---
docType: architecture
scope: repo
status: current
authoritative: true
owner: edge-function
language: en
whenToUse: 'When changing Supabase Edge Functions, support scripts, or deployment packaging.'
whenToUpdate: 'When function topology, shared utilities, deployment targets, or runtime assumptions change.'
checkPaths:
  - supabase/functions/**
  - supabase/config.toml
  - Dockerfile
  - package.json
lastReviewedAt: 2026-05-29
lastReviewedCommit: 5659945e2faa17317ed71f96b69dbf2b37e25839
---

# Edge Function Architecture

## Overview

The repository packages Supabase Edge Functions for TianGong AI search and generation APIs. Local development is driven by the Supabase CLI through `npm start`, which serves functions with `supabase/.env.local`.

## Key Paths

- `supabase/functions/_shared/**`: shared function utilities.
- `supabase/functions/*_search/**`: search endpoints, including ESG, science, KB course, education, reports, standards, patents, textbooks, Green Deal, internal content, and BigQuery-backed search.
- `supabase/functions/info_extract/**`: information extraction endpoint.
- `supabase/functions/question_generation/**`: question generation endpoint.
- `supabase/functions/kg_generate/**`: knowledge graph generation endpoint.
- `supabase/config.toml`: local Supabase project configuration.
- `scripts/eval_search_quality.ts`: search quality evaluation helper.
- `scripts/eval_query_rewrite_models.ts`: non-production query rewrite model evaluation helper for comparing OpenAI chat model candidates against the `gpt-4.1-mini` baseline.
- `Dockerfile`: unvalidated container packaging; it currently references missing `supabase/functions/main` and `supabase/functions/import_map.json`.

## Runtime Shape

The repo uses Node.js tooling for local commands, Deno for Supabase function runtime behavior, and the Supabase CLI for serving and deployment. Function environment values are derived from `.env.example` and `supabase/.env.example`; real local and production secrets must not be committed.

`course_search` performs Bearer API-key authorization inside the function through the `verify_kb_api_key` RPC. When `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` are configured, successful authorization contexts are cached for up to 15 minutes, capped by token expiry; Redis failures fall back to live RPC verification.

## Integration Points

- MCP server calls these edge functions through configured Supabase deployment URLs.
- KB and unstructure repositories produce or maintain data that these functions query, but this repo only owns the API execution surface.
