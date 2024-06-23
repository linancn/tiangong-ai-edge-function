FROM --platform=linux/arm64 supabase/edge-runtime:v1.54.6

COPY ./supabase/functions /home/deno/functions
CMD [ "start", "--main-service", "/home/deno/functions/esg_compliance" ]