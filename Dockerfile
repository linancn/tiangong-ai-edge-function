FROM --platform=linux/arm64 supabase/edge-runtime:v1.58.3

COPY ./supabase/functions/_shared/supabase_auth.ts /home/deno/functions/_shared/supabase_auth.ts
COPY ./supabase/functions/main /home/deno/functions/main
CMD [ "start", "--main-service", "/home/deno/functions/main" ]