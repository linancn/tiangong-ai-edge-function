// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import generateQuery from '../_shared/generate_query.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const openai_api_key = Deno.env.get('OPENAI_API_KEY') ?? '';
const openai_embedding_model = Deno.env.get('OPENAI_EMBEDDING_MODEL') ?? '';

const pinecone_api_key = Deno.env.get('PINECONE_API_KEY_US_EAST_1') ?? '';
const pinecone_index_name = Deno.env.get('PINECONE_INDEX_NAME') ?? '';
const pinecone_namespace_report = Deno.env.get('PINECONE_NAMESPACE_REPORT') ?? '';

const opensearch_region = Deno.env.get('OPENSEARCH_REGION') ?? '';
const opensearch_domain = Deno.env.get('OPENSEARCH_DOMAIN') ?? '';
const opensearch_index_name = Deno.env.get('OPENSEARCH_ESG_INDEX_NAME') ?? '';

const supabase_url = Deno.env.get('LOCAL_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('LOCAL_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const openaiClient = new OpenAIEmbeddings({
  apiKey: openai_api_key,
  model: openai_embedding_model,
});

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

// async function getMeta(supabase: SupabaseClient, id: string[]) {
//   const { data, error } = await supabase
//     .from('reports')
//     .select('id, title, issuing_organization, release_date, url')
//     .in('id', id);

//   if (error) {
//     console.error(error);
//     return null;
//   }
//   // console.log(data);
//   return data;
// }

function formatTimestampToDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  return `${year}-${month}-${day}`;
}

type FilterType = { [field: string]: string[] };
type FiltersItem = {
  terms: { [field: string]: string[] };
};
type FiltersType = FiltersItem[];
type PCFilter = {
  $and: Array<{ [field: string]: { $in: string[] } }>;
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

const search = async (
  // supabase: SupabaseClient,
  semantic_query: string,
  full_text_query: string[],
  topK: number,
  filter?: FilterType,
) => {
  const searchVector = await openaiClient.embedQuery(semantic_query);

  const filters = [];
  if (filter) {
    filters.push({ terms: filter });
  }

  // console.log(full_text_query, topK, filters);

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

  const [pineconeResponse, fulltextResponse] = await Promise.all([
    index.namespace(pinecone_namespace_report).query(queryOptions),
    opensearchClient.search({
      index: opensearch_index_name,
      body: body,
    }),
  ]);

  // console.log(pineconeResponse);
  // console.log(fulltextResponse);

  const id_set = new Set();
  const unique_docs = [];

  for (const doc of pineconeResponse.matches) {
    const id = doc.id;

    id_set.add(id);
    if (doc.metadata) {
      unique_docs.push({
        id: doc.metadata.rec_id,
        organization: doc.metadata.organization,
        title: doc.metadata.title,
        release_date: doc.metadata.release_date,
        text: doc.metadata.text,
        url: doc.metadata.url,
      });
    }
  }
  for (const doc of fulltextResponse.body.hits.hits) {
    const id = doc._id;

    if (!id_set.has(id)) {
      unique_docs.push({
        id: doc._source.rec_id,
        organization: doc._source.organization,
        title: doc._source.title,
        release_date: doc._source.release_date,
        text: doc._source.text,
        url: doc._source.url,
      });
    }
  }

  // const unique_doc_id_set = new Set<string>();
  // for (const doc of unique_docs) {
  //   unique_doc_id_set.add(doc.id);
  // }

  const docList = unique_docs.map((doc) => {
    const title = doc.title;
    const organization = doc.organization;
    const url = doc.url;
    const release_date = formatTimestampToDate(doc.release_date);
    const source_entry = `[${title}. ${organization}. ${release_date}.](${url})`;
    return { content: doc.text, source: source_entry };
  });

  // console.log(docList);
  return docList;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(supabase_url, supabase_anon_key);
  const authResponse = await supabaseAuth(
    supabase,
    req.headers.get('email') ?? '',
    req.headers.get('password') ?? '',
  );
  if (authResponse.status !== 200) {
    return authResponse;
  }

  const { query, filter, topK = 5 } = await req.json();

  // console.log(query, filter);

  logInsert(req.headers.get('email') ?? '', Date.now(), 'report_search', topK);

  const res = await generateQuery(query);

  const result = await search(
    // supabase,
    res.semantic_query,
    [...res.fulltext_query_chi_sim, ...res.fulltext_query_eng],
    topK,
    filter,
  );
  // console.log(result);

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:
  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/report_search' \
      --header 'Content-Type: application/json' \
    --header 'email: xxx' \
    --header 'password: xxx' \
    --data '{"query": "coastal floods and sandy coastline recession are projected to increase?", "topK": 3}'
*/
