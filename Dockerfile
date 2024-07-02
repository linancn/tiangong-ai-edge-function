FROM --platform=linux/arm64 supabase/edge-runtime:v1.54.9

COPY ./supabase/functions/main /home/deno/functions/main
CMD [ "start", "--main-service", "/home/deno/functions/main" ]