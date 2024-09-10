// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts";

import { SupabaseClient, createClient } from "jsr:@supabase/supabase-js@2";

import { OpenAIEmbeddings } from "https://esm.sh/@langchain/openai";
import { Pinecone } from "https://esm.sh/@pinecone-database/pinecone";
import { corsHeaders } from "../_shared/cors.ts";
import generateQuery from "../_shared/generate_query.ts";

const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
const openai_embedding_model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "";

const pinecone_api_key = Deno.env.get("PINECONE_API_KEY") ?? "";
const pinecone_index_name = Deno.env.get("PINECONE_INDEX_NAME") ?? "";
const pinecone_namespace_sci = Deno.env.get("PINECONE_NAMESPACE_SCI") ?? "";

const supabase_url = Deno.env.get("SP_URL") ?? "";
const supabase_anon_key = Deno.env.get("SP_ANON_KEY") ?? "";

const openaiClient = new OpenAIEmbeddings({
  apiKey: openai_api_key,
  model: openai_embedding_model,
});

const pc = new Pinecone({ apiKey: pinecone_api_key });
const index = pc.index(pinecone_index_name);

async function getMeta(supabase: SupabaseClient, doi: string[]) {
  const { data, error } = await supabase
    .from("journals")
    .select("doi, title, authors")
    .in("doi", doi);

  if (error) {
    console.error(error);
    return null;
  }
  console.log(data);
  return data;
}

function formatTimestampToYearMonth(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  return `${year}-${month}`;
}

type FilterType =
  | { journal?: string[]; date?: string }
  | Record<string | number | symbol, never>;

type JournalCondition = { $or: { journal: string }[] };

type DateCondition = { date: string };
type PCFilter = {
  $and?: (JournalCondition | DateCondition)[];
};

function filterToPCQuery(filter?: FilterType): PCFilter | undefined {
  if (!filter || Object.keys(filter).length === 0) {
    return undefined;
  }

  const conditions = [];

  if (filter.journal) {
    const journalConditions = filter.journal.map((c) => ({ journal: c }));
    conditions.push({ $or: journalConditions });
  }

  if (filter.date) {
    conditions.push({ date: filter.date });
  }
  return conditions.length > 0 ? { $and: conditions } : undefined;
}

const search = async (
  supabase: SupabaseClient,
  semantic_query: string,
  topK: number,
  filter?: FilterType,
) => {
  const searchVector = await openaiClient.embedQuery(semantic_query);

  // console.log(filter);
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

  if (filter && Object.keys(filter).length > 0) {
    queryOptions.filter = filterToPCQuery(filter);
  }

  const pineconeResponse = await index.namespace(pinecone_namespace_sci).query(
    queryOptions,
  );

  // console.log(pineconeResponse);

  const rec_id_set = new Set();
  const unique_docs = [];

  for (const doc of pineconeResponse.matches) {
    if (doc.metadata && doc.metadata.doi) {
      const id = doc.metadata.doi;
      const date = doc.metadata.date as number;

      if (!rec_id_set.has(id)) {
        rec_id_set.add(id);
        unique_docs.push({
          id: String(id),
          text: doc.metadata.text,
          journal: doc.metadata.journal,
          date: formatTimestampToYearMonth(date),
        });
      }
    }
  }

  const uniqueIds = new Set(unique_docs.map((doc) => doc.id));
  console.log(Array.from(uniqueIds));

  const pgResponse = await getMeta(supabase, Array.from(uniqueIds));

  const docList = unique_docs.map((doc) => {
    const record = pgResponse.find((r: { doi: string; }) => r.doi === doc.id);

    if (record) {
      const title = record.title;
      const journal = doc.journal;
      const authors = record.authors.join(", ");
      const date = doc.date;
      const url = `https://doi.org/${record.doi}`;
      const sourceEntry =
        `[${title}, ${journal}. ${authors}. ${date}.](${url})`;
      return { content: doc.text, source: sourceEntry };
    } else {
      throw new Error("Record not found");
    }
  });

  return docList;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(supabase_url, supabase_anon_key);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: req.headers.get("email"),
    password: req.headers.get("password"),
  });
  if (error) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (data.user.role !== "authenticated") {
    return new Response("You are not an authenticated user.", { status: 401 });
  }

  const { query, filter, topK } = await req.json();
  // console.log(query, filter);

  const res = await generateQuery(query);

  const result = await search(
    supabase,
    res.semantic_query,
    topK,
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

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/sci_search' \
     --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --header 'x-password: xxx' \
    --data '{"query": "关键金属物质流的全球贸易特征是什么?", "filter": {"journal": ["JOURNAL OF INDUSTRIAL ECOLOGY"]}, "topK": 3}'
*/
