// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { createClient } from '@supabase/supabase-js@2';
import { Redis } from '@upstash/redis';
import neo4j from 'neo4j-driver';
import { corsHeaders } from '../_shared/cors.ts';
import decodeApiKey from '../_shared/decode_api_key.ts';
import generateQuery from '../_shared/generate_query.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

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

const search = async (full_text_query: string[], root: number, depth: number) => {
  const searchText = full_text_query.join(' ');
  const { records } = await driver.executeQuery(
    `CALL db.index.fulltext.queryNodes("concept_fulltext_index","${searchText}") YIELD node,score WITH node AS startNode ORDER BY score DESC LIMIT ${root} MATCH path = (startNode)-[r:HAS_PART*..${depth}]->(endNode) WHERE NOT (endNode)-->() RETURN path`,
  );

  await driver.close();

  return records;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let email = req.headers.get('email') ?? '';
  let password = req.headers.get('password') ?? '';

  const apiKey = req.headers.get('x-api-key') ?? '';
  // console.log(apiKey);

  if (apiKey && (!email || !password)) {
    const credentials = decodeApiKey(apiKey);

    if (credentials) {
      if (!email) email = credentials.email;
      if (!password) password = credentials.password;
    } else {
      return new Response(JSON.stringify({ error: 'Invalid API Key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  let first_login = false;

  if (!(await redis.exists(email))) {
    const authResponse = await supabaseAuth(supabase, email, password);
    if (authResponse.status !== 200) {
      return authResponse;
    } else {
      await redis.setex(email, 3600, '');
      first_login = true;
    }
  }

  const { query, root = 1, depth = 3 } = await req.json();
  // console.log(query, filter);

  logInsert(email, Date.now(), 'edu_graph_search', root, depth);

  const res = await generateQuery(query);
  // console.log(res);
  const result = await search(
    [...res.fulltext_query_chi_sim, ...res.fulltext_query_eng],
    root,
    depth,
  );
  // console.log(result);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});
