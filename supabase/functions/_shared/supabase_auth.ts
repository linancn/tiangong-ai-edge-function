// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { SupabaseClient } from '@supabase/supabase-js@2';

async function supabaseAuth(supabase: SupabaseClient, email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });
  if (error) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (data.user.role !== 'authenticated') {
    return new Response('You are not an authenticated user.', {
      status: 401,
    });
  } else {
    return new Response('Authorized', { status: 200 });
  }
}

export default supabaseAuth;
