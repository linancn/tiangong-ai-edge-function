// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts";

import { OpenAIEmbeddings } from "https://esm.sh/@langchain/openai";
import { Pinecone } from "https://esm.sh/@pinecone-database/pinecone";
import { corsHeaders } from "../_shared/cors.ts";
import generateQuery from "../_shared/generate_query.ts";
import postgres from "npm:/postgres";

const x_password = Deno.env.get("X_PASSWORD") ?? "";

const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
const openai_embedding_model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "";

const pinecone_api_key = Deno.env.get("PINECONE_API_KEY") ?? "";
const pinecone_index_name = Deno.env.get("PINECONE_INDEX_NAME") ?? "";
const pinecone_namespace_sci = Deno.env.get("PINECONE_NAMESPACE_SCI") ?? "";

const postgres_uri = Deno.env.get("POSTGRES_URI") ?? "";

const openaiClient = new OpenAIEmbeddings({
  apiKey: openai_api_key,
  model: openai_embedding_model,
});

const pc = new Pinecone({ apiKey: pinecone_api_key });
const index = pc.index(pinecone_index_name);
const sql = postgres(postgres_uri);

async function getMeta(doi: string[]) {
  const records = await sql`
    SELECT
      doi, title, authors
    FROM journals
    WHERE doi IN ${sql(doi)}
  `;
  return records;
}

function filterToPCQuery(filter: FilterType): PCFilter {
  const { journal } = filter;
  const andConditions = journal.map((c) => ({ journal: c }));

  return { $or: andConditions };
}

function formatTimestampToYearMonth(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  return `${year}-${month}`;
}

type FilterType =
  | { journal: string[] }
  | Record<string | number | symbol, never>;
type PCFilter = {
  $or: { journal: string }[];
};

const search = async (
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

  if (filter) {
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
  // console.log(unique_doc_id_set);

  const pgResponse = await getMeta(Array.from(uniqueIds));

  const docList = unique_docs.map((doc) => {
    const record = pgResponse.find((r) => r.doi === doc.id);

    if (record) {
      const title = record.title;
      const journal = doc.journal;
      const authors = record.authors.join(", ");
      const date = doc.date;
      const url = `https://doi.org/${record.doi}`;
      const sourceEntry = `[${title}, ${journal}. ${authors}. ${date}.](${url})`;
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

  const password = req.headers.get("x-password");
  if (password !== x_password) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { query, filter, topK } = await req.json();
  // console.log(query, filter);

  const res = await generateQuery(query);

  const result = await search(
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
