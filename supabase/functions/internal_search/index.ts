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
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const openai_embedding_model = Deno.env.get('OPENAI_EMBEDDING_MODEL') ?? '';

const pinecone_api_key = Deno.env.get('PINECONE_API_KEY_US_EAST_1') ?? '';
const pinecone_index_name = Deno.env.get('PINECONE_INDEX_NAME') ?? '';
const pinecone_namespace_internal = Deno.env.get('PINECONE_NAMESPACE_INTERNAL') ?? '';

const opensearch_region = Deno.env.get('OPENSEARCH_REGION') ?? '';
const opensearch_domain = Deno.env.get('OPENSEARCH_DOMAIN') ?? '';
const opensearch_index_name = Deno.env.get('OPENSEARCH_INTERNAL_INDEX_NAME') ?? '';

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

type FilterType = { [field: string]: string[] };
type FiltersItem = {
  terms?: { [field: string]: string[] };
};
type FiltersType = FiltersItem[];

type PCFilter = {
  $and: Array<{ [field: string]: { $in?: string[] } }>;
};

function filterToPCQuery(filters: FiltersType): PCFilter {
  const andConditions = filters.map((item) => {
    if (item.terms) {
      const field = Object.keys(item.terms)[0];
      const values = item.terms[field];
      return {
        [field]: {
          $in: values,
        },
      };
    }
    return {};
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
  title: string;
  text: string;
  synonyms: string[];
}

const search = async (
  semantic_query: string,
  full_text_query: string[],
  topK: number,
  extK: number,
  filter?: FilterType,
) => {
  // console.log(full_text_query, topK, filter);

  const searchVector = await generateEmbedding(semantic_query, {
    model: openai_embedding_model,
  });

  // console.log(filter);

  const filters = [];

  if (filter) {
    filters.push({ terms: filter });
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

  if (filters) {
    queryOptions.filter = filterToPCQuery(filters);
  }

  // console.log(queryOptions.filter);

  const [pineconeResponse, fulltextResponse] = await Promise.all([
    index.namespace(pinecone_namespace_internal).query(queryOptions),
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
        text: metadata.text,
        title: metadata.title,
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
        text: sourceDoc.text,
        title: sourceDoc.title,
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
        text: sourceDoc.text,
        title: sourceDoc.title,
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
    const title = doc.title;
    const source_entry = `**${title}**.`;
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

  const { query, filter, topK = 5, extK = 0 } = await req.json();
  // console.log(query, filter);

  logInsert(email, Date.now(), 'internal_search', topK, extK);

  const res = await generateQuery(query);
  // console.log(res);
  // console.log([
  //   ...res.fulltext_query_chi_tra,
  //   ...res.fulltext_query_chi_sim,
  //   ...res.fulltext_query_eng,
  // ]);
  const result = await search(
    res.semantic_query,
    [...res.fulltext_query_chi_tra, ...res.fulltext_query_chi_sim, ...res.fulltext_query_eng],
    topK,
    extK,
    filter,
  );
  // console.log(result);

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});
