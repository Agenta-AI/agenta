---
id: invoke-contract
code: AGE-3
title: Agent service has no documented invoke contract — how do completion/chat solve
  it?
status: resolved
needs_reply: false
promoted_to: ''
created: '2026-07-01T13:54:47Z'
updated: '2026-07-01T17:01:13Z'
hidden: true
---









# Agent service has no documented invoke contract — how do completion/chat solve it?

## Summary

RESOLVED (redundant, folded into harden-invoke: /inspect is the contract, OpenAPI stays off).

## Messages


**Agent** · Jul 1, 13:54

User: 'the agent microservice has no live-documented invoke contract' — how do we solve this in completion and chat? in the docs?

**Agent** · Jul 1, 14:08

The answer to "how do completion and chat solve it" is: they do not. None of the three services expose OpenAPI.

`create_app` disables OpenAPI, Swagger, and ReDoc for every service by design (`sdks/python/agenta/sdk/decorators/routing.py:74-76`, and the outer app at `services/entrypoints/main.py:107-108`). So the 404 on `/services/agent/v0/openapi.json` is uniform, not an agent gap.

The real contract for all three today is **`POST .../inspect`**, which returns the inputs, parameters, and outputs schemas (agent schemas at `services/oss/src/agent/schemas.py:76-80`). That is the live, machine-readable contract right now.

To get proper OpenAPI: flip that shared default and enable `openapi_url` on the typed `invoke_endpoint(request: WorkflowInvokeRequest)` route. FastAPI would then generate the spec for agent, completion, and chat at once. So the fix is one shared change, not an agent-specific doc. Short term, point callers at `/inspect`.

**Agent** · Jul 1, 14:47

Plan tracked under the harden-invoke decision and the silent-fallback thread. A subagent is checking what enabling openapi_url would actually generate for the invoke route (useful schema vs misleading), and the risks of turning it on for all three services. Meanwhile /inspect stays the live contract; I will document that in the kit.

**Agent** · Jul 1, 15:21

Redundant with silent-fallback + the harden-invoke decision. Resolving; see harden-invoke for the single answer (/inspect is the contract, do not enable OpenAPI).
