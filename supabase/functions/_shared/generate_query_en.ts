// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';

const openai_api_key = Deno.env.get('OPENAI_API_KEY') ?? '';
// const openai_chat_model = Deno.env.get('OPENAI_CHAT_MODEL') ?? '';

const model = new ChatOpenAI({
  model: 'gpt-4o-mini',
  temperature: 0,
  apiKey: openai_api_key,
});

const querySchema = {
  type: 'object',
  properties: {
    semantic_query: {
      title: 'SemanticQuery',
      description: 'A query for semantic retrieval in English.',
      type: 'string',
    },
    fulltext_query_eng: {
      title: 'FulltextQueryENG',
      description:
        'A query list for full-text search in English, including original names and synonyms.',
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['semantic_query', 'fulltext_query_eng'],
};

interface QueryResponse {
  semantic_query: string;
  fulltext_query_eng: string[];
}

const modelWithStructuredOutput = model.withStructuredOutput(querySchema);

const prompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `Task: Transform original query into two specific queries: SemanticQuery and FulltextQueryENG.`,
  ],
  ['human', 'Original query: {input}'],
]);

const chain = prompt.pipe(modelWithStructuredOutput);

async function generateQuery(query: string) {
  const response = await chain.invoke({ input: query });
  // console.log(response);
  return response as QueryResponse;
}

export default generateQuery;
