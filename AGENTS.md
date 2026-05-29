---
docType: agent-contract
scope: repo
status: current
authoritative: true
owner: edge-function
language: en
whenToUse: 'Before editing the edge-function repository.'
whenToUpdate: 'When repo entry points, workflow commands, docpact config, deployment boundaries, or service ownership change.'
checkPaths:
  - AGENTS.md
  - .docpact/config.yaml
  - .github/workflows/docpact.yml
  - _docs/**
lastReviewedAt: 2026-05-29
lastReviewedCommit: 08395648bba6ef8ee00e4d0dc075e8850daecd28
---

# TianGong AI Edge Function Agent Contract

This repository owns the Supabase Edge Function surface for TianGong AI search and generation APIs. Workspace-level submodule policy remains in the root workspace; product implementation and repo-local documentation belong here.

## Required Load Order

1. Read this file.
2. Read `.docpact/config.yaml`.
3. Run `docpact route --root . --paths <target-paths> --format json` from this repo root for the files you plan to change.
4. Read the relevant files under `_docs/contracts/**`, `_docs/architecture/**`, and `_docs/runbooks/**`.
5. Read the implementation files under `supabase/functions/**` or `scripts/**`.

## Source Of Truth

- `.docpact/config.yaml`: machine-readable governance rules, routing aliases, coverage, document inventory, and freshness policy.
- `README.md`: developer setup, local Supabase serving, Docker, and remote deployment command examples.
- `_docs/contracts/repo-contract.md`: durable ownership and boundary rules.
- `_docs/architecture/repo-architecture.md`: current service topology and key paths.
- `_docs/runbooks/development.md`: repeatable local development and validation steps.

## Hard Boundaries

- Do not move workspace submodule policy, branch policy, or integration completion rules into this repository.
- Do not commit local secrets from `.env.local`, `supabase/.env.local`, or production Supabase secrets.
- Treat each top-level function directory under `supabase/functions/`, excluding `_shared/`, as an API surface; update API or architecture docs when behavior, parameters, auth, response shape, deployed names, or target indexes change.

## Completion Criteria

- Relevant docpact route output has been reviewed before code or docs changes.
- Docs touched by the route result are reviewed or updated.
- `docpact validate-config --root . --strict` passes after governance changes.
- For implementation changes, run the repo's relevant validation command from `README.md` or `_docs/runbooks/development.md`.
