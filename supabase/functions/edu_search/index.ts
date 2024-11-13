// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { Pinecone } from '@pinecone-database/pinecone';
import { createClient, SupabaseClient } from '@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import generateQuery from '../_shared/generate_query.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const openai_api_key = Deno.env.get('OPENAI_API_KEY') ?? '';
const openai_embedding_model = Deno.env.get('OPENAI_EMBEDDING_MODEL') ?? '';

const pinecone_api_key = Deno.env.get('PINECONE_API_KEY_US_EAST_1') ?? '';
const pinecone_index_name = Deno.env.get('PINECONE_INDEX_NAME') ?? '';
const pinecone_namespace_edu = Deno.env.get('PINECONE_NAMESPACE_EDU') ?? '';

const opensearch_region = Deno.env.get('OPENSEARCH_REGION') ?? '';
const opensearch_domain = Deno.env.get('OPENSEARCH_DOMAIN') ?? '';
const opensearch_index_name = Deno.env.get('OPENSEARCH_EDU_INDEX_NAME') ?? '';

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

interface EduData {
  id: string;
  name: string;
  chapter_number: number;
  description: string;
}

async function getEduMeta(supabase: SupabaseClient, id: string[]): Promise<EduData[] | null> {
  const batchSize = 400;
  let allData: EduData[] = [];

  for (let i = 0; i < id.length; i += batchSize) {
    const batch = id.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('edu_meta')
      .select('id, name, chapter_number, description')
      .in('id', batch);

    if (error) {
      console.error(error);
      return null;
    }

    allData = allData.concat(data as EduData[]);
  }
  return allData;
}

type FilterType = { course: string[] } | Record<string | number | symbol, never>;
type PCFilter = {
  $or: { course: string }[];
};

function filterToPCQuery(filter: FilterType): PCFilter {
  const { course } = filter;
  const andConditions = course.map((c) => ({ course: c }));

  return { $or: andConditions };
}

const search = async (
  supabase: SupabaseClient,
  semantic_query: string,
  full_text_query: string[],
  topK: number,
  filter: FilterType,
) => {
  // console.log(query, topK, filter);

  const searchVector = await openaiClient.embedQuery(semantic_query);

  // console.log(filter);

  const body = {
    query: filter
      ? {
          bool: {
            should: full_text_query.map((query) => ({
              match: { text: query },
            })),
            minimum_should_match: 1,
            filter: [{ terms: filter }],
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

  if (filter) {
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

  const id_set = new Set();
  const unique_docs = [];

  for (const doc of pineconeResponse.matches) {
    const id = doc.id;

    id_set.add(id);
    if (doc.metadata) {
      unique_docs.push({
        id: doc.metadata.rec_id,
        course: doc.metadata.course,
        text: doc.metadata.text,
      });
    }
  }

  for (const doc of fulltextResponse.body.hits.hits) {
    const id = doc._id;

    if (!id_set.has(id)) {
      unique_docs.push({
        id: doc._source.rec_id,
        course: doc._source.course,
        text: doc._source.text,
      });
    }
  }

  const unique_doc_id_set = new Set<string>();
  for (const doc of unique_docs) {
    unique_doc_id_set.add(doc.id);
  }

  // console.log(unique_doc_id_set);

  const pgResponse = await getEduMeta(supabase, Array.from(unique_doc_id_set));

  const docList = unique_docs.map((doc) => {
    const record = pgResponse?.find((r: { id: string }) => r.id === doc.id);

    if (record) {
      const name = record.name;
      const chapter_number = record.chapter_number;
      const description = record.description;
      const course = doc.course;
      const source_entry = `${course}: **${name} (Ch. ${chapter_number})**. ${description}.`;
      return { content: doc.text, source: source_entry };
    } else {
      throw new Error('Record not found');
    }
  });

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

  logInsert(req.headers.get('email') ?? '', Date.now(), 'edu_search', topK);

  const res = await generateQuery(query);
  // console.log(res);
  const result = await search(
    supabase,
    res.semantic_query,
    [...res.fulltext_query_chi_sim, ...res.fulltext_query_eng],
    topK,
    filter,
  );
  // console.log(result);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/edu_search' \
    --header 'Content-Type: application/json' \
    --header 'email: xxx' \
    --header 'password: xxx' \
    --data '{"query": "what is the relationship between filter layer expansion and washing intensity?", "topK": 3}'

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/edu_search' \
    --header 'Content-Type: application/json' \
    --header 'x-password: XXX' \
    --header 'email: xxx' \
    --header 'password: xxx' \
    --data '{"query": "what is the relationship between filter layer expansion and washing intensity?", "filter": {"course": ["水处理工程"]}, "topK": 3}'
*/
