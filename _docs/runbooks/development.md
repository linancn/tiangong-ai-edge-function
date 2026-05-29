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
lastReviewedAt: 2026-05-29
lastReviewedCommit: 5659945e2faa17317ed71f96b69dbf2b37e25839
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
