---
id: fix-sidecar-persist-401
title: 'Fix: sidecar sessions-persist 401s (cred=MISSING); child invokes lose trace_id'
status: in-review
owner: fable
pr: https://github.com/Agenta-AI/agenta/pull/5073
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-05T14:23:03Z'
updated: '2026-07-05T16:08:13Z'
---



# Fix: sidecar sessions-persist 401s (cred=MISSING); child invokes lose trace_id

## Context

Root-cause first (code vs env post-#5059), then fix + live before/after + PR if code.

## Messages

**Agent** · Jul 5, 14:23

task created.

**Agent** · Jul 5, 14:43

DONE — CODE bug, fixed + live-verified, draft PR #5073 (base big-agents).

Root cause: commit a8f9a5111c statically seeded HANDLER_REGISTRY `agent.v0` with the SDK's bare
`agent_v0` (noop trace/run context, uninstrumented). `register_handler` is setdefault-only, so the
agent service's `register_handler(auto_instrument(_agent), AGENT_URI)` was a silent no-op and the
seed ran every /invoke: no span -> trace_id=None; `trace=None` on the wire -> runner `cred=MISSING`
-> all runner->API session calls 401 -> persist DROPPED. One root cause for both symptoms.

Fix: `register_handler(..., replace=True)` + `create_agent_app` uses it; regression tests in
`test_register_handler_replace.py`; sidecar recipe README now sets `AGENTA_API_INTERNAL_URL`.
After (live, same request): `cred=present`, `[sessions/persist] ingest OK` x3, response
trace_id=eb7483d8..., run went 500 -> 200 PONG (service connection resolution restored too).

**Agent** · Jul 5, 16:08

PR up: register_handler replace=True (the #5064 static seed silently shadowed the real composed handler); fixed 401s + trace_id=None + gating bypass in one; live verified.
