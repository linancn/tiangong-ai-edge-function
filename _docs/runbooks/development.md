---
docType: runbook
scope: repo
status: current
authoritative: true
owner: edge-function
language: en
whenToUse: 'When developing, validating, or deploying edge functions.'
whenToUpdate: 'When setup commands, local serve flow, validation, or deployment commands change.'
checkPaths:
  - README.md
  - package.json
  - deno.json
  - Dockerfile
  - supabase/**
lastReviewedAt: 2026-10-10
lastReviewedCommit: 8de58fbcb4dc10abece3131a5ea3ed4b63970056
---

# Edge Function Development Runbook

## Setup

1. Use Node.js 22 from `.nvmrc`.
2. Install Deno as described in `README.md`.
3. Run `npm install`.
4. Copy `.env.example` to `.env.local` for root-level tooling.
5. Copy `supabase/.env.example` to `supabase/.env.local` before running `npm start`.
6. Configure `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` when validating `course_search` Bearer authorization caching; leave them unset to force live RPC verification.

## Local Serve

Run:

```bash
npm start
```

This serves Supabase functions with:

```bash
supabase functions serve --env-file ./supabase/.env.local --no-verify-jwt
```

## Validation

Run:

```bash
npm run lint
docpact validate-config --root . --strict
```

Use `test.example.http` or a REST client for endpoint checks when function behavior changes.

## Query Rewrite Model Evaluation

Production query rewriting uses `OPENAI_QUERY_REWRITE_MODEL=gpt-6-luna` by default with fixed `none` reasoning and `low` verbosity. Keep `OPENAI_CHAT_MODEL` and `OPENAI_EMBEDDING_MODEL` unchanged when migrating or rolling back rewriting. Set the query override to `gpt-5.4-nano` and restart/redeploy the affected runtime to roll back; deleting it restores Luna. The override must name a model supporting both settings. This code change does not itself deploy functions or update remote secrets.

Run the offline request contracts and the six-fixture live opt-in smoke using the commands in README. The smoke checks raw schema fields before sanitization, supplied identifiers and exclusions in both query fields, alias bounds, and the provider's actual model/configuration receipt. It makes at most six requests without retries; inspect the default dry output before spending on live calls. Raw reports belong outside Git. Use a valid existing credential with a local function server and small `topK`/`extK` values for real retrieval checks; do not bypass authorization or replace retrieval backends with mocks when claiming retrieval qualification.

### Luna qualification observed on 2026-10-10

Model-selection evidence comes from [LCA PR #465](https://github.com/tiangong-lca/edge-functions/pull/465); this workspace's configured local baseline was also `gpt-5.4-nano`. Local verification was limited to integration compatibility:

- Offline production-caller request checks passed for all four profiles on Responses and Chat, including a query-only nano rollback override, generic generation isolation, and unchanged embedding selection. Chat parameter transport was verified with mocks; live qualification used Responses, selected by the current SDK. Type checks and scoped Prettier checks passed.
- The initial six live Luna calls found one CAS omission in `semantic_query`. The shared prompt was strengthened to preserve every supplied identifier/edition in both fields without invented expansions. A new six-call run passed every raw/sanitized schema and semantic probe; all responses reported Luna, none/low and zero reasoning tokens. Other existing prompts and schemas were retained.
- Two authenticated local `edu_search` requests with the same Chinese nitrogen/phosphorus-removal query and `topK=3, extK=0` used real configured OpenAI, Pinecone and OpenSearch backends. Nano and Luna both returned HTTP 200 and the same ordered two relevant documents. Provider receipts confirmed the requested rewrite models and unchanged `text-embedding-3-small` embeddings. This is a retrieval/rollback smoke, not a statistical latency, cost or full-corpus quality result.
- Live backend responses and receipts were retained outside Git. Only sanitized outcomes are recorded here and in the delivery Issue/PR. Remote deployment remains a separate operation.

### Legacy candidate matrix

Use `scripts/eval_query_rewrite_models.ts` when comparing OpenAI chat models for query rewrite behavior. The script reuses production rewrite prompts and schemas, compares candidates against `gpt-4.1-mini`, and writes reports to `/tmp/tiangong-eval` unless `--output-prefix` is provided.

```bash
set -a; . ./supabase/.env.local; set +a
deno run --allow-env --allow-net --allow-read --allow-write \
  --config supabase/functions/deno.json \
  scripts/eval_query_rewrite_models.ts --dry-run
```

Use `--include-optional` for optional GPT-5 nano-family candidates and `--models=<id,id>` to restrict the matrix. The script only reports a suggested `OPENAI_CHAT_MODEL`; it does not mutate production configuration.

## Deployment

Use the Supabase deployment commands in `README.md` for individual functions. Pass `--import-map supabase/functions/deno.json` so the remote bundler resolves shared Deno and npm import aliases. Docker packaging is not currently a validated path: `Dockerfile` references `supabase/functions/main` and `supabase/functions/import_map.json`, which are not present. Fix and validate the Dockerfile before using Docker deployment commands.
