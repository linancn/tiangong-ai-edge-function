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
lastReviewedAt: 2026-10-10
lastReviewedCommit: 5f43228ef53037065516557b5400b85e2caf423b
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
- `scripts/query_rewrite_smoke.ts`: six fixed live opt-in rewrite probes through the production helpers, without a model matrix or judge.
- `scripts/query_rewrite_test.ts`: offline request contracts for shared text-model selection, rewrite-specific options, and independent embeddings.
- `Dockerfile`: unvalidated container packaging; it currently references missing `supabase/functions/main` and `supabase/functions/import_map.json`.

## Runtime Shape

The repo uses Node.js tooling for local commands, Deno for Supabase function runtime behavior, and the Supabase CLI for serving and deployment. Function environment values are derived from `.env.example` and `supabase/.env.example`; real local and production secrets must not be committed.

Query rewriting and all structured text generation share `OPENAI_CHAT_MODEL`; configure it as `gpt-6-luna` to select Luna for both. The multilingual and English rewrite helpers fix reasoning to `none` and verbosity to `low`, transported as Responses `reasoning.effort`/`text.verbosity` or Chat `reasoning_effort`/`verbosity`, and explicitly retain `temperature=0`. The shared layer sends temperature only when supplied: general generation uses model defaults for reasoning and sampling, avoiding Luna's rejection of temperature with its default reasoning mode. Embeddings retain `OPENAI_EMBEDDING_MODEL`. Existing default/report/regulatory schemas and sanitize behavior remain intact. Rewrite prompts explicitly retain supplied identifiers and editions in both semantic and lexical fields; unknown abbreviations are not expanded. No shared output-token cap is introduced.

An unset, empty, or whitespace-only `OPENAI_CHAT_MODEL` selects the shared default, `gpt-6-luna`, in both structured entrypoints. The direct helper also trims model names. A request failure propagates through the existing error path without automatic model failover. Alternative models require explicit configuration and validation across generation and rewrite callers, including none/low compatibility.

`course_search` performs Bearer API-key authorization inside the function through the `verify_kb_api_key` RPC. When `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` are configured, successful authorization contexts are cached for up to 15 minutes, capped by token expiry; Redis failures fall back to live RPC verification. Its aggregated `documents` response keeps `content` and `source` and also returns the originating KB `document_id` plus source metadata `tags`, so callers do not need to reverse-engineer record IDs or discard document labels.

## Integration Points

- MCP server calls these edge functions through configured Supabase deployment URLs.
- KB and unstructure repositories produce or maintain data that these functions query, but this repo only owns the API execution surface.
