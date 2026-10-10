---
docType: guide
scope: repo
status: current
authoritative: true
owner: edge-function
language: en
whenToUse: 'When setting up, serving, testing, or deploying TianGong AI Edge Functions.'
whenToUpdate: 'When local setup, runtime commands, environment templates, deployment steps, or exposed functions change.'
checkPaths:
  - AGENTS.md
  - .docpact/config.yaml
  - package.json
  - deno.json
  - Dockerfile
  - .env.example
  - supabase/**
  - test.example.http
lastReviewedAt: 2026-10-10
lastReviewedCommit: a8678bcbc48ee779494565eca08583a0a92c42a7
---

# TianGong-AI-Edge-Functions

<!-- tiangong-ai-migration-20260914:start -->

## GitHub organization migration / GitHub 组织迁移

This original repository now belongs to the [tiangong-ai organization](https://github.com/tiangong-ai), with its repository identity and history retained. The CLI package `@tiangong-ai/cli` and command `tiangong-ai` are unchanged. Wiki is now published as `@tiangong-ai/wiki`; its commands remain unchanged. See the [migration and upgrade notes](https://github.com/tiangong-ai/cli-toolkit/releases/tag/v0.0.63).

该仓库已迁入 [tiangong-ai 组织](https://github.com/tiangong-ai)，仓库身份与历史保留。CLI 包名 `@tiangong-ai/cli` 和命令 `tiangong-ai` 不变；Wiki 新包名为 `@tiangong-ai/wiki`，命令不变。升级方式见[迁移说明](https://github.com/tiangong-ai/cli-toolkit/releases/tag/v0.0.63)。原个人账号 `tiangong-ai-legacy` 保留历史；请自行 Follow 新组织。

<!-- tiangong-ai-migration-20260914:end -->

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

Copy `.env.example` to `.env.local` for root-level tooling, and copy `supabase/.env.example` to `supabase/.env.local` before running `npm start`.

Most remote API examples use `x-api-key` for authentication. `course_search` remote examples use scoped bearer tokens so the function can verify `kb:read` and apply collection-scope restrictions through `verify_kb_api_key`.

`course_search` can use `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` to cache successful Bearer API-key authorization contexts for 15 minutes. The cache is optional; when it is not configured or Redis is unavailable, the function falls back to the `verify_kb_api_key` RPC.

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

## Query Rewrite Model Evaluation

Set `OPENAI_CHAT_MODEL=gpt-6-luna` to select Luna for query rewriting and all text-generation functions. Both the multilingual and English rewrite helpers use this shared setting with `reasoning.effort=none`, `text.verbosity=low`, and `temperature=0`, keeping their existing schema/profile selection. The Chat compatibility branch sends the equivalent `reasoning_effort` and `verbosity` fields. General generation leaves reasoning and sampling parameters to the model defaults; embeddings use `OPENAI_EMBEDDING_MODEL`.

`OPENAI_CHAT_MODEL` is the single text-model setting. Keep it explicitly configured: an unset or blank value retains the existing shared default, `gpt-4o-mini`. A failed model request follows the existing error path without automatically switching models. Before configuring another model, validate all text-generation callers and the rewrite helpers' fixed none/low settings. No query rewrite cache or vector reindex is involved.

The shared request layer sends `temperature` only when explicitly supplied. Luna rejects this parameter when reasoning is not `none`, so general generation must not receive an implicit `temperature=0` ([OpenAI compatibility guidance](https://developers.openai.com/api/docs/guides/deployment-checklist)).

The Luna migration reuses the model-selection evidence from [LCA PR #465](https://github.com/tiangong-lca/edge-functions/pull/465). Local qualification is a bounded integration smoke, not another comparative benchmark:

```bash
# Offline request contracts: shared model selection, four profiles, both SDK paths, embedding isolation.
deno test --allow-env --config supabase/functions/deno.json scripts/query_rewrite_test.ts

# Inspect six fixed fixtures without provider calls.
deno run --config supabase/functions/deno.json scripts/query_rewrite_smoke.ts

# Explicit live smoke using your existing configured credentials: six calls, no retries/judge.
set -a; . ./supabase/.env.local; set +a
deno run --allow-env --allow-net --allow-read --allow-write=/tmp \
  --config supabase/functions/deno.json scripts/query_rewrite_smoke.ts \
  --live --output=/tmp/query-rewrite-smoke.json
```

Keep provider receipts and backend responses outside Git. See the development runbook for observed qualification and its limits.

`scripts/eval_query_rewrite_models.ts` compares `OPENAI_CHAT_MODEL` candidates for query rewrite only. It reuses the production rewrite prompts and schemas, keeps `gpt-4.1-mini` as the baseline, and writes JSON plus Markdown reports under `/tmp/tiangong-eval` by default.

```bash
# Fast compatibility check across baseline and candidate models.
set -a; . ./supabase/.env.local; set +a
deno run --allow-env --allow-net --allow-read --allow-write \
  --config supabase/functions/deno.json \
  scripts/eval_query_rewrite_models.ts --dry-run

# Full run: all bundled search queries, repeated three times per model.
deno run --allow-env --allow-net --allow-read --allow-write \
  --config supabase/functions/deno.json \
  scripts/eval_query_rewrite_models.ts
```

The script evaluates `gpt-4.1-nano`, `gpt-4o-mini`, and GPT-5 nano-family candidates with `reasoning.effort=none` when configured. It does not change the production `OPENAI_CHAT_MODEL`; use the report recommendation before making a separate config change.

## Docker Deployment on AWS ECS Fargate

This path is not currently validated: `Dockerfile` references `supabase/functions/main` and `supabase/functions/import_map.json`, which are not present.

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

IMPORT_MAP="--import-map supabase/functions/deno.json"

npx supabase functions deploy edu_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy esg_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy internal_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy sci_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy course_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy patent_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy report_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy standard_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy textbook_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy green_deal_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy bigquery_search --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy info_extract --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP

npx supabase functions deploy question_generation --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
npx supabase functions deploy kg_generate --project-ref qyyqlnwqwgvzxnccnbgm --no-verify-jwt $IMPORT_MAP
```
