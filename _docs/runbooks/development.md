---
docType: runbook
scope: repo
status: current
authoritative: true
owner: edge-function
language: en
whenToUse: "When developing, validating, or deploying edge functions."
whenToUpdate: "When setup commands, local serve flow, validation, or deployment commands change."
checkPaths:
  - README.md
  - package.json
  - deno.json
  - Dockerfile
  - supabase/**
lastReviewedAt: 2026-05-22
lastReviewedCommit: a0929d5a40efe3ccb4627551555e325a73801d73
---

# Edge Function Development Runbook

## Setup

1. Use Node.js 22 from `.nvmrc`.
2. Install Deno as described in `README.md`.
3. Run `npm install`.
4. Copy `.env.example` to `.env.local` for root-level tooling.
5. Copy `supabase/.env.example` to `supabase/.env.local` before running
   `npm start`.

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

Use `test.example.http` or a REST client for endpoint checks when function
behavior changes.

## Deployment

Use the Supabase deployment commands in `README.md` for individual functions.
Docker packaging is not currently a validated path: `Dockerfile` references
`supabase/functions/main` and `supabase/functions/import_map.json`, which are
not present. Fix and validate the Dockerfile before using Docker deployment
commands.
