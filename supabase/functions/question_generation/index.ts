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

const supabase_url = Deno.env.get('REMOTE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('REMOTE_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const model = new ChatOpenAI({
  model: openai_chat_model,
  temperature: 0,
  apiKey: openai_api_key,
});

const responseSchema = {
  type: 'object',
  properties: {
    What: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    Why: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    Where: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    When: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    Who: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    How: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['What', 'Why', 'Where', 'When', 'Who', 'How'],
};

interface QueryResponse {
  What: string[];
  Why: string[];
  Where: string[];
  When: string[];
  Who: string[];
  How: string[];
}

const modelWithStructuredOutput = model.withStructuredOutput(responseSchema);

const prompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `Generate 10 questions (MUST in the language same as perspective) for each perspective: What, Why, Where, When, Who, and How.`,
  ],
  ['human', 'Perspective: {input}'],
]);

const chain = prompt.pipe(modelWithStructuredOutput);

async function generateQuery(query: string) {
  const response = await chain.invoke({ input: query });
  // console.log(response);
  return response as QueryResponse;
}
// export default generateQuery;

Deno.serve(async (req) => {
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

  const { query } = await req.json();
  // console.log(query, filter);
  logInsert(req.headers.get('email') ?? '', Date.now(), 'question_generation');

  const result = await generateQuery(query);
  // console.log(result);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});
