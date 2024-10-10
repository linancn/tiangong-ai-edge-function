// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { createClient } from '@supabase/supabase-js@2';
import DDG from 'duck-duck-scrape';
import { corsHeaders } from '../_shared/cors.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';

const supabase_url = Deno.env.get('LOCAL_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('LOCAL_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const search = async (query: string, maxResults: number = 3) => {
  try {
    const searchResults = await DDG.search(query, {
      safeSearch: DDG.SafeSearchType.STRICT,
    });

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

  const supabase = createClient(supabase_url, supabase_anon_key);
  const authResponse = await supabaseAuth(
    supabase,
    req.headers.get('email') ?? '',
    req.headers.get('password') ?? '',
  );
  if (authResponse.status !== 200) {
    return authResponse;
  }

  const { query, maxResults = 5 } = await req.json();
  // console.log(query, maxResults);

  const result = await search(query, maxResults);
  // console.log(result);

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/internet_search' \
    --header 'Content-Type: application/json' \
    --header 'email: xxx' \
    --header 'password: xxx' \
    --data '{"query":"哪些公司使用了阿里云来帮助减排？", "maxResults": 2}'
*/
