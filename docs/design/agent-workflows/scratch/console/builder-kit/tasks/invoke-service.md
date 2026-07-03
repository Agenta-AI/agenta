---
id: invoke-service
title: 'Agent invoke endpoint: reference-only config loading, missing contract, silent
  fallback'
status: done
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T13:55:35Z'
updated: '2026-07-01T14:08:56Z'
---




# Agent invoke endpoint: reference-only config loading, missing contract, silent fallback

## Context

Investigate services/agent invoke endpoint + api gateway. (a) Why does reference-only invocation (no inline parameters) not load the committed config, falling back to a default? bug or design? (b) How do the completion & chat services document their invoke contract (OpenAPI?) and how to give the agent service the same. (c) Why does a wrong-shaped body silently fall back instead of returning a validation error. Feeds threads invoke-contract, silent-fallback, reference-only.

## Messages


**Agent** · Jul 1, 13:55

task created.

**Agent** · Jul 1, 14:08

A=bug (seeded default kills reference hydration; drop the seed). B=all services disable OpenAPI by design, /inspect is the contract; enable openapi_url to fix all three. C=loose models; add strict validation on parameters.agent.
