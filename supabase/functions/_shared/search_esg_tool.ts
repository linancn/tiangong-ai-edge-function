/// <reference types="https://esm.sh/v135/@supabase/functions-js@2.4.1/src/edge-runtime.d.ts" />

import { AwsSigv4Signer } from "npm:/@opensearch-project/opensearch/aws";
import { Client } from "npm:/@opensearch-project/opensearch";
import { DynamicStructuredTool } from "https://esm.sh/@langchain/core/tools";
import { OpenAIEmbeddings } from "https://esm.sh/@langchain/openai";
import { Pinecone } from "https://esm.sh/@pinecone-database/pinecone";
import { defaultProvider } from "npm:/@aws-sdk/credential-provider-node";
import postgres from "npm:/postgres";
import { z } from "https://esm.sh/zod";

const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
const openai_embedding_model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "";

const pinecone_api_key = Deno.env.get("PINECONE_API_KEY") ?? "";
const pinecone_index_name = Deno.env.get("PINECONE_INDEX_NAME") ?? "";
const pinecone_namespace_esg = Deno.env.get("PINECONE_NAMESPACE_ESG") ?? "";

const opensearch_region = Deno.env.get("OPENSEARCH_REGION") ?? "";
const opensearch_domain = Deno.env.get("OPENSEARCH_DOMAIN") ?? "";
const opensearch_index_name = Deno.env.get("OPENSEARCH_INDEX_NAME") ?? "";

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
      id, company_short_name, report_title, publication_date
    FROM esg_meta
    WHERE id IN ${sql(id)}
  `;
  return records;
}

const search = async (query: string, topK: number, filter: object) => {
  // console.log(query, topK, filter);

  const searchVector = await openaiClient.embedQuery(query);

  const [pineconeResponse, fulltextResponse] = await Promise.all([
    index.namespace(pinecone_namespace_esg).query({
      vector: searchVector,
      filter: filter,
      topK: topK,
      includeMetadata: true,
    }),
    opensearchClient.search({
      index: opensearch_index_name,
      body: {
        query: {
          match: {
            text: query,
          },
        },
        size: topK,
      },
    }),
  ]);

  if (!pineconeResponse) {
    console.error("Pinecone query response is empty.");
  }

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

  const pgResponse = await getEsgMeta(Array.from(unique_doc_id_set));

  const docList = unique_docs.map((doc) => {
    const record = pgResponse.find((r) => r.id === doc.id);

    if (record) {
      const formattedDate =
        new Date(record.publication_date).toISOString().split("T")[0];
      const companyShortName = record.company_short_name;
      const reportTitle = record.report_title;
      const pageNumber = doc.page_number;
      const sourceEntry =
        `${companyShortName}. ${reportTitle}. ${formattedDate}. (P${pageNumber})`;
      return { content: doc.text, source: sourceEntry };
    } else {
      throw new Error("Record not found");
    }
  });

  return docList;
};

type FilterType = { rec_id: { "$in": string[] } } | Record<string, never>;
class SearchEsgTool extends DynamicStructuredTool {
  constructor() {
    super({
      name: "Search_ESG_Tool",
      description: "Call this tool to search the ESG database for information.",
      schema: z.object({
        query: z.string().describe("Requirements or questions from the user."),
        docIds: z.array(z.string()).default([]).describe(
          "document ids to filter the search.",
        ),
        topK: z.number().default(5).describe("Number of results to return."),
      }),
      func: async (
        { query, docIds, topK }: {
          query: string;
          docIds: string[];
          topK: number;
        },
      ) => {
        if (!query) {
          throw new Error("Query is empty.");
        }

        const filter: FilterType = docIds.length > 0
          ? { rec_id: { "$in": docIds } }
          : {};
        const results = await search(query, topK, filter);
        return JSON.stringify(results);
      },
    });
  }
}

export default SearchEsgTool;
