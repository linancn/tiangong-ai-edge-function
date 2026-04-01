// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js@2';
import { Redis } from '@upstash/redis';
import { corsHeaders } from '../_shared/cors.ts';
import decodeApiKey from '../_shared/decode_api_key.ts';
import {
  extractSynonymTerms,
  mergeSynonymTerms,
  prependSynonymsToText,
} from '../_shared/document_synonyms.ts';
import generateQuery from '../_shared/generate_query.ts';
import { generateEmbedding } from '../_shared/openai_embedding.ts';
import { buildLexicalQueryCandidates } from '../_shared/search_query_utils.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const openai_embedding_model = Deno.env.get('OPENAI_EMBEDDING_MODEL') ?? '';

const pinecone_api_key = Deno.env.get('PINECONE_API_KEY_US_EAST_1') ?? '';
const pinecone_index_name = Deno.env.get('PINECONE_INDEX_NAME') ?? '';
const pinecone_namespace_edu = Deno.env.get('PINECONE_NAMESPACE_EDU') ?? '';

const opensearch_region = Deno.env.get('OPENSEARCH_REGION') ?? '';
const opensearch_domain = Deno.env.get('OPENSEARCH_DOMAIN') ?? '';
const opensearch_index_name = Deno.env.get('OPENSEARCH_EDU_INDEX_NAME') ?? '';

const supabase_url = Deno.env.get('REMOTE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_publishable_key =
  Deno.env.get('REMOTE_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';

const redis_url = Deno.env.get('UPSTASH_REDIS_URL') ?? '';
const redis_token = Deno.env.get('UPSTASH_REDIS_TOKEN') ?? '';

const pc = new Pinecone({ apiKey: pinecone_api_key });
const index = pc.index(pinecone_index_name);

const opensearchClient = new Client({
  ...AwsSigv4Signer({
    region: opensearch_region,
    service: 'aoss',

    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    },
  }),
  node: opensearch_domain,
});

const supabaseClientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
};

function createSupabaseClient(accessToken?: string) {
  return createClient(
    supabase_url,
    supabase_publishable_key,
    accessToken
      ? {
          ...supabaseClientOptions,
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        }
      : supabaseClientOptions,
  );
}

const supabase = createSupabaseClient();

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

const EDU_FILTER_FIELDS = [
  'course',
  'type',
  'file_type',
  'language',
  'chapter_number',
  'name',
] as const;

type EduFilterField = (typeof EDU_FILTER_FIELDS)[number];
type SearchFilter = { course: string[] } | undefined;
type MetadataFilter = Partial<Record<EduFilterField, Array<string | number>>>;
type PCFilter = {
  $or: { course: string }[];
};

interface EduMetaRow {
  course?: string | null;
  type?: string | null;
  file_type?: string | null;
  language?: string | null;
  chapter_number?: number | null;
  name?: string | null;
}

interface FilterOption {
  value: string | number;
  count: number;
}

type UserScopedEduMetaAuthResult =
  | { ok: true; client: ReturnType<typeof createSupabaseClient> }
  | { ok: false; response: Response };

class RequestValidationError extends Error {}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  headers.set('Content-Type', 'application/json');

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function isEduFilterField(value: string): value is EduFilterField {
  return EDU_FILTER_FIELDS.includes(value as EduFilterField);
}

function normalizeStringList(rawValue: unknown): string[] {
  if (rawValue === undefined || rawValue === null) {
    return [];
  }

  const values = Array.isArray(rawValue) ? rawValue : [rawValue];
  const normalized = new Map<string, string>();

  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const text = String(value).trim();
    if (!text) {
      continue;
    }

    normalized.set(text, text);
  }

  return [...normalized.values()];
}

function normalizeSearchFilter(rawFilter: unknown): SearchFilter {
  if (!rawFilter || typeof rawFilter !== 'object' || Array.isArray(rawFilter)) {
    return undefined;
  }

  const course = normalizeStringList((rawFilter as Record<string, unknown>).course);
  if (course.length === 0) {
    return undefined;
  }

  return { course };
}

function hasCourseFilter(filter: SearchFilter): filter is { course: string[] } {
  return !!filter && filter.course.length > 0;
}

function filterToPCQuery(filter: { course: string[] }): PCFilter {
  const { course } = filter;
  const andConditions = course.map((c) => ({ course: c }));

  return { $or: andConditions };
}

function normalizeRequestedFields(rawFields: unknown): EduFilterField[] {
  if (rawFields === undefined) {
    return [...EDU_FILTER_FIELDS];
  }

  if (!Array.isArray(rawFields)) {
    throw new RequestValidationError('`fields` must be an array of supported field names.');
  }

  const uniqueFields = new Set<EduFilterField>();

  for (const field of rawFields) {
    if (typeof field !== 'string' || !isEduFilterField(field)) {
      throw new RequestValidationError(
        `Unsupported field: ${String(field)}. Supported fields: ${EDU_FILTER_FIELDS.join(', ')}`,
      );
    }
    uniqueFields.add(field);
  }

  if (uniqueFields.size === 0) {
    throw new RequestValidationError('`fields` must contain at least one supported field.');
  }

  return [...uniqueFields];
}

function normalizeMetadataFilterValue(
  field: EduFilterField,
  value: unknown,
): string | number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (field === 'chapter_number') {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }

    const text = String(value).trim();
    if (!text) {
      return null;
    }

    const parsed = Number(text);
    if (!Number.isInteger(parsed)) {
      throw new RequestValidationError('`filter.chapter_number` must contain integers.');
    }

    return parsed;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function normalizeMetadataFilter(rawFilter: unknown): MetadataFilter {
  if (rawFilter === undefined || rawFilter === null) {
    return {};
  }

  if (typeof rawFilter !== 'object' || Array.isArray(rawFilter)) {
    throw new RequestValidationError('`filter` must be an object.');
  }

  const normalizedFilter: MetadataFilter = {};

  for (const [field, rawValues] of Object.entries(rawFilter as Record<string, unknown>)) {
    if (!isEduFilterField(field)) {
      throw new RequestValidationError(
        `Unsupported filter field: ${field}. Supported fields: ${EDU_FILTER_FIELDS.join(', ')}`,
      );
    }

    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    const normalizedValues = new Map<string, string | number>();

    for (const value of values) {
      const normalizedValue = normalizeMetadataFilterValue(field, value);
      if (normalizedValue === null) {
        continue;
      }

      normalizedValues.set(`${typeof normalizedValue}:${String(normalizedValue)}`, normalizedValue);
    }

    if (normalizedValues.size > 0) {
      normalizedFilter[field] = [...normalizedValues.values()];
    }
  }

  return normalizedFilter;
}

function buildEduMetaSelect(fields: EduFilterField[]): string {
  return [...new Set(fields)].join(',');
}

function matchesMetadataFilter(row: EduMetaRow, filter: MetadataFilter): boolean {
  for (const field of Object.keys(filter) as EduFilterField[]) {
    const acceptedValues = filter[field];
    if (!acceptedValues || acceptedValues.length === 0) {
      continue;
    }

    const rowValue = row[field];
    if (rowValue === undefined || rowValue === null) {
      return false;
    }

    if (!acceptedValues.some((acceptedValue) => acceptedValue === rowValue)) {
      return false;
    }
  }

  return true;
}

function buildFieldOptions(rows: EduMetaRow[], field: EduFilterField): FilterOption[] {
  const options = new Map<string, FilterOption>();

  for (const row of rows) {
    const value = row[field];
    if (value === undefined || value === null || value === '') {
      continue;
    }

    const key = `${typeof value}:${String(value)}`;
    const existing = options.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    options.set(key, {
      value,
      count: 1,
    });
  }

  return [...options.values()].sort((a, b) => {
    if (field === 'chapter_number') {
      return Number(a.value) - Number(b.value);
    }

    return String(a.value).localeCompare(String(b.value), 'zh-Hans-CN');
  });
}

async function listFilterOptions(
  supabaseClient: ReturnType<typeof createSupabaseClient>,
  rawFields: unknown,
  rawFilter: unknown,
) {
  const requestedFields = normalizeRequestedFields(rawFields);
  const normalizedFilter = normalizeMetadataFilter(rawFilter);
  const selectedFields = [
    ...requestedFields,
    ...(Object.keys(normalizedFilter) as EduFilterField[]),
  ];

  const { data, error } = await supabaseClient
    .from('edu_meta')
    .select(buildEduMetaSelect(selectedFields));

  if (error) {
    throw new Error(`Failed to query edu_meta: ${error.message}`);
  }

  const rows = (data ?? []) as EduMetaRow[];
  const matchedRows = rows.filter((row) => matchesMetadataFilter(row, normalizedFilter));

  return {
    action: 'list_filter_options',
    supported_fields: [...EDU_FILTER_FIELDS],
    requested_fields: requestedFields,
    total_records: rows.length,
    matched_records: matchedRows.length,
    applied_filter: normalizedFilter,
    options: Object.fromEntries(
      requestedFields.map((field) => [field, buildFieldOptions(matchedRows, field)]),
    ),
  };
}

function normalizeRequiredQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    throw new RequestValidationError('`query` must be a non-empty string.');
  }

  return rawQuery.trim();
}

function normalizeNonNegativeInteger(
  rawValue: unknown,
  defaultValue: number,
  fieldName: string,
): number {
  if (rawValue === undefined || rawValue === null) {
    return defaultValue;
  }

  const value = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim());
  if (!Number.isInteger(value) || value < 0) {
    throw new RequestValidationError(`\`${fieldName}\` must be a non-negative integer.`);
  }

  return value;
}

async function createUserScopedEduMetaClient(
  email: string,
  password: string,
): Promise<UserScopedEduMetaAuthResult> {
  if (!email || !password) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const authClient = createSupabaseClient();
  const { data, error } = await authClient.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (data.user?.role !== 'authenticated') {
    return {
      ok: false,
      response: jsonResponse({ error: 'You are not an authenticated user.' }, { status: 401 }),
    };
  }

  const accessToken = data.session?.access_token;
  if (!accessToken) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  await redis.setex(email, 3600, '');

  return {
    ok: true,
    client: createSupabaseClient(accessToken),
  };
}

function getIdRange(id: string, extK: number): Set<string> {
  const idRange = new Set<string>();
  const match = id.match(/_(\d+)$/);
  if (match) {
    const baseId = parseInt(match[1], 10);
    for (let i = Math.max(0, baseId - extK); i <= baseId + extK; i++) {
      idRange.add(`${id.substring(0, id.lastIndexOf('_') + 1)}${i}`);
    }
  }
  return idRange;
}

interface Document {
  sort_id: number;
  id: string;
  name: string;
  chapter_number: number;
  course: string;
  text: string;
  synonyms: string[];
}

const search = async (
  semantic_query: string,
  full_text_query: string[],
  topK: number,
  extK: number,
  filter: SearchFilter,
) => {
  // console.log(query, topK, filter);

  const searchVector = await generateEmbedding(semantic_query, {
    model: openai_embedding_model,
  });

  // console.log(filter);

  const body = {
    query: hasCourseFilter(filter)
      ? {
          bool: {
            should: full_text_query.map((query) => ({
              match: { text: query },
            })),
            minimum_should_match: 1,
            filter: [{ terms: { course: filter.course } }],
          },
        }
      : {
          bool: {
            should: full_text_query.map((query) => ({
              match: { text: query },
            })),
            minimum_should_match: 1,
          },
        },
    size: topK,
  };
  // console.log(filter.course);

  // console.log(body.query.bool.filter);
  // console.log(filterToPCQuery(filter));

  interface QueryOptions {
    vector: number[];
    topK: number;
    includeMetadata: boolean;
    includeValues: boolean;
    filter?: PCFilter;
  }

  const queryOptions: QueryOptions = {
    vector: searchVector,
    topK: topK,
    includeMetadata: true,
    includeValues: false,
  };

  if (hasCourseFilter(filter)) {
    queryOptions.filter = filterToPCQuery(filter);
  }

  const [pineconeResponse, fulltextResponse] = await Promise.all([
    index.namespace(pinecone_namespace_edu).query(queryOptions),
    opensearchClient.search({
      index: opensearch_index_name,
      body: body,
    }),
  ]);

  // if (!pineconeResponse) {
  //   console.error("Pinecone query response is empty.");
  // }

  // console.log(pineconeResponse);
  // console.log(fulltextResponse.body.hits.hits);

  // if (!pineconeResponse || !fulltextResponse) {
  //   throw new Error("One or both of the search queries failed");
  // }

  const id_set = new Set<string>();
  const unique_docs: Document[] = [];

  for (const doc of pineconeResponse.matches) {
    const id = doc.id;

    id_set.add(id);
    if (doc.metadata) {
      const metadata = doc.metadata as Record<string, any>;
      unique_docs.push({
        sort_id: parseInt(doc.id.match(/_(\d+)$/)?.[1] ?? '0', 10),
        id: metadata.rec_id,
        course: metadata.course,
        name: metadata.name,
        chapter_number: metadata.chapter_number,
        text: metadata.text,
        synonyms: extractSynonymTerms(metadata),
      });
    }
  }

  for (const hit of fulltextResponse.body.hits.hits) {
    const doc = hit as { _id: string; _source?: Record<string, any> };
    const id = doc._id;
    if (!doc._source || typeof doc._source !== 'object') {
      continue;
    }

    if (!id_set.has(id)) {
      id_set.add(id);
      const sourceDoc = doc._source;
      unique_docs.push({
        sort_id: parseInt(doc._id.match(/_(\d+)$/)?.[1] ?? '0', 10),
        id: sourceDoc.rec_id,
        course: sourceDoc.course,
        name: sourceDoc.name,
        chapter_number: sourceDoc.chapter_number,
        text: sourceDoc.text,
        synonyms: extractSynonymTerms(sourceDoc),
      });
    }
  }

  // console.log(id_set);

  if (extK > 0) {
    const extend_ids = new Set<string>();
    for (const id of id_set) {
      const idRange = getIdRange(id, extK);
      for (const id of idRange) {
        extend_ids.add(id);
      }
    }

    for (const id of id_set) {
      extend_ids.delete(id);
    }

    const extFulltextResponse = await opensearchClient.mget({
      index: opensearch_index_name,
      body: {
        ids: [...extend_ids],
      },
    });

    const filteredResponse = (extFulltextResponse.body.docs as unknown[]).filter(
      (
        doc: unknown,
      ): doc is {
        _id: string;
        _source: Record<string, any>;
        found: true;
      } => {
        if (!doc || typeof doc !== 'object') {
          return false;
        }

        const record = doc as Record<string, unknown>;
        return (
          record.found === true &&
          typeof record._id === 'string' &&
          !!record._source &&
          typeof record._source === 'object'
        );
      },
    );
    // console.log(filteredResponse);

    for (const doc of filteredResponse) {
      const sourceDoc = doc._source;
      // console.log(filteredResponse);
      unique_docs.push({
        sort_id: parseInt(doc._id.match(/_(\d+)$/)?.[1] ?? '0', 10),
        id: sourceDoc.rec_id,
        course: sourceDoc.course,
        name: sourceDoc.name,
        chapter_number: sourceDoc.chapter_number,
        text: sourceDoc.text,
        synonyms: extractSynonymTerms(sourceDoc),
      });
    }
  }

  unique_docs.sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return a.sort_id - b.sort_id;
  });

  const combinedDocs: Document[] = [];
  let currentGroup: Document[] = [];
  let currentId: string | null = null;

  for (const doc of unique_docs) {
    if (doc.id !== currentId) {
      if (currentGroup.length > 0) {
        // Combine texts for the current group
        const combinedText = currentGroup.map((doc) => doc.text).join('\n');
        const combinedSynonyms = mergeSynonymTerms(...currentGroup.map((doc) => doc.synonyms));
        combinedDocs.push({
          ...currentGroup[0],
          text: combinedText,
          synonyms: combinedSynonyms,
        });
      }
      currentGroup = [doc];
      currentId = doc.id;
    } else {
      currentGroup.push(doc);
    }
  }

  // Handle the last group
  if (currentGroup.length > 0) {
    const combinedText = currentGroup.map((doc) => doc.text).join('\n');
    const combinedSynonyms = mergeSynonymTerms(...currentGroup.map((doc) => doc.synonyms));
    combinedDocs.push({
      ...currentGroup[0],
      text: combinedText,
      synonyms: combinedSynonyms,
    });
  }

  const docList = combinedDocs.map((doc) => {
    const course = doc.course;
    const name = doc.name;
    const chapter_number = doc.chapter_number;
    const source_entry = `${course}: **${name} (Ch. ${chapter_number})**.`;
    return {
      content: prependSynonymsToText(doc.text, doc.synonyms),
      source: source_entry,
    };
  });

  return docList;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    const parsedBody = await req.json();
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return jsonResponse({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }

    body = parsedBody as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  let email = req.headers.get('email') ?? '';
  let password = req.headers.get('password') ?? '';

  const apiKey = req.headers.get('x-api-key') ?? '';
  // console.log(apiKey);

  if (apiKey && (!email || !password)) {
    const credentials = decodeApiKey(apiKey);

    if (credentials) {
      if (!email) email = credentials.email;
      if (!password) password = credentials.password;
    } else {
      return jsonResponse({ error: 'Invalid API Key' }, { status: 401 });
    }
  }

  const action = body.action;

  if (action !== undefined && action !== 'list_filter_options') {
    return jsonResponse(
      {
        error: `Unsupported action: ${String(action)}`,
        supported_actions: ['list_filter_options'],
      },
      { status: 400 },
    );
  }

  if (action === 'list_filter_options') {
    try {
      const authResult = await createUserScopedEduMetaClient(email, password);
      if (!authResult.ok) {
        return authResult.response;
      }

      const result = await listFilterOptions(authResult.client, body.fields, body.filter);
      logInsert(email, Date.now(), 'edu_search:list_filter_options');

      return jsonResponse(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return jsonResponse(
          {
            error: error.message,
            supported_fields: [...EDU_FILTER_FIELDS],
          },
          { status: 400 },
        );
      }

      return jsonResponse(
        {
          error: error instanceof Error ? error.message : 'Failed to list filter options.',
        },
        { status: 500 },
      );
    }
  }

  // let first_login = false;

  if (!(await redis.exists(email))) {
    const authResponse = await supabaseAuth(supabase, email, password);
    if (authResponse.status !== 200) {
      return authResponse;
    } else {
      await redis.setex(email, 3600, '');
      // first_login = true;
    }
  }

  let query = '';
  let filter: SearchFilter = undefined;
  let topK = 5;
  let extK = 0;

  try {
    query = normalizeRequiredQuery(body.query);
    filter = normalizeSearchFilter(body.filter);
    topK = normalizeNonNegativeInteger(body.topK, 5, 'topK');
    extK = normalizeNonNegativeInteger(body.extK, 0, 'extK');
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    throw error;
  }

  logInsert(email, Date.now(), 'edu_search', topK, extK);

  const res = await generateQuery(query);
  // console.log(res);
  const result = await search(
    res.semantic_query,
    buildLexicalQueryCandidates(res),
    topK,
    extK,
    filter,
  );
  // console.log(result);

  return jsonResponse(result);
});
