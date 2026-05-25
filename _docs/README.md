---
docType: index
scope: repo
status: current
authoritative: true
owner: edge-function
language: en
whenToUse: 'When navigating edge-function repository documentation.'
whenToUpdate: 'When repository documentation layers, key docs, or governance routing change.'
checkPaths:
  - AGENTS.md
  - .docpact/config.yaml
  - .github/workflows/docpact.yml
  - _docs/**
lastReviewedAt: 2026-05-25
lastReviewedCommit: 6c691ef6a73e918fd65a72a4755233665eacfd4b
---

# Edge Function Documentation

This directory contains the repo-local source documents governed by docpact.

## Layers

- Layer 0: `AGENTS.md` for mandatory agent entry guidance.
- Layer 1: `.docpact/config.yaml` for machine-readable governance.
- CI: `.github/workflows/docpact.yml` for config validation and PR documentation lint.
- Layer 2: current contracts, architecture, standards, and runbooks under `_docs/**`.

## Current Documents

- `_docs/contracts/repo-contract.md`: repository ownership, boundaries, and completion rules.
- `_docs/architecture/repo-architecture.md`: Supabase Edge Function topology.
- `_docs/runbooks/development.md`: local development, validation, and deployment workflow.
- `_docs/standards/documentation-standards.md`: repo-local documentation rules.
