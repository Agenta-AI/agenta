---
id: invoke-research
title: Where reference-invocation happens + OpenAPI-enable behavior + validation plan
status: done
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T14:48:39Z'
updated: '2026-07-01T15:02:05Z'
---



# Where reference-invocation happens + OpenAPI-enable behavior + validation plan

## Context

Map where the product invokes an agent by reference (playground run, trigger/schedule fire) and re-confirm whether a committed reference (revision/variant/app id) loads the committed config or the default. Also: what enabling openapi_url would actually generate for the invoke route + risks. Feeds fix-reference-only + harden-invoke.

## Messages

**Agent** · Jul 1, 14:48

task created.

**Agent** · Jul 1, 15:02

Reference behavior is NOT a production bug: playground inlines; triggers hydrate data.revision server-side (_ensure_request_revision) before forwarding; only a direct API-bypassing service call falls back to default (what the lab does). Latent SDK inconsistency: agent seeds a non-empty default that disables its own hydration net (completion/chat seed empty). OpenAPI: would be misleading (opaque parameters), /inspect strictly better — keep off.
