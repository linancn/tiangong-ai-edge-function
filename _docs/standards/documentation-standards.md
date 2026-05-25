---
docType: standard
scope: repo
status: current
authoritative: true
owner: edge-function
language: en
whenToUse: 'When creating, moving, or reviewing edge-function documentation.'
whenToUpdate: 'When documentation layers, metadata rules, or source-of-truth boundaries change.'
checkPaths:
  - AGENTS.md
  - .docpact/config.yaml
  - .github/workflows/docpact.yml
  - _docs/**
lastReviewedAt: 2026-05-25
lastReviewedCommit: 2eb252a8e493c51faa5e534e7f271a734dcfcc26
---

# Edge Function Documentation Standards

## Layers

- `AGENTS.md`: mandatory repo entry guidance for agents.
- `.docpact/config.yaml`: machine-readable governance, routing, coverage, and document inventory.
- `.github/workflows/docpact.yml`: CI enforcement for config validation and PR documentation lint.
- `_docs/contracts/**`: current constraints and ownership rules.
- `_docs/architecture/**`: current service topology and integration facts.
- `_docs/runbooks/**`: executable procedures.
- `_docs/standards/**`: repo-local documentation and engineering standards.

## Rules

- Keep deterministic governance facts in `.docpact/config.yaml`.
- Keep explanatory architecture, API, and workflow details in `_docs/**`.
- Update docs when public function names, request parameters, auth behavior, response shape, deployment commands, or required environment variables change.
- Do not duplicate root workspace branch policy or submodule integration policy in this repository.
