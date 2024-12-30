// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { createClient } from '@supabase/supabase-js@2';
import { Redis } from '@upstash/redis';
import neo4j from 'neo4j-driver';
import { corsHeaders } from '../_shared/cors.ts';
import generateQuery from '../_shared/generate_query.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const openai_api_key = Deno.env.get('OPENAI_API_KEY') ?? '';
const openai_chat_model = Deno.env.get('OPENAI_CHAT_MODEL_LATEST') ?? '';

const neo4j_url = Deno.env.get('NEO4J_URI') ?? '';
const neo4j_user = Deno.env.get('NEO4J_USER') ?? '';
const neo4j_password = Deno.env.get('NEO4J_PASSWORD') ?? '';

const supabase_url = Deno.env.get('REMOTE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('REMOTE_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const redis_url = Deno.env.get('UPSTASH_REDIS_URL') ?? '';
const redis_token = Deno.env.get('UPSTASH_REDIS_TOKEN') ?? '';

const driver = neo4j.driver(neo4j_url, neo4j.auth.basic(neo4j_user, neo4j_password));

const supabase = createClient(supabase_url, supabase_anon_key);

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

// NEO4J DATABASE SEARCH
const search = async (full_text_query: string[], root: number, depth: number) => {
  const searchText = full_text_query.join(' ');
  const { records } = await driver.executeQuery(
    `CALL db.index.fulltext.queryNodes("concept_fulltext_index","${searchText}") YIELD node,score WITH node AS startNode ORDER BY score DESC LIMIT ${root} MATCH path = (startNode)-[r:HAS_PART*..${depth}]->(endNode) WHERE NOT (endNode)-->() RETURN path`,
  );

  await driver.close();

  return records;
};

// RESULT CONVERSION

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
  `
    There is retrieved result from NEO4J database, using the following cypher query sentence.
    This result shows the tree-shape hierarchical knowledge structure from the root node related to '{searchText}', with elementId representing the unique identifier of each node.
    Please convert the result into a structured JSON format to ensure clear hierarchical relationships and logical connections between all levels.

    Cypher query: CALL db.index.fulltext.queryNodes('concept_fulltext_index','{searchText}') YIELD node,score WITH node AS startNode ORDER BY score DESC LIMIT {root} MATCH path = (startNode)-[r:HAS_PART*..{depth}]->(endNode) WHERE NOT (endNode)-->() RETURN path

    Retrieved results: {result}.
    `,
]);

const chain = prompt.pipe(modelWithStructuredOutput);

async function generateGraph(searchText: string, root: number, depth: number, result: string) {
  const response = await chain.invoke({
    searchText: searchText,
    root: root,
    depth: depth,
    result: result,
  });
  return response as QueryResponse;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const email = req.headers.get('email') ?? '';
  const password = req.headers.get('password') ?? '';

  if (!(await redis.exists(email))) {
    const authResponse = await supabaseAuth(supabase, email, password);
    if (authResponse.status !== 200) {
      return authResponse;
    } else {
      await redis.setex(email, 3600, '');
    }
  }

  const { query, root = 1, depth = 2 } = await req.json();
  // console.log(query, filter);

  logInsert(email, Date.now(), 'edu_graph_generate', root, depth);

  const res = await generateQuery(query);
  // console.log(res);
  const result = await search(
    [...res.fulltext_query_chi_sim, ...res.fulltext_query_eng],
    root,
    depth,
  );

  const result_structure = await generateGraph(query, root, depth, JSON.stringify(result));
  // console.log(result);

  return new Response(JSON.stringify(result_structure), {
    headers: { 'Content-Type': 'application/json' },
  });
});
