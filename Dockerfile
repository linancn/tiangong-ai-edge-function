FROM --platform=linux/arm64 denoland/deno:debian-1.45.2

RUN apt-get update && apt-get install -y redis-server
RUN apt-get clean
RUN rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ./supabase/functions/_shared /app/_shared
COPY ./supabase/functions/main /app/main
COPY ./supabase/functions/import_map.json /app/import_map.json

COPY .env /app/.env

CMD ["sh", "-c", "redis-server --daemonize yes && deno run --allow-all --env --import-map import_map.json ./main/index.ts"]