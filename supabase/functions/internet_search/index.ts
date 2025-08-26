// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { createClient } from '@supabase/supabase-js@2';
import { Redis } from '@upstash/redis';
import { search as DDGSearch, SafeSearchType } from 'duck-duck-scrape';
import { corsHeaders } from '../_shared/cors.ts';
import decodeApiKey from '../_shared/decode_api_key.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const supabase_url = Deno.env.get('REMOTE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_publishable_key =
  Deno.env.get('REMOTE_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';

const redis_url = Deno.env.get('UPSTASH_REDIS_URL') ?? '';
const redis_token = Deno.env.get('UPSTASH_REDIS_TOKEN') ?? '';

const supabase = createClient(supabase_url, supabase_publishable_key);

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

const search = async (query: string, maxResults: number = 3) => {
  try {
    // console.log('Searching:', query);
    const searchResults = await DDGSearch(
      query,
      {
        safeSearch: SafeSearchType.STRICT,
      },
      {
        // Temporary mitigation for DDG anomaly detection (see Snazzah/duck-duck-scrape#140)
        uri_modifier: (rawUrl: string) => {
          try {
            const url = new URL(rawUrl);
            url.searchParams.delete('ss_mkt');
            return url.toString();
          } catch {
            return rawUrl;
          }
        },
      },
    );
    // console.log(searchResults);

    if (Array.isArray(searchResults.results)) {
      const results = searchResults.results.slice(0, maxResults);
      const markdownList = results.map((item) => {
        const content = item.description;
        const source = `![icon](${item.icon})${item.title} [(${item.hostname})](${item.url})`;
        return { content, source };
      });
      return markdownList;
    } else {
      return [];
    }
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
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

  // let first_login = false;

  if (!(await redis.exists(email))) {
    const authResponse = await supabaseAuth(supabase, email, password);
    if (authResponse.status !== 200) {
      return authResponse;
    } else {
      await redis.setex(email, 3600, '');
      // first_login = true;
    }
  }

  const { query, maxResults = 5 } = await req.json();
  // console.log(query, maxResults);

  logInsert(email, Date.now(), 'internet_search', maxResults);

  const result = await search(query, maxResults);
  // console.log(result);

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
