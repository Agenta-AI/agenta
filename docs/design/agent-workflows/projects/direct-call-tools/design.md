# Design — direct-call tools

The shape at each of the three stages (config, resolved spec, sidecar dispatch) for each tool
type, then the platform-op catalog and the reference resolution.

## The `call` descriptor (the one new field)

A resolved callback tool gains an optional `call`. When present, the sidecar calls that
endpoint directly. When absent, it falls back to the shared `/tools/call` (gateway).

```
call: {
  method: "POST" | "GET",
  path: string,            // absolute path from the Agenta origin, e.g. "/api/annotations/"
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
| resolved | `CallbackToolSpec` with `call`, no `callRef`. `input_schema` = the referenced workflow's input contract (`revision.schemas.inputs`, read at resolve time). |
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

**Where the input schema comes from.** The reference tool's `input_schema` is the referenced
workflow's own input contract, which the service reads at resolve time from the workflow's
`/inspect` response (`revision.schemas.inputs`). For a chat workflow that contract carries
`messages` (referenced via `x-ag-type-ref: "messages"`, the shared `Messages` type served at
`/workflows/catalog/types`) plus any template input variables; for a prompt workflow it is the
template variables. The model therefore sees exactly the inputs the workflow expects, with no
hand-authored schema, and the runner places its args at `data.inputs` (`args_into`), where the
invoke reads `messages` from `inputs.messages`.

**Output schemas: deferred.** The referenced workflow also publishes an output contract
(`revision.schemas.outputs`), and an output schema exists in a few places (MCP's optional
`outputSchema`, Agenta's AI-services `ToolDefinition`). But the tool definitions the model
actually sees — OpenAI/Anthropic function calling and the Pi/Claude/MCP registrations — are
input-schema only; the model gets the tool's output as result text, not validated against a
declared schema. So we put no tool `output_schema` on the wire now. The workflow's
`schemas.outputs` stays available for a later structured-output pass; noted, not a Phase-1 item.

Resolution detail (`ref_by` → references key): `variant` → `workflow_variant`, `environment` →
`environment`; absent `version` = latest of that variant/environment, set = that revision. The
service resolves this to a `workflow_revision` id up front, always, including for `environment`
references. The sidecar is always invoked fresh by the service, so the service re-resolves on
each invoke and the baked revision stays current; there is no call-time env resolution. (Revisit
only if a long-lived sidecar ever calls itself with no service in front.)

The win over today: no call-time resolution detour and no `/tools/call` string-routing. The
service already does the resolve-time API work for gateway/embed/secrets, so a reference is one
more thing it resolves there. Removing the `workflow.*` branch from `/tools/call` is coupled to
this; when exactly it lands is the orchestrator's sequencing call (see `status.md`).

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

## Permissions and approval (uniform across all tool types)

Permission and approval are not part of the `call` path and are not special-cased per executor.
Every tool type (gateway, reference, platform, code, client) carries `needs_approval` /
`permission` on the shared `ToolSpecBase`, and the runner resolves the effective decision with the
same `effective_permission()` precedence and enforces it BEFORE the call, regardless of where the
call goes. Going direct changes the transport, not the gate, so HITL still works for direct tools.

A later PR will refactor tool config into a typed shape (a `type` plus a per-type config block,
including a dedicated permissions block) instead of today's flat fields. That hierarchy is out of
scope here. The requirement this design holds is narrower: permission handling stays consistent
across all tool types, so the refactor can lift it uniformly later.

## The platform-op catalog

Mirror the pattern Agenta already uses for a reserved, code-defined tool:
`tools.agenta.find_capabilities` (PR #4884, `api/oss/src/core/tools/discovery.py`) — a reserved
`tools.agenta.*` op with a `description` and an `input_schema`, backed by an endpoint
(`POST /tools/discover`). The platform-op catalog generalizes that one reserved tool into a small
code-defined table, shaped like the evaluators catalog (`resources/evaluators/evaluators.py`: a
module-level list of `{key, description, settings_template, ...}` entries):

```
op -> { description, method, path, input_schema (or x-ag-type-ref), default_permission, default_needs_approval }
```

- **Descriptions live in the SDK** (per Mahmoud), next to the op→endpoint table the resolver uses.
  The author writes only `{ type:"platform", op }`.
- **Input schemas reuse the in-process schema catalog** (the `CATALOG_TYPES` mechanism, built from
  `model_json_schema()` and served at `/workflows/catalog/types`), referenced via `x-ag-type-ref`
  — the same mechanism the agent `/inspect` schema already uses for `messages`. Not parsed from
  `/openapi.json`.
- Each op carries a sensible default permission; `needs_approval` / `permission` on the config
  override per `effective_permission()` (see the permissions section above).

**`find_capabilities` is the first platform tool.** PR #4884 already built the server side
(`POST /tools/discover` + the reserved op); Workstream A adds the SDK emission of it as a
`CallbackToolSpec` with a `call` — exactly the general platform-tool path here. (STATUS.md tracks
that emission as deferred-into-A.)

Not `platform_catalog.py` wholesale: that catalog (reserved `_agenta.*` workflow slugs, versioned,
deterministic UUIDs, a virtual revision provider) is current and correct for platform
**workflows/skills**, but heavier than platform ops need. Mirror its "code-defined,
reserved-namespace, validated-at-import" spirit, not its versioned-revision machinery.

`create_workflow` today is three calls (artifact, variant, revision). Add one convenience endpoint
so the platform tool is a single direct call, atomic, with its own permission check.

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
