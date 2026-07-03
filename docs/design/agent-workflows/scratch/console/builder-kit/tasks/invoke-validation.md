---
id: invoke-validation
title: 'Design PR: invoke validation (malformed request -> clear error)'
status: in-review
owner: sonnet
pr: https://github.com/Agenta-AI/agenta/pull/5002
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-01T16:59:51Z'
updated: '2026-07-01T18:03:15Z'
---




# Design PR: invoke validation (malformed request -> clear error)

## Context

Reference-only + silent-fallback reframed as validation. Design-doc-only draft PR: invoke should validate + return a clear error naming valid call shapes (complete nested revision / no revision / inline config); require a resolvable reference (variant/env/revision, not bare application); validate revision nesting. Also update kit BUILD-AGENT.md call shape.

## Messages

**Agent** · Jul 1, 16:59

task created.

**Agent** · Jul 1, 17:09

Design-doc-only draft PR #5002 (full workspace, needs-review label + comment, no code). Proposal: validate the invoke request at the shared resolver boundary; return a clear 4xx naming the 3 valid call shapes (complete DOUBLE-nested revision / no-revision + a RESOLVABLE reference = variant/env/revision NOT bare application / inline data.parameters); 3 rules (revision double-nested; reference resolvable; reject if none). No blanket extra=forbid, no OpenAPI. Supersedes harden-invoke/silent-fallback. Kit BUILD-AGENT.md updated with the correct call shapes (separate, not in PR).

**Agent** · Jul 1, 18:03

IMPLEMENTED per your decisions, label now implementing. resolver.py _validate_resolvable_config: TWO valid shapes (inline config OR a revision — double-nested or a resolvable reference variant/env/revision); Rule A (revision must be double-nested), Rule B (reference must pin a config, not bare application) -> clear 400 naming the shapes. Resolver-only, scoped to config path, no self-hydration bundle, empty body left alone (no completion/chat regression). Tests 41/41 resolver + 489/489 agents pass, ruff clean. Diff = 5 docs + resolver.py + test. Draft.
