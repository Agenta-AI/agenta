# Design — direct-call tools

The shape at each of the three stages (config, resolved spec, sidecar dispatch) for each tool
type, then the platform-op catalog and the reference resolution.

## The `call` descriptor (the one new field)

A resolved callback tool gains an optional `call`. When present, the sidecar calls that
endpoint directly. When absent, it falls back to the shared `/tools/call` (gateway).

```
call: {
  method: "POST" | "GET",
  path: string,            // RELATIVE to the Agenta base, e.g. "/api/annotations/"
  body?: object,           // server-fixed fields, baked at resolve time
  args_into?: string,      // dotted path where the model's args are placed; absent = root
}
```

Rules the sidecar applies:

- `path` is an absolute path from the Agenta ORIGIN, and the runner derives that origin from the
  run's `toolCallback.endpoint` (the same Agenta the gateway callback uses; the origin is the
  scheme/host/port of that URL). The resolver never emits a host, so a tool can never reach a
  non-Agenta host. A run carrying any direct tool therefore also carries a `toolCallback` (it
  does whenever any callback tool is present). All direct targets, platform ops and the
  reference invoke, live under that one origin.
- Auth is the run's single `toolCallback.authorization` (the caller credential), reused for
  every direct call. No per-tool auth.
- Body assembly:
  - If `args_into` is set: deep-clone `body`, set the `args_into` path to the model's args,
    POST it. (Reference: `args_into = "data.inputs"`.)
  - Else: `POST { ...modelArgs, ...body }` so **fixed fields win**. This is what stops the
    model from overriding a locked field (e.g. `update_own_workflow`'s owning variant id).

`callRef` stays for gateway. A spec has either `call` (direct) or `callRef` (gateway), not both.

## Per-tool-type table

### Gateway (Composio) — unchanged

| Stage | Shape |
|---|---|
| config | `{ type:"gateway", provider:"composio", integration, action, connection }` |
| resolved | `CallbackToolSpec` with `callRef:"tools.composio...."`, no `call` |
| dispatch | sidecar → shared `/tools/call` (server reads the Composio secret) |

### Reference (a stored workflow as a tool)

| Stage | Shape |
|---|---|
| config | `{ type:"reference", ref_by:"variant"|"environment", slug, version?, name?, description?, input_schema? }` (Workstream B) |
| resolved | `CallbackToolSpec` with `call`, no `callRef`. `input_schema` = the workflow's inputs. |
| dispatch | sidecar → direct POST to the invoke endpoint; the revision is resolved by the service at resolve time and baked into `call.body` |

Resolved example:

```json
{ "name": "get_weather", "description": "Look up weather for a city",
  "inputSchema": { "type":"object", "properties": { "city": {"type":"string"} } },
  "call": {
    "method": "POST",
    "path": "/api/workflows/invoke",
    "body": { "references": { "workflow_revision": { "id": "rev_abc123" } } },
    "args_into": "data.inputs"
  } }
```

The service resolved `ref_by:"variant", slug:"weather-agent", version:"3"` to the concrete
revision `rev_abc123` at resolve time and baked it into `call.body`. At call time the model
supplies `{ "city": "Paris" }`; the sidecar sets `body.data.inputs = {city:"Paris"}` and POSTs
directly. The invoke endpoint loads and runs `rev_abc123` in **batch** and returns. The tool
result is the sub-workflow's `data.outputs` plus `trace_id`. The sub-run nests in the trace; the
model gets the final output.

Resolution detail (`ref_by` → references key): `variant` → `workflow_variant`, `environment` →
`environment`; absent `version` = latest of that variant/environment, set = that revision. The
service resolves this to a `workflow_revision` id up front, always, including for `environment`
references. The sidecar is always invoked fresh by the service, so the service re-resolves on
each invoke and the baked revision stays current; there is no call-time env resolution. (Revisit
only if a long-lived sidecar ever calls itself with no service in front.)

The win over today: no call-time resolution detour and no `/tools/call` string-routing. The
service already does the resolve-time API work for gateway/embed/secrets, so a reference is one
more thing it resolves there. Removing the `workflow.*` branch from `/tools/call` is coupled to
this and is an open decision (see `status.md`).

### Platform (an Agenta operation)

| Stage | Shape |
|---|---|
| config | `{ type:"platform", op:"create_workflow", needs_approval?, permission? }` |
| resolved | `CallbackToolSpec` with `call`; `description` from the SDK catalog; `input_schema` fetched from the schema catalog at resolve time |
| dispatch | sidecar → direct POST to that op's endpoint (a plain authenticated endpoint that does in-process service work) |

Resolved examples:

```json
{ "name": "add_trace_annotation", "description": "Record a finding on a trace",
  "inputSchema": { "...from catalog..." },
  "call": { "method":"POST", "path":"/api/annotations/" } }
```

```json
{ "name": "update_own_workflow", "description": "Commit a new revision to your own workflow",
  "inputSchema": { "type":"object", "properties": { "agent_config":{}, "message":{} } },
  "call": { "method":"POST", "path":"/api/workflows/revisions/commit",
            "body": { "workflow_variant_id": "<the running agent's own variant>" } } }
```

For platform tools `args_into` is usually absent (the args are the body). The owning variant id
is server-fixed in `body`, so the model cannot retarget another agent.

This is the line-67 fix: each platform op is one direct call to an endpoint that does its own
in-process service work. No `/tools/call`, and no endpoint calling another endpoint.

### Code / client — unchanged

`code` runs in the sandbox subprocess; `client` is browser-fulfilled. Neither uses `call`.

## The platform-op catalog

Mirror `platform_catalog.py`. A server-side `_PLATFORM_TOOLS` table keyed by `op`:

```
op -> { method, path, input_schema_ref, default_permission, default_needs_approval }
```

- **Descriptions live in the SDK** (per Mahmoud), next to the op→endpoint table the resolver
  uses. The author writes only `{ type:"platform", op }`.
- **Input schemas come from the in-process schema catalog** (the `CATALOG_TYPES` /
  `/workflows/catalog/types` mechanism, built from `model_json_schema()`), fetched at resolve
  time. Not parsed from `/openapi.json`.
- Each op carries a sensible default permission; `needs_approval` / `permission` on the config
  override per the existing `effective_permission()` precedence.

`create_workflow` today is three calls (artifact, variant, revision). Add one convenience
endpoint so the platform tool is a single direct call, atomic, with its own permission check.

## Sidecar dispatch algorithm

```ts
// services/agent/src/tools/dispatch.ts, callback branch:
if (spec.call) {
  const body = assembleBody(spec.call, params);   // args_into deep-set, else fixed-wins merge
  const url = joinBase(runnerAgentaBase, spec.call.path);   // relative path only
  return callDirect(spec.call.method, url, opts.authorization, body, opts.signal);
}
if (opts.relayDir) return relayToolCall(...);     // gateway on Daytona
return callAgentaTool(opts.endpoint, opts.authorization, spec.callRef, ...);  // gateway
```

Daytona: the same `if (spec.call)` branch lives in the host-side relay handler
(`relay.ts executeRelayedTool`), which already holds the full spec. The sandbox still sends only
name + args; the host makes the direct call. Permission / HITL gating is unchanged: it is a
spec-level concern enforced before the call, independent of where the call goes.

## What `/tools/call` becomes

Gateway-only. The `workflow.*` branch and its `_call_workflow_tool` move out (reference goes
direct). The endpoint's sole job is the one thing that needs the server: resolve the Composio
connection from the vault and call Composio.
