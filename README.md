---
docType: guide
scope: repo
status: current
authoritative: true
owner: edge-function
language: en
whenToUse: "When setting up, serving, testing, or deploying TianGong AI Edge Functions."
whenToUpdate: "When local setup, runtime commands, environment templates, deployment steps, or exposed functions change."
checkPaths:
  - AGENTS.md
  - .docpact/config.yaml
  - package.json
  - deno.json
  - Dockerfile
  - .env.example
  - supabase/**
  - test.example.http
lastReviewedAt: 2026-04-29
lastReviewedCommit: 6769a7b7210a6386d6dae6695bdd9010a1185614
---

# TianGong-AI-Edge-Functions

## Env Preparing

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 22
nvm use

curl -fsSL https://deno.land/install.sh | sh -s v2.1.4 # Then manually add the deno directory to your $HOME/.zshrc (or similar)

# Install dependencies (first run)
npm install

# Update dependencies
npm update && npm ci

# start local instance with .env.local
npm start

# Code Prettier
npm run lint

```

## Deno info

```bash
deno info
```

Copy `.env.example` to `.env.local` for root-level tooling, and copy
`supabase/.env.example` to `supabase/.env.local` before running `npm start`.

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
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
   S3 Access Key: 625729a08b95bf1b7ff351a663f3a23c
   S3 Secret Key: 850181e4652dd023b7a98c58ae0d2d34bd487ee0cc3254aed6eda37307425907
       S3 Region: local
````

## Local Test

```bash
# Start Supabase Edge Functions Server
npm start
# equivalent to
npx supabase functions serve --env-file ./supabase/.env.local --no-verify-jwt
```

Edit .env file refer to .env.example then use REST Client extension of VSCode to test the API in test.local.http.

## Docker Deployment on AWS ECS Fargate

This path is not currently validated: `Dockerfile` references
`supabase/functions/main` and `supabase/functions/import_map.json`, which are
not present.

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
npx supabase functions deploy esg_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy internal_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy sci_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy course_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy patent_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy report_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy standard_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy textbook_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy green_deal_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy bigquery_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy info_extract --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt

npx supabase functions deploy question_generation --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
npx supabase functions deploy kg_generate --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt
```
