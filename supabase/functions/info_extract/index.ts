// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { createClient } from '@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const openai_api_key = Deno.env.get('OPENAI_API_KEY') ?? '';
const openai_chat_model = Deno.env.get('OPENAI_CHAT_MODEL') ?? '';

const supabase_url = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('REMOTE_SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('REMOTE_SUPABASE_ANON_KEY') ?? '';

const model = new ChatOpenAI({
  model: openai_chat_model,
  temperature: 0,
  apiKey: openai_api_key,
});

const responseSchema = {
  type: 'object',
  description:
    'A list of tuples containing a pair of start and end nodes, and the edge between nodes in the same language as the topic',
  properties: {
    tuples: {
      type: 'array',
      items: {
        type: 'object',
        description:
          'A tuple with specific start node, end node and their relationship in the same language as the topic.',
        properties: {
          start_node: {
            type: 'string',
            description: 'A concept from extracted ontology',
          },
          end_node: {
            type: 'string',
            description: 'A related concept from extracted ontology',
          },
          edge: {
            type: 'string',
            description:
              'A relationship between the corresponding concepts of start_node and end_node in one simple phrase',
          },
        },
        required: ['start_node', 'end_node', 'edge'],
      },
    },
  },
  required: ['tuples'],
};

interface QueryResponse {
  tuples: string[];
}
const modelWithStructuredOutput = model.withStructuredOutput(responseSchema);

const prompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `
    "You are an expert in network graph generation, specializing in extracting terms and their relationships from a given context with precision.\n"
    "Your task is to extract all ontological terms and their relations from the provided context, ensuring thoroughness and accuracy. \n"
    "The extracted terms should represent the key and specific concepts in the topic. \n"
    "\n"
    "Guidelines for extraction:\n"
    "1. While analyzing the text, focus on identifying key terms in each sentence.\n"
        "\t- Terms must be closely related to the provided topic, which should be professional nouns.\n"
        "\t- Terms should be simple and specific. Avoid over-generalizing.\n"
        "\t- Consider every type of concept mentioned, such as concrete objects, abstract ideas, names, places, and events.\n"
    "2. Think about the relationships between the identified terms:\n"
        "\t- Terms appearing in the same sentence, paragraph, or context are often related.\n"
        "\t- Be thorough in identifying one-to-one, one-to-many, and many-to-many relationships between terms.\n"
        "\t- Relations may include 'is a type of', 'is part of', 'is associated with', 'causes', 'depends on', etc.\n"
    "3. Translate all the terms and relationships to the same language as the INPUT Topic.\n"

    "Output (SHOULD translate into the language same as the topic):\n"
    "Return all extracted terms and their relations in a structured JSON format. \n"
    "Each pair of related terms should be output with its relationship.\n"
    `,
  ],
  [
    'human',
    `The following context is related to "{topic}". \n
    Context: {context}`,
  ],
]);

const chain = prompt.pipe(modelWithStructuredOutput);

async function generateQuery(context: string, question: string) {
  // const response = await chain.invoke({ context: query });
  const response = await chain.invoke({ context: context, topic: question });
  // console.log(response);
  return response as QueryResponse;
}
// export default generateQuery;

Deno.serve(async (req) => {
  // console.log(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  // Get the session or user object
  const supabase = createClient(supabase_url, supabase_anon_key);
  const authResponse = await supabaseAuth(
    supabase,
    req.headers.get('email') ?? '',
    req.headers.get('password') ?? '',
  );
  if (authResponse.status !== 200) {
    return authResponse;
  }

  const { question = ' ', context } = await req.json();
  // console.log(question);
  // console.log(question, context);
  // console.log(query, filter);
  logInsert(req.headers.get('email') ?? '', Date.now(), 'info_extract');

  const result = await generateQuery(context, question);
  // console.log(result)
  // const result = await generateQuery(query, question);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});
