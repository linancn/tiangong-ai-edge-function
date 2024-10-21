// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { OpenAIEmbeddings } from '@langchain/openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import generateQuery from '../_shared/generate_query.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';

const openai_api_key = Deno.env.get('OPENAI_API_KEY') ?? '';
const openai_embedding_model = Deno.env.get('OPENAI_EMBEDDING_MODEL') ?? '';

const pinecone_api_key = Deno.env.get('PINECONE_API_KEY') ?? '';
const pinecone_index_name = Deno.env.get('PINECONE_INDEX_NAME') ?? '';
const pinecone_namespace_patent = Deno.env.get('PINECONE_NAMESPACE_PATENT') ?? '';

const supabase_url = Deno.env.get('LOCAL_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('LOCAL_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const openaiClient = new OpenAIEmbeddings({
  apiKey: openai_api_key,
  model: openai_embedding_model,
});

const pc = new Pinecone({ apiKey: pinecone_api_key });
const index = pc.index(pinecone_index_name);

type FilterType =
  | { country?: string[]; publication_date?: string }
  | Record<string | number | symbol, never>;
type CountryCondition = { $or: { country: string }[] };
type DateCondition = { publication_date: string };
type PCFilter = {
  $and?: (CountryCondition | DateCondition)[];
};

function filterToPCQuery(filter?: FilterType): PCFilter | undefined {
  if (!filter || Object.keys(filter).length === 0) {
    return undefined;
  }

  const conditions = [];

  if (filter.country) {
    const CountryConditions = filter.country.map((c) => ({ country: c }));
    conditions.push({ $or: CountryConditions });
  }

  if (filter.publication_date) {
    conditions.push({ publication_date: filter.publication_date });
  }
  return conditions.length > 0 ? { $and: conditions } : undefined;
}

const search = async (semantic_query: string, topK: number, filter?: FilterType) => {
  const searchVector = await openaiClient.embedQuery(semantic_query);

  // console.log(filter);
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
    includeValues: false
  };

  if (filter && Object.keys(filter).length > 0) {
    queryOptions.filter = filterToPCQuery(filter);
  }

  const pineconeResponse = await index.namespace(pinecone_namespace_patent).query(queryOptions);

  // console.log(pineconeResponse);

  const unique_docs = [];

  for (const doc of pineconeResponse.matches) {
    if (doc.metadata && doc.id) {
      unique_docs.push({
        id: String(doc.id),
        text: doc.metadata.abstract,
        country: doc.metadata.country,
        publication_date: doc.metadata.publication_date,
        title: doc.metadata.title,
        url: doc.metadata.url,
      });
    }
  }

  if (unique_docs.length > 0) {
    const docList = unique_docs.map((doc) => {
      const title = doc.title;
      const country = doc.country;
      const id = doc.id;
      const date = doc.publication_date;
      const url = doc.url;
      const sourceEntry = `[${title}, ${id}, ${country}. ${date}.](${url})`;
      return { content: doc.text, source: sourceEntry };
    });
    return docList;
  } else {
    throw new Error('Record not found');
  }
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

  const res = await generateQuery(query);

  const result = await search(res.semantic_query, topK, filter);
  // console.log(result);

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/patent_search' \
    --header 'Content-Type: application/json' \
    --header 'email: xxx' \
    --header 'password: xxx' \
    --data '{"query": "Tunnel for high-speed vehicles?", "filter": {"country": ["Japan"], "publication_date": {"$gte": 19900101}}, "topK": 3}'
*/
