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
const supabase_publishable_key =
  Deno.env.get('REMOTE_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';

const model = new ChatOpenAI({
  model: openai_chat_model,
  temperature: 0,
  apiKey: openai_api_key,
});

const responseSchema = {
  type: 'object',
  description:
    'Schema for the response containing extracted terms and their relationships from a given context in the same language as input topic, ensuring the generated result is a tree structure with two more levels (at most 6).',
  properties: {
    name: {
      type: 'string',
      description: 'The name of the node, which is the extracted term.',
    },
    node_id: {
      type: 'string',
      description: 'The unique identifier for the node.',
    },
    children: {
      type: 'array',
      description: 'This is an array of child nodes, allowing for a hierarchical structure.',
      items: {
        $ref: '#/definitions/node',
      },
      required: ['items'],
    },
    relations: {
      type: 'array',
      description:
        'List of relationships between the corresponding concepts associated with the node',
      items: {
        $ref: '#/definitions/relation',
      },
    },
  },
  required: ['name', 'node_id', 'children', 'relations'],
  definitions: {
    node: {
      type: 'object',
      description: 'Schema for a child node.',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the child node.',
        },
        node_id: {
          type: 'string',
          description: 'The unique identifier for the child node.',
        },
        children: {
          type: 'array',
          description: 'List of child nodes of this node.',
          items: {
            $ref: '#/definitions/node',
          },
        },
      },
      required: ['name', 'node_id', 'children'],
    },
    relation: {
      type: 'object',
      description: 'Schema for a relationship between nodes.',
      properties: {
        relation_name: {
          type: 'string',
          description: 'The name of the relationship.',
        },
        source_node_id: {
          type: 'string',
          description: 'The unique identifier for the source node in the relationship.',
        },
        target_node_id: {
          type: 'string',
          description: 'The unique identifier for the target node in the relationship.',
        },
      },
      required: ['relation_name', 'source_node_id', 'target_node_id'],
    },
  },
};

interface Node {
  name: string;
  node_id: string;
  children: Node[];
}

interface Relation {
  relation_name: string;
  source_node_id: string;
  target_node_id: string;
}

interface QueryResponse {
  name: string;
  node_id: string;
  children: Node[];
  relations: Relation[];
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

    "Output:\n"
    "Return all extracted terms and their relations in a structured JSON format. \n"
    "Each pair of related terms should be output with its relationship.\n"
    "Translated into Chinese."
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
  const response = await chain.invoke({ context: context, topic: question });
  return response as QueryResponse;
}
// export default generateQuery;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  // Get the session or user object
  const supabase = createClient(supabase_url, supabase_publishable_key);
  const authResponse = await supabaseAuth(
    supabase,
    req.headers.get('email') ?? '',
    req.headers.get('password') ?? '',
  );
  if (authResponse.status !== 200) {
    return authResponse;
  }

  const { question = ' ', context } = await req.json();
  logInsert(req.headers.get('email') ?? '', Date.now(), 'kg_generate');
  const result = await generateQuery(context, question);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});
