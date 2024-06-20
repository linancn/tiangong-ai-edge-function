// Setup type definitions for built-in Supabase Runtime APIs
/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { ChatOpenAI } from "https://esm.sh/@langchain/openai";
import { ChatPromptTemplate } from "https://esm.sh/@langchain/core/prompts";

const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
const openai_chat_model = Deno.env.get("OPENAI_CHAT_MODEL") ?? "";

const model = new ChatOpenAI({
  model: openai_chat_model,
  temperature: 0,
  apiKey: openai_api_key,
});

const querySchema = {
  type: "object",
  properties: {
    semantic_query: {
      title: "SemanticQuery",
      description: "A query for semantic retrieval in query's original language.",
      type: "string",
    },
    fulltext_query_eng: {
      title: "FulltextQueryENG",
      description:
        "A query list for full-text search in English, including original names and synonyms.",
      type: "array",
      "items": {
        "type": "string",
      },
    },
    fulltext_query_chi_sim: {
      title: "FulltextQueryChiSim",
      description:
        "A query list for full-text search in Simplified Chinese, including original names and synonyms.",
      type: "array",
      "items": {
        "type": "string",
      },
    },
    fulltext_query_chi_tra: {
      title: "FulltextQueryChiTra",
      description:
        "A query list for full-text search in Traditional Chinese, including original names and synonyms.",
      type: "array",
      "items": {
        "type": "string",
      },
    },
  },
  required: [
    "semantic_query",
    "fulltext_query_eng",
    "fulltext_query_chi_sim",
    "fulltext_query_chi_tra",
  ],
};

const modelWithStructuredOutput = model.withStructuredOutput(querySchema);

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `Task: Transform original query into four specific queries: SemanticQuery, FulltextQueryENG, FulltextQueryChiSim and FulltextQueryChiTra.`,
  ],
  ["human", "Original query: {input}"],
]);

const chain = prompt.pipe(modelWithStructuredOutput);

async function generateQuery(
  query: string,
) {
  const response = await chain.invoke({ input: query });
  // console.log(response);
  return response;
}

export default generateQuery;
