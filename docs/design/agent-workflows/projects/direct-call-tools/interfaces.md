# Interface reference — direct-call tools

The concrete interface delta, so review and implementation reference the same contract. Each entry
is the exact shape plus the seam (file) it lands in. This is the spec; `design.md` is the rationale.

## 1. Resolved tool spec — the `call` descriptor (cross-service wire)

Add to `ResolvedToolSpec` (TS, `services/agent/src/protocol.ts`) and `CallbackToolSpec` (Python,
`sdks/python/agenta/sdk/agents/tools/models.py`):

```
call?: {
  method: "POST" | "GET",
  path: string,                              // absolute path from the Agenta origin
  body?: object,                             // static server-fixed fields (resolve time)
  context?: { [bodyPath: string]: "$ctx.<key>" },   // runner fills from runContext at dispatch
  args_into?: string                         // dotted path where the model's args are placed
}
```

- Mirror in `wire.py`; update the golden `/run` fixtures and both wire-contract tests.
- `callRef` stays for gateway; a spec carries `call` XOR `callRef`.
- Seams: `protocol.ts`, `models.py`, `wire.py`, `golden/`.

## 2. Run request — `runContext` (cross-service wire)

Add `runContext` to `AgentRunRequest` (`protocol.ts`) and the Python wire model — its OWN field,
NOT inside `TraceContext` — refreshed per turn:

```
runContext?: {
  workflow?: { artifact_id, variant_id, variant_name, revision_id, version, is_draft, latest_revision_id },
  trace?:    { trace_id, span_id },
  session_id?: string
}
```

- The service fills it in `services/oss/src/agent/app.py` (it already holds `RunningContext.revision`
  + the request). Consumed only by `call.context` binding; the model never reads it.
- Seams: `protocol.ts` (AgentRunRequest), `wire.py`, `app.py`.

## 3. Tool config — `type:"platform"` (public-edge, agent config)

Add a `PlatformToolConfig` arm to the `ToolConfig` union (`models.py`):

```
{ type: "platform", op: string, needs_approval?: bool, permission?: <Permission> }
```

- Surfaced in `AgentConfigSchema.tools`.
- Seams: `models.py` (ToolConfig union), the agent-config schema (`schemas.py` / `agent_v0_interface`),
  FE `AgentConfigControl` (later).

## 4. Platform-op catalog entry (in-service; SDK)

**Location (Codex catalog review):** a TYPED catalog model (not plain module-level dicts) in a new
`sdks/python/agenta/sdk/agents/platform/op_catalog.py`, bridged in `platform/resolve.py`, with the
config arm in `tools/models.py` wired through `tools/resolver.py`. Descriptions live in the SDK.
Reuse `PlatformConnection` (the existing base-url/auth/headers seam) rather than new HTTP plumbing.

A code-defined catalog mapping an `op` to:

```
op -> {
  description: string,           // SDK-owned
  method, path,                  // the EXISTING endpoint to expose
  input_schema_ref: string,      // a CATALOG_TYPES key (x-ag-type-ref) — the endpoint's request schema
  bind?: { [endpointField: string]: "$ctx.<key>" },   // self-targeting fields filled server-side
  default_permission?, default_needs_approval?
}
```

- Resolve: strip each `bind` field (path-aware) from the model-visible `input_schema` (+ `required`);
  emit `call` (`method`/`path`/`context`=bind/`body`).
- Seams: `platform/op_catalog.py` (new), `platform/resolve.py`, `tools/{models,resolver}.py`,
  `CATALOG_TYPES`.

## 5. Reference tool config (owned by Workstream B; referenced here)

```
{ type: "reference", ref_by: "variant"|"environment", slug, version?, name?, description?, input_schema? }
```

- Resolves to a `CallbackToolSpec` with `call` → the invoke endpoint; revision resolved at resolve
  time (env follows the live deployment because the service re-resolves per invoke).
- Seams: `models.py` (`ReferenceToolConfig`, B), the SDK workflow resolver.

## 6. Dispatch — body assembly (runner)

`services/agent/src/tools/dispatch.ts` + `relay.ts` (the Daytona host handler): for a `call` spec,
assemble the body = model args (at `args_into` or root) → overlay static `body` → overlay `context`
(resolve each `$ctx.*` against `runContext`, deep-set), **context last**. Hardening: path-conflict
rejection, strict dotted-path parse, prototype-pollution-safe deep-set, post-merge schema
validation. Guardrail: method allowlist (`GET`/`POST`), relative `/api/...` path, origin derived
from `toolCallback.endpoint`.

- Seams: `dispatch.ts`, `relay.ts`, a new direct-call helper (e.g. `tools/direct.ts`).
