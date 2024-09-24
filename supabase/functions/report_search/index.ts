// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "https://esm.sh/v135/@supabase/functions-js/src/edge-runtime.d.ts";

import { SupabaseClient, createClient } from "jsr:@supabase/supabase-js@2";

import { OpenAIEmbeddings } from "npm:/@langchain/openai";
import { Pinecone } from "npm:/@pinecone-database/pinecone";
import { corsHeaders } from "../_shared/cors.ts";
import generateQuery from "../_shared/generate_query.ts";
import supabaseAuth from "../_shared/supabase_auth.ts";

const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
const openai_embedding_model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "";

const pinecone_api_key = Deno.env.get("PINECONE_API_KEY") ?? "";
const pinecone_index_name = Deno.env.get("PINECONE_INDEX_NAME") ?? "";
const pinecone_namespace_report = Deno.env.get("PINECONE_NAMESPACE_REPORT") ??
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

async function getMeta(supabase: SupabaseClient, id: string[]) {
  const { data, error } = await supabase
    .from("reports")
    .select("id, title, issuing_organization, release_date, url")
    .in("id", id);

  if (error) {
    console.error(error);
    return null;
  }
  // console.log(data);
  return data;
}

const search = async (
  supabase: SupabaseClient,
  semantic_query: string,
  topK: number,
) => {
  const searchVector = await openaiClient.embedQuery(semantic_query);

  interface QueryOptions {
    vector: number[];
    topK: number;
    includeMetadata: boolean;
  }

  const queryOptions: QueryOptions = {
    vector: searchVector,
    topK: topK,
    includeMetadata: true,
  };

  const pineconeResponse = await index.namespace(pinecone_namespace_report)
    .query(
      queryOptions,
    );

  // console.log(pineconeResponse);

  const rec_id_set = new Set();
  const unique_docs: { id: string; text: string }[] = [];

  for (const doc of pineconeResponse.matches) {
    if (doc.metadata && doc.metadata.rec_id) {
      unique_docs.push({
        id: String(doc.metadata.rec_id),
        text: String(doc.metadata.text),
      });
    }
  }
  for (const doc of pineconeResponse.matches) {
    if (doc.metadata && doc.metadata.rec_id) {
      const id = doc.metadata.rec_id;
      const text = doc.metadata.text as string;

      if (!rec_id_set.has(id)) {
        rec_id_set.add(id);
        unique_docs.push({
          id: String(id),
          text: text,
        });
      }
    }
  }

  const uniqueIds = new Set(unique_docs.map((doc) => doc.id));

  // console.log(uniqueIds);

  const pgResponse = await getMeta(supabase, Array.from(uniqueIds));

  const docList = unique_docs.map((doc) => {
    const record = pgResponse?.find((r) => r.id === doc.id);

    if (record) {
      const title = record.title;
      const issuing_organization = record.issuing_organization;
      const release_date = new Date(record.release_date);
      const formatted_date = release_date.toISOString().split("T")[0];
      const url = `https://doi.org/${record.url}`;
      const sourceEntry =
        `[${title}, ${issuing_organization}. ${formatted_date}.](${url})`;
      return { content: doc.text, source: sourceEntry };
    } else {
      throw new Error("Record not found");
    }
  });
  // console.log(docList);
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

  const { query, topK = 3 } = await req.json();
  // console.log(query, filter);

  const res = await generateQuery(query);

  const result = await search(
    supabase,
    res.semantic_query,
    topK,
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
  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/report_search' \
      --header 'Content-Type: application/json' \
    --header 'email: xxx' \
    --header 'password: xxx' \
    --data '{"query": "coastal floods and sandy coastline recession are projected to increase?", "topK": 3}'
*/
