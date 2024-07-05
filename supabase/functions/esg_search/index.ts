// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts";

import { AwsSigv4Signer } from "npm:/@opensearch-project/opensearch/aws";
import { Client } from "npm:/@opensearch-project/opensearch";
import { OpenAIEmbeddings } from "https://esm.sh/@langchain/openai";
import { Pinecone } from "https://esm.sh/@pinecone-database/pinecone";
import { corsHeaders } from "../_shared/cors.ts";
import { defaultProvider } from "npm:/@aws-sdk/credential-provider-node";
import generateQuery from "../_shared/generate_query.ts";
import postgres from "npm:/postgres";

const x_password = Deno.env.get("X_PASSWORD") ?? "";

const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
const openai_embedding_model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "";

const pinecone_api_key = Deno.env.get("PINECONE_API_KEY") ?? "";
const pinecone_index_name = Deno.env.get("PINECONE_INDEX_NAME") ?? "";
const pinecone_namespace_esg = Deno.env.get("PINECONE_NAMESPACE_ESG") ?? "";

const opensearch_region = Deno.env.get("OPENSEARCH_REGION") ?? "";
const opensearch_domain = Deno.env.get("OPENSEARCH_DOMAIN") ?? "";
const opensearch_index_name = Deno.env.get("OPENSEARCH_ESG_INDEX_NAME") ?? "";

const postgres_uri = Deno.env.get("POSTGRES_URI") ?? "";

const openaiClient = new OpenAIEmbeddings({
  apiKey: openai_api_key,
  model: openai_embedding_model,
});

const pc = new Pinecone({ apiKey: pinecone_api_key });
const index = pc.index(pinecone_index_name);

const opensearchClient = new Client({
  ...AwsSigv4Signer({
    region: opensearch_region,
    service: "aoss",

    getCredentials: () => {
      // Any other method to acquire a new Credentials object can be used.
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    },
  }),
  node: opensearch_domain,
});

const sql = postgres(postgres_uri);

async function getEsgMeta(id: string[]) {
  const records = await sql`
    SELECT
      id, report_title, company_name, publication_date, language
    FROM esg_meta
    WHERE id IN ${sql(id)}
  `;
  return records;
}

type FilterType =
  | { reportId: string[] }
  | Record<string | number | symbol, never>;
type PCFilter = {
  $or: { rec_id: string }[];
};

function filterToPCQuery(filter: FilterType): PCFilter {
  const { reportId } = filter;
  const andConditions = reportId.map((c) => ({ rec_id: c }));

  return { $or: andConditions };
}

const search = async (
  semantic_query: string,
  full_text_query: string[],
  topK: number,
  filter: FilterType,
) => {
  // console.log(full_text_query, topK, filter);

  const searchVector = await openaiClient.embedQuery(semantic_query);

  console.log(filter);

  const body = {
    query: filter
      ? {
        bool: {
          must: full_text_query.map((query) => ({
            match: { text: query },
          })),
          filter: [
            { terms: { reportId: filter.reportId } },
          ],
        },
      }
      : {
        bool: {
          must: full_text_query.map((query) => ({
            match: { text: query },
          })),
        },
      },
    size: topK,
  };

  // console.log(filter.reportId);
  // console.log(body.query.bool.filter);
  console.log(filterToPCQuery(filter));
  interface QueryOptions {
    vector: number[];
    topK: number;
    includeMetadata: boolean;
    filter?: PCFilter;
  };

  const queryOptions: QueryOptions = {
    vector: searchVector,
    topK: topK,
    includeMetadata: true,
  };

  if (filter) {
    queryOptions.filter = filterToPCQuery(filter);
  };

  const [pineconeResponse, fulltextResponse] = await Promise.all([
    index.namespace(pinecone_namespace_esg).query(queryOptions),
    opensearchClient.search({
      index: opensearch_index_name,
      body: body,
    }),
  ]);

  // if (!pineconeResponse) {
  //   console.error("Pinecone query response is empty.");
  // }

  // console.log(pineconeResponse);
  // console.log(fulltextResponse);

  const rec_id_set = new Set();
  const unique_docs = [];

  for (const doc of pineconeResponse.matches) {
    const id = doc.id;

    if (!rec_id_set.has(id)) {
      rec_id_set.add(id);
      if (doc.metadata) {
        unique_docs.push({
          id: doc.metadata.rec_id,
          page_number: doc.metadata.page_number,
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
        id: doc._source.reportId,
        page_number: doc._source.pageNumber,
        text: doc._source.text,
      });
    }
  }

  const unique_doc_id_set = new Set<string>();
  for (const doc of unique_docs) {
    unique_doc_id_set.add(doc.id);
  }

  // console.log(unique_doc_id_set);

  const pgResponse = await getEsgMeta(Array.from(unique_doc_id_set));

  const docList = unique_docs.map((doc) => {
    const record = pgResponse.find((r) => r.id === doc.id);

    if (record) {
      const report_title = record.report_title;
      const company_name = record.company_name;
      const publication_date = record.publication_date;
      const page_number = doc.page_number;
      const sourceEntry =
        ` ${company_name}: **${report_title} (${page_number})**. ${publication_date}.`;
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
  // Get the session or user object
  const password = req.headers.get("x-password");
  if (password !== x_password) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { query, filter, topK } = await req.json();
  // console.log(query, filter);

  const res = await generateQuery(query);
  // console.log(res);
  const result = await search(
    res.semantic_query,
    [...res.fulltext_query_chi_tra, ...res.fulltext_query_chi_sim,...res.fulltext_query_eng],
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

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/esg_search' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --header 'x-password: xxx' \
    --data '{"query": "采取了哪些减排措施?", "filter": {"reportId": ["73338fdb-5c79-44fb-adbf-09f2b580acc8","07aba0bb-ac7c-41a2-b50b-d2f7793e5b3c"]}, "topK": 3}'
  
  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/esg_search' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --header 'x-password: XXXXX' \
    --data '{"query": "哪些公司使用了阿里云来帮助减排", "topK": 3}'
*/
