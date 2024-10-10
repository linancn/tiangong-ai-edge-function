FROM --platform=linux/arm64 supabase/edge-runtime:v1.58.11

COPY ./supabase/functions/_shared/supabase_auth.ts /home/deno/functions/_shared/supabase_auth.ts
COPY ./supabase/functions/_shared/supabase_function_log.ts /home/deno/functions/_shared/supabase_function_log.ts
COPY ./supabase/functions/main /home/deno/functions/main
CMD [ "start", "--main-service", "/home/deno/functions/main" ]