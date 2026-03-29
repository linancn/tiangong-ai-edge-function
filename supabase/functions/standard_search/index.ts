// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { Pinecone } from '@pinecone-database/pinecone';
import { SupabaseClient, createClient } from '@supabase/supabase-js@2';
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
const pinecone_namespace_standard = Deno.env.get('PINECONE_NAMESPACE_STANDARD') ?? '';

const opensearch_region = Deno.env.get('OPENSEARCH_REGION') ?? '';
const opensearch_domain = Deno.env.get('OPENSEARCH_DOMAIN') ?? '';
const opensearch_index_name = Deno.env.get('OPENSEARCH_STANDARD_INDEX_NAME') ?? '';

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

const supabase = createClient(supabase_url, supabase_publishable_key);

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

async function getStandardsMeta(supabase: SupabaseClient, meta_contains: string) {
  // console.log(full_text);
  const { data, error } = await supabase.rpc('standards_full_text', {
    meta_contains,
  });

  if (error) {
    console.error(error);
    return null;
  }
  // console.log(data);
  return data;
}

function formatTimestampToDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  return `${year}-${month}-${day}`;
}

type FilterType = { [field: string]: string[] };
type DateFilterType = { [field: string]: { gte?: number; lte?: number } };

type FiltersItem = {
  terms?: { [field: string]: string[] };
  range?: { [field: string]: { gte?: number; lte?: number } };
};

type FiltersType = FiltersItem[];

type PCFilter = {
  $and: Array<{ [field: string]: { $in?: string[]; $gte?: number; $lte?: number } }>;
};

function filterToPCQuery(filters: FiltersType): PCFilter {
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
        if (item.range[field].gte) {
          rangeConditions.$gte = item.range[field].gte;
        }
        if (item.range[field].lte) {
          rangeConditions.$lte = item.range[field].lte;
        }
        conditions.push({
          [field]: rangeConditions,
        });
      }
    }
    return conditions;
  });

  return {
    $and: andConditions,
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
  standard_number: number;
  text: string;
  synonyms: string[];
  title: string;
  organization: string;
  effective_date: number;
}

const search = async (
  supabase: SupabaseClient,
  email: string,
  password: string,
  first_login: boolean,
  semantic_query: string,
  full_text_query: string[],
  topK: number,
  extK: number,
  meta_contains?: string,
  filter?: FilterType,
  datefilter?: DateFilterType,
) => {
  // console.log(topK, filter, meta_contains);

  let pgResponse = null;
  if (meta_contains) {
    if (!first_login) {
      await supabaseAuth(supabase, email, password);
      // console.log('Re-authenticated');
    }
    pgResponse = await getStandardsMeta(supabase, meta_contains);
  }

  const searchVector = await generateEmbedding(semantic_query, {
    model: openai_embedding_model,
  });

  // console.log(filter);

  const filters = [];

  if (pgResponse && pgResponse.length > 0) {
    const ids: string[] = [];
    pgResponse.forEach((item: { id: string }) => {
      ids.push(item.id);
    });
    filters.push({ terms: { rec_id: ids } });
  }
  if (pgResponse && pgResponse.length === 0) {
    return {
      message: 'No records found matching the metadata filters.',
      suggestion: 'Please try using different metadata filters.',
    };
  }

  if (filter || datefilter) {
    const filtersArray: Array<{ terms?: typeof filter; range?: typeof datefilter }> = [];
    if (filter) {
      filtersArray.push({ terms: filter });
    }
    if (datefilter) {
      filtersArray.push({ range: datefilter });
    }
    filters.push(...filtersArray);
  }
  // console.log(filters);

  const body = {
    query: filters
      ? {
          bool: {
            should: full_text_query.map((query) => ({
              match: { text: query },
            })),
            minimum_should_match: 1,
            filter: filters,
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
  // console.log(body);

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

  // console.log(filters);

  if (filters) {
    queryOptions.filter = filterToPCQuery(filters);
  }
  // console.log(queryOptions);

  const [pineconeResponse, fulltextResponse] = await Promise.all([
    index.namespace(pinecone_namespace_standard).query(queryOptions),
    opensearchClient.search({
      index: opensearch_index_name,
      body: body,
    }),
  ]);

  // console.log(queryOptions.filter);
  // console.log(pineconeResponse);
  // console.log(fulltextResponse.body.hits.hits);

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
        organization: metadata.organization,
        standard_number: metadata.standard_number,
        title: metadata.title,
        effective_date: metadata.date,
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
        organization: sourceDoc.organization,
        standard_number: sourceDoc.standard_number,
        title: sourceDoc.title,
        effective_date: sourceDoc.effective_date,
        text: sourceDoc.text,
        synonyms: extractSynonymTerms(sourceDoc),
      });
    }
  }

  // const unique_doc_id_set = new Set<string>();
  // for (const doc of unique_docs) {
  //   unique_doc_id_set.add(doc.id);
  // }

  // console.log(unique_doc_id_set);

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
        organization: sourceDoc.organization,
        standard_number: sourceDoc.standard_number,
        title: sourceDoc.title,
        effective_date: sourceDoc.effective_date,
        text: sourceDoc.text,
        synonyms: extractSynonymTerms(sourceDoc),
      });
    }
  }
  // console.log(unique_docs);

  // const unique_doc_id_set = new Set<string>();
  // for (const doc of unique_docs) {
  //   unique_doc_id_set.add(doc.id);
  // }

  // console.log(unique_doc_id_set);

  unique_docs.sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return a.sort_id - b.sort_id;
  });

  // **Optimized: Combine documents in a single pass**
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

  // console.log(combinedDocs);

  const docList = combinedDocs.map((doc) => {
    const title = doc.title;
    const standard_number = doc.standard_number;
    const issuing_organization = doc.organization;
    const effective_date = formatTimestampToDate(doc.effective_date);
    const source_entry = `${title}(${standard_number}), ${issuing_organization}. ${effective_date}.`;
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
      return new Response(JSON.stringify({ error: 'Invalid API Key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  let first_login = false;

  if (!(await redis.exists(email))) {
    const authResponse = await supabaseAuth(supabase, email, password);
    if (authResponse.status !== 200) {
      return authResponse;
    } else {
      await redis.setex(email, 3600, '');
      first_login = true;
    }
  }

  const { query, filter, datefilter, meta_contains, topK = 5, extK = 0 } = await req.json();
  // console.log(query, filter);

  logInsert(email, Date.now(), 'standard_search', topK, extK);

  const res = await generateQuery(query);
  // console.log(res);
  const result = await search(
    supabase,
    email,
    password,
    first_login,
    res.semantic_query,
    buildLexicalQueryCandidates(res),
    topK,
    extK,
    meta_contains,
    filter,
    datefilter,
  );
  // console.log(result);

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});
