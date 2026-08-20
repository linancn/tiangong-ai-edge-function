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
import generateQuery from '../_shared/generate_query.ts';
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
const supabase_service_role_key = getSupabaseAdminKey();

const redis_url = Deno.env.get('UPSTASH_REDIS_URL') ?? '';
const redis_token = Deno.env.get('UPSTASH_REDIS_TOKEN') ?? '';

const auth_cache_ttl_seconds = 15 * 60;
const auth_cache_version = 'v1';
const course_search_required_scopes = ['kb:read'];

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
const redis = redis_url && redis_token ? new Redis({ url: redis_url, token: redis_token }) : null;

function getServiceSupabase() {
  requireServiceRoleKey();
  serviceSupabase ??= createServiceClient();
  return serviceSupabase;
}

type FilterType = { [field: string]: string[] };
type DateFilterType = { [field: string]: { gte?: number; lte?: number } };
type FiltersItem = {
  terms?: FilterType;
  range?: DateFilterType;
};
type FiltersType = FiltersItem[];
type PCFilter = {
  $and: Array<{ [field: string]: { $in?: string[]; $gte?: number; $lte?: number } }>;
};

interface SearchTarget {
  opensearchIndexName: string;
  pineconeIndexName: string;
  pineconeNamespace: string;
}

interface AuthContext {
  subject: string;
  collectionScope: string[];
}

interface CachedAuthContext extends AuthContext {
  expiresAt: string | null;
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
  filter: FilterType;
  datefilter: DateFilterType;
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
    throw new Error('Missing Supabase admin key. Expected SUPABASE_SECRET_KEYS.default.');
  }
}

function trimEnv(value: string | undefined) {
  return value?.trim() ?? '';
}

function getSupabaseSecretKeyFromDictionary() {
  const rawSecretKeys = trimEnv(Deno.env.get('SUPABASE_SECRET_KEYS'));
  if (!rawSecretKeys) {
    return '';
  }

  try {
    const secretKeys = JSON.parse(rawSecretKeys) as Record<string, unknown>;
    const defaultKey = secretKeys.default;
    if (typeof defaultKey === 'string' && defaultKey.trim()) {
      return defaultKey.trim();
    }

    return '';
  } catch (error) {
    console.error('Failed to parse SUPABASE_SECRET_KEYS:', error);
    return '';
  }
}

function getSupabaseAdminKey() {
  return getSupabaseSecretKeyFromDictionary();
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
    filter: normalizeFilter(normalizeObject(body.filter, 'filter')),
    datefilter: normalizeDateFilter(body.datefilter),
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

function collectionPathToTag(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? '';
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

async function buildAuthCacheKey(tokenHash: string) {
  const scopedHash = await sha256Hex(
    `course_search|${course_search_required_scopes.join(',')}|${tokenHash}`,
  );
  return `course_search:auth:${auth_cache_version}:${scopedHash}`;
}

function normalizeCollectionScope(rawScope: unknown): string[] {
  return Array.isArray(rawScope)
    ? rawScope.map((path: unknown) => normalizeCollectionPath(String(path)))
    : [];
}

function parseCachedAuthContext(rawValue: unknown): CachedAuthContext | null {
  if (!rawValue) {
    return null;
  }

  try {
    const value = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const entry = value as Record<string, unknown>;
    if (typeof entry.subject !== 'string' || !entry.subject) {
      return null;
    }

    const expiresAt =
      typeof entry.expiresAt === 'string' && entry.expiresAt ? entry.expiresAt : null;
    if (expiresAt) {
      const expiresAtMs = Date.parse(expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        return null;
      }
    }

    return {
      subject: entry.subject,
      collectionScope: normalizeCollectionScope(entry.collectionScope),
      expiresAt,
    };
  } catch (_error) {
    return null;
  }
}

async function readCachedAuthContext(cacheKey: string): Promise<AuthContext | null> {
  if (!redis) {
    return null;
  }

  try {
    const cached = await redis.get(cacheKey);
    const parsed = parseCachedAuthContext(cached);
    return parsed
      ? {
          subject: parsed.subject,
          collectionScope: parsed.collectionScope,
        }
      : null;
  } catch (error) {
    console.error('course_search auth cache read failed', error);
    return null;
  }
}

function getAuthCacheTtlSeconds(expiresAt: unknown) {
  if (typeof expiresAt !== 'string' || !expiresAt) {
    return auth_cache_ttl_seconds;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return auth_cache_ttl_seconds;
  }

  return Math.max(
    0,
    Math.min(auth_cache_ttl_seconds, Math.floor((expiresAtMs - Date.now()) / 1000)),
  );
}

async function writeCachedAuthContext(cacheKey: string, context: CachedAuthContext) {
  if (!redis) {
    return;
  }

  const ttlSeconds = getAuthCacheTtlSeconds(context.expiresAt);
  if (ttlSeconds <= 0) {
    return;
  }

  try {
    await redis.setex(cacheKey, ttlSeconds, JSON.stringify(context));
  } catch (error) {
    console.error('course_search auth cache write failed', error);
  }
}

async function authenticateRequest(req: Request): Promise<AuthContext | Response> {
  const bearerToken = extractBearerToken(req.headers.get('authorization'));

  if (bearerToken) {
    requireServiceRoleKey();
    const tokenHash = await sha256Hex(bearerToken);
    const authCacheKey = await buildAuthCacheKey(tokenHash);
    const cachedAuth = await readCachedAuthContext(authCacheKey);
    if (cachedAuth) {
      return cachedAuth;
    }

    const { data, error } = await getServiceSupabase().rpc('verify_kb_api_key', {
      p_token_prefix: bearerToken.slice(0, 18),
      p_token_hash: tokenHash,
      p_required_scopes: course_search_required_scopes,
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

    const authContext = {
      subject: String(row.client_id ?? row.actor_user_id),
      collectionScope: normalizeCollectionScope(row.collection_scope),
    };

    await writeCachedAuthContext(authCacheKey, {
      ...authContext,
      expiresAt: typeof row.expires_at === 'string' && row.expires_at ? row.expires_at : null,
    });

    return {
      subject: authContext.subject,
      collectionScope: authContext.collectionScope,
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

function normalizeFilter(rawFilter: Record<string, unknown>): FilterType {
  const filter: FilterType = {};

  for (const [field, rawValue] of Object.entries(rawFilter)) {
    const values = normalizeStringList(rawValue);
    if (values.length > 0) {
      filter[field] = values;
    }
  }

  return filter;
}

function normalizeDateFilter(rawDatefilter: unknown): DateFilterType {
  const rawFilter = normalizeObject(rawDatefilter, 'datefilter');
  const datefilter: DateFilterType = {};

  for (const [field, rawValue] of Object.entries(rawFilter)) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      throw new RequestValidationError('`datefilter` values must be range objects.');
    }

    const rawRange = rawValue as Record<string, unknown>;
    const range: { gte?: number; lte?: number } = {};
    for (const boundary of ['gte', 'lte'] as const) {
      const boundaryValue = rawRange[boundary];
      if (boundaryValue === undefined || boundaryValue === null || boundaryValue === '') {
        continue;
      }
      const parsed = typeof boundaryValue === 'number' ? boundaryValue : Number(boundaryValue);
      if (!Number.isFinite(parsed)) {
        throw new RequestValidationError('`datefilter` gte/lte values must be numbers.');
      }
      range[boundary] = parsed;
    }

    if (Object.keys(range).length > 0) {
      datefilter[field] = range;
    }
  }

  return datefilter;
}

function buildFilters(filter?: FilterType, datefilter?: DateFilterType): FiltersType {
  const filters: FiltersType = [];
  if (filter && Object.keys(filter).length > 0) {
    filters.push({ terms: filter });
  }
  if (datefilter && Object.keys(datefilter).length > 0) {
    filters.push({ range: datefilter });
  }
  return filters;
}

function filterToPCQuery(filters: FiltersType): PCFilter | undefined {
  const andConditions = filters.flatMap((item) => {
    const conditions: Array<{ [field: string]: { $in?: string[]; $gte?: number; $lte?: number } }> =
      [];

    if (item.terms) {
      for (const field in item.terms) {
        conditions.push({
          [field]: {
            $in: item.terms[field],
          },
        });
      }
    }

    if (item.range) {
      for (const field in item.range) {
        const rangeConditions: { $gte?: number; $lte?: number } = {};
        if (item.range[field].gte !== undefined) {
          rangeConditions.$gte = item.range[field].gte;
        }
        if (item.range[field].lte !== undefined) {
          rangeConditions.$lte = item.range[field].lte;
        }
        conditions.push({
          [field]: rangeConditions,
        });
      }
    }
    return conditions;
  });

  return andConditions.length > 0
    ? {
        $and: andConditions,
      }
    : undefined;
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
  filters: FiltersType,
) {
  const searchVector = await generateEmbedding(semanticQuery, {
    model: openai_embedding_model,
  });

  const opensearchBody = {
    query: {
      bool: {
        should: fullTextQueries.map((query) => ({ match: { text: query } })),
        minimum_should_match: 1,
        ...(filters.length > 0 ? { filter: filters } : {}),
      },
    },
    size: topK,
  };

  const pineconeFilter = filterToPCQuery(filters);
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

  const hits = (fulltextResponse.body?.hits?.hits ?? []) as unknown as Array<{
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

  const documents: Array<{ content: string; source: string; document_id: string; tags: string }> =
    [];
  let currentDocumentId = '';
  let currentTexts: string[] = [];
  let currentSource = '';
  let currentTags = '';

  for (const chunk of sorted) {
    if (chunk.document_id !== currentDocumentId) {
      if (currentTexts.length > 0) {
        documents.push({
          content: currentTexts.join('\n'),
          source: currentSource,
          document_id: currentDocumentId,
          tags: currentTags,
        });
      }
      currentDocumentId = chunk.document_id;
      currentTexts = [chunk.text];
      currentSource = toSourceEntry(chunk);
      currentTags =
        typeof chunk.metadata.tags === 'string'
          ? chunk.metadata.tags
          : String(chunk.metadata.tags ?? '');
    } else {
      currentTexts.push(chunk.text);
    }
  }

  if (currentTexts.length > 0) {
    documents.push({
      content: currentTexts.join('\n'),
      source: currentSource,
      document_id: currentDocumentId,
      tags: currentTags,
    });
  }

  return documents;
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

    const filter = { ...body.filter };
    const scopeTags = auth.collectionScope.map(collectionPathToTag).filter(Boolean);
    if (scopeTags.length > 0) {
      filter.tags = [...normalizeStringList(filter.tags), ...scopeTags];
    }
    const filters = buildFilters(filter, body.datefilter);
    const rewritten = await generateQuery(body.query);
    const retrievedChunks = await retrieveChunks(
      target,
      rewritten.semantic_query,
      buildLexicalQueryCandidates(rewritten),
      body.topK,
      body.extK,
      filters,
    );

    const chunks = retrievedChunks.map(toResponseChunk);
    const courseDocuments = toCourseDocuments(chunks);

    logInsert(auth.subject, Date.now(), 'course_search', body.topK, body.extK);

    return jsonResponse(courseDocuments);
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
