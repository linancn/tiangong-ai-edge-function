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

const supabase_url = Deno.env.get('LOCAL_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('LOCAL_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

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

/* To invoke locally:
curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/info_extract' \
  --header 'email: xxx' \
  --header 'password: xxx' \
  --data '{
  "question": "什么是危险废物固化稳定化处理技术？",
  "context" : "危险险废物固化/稳定化处理技术\n5.1 概述\n5.1.1 固化/稳定化的定义\n\n通常，危险废物固化/稳定化的途径是：① 将污染物通过化学转变，引入到某种稳定固体物质的晶格中去；② 通过物理过程把污染物直接掺入到惰性基材中去。所涉及到的主要技术和技术术语有：\n\n（1）固化技术  固化技术是指在危险废物中添加固化剂或者通过热处理手段，使其转变为不可流动固体或形成紧密固体的过程。固化的产物是结构完整的整块密实固体，这种固体可以方便的尺寸大小进行运输，而无需任何辅助容器。\n\n（2）稳定化技术  稳定化技术是指利用添加剂，将危险废物中的有毒有害污染物转变为低溶解性、低迁移性及低毒性的物质的过程。稳定化一般可分为化学稳定化和物理稳定化，化学稳定化是通过化学反应使有毒物质变成不溶性化合物，使之在稳定的晶格内固定不动；物理稳定化是将污泥或半固体物质与一种疏松物料（如粉煤灰）混合生成一种粗颗粒，有土壤状坚实度的固体，这种固体可以用运输机械送至处置场。实际操作中，这两种过程是同时发生的。\n\n（3）包容化技术  包容技术是指用稳定剂或固化剂与危险废物发生凝聚作用，将有毒物质或危险废物颗粒包容或覆盖的 过程。\n\n固化和稳定化技术在处理危险废物时通常无法截然分开，固化的过程会有稳定化的作用发生，稳定化的过程往往也具有固化的作用。而在固化和稳定化处理过程中，往往也发生包容化的作用。固化技术和稳定化技术在污染土壤的治理中也是常用的一类技术。"}'
    */
