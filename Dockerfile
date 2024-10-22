FROM --platform=linux/arm64 denoland/deno:debian-1.45.2

WORKDIR /app

COPY ./supabase/functions/_shared /app/_shared
COPY ./supabase/functions/main /app/main
COPY ./supabase/functions/import_map.json /app/import_map.json

CMD [ "run", "--allow-all", "--import-map", "import_map.json", "./main/index.ts" ]
