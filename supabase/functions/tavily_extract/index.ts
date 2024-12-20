// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { createClient } from '@supabase/supabase-js@2';
import { tavily } from '@tavily/core';
import { Redis } from '@upstash/redis';
import { corsHeaders } from '../_shared/cors.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const supabase_url = Deno.env.get('LOCAL_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('LOCAL_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const redis_url = Deno.env.get('UPSTASH_REDIS_URL') ?? '';
const redis_token = Deno.env.get('UPSTASH_REDIS_TOKEN') ?? '';

const tavily_api_key = Deno.env.get('TAVILY_API_KEY') ?? '';

const tvly = tavily({ apiKey: tavily_api_key });

const supabase = createClient(supabase_url, supabase_anon_key);

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

const extract = async (urls: Array<string>) => {
  try {
    const extractResults = await tvly.extract(urls);
    console.log(extractResults);

    const markdownList = extractResults.results.map((item) => {
      const content = item.rawContent;
      const source = item.url;
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

  const { urls } = await req.json();
  const urls_json = JSON.parse(urls);
  const numberOfUrls = urls_json.length;
  // console.log(urls_json);
  // console.log(numberOfUrls);

  logInsert(email, Date.now(), 'tavily_extract', numberOfUrls);

  const result = await extract(urls_json);
  // console.log(result);

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});
