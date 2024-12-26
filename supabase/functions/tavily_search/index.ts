// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { createClient } from '@supabase/supabase-js@2';
import { tavily } from '@tavily/core';
import { Redis } from '@upstash/redis';
import { corsHeaders } from '../_shared/cors.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const supabase_url = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('REMOTE_SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('REMOTE_SUPABASE_ANON_KEY') ?? '';

const redis_url = Deno.env.get('UPSTASH_REDIS_URL') ?? '';
const redis_token = Deno.env.get('UPSTASH_REDIS_TOKEN') ?? '';

const tavily_api_key = Deno.env.get('TAVILY_API_KEY') ?? '';

const tvly = tavily({ apiKey: tavily_api_key });

const supabase = createClient(supabase_url, supabase_anon_key);

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

const search = async (query: string, maxResults: number = 5) => {
  try {
    // console.log('Searching:', query);
    const searchResults = await tvly.search(query, { maxResults });
    // console.log(searchResults);

    const markdownList = searchResults.results.map((item) => {
      const content = item.content;
      const source = `[${item.title}](${item.url})`;
      return { content, source };
    });
    return markdownList;
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
};

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

  const { query, maxResults = 5 } = await req.json();
  // console.log(query, maxResults);

  logInsert(email, Date.now(), 'tavily_search', maxResults);

  const result = await search(query, maxResults);
  // console.log(result);

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});
