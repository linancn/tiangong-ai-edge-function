FROM --platform=linux/arm64 supabase/edge-runtime:v1.54.6

COPY ./supabase/functions/main /home/deno/functions/main
CMD [ "start", "--main-service", "/home/deno/functions/main" ]