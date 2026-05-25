---
docType: contract
scope: repo
status: current
authoritative: true
owner: edge-function
language: en
whenToUse: 'When deciding whether a change belongs in the edge-function repository.'
whenToUpdate: 'When ownership, service boundaries, public API expectations, or completion criteria change.'
checkPaths:
  - AGENTS.md
  - README.md
  - .docpact/config.yaml
  - supabase/functions/**
lastReviewedAt: 2026-05-25
lastReviewedCommit: 21e0a308a485d869e6618d286301230c779864f7
---

# Edge Function Repository Contract

## Ownership

This repository owns the Supabase Edge Functions used by TianGong AI search and generation surfaces. It also owns repo-local scripts, runtime command metadata, and environment templates needed to develop or deploy those functions.

## Boundaries

- Root workspace governance, branch policy, and submodule integration remain in the workspace repository.
- MCP client behavior belongs in the MCP repository unless a change requires a backing edge function contract change here.
- Knowledge-base ingestion or document processing logic belongs in the KB or unstructure repositories unless it is packaged as an edge function in this repository.

## API Surface

The public function directories under `supabase/functions/**` are treated as API surfaces. Changes to request parameters, authentication behavior, target indexes, response shape, or deployed function names require review of:

- `README.md`
- `_docs/architecture/repo-architecture.md`
- `_docs/runbooks/development.md`

## Completion Criteria

- Run `docpact route` before editing governed files.
- Run `docpact validate-config --root . --strict` after governance changes.
- For function changes, run the relevant local Supabase serve or API test flow described in `_docs/runbooks/development.md`.
- Do not leave deployment, API, or validation facts only in chat.
