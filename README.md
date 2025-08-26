# TianGong-AI-Edge-Functions

## Env Preparing (Docker Engine MUST be Running)

```bash

sudo apt-get update && sudo apt-get install -y redis-server
# Optional
redis-server --daemonize yes

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
nvm use

curl -fsSL https://deno.land/install.sh | sh -s v2.1.4 # Then manually add the deno directory to your $HOME/.zshrc (or similar)

npm install

# Update packages
npm update && npm ci

deno cache --reload *.ts

npx supabase start

# start local instance with .env.local
npm run start

# Code Prettier
npm run lint

```

## Clear Deno cache

```bash
deno info
rm -rf ~/Library/Caches/deno # for macOS
rm -rf ~/.cache/deno # for Linux
```

Rename the `.env.example` to `.env.local` and fill in the the values before the `npx supabase start` command.

## Local Development

````bash

Started supabase local development setup.

```bash
         API URL: http://127.0.0.1:64321
     GraphQL URL: http://127.0.0.1:64321/graphql/v1
  S3 Storage URL: http://127.0.0.1:64321/storage/v1/s3
          DB URL: postgresql://postgres:postgres@127.0.0.1:64322/postgres
      Studio URL: http://127.0.0.1:64323
    Inbucket URL: http://127.0.0.1:64324
      JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
        anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
   S3 Access Key: 625729a08b95bf1b7ff351a663f3a23c
   S3 Secret Key: 850181e4652dd023b7a98c58ae0d2d34bd487ee0cc3254aed6eda37307425907
       S3 Region: local
````

## Local Test

```bash
# Start Supabase Edge Functions Server
npm run start
# equivalent to
npx supabase functions serve --env-file ./supabase/.env.local --no-verify-jwt

# Start Deno Server for LangGrapgh
deno run --allow-all --import-map supabase/functions/import_map.json --env --watch supabase/functions/main/index.ts

curl -i --location --request GET 'http://localhost:8000/main/health'
```

OR

Edit .env file refer to .env.example then use REST Client extension of VSCode to test the API in test.local.http.

## Docker Deployment on AWS ECS Fargate

```bash
docker build -t 339712838008.dkr.ecr.us-east-1.amazonaws.com/supabase/edge-runtime:v20240715 .

docker run -p 8000:8000 339712838008.dkr.ecr.us-east-1.amazonaws.com/supabase/edge-runtime:v20240715

aws ecr get-login-password --region us-east-1  | docker login --username AWS --password-stdin 339712838008.dkr.ecr.us-east-1.amazonaws.com

docker push 339712838008.dkr.ecr.us-east-1.amazonaws.com/supabase/edge-runtime:v20240715

aws ecs describe-task-definition --task-definition langserve:8

aws ecs describe-tasks --cluster production --tasks cb72b1cf0ee240b3b3820f3e9431cb7c

```

## Remote Config

```bash
npx supabase login

# npx supabase secrets set --env-file ./supabase/.env.production --project-ref qyyqlnwqwgvzxnccnbgm

npx supabase functions deploy edu_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy edu_graph_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy esg_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy internal_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy sci_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy patent_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy report_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy internet_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy standard_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy textbook_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy tavily_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy green_deal_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt

npx supabase functions deploy tavily_extract --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy edu_graph_generate --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy question_generation --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy kg_generate --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
```
