---
id: harden-invoke
title: 'Harden the invoke route: OpenAPI + strict validation (priority 2)'
status: locked
task: invoke-service
pr: ''
recommendation: (a). Both are small, they share the same route, and precedent for
  extra=forbid already exists (WorkflowInvokeRequestFlags). Pairs naturally with the
  reference-only fix.
answer: Strict validation with clear errors is fair, but not blanket forbid; do not
  enable OpenAPI blindly, research it.
answered_by: user
raised: '2026-07-01T14:09:57Z'
updated: '2026-07-01T15:02:05Z'
---



# Harden the invoke route: OpenAPI + strict validation (priority 2)

## Context

Two findings on the same route. (1) No service (agent/completion/chat) exposes OpenAPI — create_app disables it by design (decorators/routing.py:74-76); the live contract is POST .../inspect. (2) A wrong-shaped invoke body is silently accepted and the run falls back to defaults, with no 422 — the envelope models ignore unknown fields and parameters is a loose dict (models/workflows.py:237,296; agents/dtos.py:1166-1204). This made wrong-shape guessing slow during the lab.

## Options

- (a) Do both: enable openapi_url on the typed invoke route (fixes all three services at once) AND add strict validation on parameters.agent (extra=forbid / 422). My rec.
- (b) Validation only (fail loud), skip OpenAPI for now
- (c) Defer both; document /inspect as the contract

## Recommendation

(a). Both are small, they share the same route, and precedent for extra=forbid already exists (WorkflowInvokeRequestFlags). Pairs naturally with the reference-only fix.

## Your decision

**Locked:** Strict validation with clear errors is fair, but not blanket forbid; do not enable OpenAPI blindly, research it.

OpenAPI: confirmed do NOT enable (opaque/misleading; /inspect strictly better). Validation: recommend a clear error when parameters.agent has an unrecognized field, not blanket forbid — small optional fix, greenlight if you want it built. Kit updated to document /inspect + inline as the contract.

_2026-07-01T15:02:05Z_
