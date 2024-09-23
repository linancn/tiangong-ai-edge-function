// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "https://esm.sh/v135/@supabase/functions-js/src/edge-runtime.d.ts";

import DDG from "npm:/duck-duck-scrape";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import supabaseAuth from "../_shared/supabase_auth.ts";

const supabase_url = Deno.env.get("LOCAL_SUPABASE_URL") ??
  Deno.env.get("SUPABASE_URL") ?? "";
const supabase_anon_key = Deno.env.get("LOCAL_SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const search = async (
  query: string,
  topK: number = 0,
) => {
  const searchResults = await DDG.search(query, {
    safeSearch: DDG.SafeSearchType.STRICT,
    offset: topK,
  });
  return searchResults;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(supabase_url, supabase_anon_key);
  const authResponse = await supabaseAuth(
    supabase,
    req.headers.get("email") ?? "",
    req.headers.get("password") ?? "",
  );
  if (authResponse.status !== 200) {
    return authResponse;
  }

  const { query, topK } = await req.json();
  // console.log(query, topK);

  const result = await search(
    query,
    topK,
  );
  console.log(result);

  return new Response(
    JSON.stringify(result),
    { headers: { "Content-Type": "application/json" } },
  );
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/internet_search' \
    --header 'Content-Type: application/json' \
    --header 'email: xxx' \
    --header 'password: xxx' \
    --data '{"query": "Tunnel for high-speed vehicles?", "filter": {"country": ["Japan"], "publication_date": {"$gte": 19900101}}, "topK": 3}'
*/
