// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";

import { createClient, SupabaseClient } from "@supabase/supabase-js@2";

import { Client } from "@opensearch-project/opensearch";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Pinecone } from "@pinecone-database/pinecone";
import { corsHeaders } from "../_shared/cors.ts";
import generateQuery from "../_shared/generate_query.ts";
import supabaseAuth from "../_shared/supabase_auth.ts";

const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
const openai_embedding_model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "";

const pinecone_api_key = Deno.env.get("PINECONE_API_KEY") ?? "";
const pinecone_index_name = Deno.env.get("PINECONE_INDEX_NAME") ?? "";
const pinecone_namespace_standard =
  Deno.env.get("PINECONE_NAMESPACE_STANDARD") ?? "";

const opensearch_node = Deno.env.get("OPENSEARCH_NODE") ?? "";
const opensearch_index_name = Deno.env.get("OPENSEARCH_STANDARD_INDEX_NAME") ??
  "";

const supabase_url = Deno.env.get("LOCAL_SUPABASE_URL") ??
  Deno.env.get("SUPABASE_URL") ?? "";
const supabase_anon_key = Deno.env.get("LOCAL_SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const openaiClient = new OpenAIEmbeddings({
  apiKey: openai_api_key,
  model: openai_embedding_model,
});

const pc = new Pinecone({ apiKey: pinecone_api_key });
const index = pc.index(pinecone_index_name);

const opensearchClient = new Client({
  node: opensearch_node,
});

async function getStandardsMeta(supabase: SupabaseClient, full_text: string) {
  // console.log(full_text);
  const { data, error } = await supabase.rpc("standards_full_text", {
    full_text,
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
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  const day = ("0" + date.getDate()).slice(-2);
  return `${year}-${month}-${day}`;
}

// type FilterType =
//   | { standard_number: string[], rec_id?: string[] }
//   | Record<string | number | symbol, never>;

// type PCFilter = {
//   $or: { standard_number: string }[];
// };

// type FilterType = {
//   rec_id?: string[];
//   standard_number?: string[];
// };

type FiltersType = {
  terms: {
    [field: string]: string[];
  };
};

type PCFilter = {
  rec_id?: { $in: string[] };
  standard_number?: { $in: string[] };
};

function filterToPCQuery(input: any[]): any {
  const andConditions = input.map((item) => {
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

// function filterToPCQuery(filter: FilterType): PCFilter {
//   const pcFilter: PCFilter = {};

//   if (filter.rec_id && filter.rec_id.length > 0) {
//     pcFilter.rec_id = { $in: filter.rec_id };
//   }

//   if (filter.standard_number && filter.standard_number.length > 0) {
//     pcFilter.standard_number = { $in: filter.standard_number };
//   }

//   return pcFilter;
// }

const search = async (
  supabase: SupabaseClient,
  semantic_query: string,
  full_text_query: string[],
  topK: number,
  full_text?: string,
  filter?: any,
) => {
  // console.log(query, topK, filter);

  let pgResponse = null;
  if (full_text) {
    pgResponse = await getStandardsMeta(
      supabase,
      full_text,
    );
  }

  const searchVector = await openaiClient.embedQuery(semantic_query);

  // console.log(filter);

  const filters = [];

  if (pgResponse && pgResponse.length > 0) {
    const ids: string[] = [];
    pgResponse.forEach((item: { id: string }) => {
      ids.push(item.id);
    });
    filters.push({ terms: { rec_id: ids } });
  }

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

  // console.log(filter.course);

  // console.log(body.query.bool.filter);
  // console.log(filterToPCQuery(filter));

  interface QueryOptions {
    vector: number[];
    topK: number;
    includeMetadata: boolean;
    filter?: PCFilter;
  }

  const queryOptions: QueryOptions = {
    vector: searchVector,
    topK: topK,
    includeMetadata: true,
  };

  if (filters) {
    queryOptions.filter = filterToPCQuery(filters);
  }
  console.log(queryOptions.filter);

  const pineconeResponse1 = await index.namespace(pinecone_namespace_standard)
    .query(queryOptions);
  console.log(pineconeResponse1);
  const [pineconeResponse, fulltextResponse] = await Promise.all([
    index.namespace(pinecone_namespace_standard).query(queryOptions),
    opensearchClient.search({
      index: opensearch_index_name,
      body: body,
    }),
  ]);

  // console.log(queryOptions.filter);

  // if (!pineconeResponse) {
  //   console.error("Pinecone query response is empty.");
  // }

  // console.log(pineconeResponse);
  // console.log(fulltextResponse.body.hits.hits);

  // if (!pineconeResponse || !fulltextResponse) {
  //   throw new Error("One or both of the search queries failed");
  // }

  const rec_id_set = new Set();
  const unique_docs = [];

  for (const doc of pineconeResponse.matches) {
    const id = doc.id;

    if (!rec_id_set.has(id)) {
      rec_id_set.add(id);
      if (doc.metadata) {
        unique_docs.push({
          id: doc.metadata.rec_id,
          organization: doc.metadata.organization,
          standard_number: doc.metadata.standard_number,
          title: doc.metadata.title,
          effective_date: doc.metadata.date,
          text: doc.metadata.text,
        });
      }
    }
  }

  for (const doc of fulltextResponse.body.hits.hits) {
    const id = doc._id;

    if (!rec_id_set.has(id)) {
      rec_id_set.add(id);
      unique_docs.push({
        id: doc._source.rec_id,
        organization: doc._source.organization,
        standard_number: doc._source.standard_number,
        title: doc._source.title,
        effective_date: doc._source.effective_date,
        text: doc._source.text,
      });
    }
  }

  const unique_doc_id_set = new Set<string>();
  for (const doc of unique_docs) {
    unique_doc_id_set.add(doc.id);
  }

  // console.log(unique_doc_id_set);

  const docList = unique_docs.map((doc) => {
    const title = doc.title;
    const standard_number = doc.standard_number;
    const issuing_organization = doc.organization;
    const effective_date = formatTimestampToDate(doc.effective_date);
    const source_entry =
      `${title}(${standard_number}), ${issuing_organization}. ${effective_date}.`;
    return { content: doc.text, source: source_entry };
  });

  return docList;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(supabase_url, supabase_anon_key);
  const authResponse = await supabaseAuth(
    supabase,
    req.headers.get("email") ?? "",
    req.headers.get("password") ?? "",
  );
  if (authResponse.status !== 200) {
    return authResponse;
  }

  const { query, filter, full_text, topK = 5 } = await req.json();
  // console.log(query, filter);

  const res = await generateQuery(query);
  // console.log(res);
  const result = await search(
    supabase,
    res.semantic_query,
    [...res.fulltext_query_chi_sim, ...res.fulltext_query_eng],
    topK,
    full_text,
    filter,
  );
  // console.log(result);

  return new Response(
    JSON.stringify(result),
    { headers: { "Content-Type": "application/json" } },
  );
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
