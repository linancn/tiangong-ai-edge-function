// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import decodeApiKey from '../_shared/decode_api_key.ts';
import generateQuery from '../_shared/generate_query.ts';
import { getOpenAIClient } from '../_shared/openai_client.ts';
import { generateEmbedding } from '../_shared/openai_embedding.ts';
import { buildLexicalQueryCandidates } from '../_shared/search_query_utils.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const openai_embedding_model = Deno.env.get('OPENAI_EMBEDDING_MODEL') ?? '';

const pinecone_api_key = Deno.env.get('PINECONE_API_KEY_US_EAST_1') ?? '';
const pinecone_index_name = Deno.env.get('PINECONE_INDEX_NAME') ?? '';
const pinecone_namespace_course = Deno.env.get('PINECONE_NAMESPACE_COURSE') ?? '';

const opensearch_region = Deno.env.get('OPENSEARCH_REGION') ?? '';
const opensearch_domain = Deno.env.get('OPENSEARCH_DOMAIN') ?? '';
const opensearch_index_name = Deno.env.get('OPENSEARCH_COURSE_INDEX_NAME') ?? '';

const supabase_url = Deno.env.get('REMOTE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_publishable_key =
  Deno.env.get('REMOTE_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const supabase_service_role_key =
  Deno.env.get('REMOTE_SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('REMOTE_SUPABASE_SECRET_KEY') ??
  Deno.env.get('SUPABASE_SECRET_KEY') ??
  '';

const pc = new Pinecone({ apiKey: pinecone_api_key });

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

function createPublishableClient(accessToken?: string) {
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

function createServiceClient() {
  return createClient(supabase_url, supabase_service_role_key, supabaseClientOptions);
}

const authSupabase = createPublishableClient();
let serviceSupabase: ReturnType<typeof createServiceClient> | null = null;

function getServiceSupabase() {
  requireServiceRoleKey();
  serviceSupabase ??= createServiceClient();
  return serviceSupabase;
}

type QueryMode = 'retrieve' | 'answer';
type RewriteMode = 'auto' | 'off' | 'force';
type PrimitiveFilterValue = string | number | boolean;
type FilterTerms = Record<string, PrimitiveFilterValue[]>;
type FilterRanges = Record<string, { gte?: number; lte?: number }>;

interface SearchTarget {
  opensearchIndexName: string;
  pineconeIndexName: string;
  pineconeNamespace: string;
}

interface AuthContext {
  actorId: string;
  subject: string;
  collectionScope: string[];
}

interface CourseChunk {
  record_id: string;
  document_id: string;
  document_version: number | null;
  chunk_index: number;
  page_number: string | number | null;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

interface RequestBody {
  query: string;
  mode: QueryMode;
  rewrite: RewriteMode;
  scope: Record<string, unknown>;
  filters: Record<string, unknown>;
  topK: number;
  extK: number;
}

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

function requireServiceRoleKey() {
  if (!supabase_service_role_key) {
    throw new Error('Missing REMOTE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY.');
  }
}

function normalizeRequiredQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    throw new RequestValidationError('`query` must be a non-empty string.');
  }

  return rawQuery.trim();
}

function normalizePositiveInteger(rawValue: unknown, defaultValue: number, fieldName: string) {
  if (rawValue === undefined || rawValue === null) {
    return defaultValue;
  }

  const value = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new RequestValidationError(`\`${fieldName}\` must be a positive integer.`);
  }
  return value;
}

function normalizeNonNegativeInteger(rawValue: unknown, defaultValue: number, fieldName: string) {
  if (rawValue === undefined || rawValue === null) {
    return defaultValue;
  }

  const value = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim());
  if (!Number.isInteger(value) || value < 0) {
    throw new RequestValidationError(`\`${fieldName}\` must be a non-negative integer.`);
  }
  return value;
}

function normalizeMode(rawMode: unknown): QueryMode {
  if (rawMode === undefined || rawMode === null || rawMode === '') {
    return 'retrieve';
  }
  if (rawMode === 'retrieve' || rawMode === 'answer') {
    return rawMode;
  }
  throw new RequestValidationError('`mode` must be "retrieve" or "answer".');
}

function normalizeRewrite(rawRewrite: unknown): RewriteMode {
  if (rawRewrite === undefined || rawRewrite === null || rawRewrite === '') {
    return 'auto';
  }
  if (rawRewrite === 'auto' || rawRewrite === 'off' || rawRewrite === 'force') {
    return rawRewrite;
  }
  throw new RequestValidationError('`rewrite` must be "auto", "off", or "force".');
}

function normalizeObject(rawValue: unknown, fieldName: string): Record<string, unknown> {
  if (rawValue === undefined || rawValue === null) {
    return {};
  }
  if (typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    throw new RequestValidationError(`\`${fieldName}\` must be an object.`);
  }
  return rawValue as Record<string, unknown>;
}

function normalizeRequestBody(body: Record<string, unknown>): RequestBody {
  return {
    query: normalizeRequiredQuery(body.query),
    mode: normalizeMode(body.mode),
    rewrite: normalizeRewrite(body.rewrite),
    scope: normalizeObject(body.scope, 'scope'),
    filters: normalizeObject(body.filters ?? body.filter, 'filters'),
    topK: normalizePositiveInteger(body.topK, 5, 'topK'),
    extK: normalizeNonNegativeInteger(body.extK, 0, 'extK'),
  };
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
    if (text) {
      normalized.set(text, text);
    }
  }

  return [...normalized.values()];
}

function normalizeUuidList(rawValue: unknown, fieldName: string): string[] {
  const values = normalizeStringList(rawValue);
  for (const value of values) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new RequestValidationError(`\`${fieldName}\` must contain UUID values.`);
    }
  }
  return values;
}

function normalizeCollectionPath(path: string): string {
  const normalized = path.trim().replace(/^\/+|\/+$/g, '');
  if (
    !normalized ||
    normalized.includes('//') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new RequestValidationError('Collection paths must be absolute or relative safe paths.');
  }
  return `/${normalized}`;
}

function normalizeCollectionPaths(rawValue: unknown): string[] {
  return normalizeStringList(rawValue).map(normalizeCollectionPath);
}

function isPathWithin(path: string, scopePath: string) {
  return path === scopePath || path.startsWith(`${scopePath}/`);
}

function intersectScopePaths(requestedPaths: string[], tokenScopePaths: string[]) {
  if (tokenScopePaths.length === 0) {
    return requestedPaths;
  }
  if (requestedPaths.length === 0) {
    return tokenScopePaths;
  }

  const effective = new Set<string>();
  for (const requestedPath of requestedPaths) {
    for (const tokenPath of tokenScopePaths) {
      if (isPathWithin(requestedPath, tokenPath)) {
        effective.add(requestedPath);
      } else if (isPathWithin(tokenPath, requestedPath)) {
        effective.add(tokenPath);
      }
    }
  }
  return [...effective];
}

function collectionPathToTag(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? '';
}

function mergeScopeIntoFilters(
  rawFilters: Record<string, unknown>,
  scope: Record<string, unknown>,
  collectionScope: string[],
) {
  const filters = { ...rawFilters };
  const requestedPaths = normalizeCollectionPaths(scope.collection_path ?? scope.collection_paths);
  const effectivePaths = intersectScopePaths(requestedPaths, collectionScope);
  const scopeTags = effectivePaths.map(collectionPathToTag).filter(Boolean);

  if (scopeTags.length > 0) {
    filters.tags = [...normalizeStringList(filters.tags), ...scopeTags];
  }

  return filters;
}

function extractBearerToken(authorization: string | null) {
  if (!authorization) {
    return '';
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? '';
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function authenticateRequest(req: Request): Promise<AuthContext | Response> {
  const bearerToken = extractBearerToken(req.headers.get('authorization'));

  if (bearerToken) {
    requireServiceRoleKey();

    const { data, error } = await getServiceSupabase().rpc('verify_kb_api_key', {
      p_token_prefix: bearerToken.slice(0, 18),
      p_token_hash: await sha256Hex(bearerToken),
      p_required_scopes: ['kb:read'],
      p_request_context: { endpoint: 'course_search' },
    });

    if (error) {
      return jsonResponse({ error: error.message }, { status: 500 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.ok) {
      return jsonResponse(
        { error: row?.message ?? 'Invalid bearer token.' },
        { status: Number(row?.status ?? 401) },
      );
    }

    if (!row.actor_user_id) {
      return jsonResponse({ error: 'Bearer token is not mapped to an actor.' }, { status: 403 });
    }

    return {
      actorId: String(row.actor_user_id),
      subject: String(row.client_id ?? row.actor_user_id),
      collectionScope: Array.isArray(row.collection_scope)
        ? row.collection_scope.map((path: unknown) => normalizeCollectionPath(String(path)))
        : [],
    };
  }

  let email = req.headers.get('email') ?? '';
  let password = req.headers.get('password') ?? '';
  const apiKey = req.headers.get('x-api-key') ?? '';

  if (apiKey && (!email || !password)) {
    const credentials = decodeApiKey(apiKey);
    if (!credentials) {
      return jsonResponse({ error: 'Invalid API Key' }, { status: 401 });
    }
    if (!email) email = credentials.email;
    if (!password) password = credentials.password;
  }

  if (!email || !password) {
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await authSupabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || data.user?.role !== 'authenticated' || !data.user.id) {
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  return {
    actorId: data.user.id,
    subject: email,
    collectionScope: [],
  };
}

function parseRecordId(recordId: string) {
  const match = recordId.match(/^(.+)_([0-9]+)$/);
  if (!match) {
    return null;
  }
  return {
    documentId: match[1],
    chunkIndex: Number(match[2]),
  };
}

function getIdRange(id: string, extK: number): Set<string> {
  const idRange = new Set<string>();
  const parsed = parseRecordId(id);
  if (!parsed) {
    return idRange;
  }

  const prefix = `${parsed.documentId}_`;
  for (let i = Math.max(0, parsed.chunkIndex - extK); i <= parsed.chunkIndex + extK; i++) {
    idRange.add(`${prefix}${i}`);
  }
  return idRange;
}

function normalizePrimitiveFilterValue(value: unknown): PrimitiveFilterValue | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? text : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

function normalizeFilters(rawFilters: Record<string, unknown>) {
  const allowedFilterFields = new Set(['tags', 'raw_relative_path', 'page_number']);
  const terms: FilterTerms = {};
  const range: FilterRanges = {};

  for (const [field, rawValue] of Object.entries(rawFilters)) {
    if (!allowedFilterFields.has(field)) {
      throw new RequestValidationError(
        `Unsupported filter field: ${field}. Supported fields: tags, raw_relative_path, page_number.`,
      );
    }

    if (
      field === 'page_number' &&
      rawValue &&
      typeof rawValue === 'object' &&
      !Array.isArray(rawValue)
    ) {
      const rawRange = rawValue as Record<string, unknown>;
      const pageRange: { gte?: number; lte?: number } = {};
      for (const boundary of ['gte', 'lte'] as const) {
        const boundaryValue = rawRange[boundary];
        if (boundaryValue === undefined || boundaryValue === null || boundaryValue === '') {
          continue;
        }
        const parsed = typeof boundaryValue === 'number' ? boundaryValue : Number(boundaryValue);
        if (!Number.isFinite(parsed)) {
          throw new RequestValidationError('`filters.page_number.gte/lte` must be numbers.');
        }
        pageRange[boundary] = parsed;
      }
      if (Object.keys(pageRange).length > 0) {
        range[field] = pageRange;
      }
      continue;
    }

    const values = (Array.isArray(rawValue) ? rawValue : [rawValue])
      .map(normalizePrimitiveFilterValue)
      .filter((value): value is PrimitiveFilterValue => value !== null);

    if (values.length > 0) {
      terms[field] = [
        ...new Map(values.map((value) => [`${typeof value}:${String(value)}`, value])).values(),
      ];
    }
  }

  return { terms, range };
}

function buildOpenSearchFilter(filters: ReturnType<typeof normalizeFilters>) {
  const clauses: Array<Record<string, unknown>> = [];

  for (const [field, values] of Object.entries(filters.terms)) {
    clauses.push({ terms: { [field]: values } });
  }

  for (const [field, value] of Object.entries(filters.range)) {
    clauses.push({ range: { [field]: value } });
  }

  return clauses;
}

function buildPineconeFilter(filters: ReturnType<typeof normalizeFilters>) {
  const clauses: Array<Record<string, unknown>> = [];

  for (const [field, values] of Object.entries(filters.terms)) {
    clauses.push({ [field]: { $in: values } });
  }

  for (const [field, value] of Object.entries(filters.range)) {
    clauses.push({
      [field]: {
        ...(value.gte !== undefined ? { $gte: value.gte } : {}),
        ...(value.lte !== undefined ? { $lte: value.lte } : {}),
      },
    });
  }

  return clauses.length > 0 ? { $and: clauses } : undefined;
}

function shouldAutoRewrite(query: string) {
  const trimmed = query.trim();
  if (/^(doi|isbn|issn|patent|标准号)[:：]/i.test(trimmed)) {
    return false;
  }
  if (/^[a-z0-9_\-./:]+$/i.test(trimmed) && trimmed.length <= 32) {
    return false;
  }
  return trimmed.length > 12 || /[?？,，。;；\s]/u.test(trimmed);
}

async function buildQueryPack(query: string, rewrite: RewriteMode) {
  if (rewrite === 'off' || (rewrite === 'auto' && !shouldAutoRewrite(query))) {
    return {
      semanticQuery: query,
      fullTextQueries: [query],
      rewriteApplied: false,
    };
  }

  const rewritten = await generateQuery(query);
  return {
    semanticQuery: rewritten.semantic_query,
    fullTextQueries: buildLexicalQueryCandidates(rewritten),
    rewriteApplied: true,
  };
}

function loadCourseSearchTarget(): SearchTarget {
  return {
    opensearchIndexName: opensearch_index_name,
    pineconeIndexName: pinecone_index_name,
    pineconeNamespace: pinecone_namespace_course,
  };
}

function readSourceText(source: Record<string, unknown>) {
  return typeof source.text === 'string' ? source.text : String(source.text ?? '');
}

function readMetadataNumber(source: Record<string, unknown>, field: string) {
  const value = source[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function chunkFromRecord(
  recordId: string,
  score: number,
  metadata: Record<string, unknown>,
): CourseChunk | null {
  const parsed = parseRecordId(recordId);
  if (!parsed) {
    return null;
  }

  const text = readSourceText(metadata);
  if (!text) {
    return null;
  }

  return {
    record_id: recordId,
    document_id: parsed.documentId,
    document_version: readMetadataNumber(metadata, 'document_version'),
    chunk_index: parsed.chunkIndex,
    page_number:
      metadata.page_number === undefined ? null : (metadata.page_number as string | number),
    score,
    text,
    metadata: Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'text')),
  };
}

async function retrieveChunks(
  target: SearchTarget,
  semanticQuery: string,
  fullTextQueries: string[],
  topK: number,
  extK: number,
  filters: ReturnType<typeof normalizeFilters>,
) {
  const searchVector = await generateEmbedding(semanticQuery, {
    model: openai_embedding_model,
  });

  const opensearchFilters = buildOpenSearchFilter(filters);
  const opensearchBody = {
    query: {
      bool: {
        should: fullTextQueries.map((query) => ({ match: { text: query } })),
        minimum_should_match: 1,
        ...(opensearchFilters.length > 0 ? { filter: opensearchFilters } : {}),
      },
    },
    size: topK,
  };

  const pineconeFilter = buildPineconeFilter(filters);
  const pineconeIndex = pc.index(target.pineconeIndexName);

  const [pineconeResponse, fulltextResponse] = await Promise.all([
    pineconeIndex.namespace(target.pineconeNamespace).query({
      vector: searchVector,
      topK,
      includeMetadata: true,
      includeValues: false,
      ...(pineconeFilter ? { filter: pineconeFilter } : {}),
    }),
    opensearchClient.search({
      index: target.opensearchIndexName,
      body: opensearchBody,
    }),
  ]);

  const chunks = new Map<string, CourseChunk>();
  const candidateIds = new Set<string>();

  for (const match of pineconeResponse.matches ?? []) {
    if (!match.id || !match.metadata) {
      continue;
    }
    const chunk = chunkFromRecord(
      String(match.id),
      typeof match.score === 'number' ? match.score : 0,
      match.metadata as Record<string, unknown>,
    );
    if (!chunk) {
      continue;
    }
    chunks.set(chunk.record_id, chunk);
    candidateIds.add(chunk.record_id);
  }

  const hits = (fulltextResponse.body?.hits?.hits ?? []) as Array<{
    _id: string;
    _score?: number;
    _source?: Record<string, unknown>;
  }>;

  for (const hit of hits) {
    if (!hit._source) {
      continue;
    }
    const chunk = chunkFromRecord(hit._id, hit._score ?? 0, hit._source);
    if (!chunk) {
      continue;
    }
    const existing = chunks.get(chunk.record_id);
    if (!existing || chunk.score > existing.score) {
      chunks.set(chunk.record_id, chunk);
    }
    candidateIds.add(chunk.record_id);
  }

  if (extK > 0 && candidateIds.size > 0) {
    const extendedIds = new Set<string>();
    for (const id of candidateIds) {
      for (const extendedId of getIdRange(id, extK)) {
        if (!candidateIds.has(extendedId)) {
          extendedIds.add(extendedId);
        }
      }
    }

    if (extendedIds.size > 0) {
      const extFulltextResponse = await opensearchClient.mget({
        index: target.opensearchIndexName,
        body: {
          ids: [...extendedIds],
        },
      });

      const docs = (extFulltextResponse.body.docs ?? []) as Array<{
        _id: string;
        _source?: Record<string, unknown>;
        found?: boolean;
      }>;

      for (const doc of docs) {
        if (!doc.found || !doc._source) {
          continue;
        }
        const chunk = chunkFromRecord(doc._id, 0, doc._source);
        if (chunk && !chunks.has(chunk.record_id)) {
          chunks.set(chunk.record_id, chunk);
        }
      }
    }
  }

  return [...chunks.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.document_id !== b.document_id) {
      return a.document_id.localeCompare(b.document_id);
    }
    return a.chunk_index - b.chunk_index;
  });
}

function toResponseChunk(chunk: CourseChunk) {
  return {
    record_id: chunk.record_id,
    document_id: chunk.document_id,
    document_version: chunk.document_version,
    chunk_id: `chunk_${chunk.chunk_index}`,
    chunk_index: chunk.chunk_index,
    page_number: chunk.page_number,
    score: chunk.score,
    text: chunk.text,
    metadata: chunk.metadata,
  };
}

function toSourceEntry(chunk: ReturnType<typeof toResponseChunk>) {
  const rawRelativePath = chunk.metadata.raw_relative_path;
  const source =
    typeof rawRelativePath === 'string' && rawRelativePath.trim()
      ? rawRelativePath.trim()
      : chunk.document_id;

  return chunk.page_number === null || chunk.page_number === ''
    ? source
    : `${source}#page=${chunk.page_number}`;
}

function toCourseDocuments(chunks: ReturnType<typeof toResponseChunk>[]) {
  const sorted = [...chunks].sort((a, b) => {
    if (a.document_id !== b.document_id) {
      return a.document_id.localeCompare(b.document_id);
    }
    return a.chunk_index - b.chunk_index;
  });

  const documents: Array<{ content: string; source: string }> = [];
  let currentDocumentId = '';
  let currentTexts: string[] = [];
  let currentSource = '';

  for (const chunk of sorted) {
    if (chunk.document_id !== currentDocumentId) {
      if (currentTexts.length > 0) {
        documents.push({
          content: currentTexts.join('\n'),
          source: currentSource,
        });
      }
      currentDocumentId = chunk.document_id;
      currentTexts = [chunk.text];
      currentSource = toSourceEntry(chunk);
    } else {
      currentTexts.push(chunk.text);
    }
  }

  if (currentTexts.length > 0) {
    documents.push({
      content: currentTexts.join('\n'),
      source: currentSource,
    });
  }

  return documents;
}

async function synthesizeAnswer(query: string, chunks: ReturnType<typeof toResponseChunk>[]) {
  if (chunks.length === 0) {
    return {
      answer: 'I do not have enough authorized course material to answer this question.',
      citations: [],
    };
  }

  const client = getOpenAIClient(Deno.env.get('OPENAI_BASE_URL') || undefined) as unknown as {
    responses?: { create?: (args: unknown) => Promise<unknown> };
    chat?: { completions?: { create?: (args: unknown) => Promise<unknown> } };
  };
  const model = Deno.env.get('OPENAI_CHAT_MODEL') || 'gpt-4o-mini';
  const context = chunks
    .slice(0, 8)
    .map(
      (chunk, index) =>
        `[${index + 1}] document_id=${chunk.document_id} chunk=${chunk.chunk_index}\n${chunk.text}`,
    )
    .join('\n\n');

  const systemPrompt =
    'Answer using only the provided authorized course context. If the context is insufficient, say that you do not have enough evidence. Include bracketed citation numbers for factual claims.';
  const userPrompt = `Question:\n${query}\n\nAuthorized course context:\n${context}`;

  let rawResponse: unknown;
  if (client.responses?.create) {
    rawResponse = await client.responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
  } else if (client.chat?.completions?.create) {
    rawResponse = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
  } else {
    throw new Error('OpenAI SDK missing both responses.create and chat.completions.create');
  }

  const answer = extractOpenAIText(rawResponse);

  return {
    answer: answer || 'I do not have enough authorized course material to answer this question.',
    citations: chunks.slice(0, 8).map((chunk, index) => ({
      citation_id: index + 1,
      record_id: chunk.record_id,
      document_id: chunk.document_id,
      chunk_index: chunk.chunk_index,
    })),
  };
}

function extractOpenAIText(response: unknown): string {
  if (!response || typeof response !== 'object') {
    return '';
  }

  const record = response as Record<string, unknown>;
  if (typeof record.output_text === 'string') {
    return record.output_text.trim();
  }

  const output = record.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content =
        item && typeof item === 'object' ? (item as Record<string, unknown>).content : null;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (
          part &&
          typeof part === 'object' &&
          typeof (part as Record<string, unknown>).text === 'string'
        ) {
          return String((part as Record<string, unknown>).text).trim();
        }
      }
    }
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const message =
        choice && typeof choice === 'object' ? (choice as Record<string, unknown>).message : null;
      if (message && typeof message === 'object') {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === 'string') {
          return content.trim();
        }
      }
    }
  }

  return '';
}

async function insertQueryLog(input: {
  actorId: string;
  scope: Record<string, unknown>;
  mode: QueryMode;
  rewrite: RewriteMode;
  rewriteApplied: boolean;
  originalQuery: string;
  semanticQuery: string;
  fullTextQueries: string[];
  filters: Record<string, unknown>;
  topK: number;
  extK: number;
  resultCount: number;
  latencyMs: number;
}) {
  const { error } = await getServiceSupabase()
    .from('kb_query_logs')
    .insert({
      actor_id: input.actorId,
      scope_json: input.scope,
      mode: input.mode,
      rewrite_mode: input.rewrite,
      rewrite_applied: input.rewriteApplied,
      original_query: input.originalQuery,
      semantic_query: input.semanticQuery,
      full_text_query: input.fullTextQueries.join('\n'),
      filters_json: input.filters,
      top_k: input.topK,
      ext_k: input.extK > 0 ? input.extK : null,
      result_count: input.resultCount,
      latency_ms: input.latencyMs,
    });

  if (error) {
    console.error('Failed to insert kb_query_logs row:', error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const parsedBody = await req.json();
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return jsonResponse(
        { error: 'Request body must be a JSON object.' },
        {
          status: 400,
        },
      );
    }

    const body = normalizeRequestBody(parsedBody as Record<string, unknown>);
    const auth = await authenticateRequest(req);
    if (auth instanceof Response) {
      return auth;
    }

    const startedAt = Date.now();
    const documentScopeIds = normalizeUuidList(body.scope.document_ids, 'scope.document_ids');
    const target = loadCourseSearchTarget();

    if (!target.opensearchIndexName || !target.pineconeIndexName || !target.pineconeNamespace) {
      return jsonResponse(
        {
          error:
            'Course search target is not configured. Expected kb_search_partitions course row or course search environment variables.',
        },
        { status: 500 },
      );
    }

    const filters = normalizeFilters(
      mergeScopeIntoFilters(body.filters, body.scope, auth.collectionScope),
    );
    const queryPack = await buildQueryPack(body.query, body.rewrite);
    const retrievedChunks = await retrieveChunks(
      target,
      queryPack.semanticQuery,
      queryPack.fullTextQueries,
      body.topK,
      body.extK,
      filters,
    );

    const scopedDocumentIds = new Set(documentScopeIds);
    const chunks = retrievedChunks
      .filter((chunk) => scopedDocumentIds.size === 0 || scopedDocumentIds.has(chunk.document_id))
      .map(toResponseChunk);

    const courseDocuments = toCourseDocuments(chunks);
    const answerResult =
      body.mode === 'answer'
        ? await synthesizeAnswer(body.query, chunks)
        : { answer: null, citations: [] };
    const latencyMs = Date.now() - startedAt;

    await insertQueryLog({
      actorId: auth.actorId,
      scope: body.scope,
      mode: body.mode,
      rewrite: body.rewrite,
      rewriteApplied: queryPack.rewriteApplied,
      originalQuery: body.query,
      semanticQuery: queryPack.semanticQuery,
      fullTextQueries: queryPack.fullTextQueries,
      filters: body.filters,
      topK: body.topK,
      extK: body.extK,
      resultCount: courseDocuments.length,
      latencyMs,
    });
    logInsert(auth.subject, Date.now(), 'course_search', body.topK, body.extK);

    if (body.mode === 'retrieve') {
      return jsonResponse(courseDocuments);
    }

    const queryId = crypto.randomUUID();
    return jsonResponse({
      query_id: queryId,
      mode: body.mode,
      rewrite: body.rewrite,
      rewrite_applied: queryPack.rewriteApplied,
      answer: answerResult.answer,
      citations: answerResult.citations,
      chunks,
      result_count: chunks.length,
      latency_ms: latencyMs,
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    console.error(error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'course_search failed.',
      },
      { status: 500 },
    );
  }
});
