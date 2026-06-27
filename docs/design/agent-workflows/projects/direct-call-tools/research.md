# Research — the code seams

All paths verified this session. Line numbers are approximate anchors, not exact contracts.

## Tool config and resolved spec (SDK)

- `sdks/python/agenta/sdk/agents/tools/models.py`
  - `ToolConfig` union (`~127`), discriminated by `type`: `builtin`, `gateway`, `code`,
    `client`, `reference`. **No `platform` type yet** (Workstream A adds it).
  - `GatewayToolConfig` → `reference` property `tools.{provider}.{integration}.{action}.{connection}`.
  - `ReferenceToolConfig` (`~92`): `slug` + optional `version` today; `call_ref` property
    `workflow.{slug}[.{version}]`. **Workstream B adds env/variant here.**
  - `CallbackToolSpec` (`~233`): the resolved spec. `kind:"callback"` + `call_ref`. Inherits
    `ToolSpecBase` (`~155`): `name`, `description`, `input_schema`, `needs_approval`, `render`,
    `read_only`, `permission`, `effective_permission()`, `to_wire()`. **Workstream A adds the
    optional `call` field here.**
  - `ToolSpec` union (`~252`): `CallbackToolSpec | CodeToolSpec | ClientToolSpec`.
- `sdks/python/agenta/sdk/agents/tools/resolver.py` (`~172`): partitions configs; reference and
  gateway both resolve to `CallbackToolSpec` + one shared `ToolCallback(endpoint=.../tools/call,
  authorization)`. Reference resolves locally; gateway calls `/tools/resolve`.
- `sdks/python/agenta/sdk/agents/platform/workflow.py` / `gateway.py`: the two resolvers. Both
  return `ToolCallback(endpoint=f"{api_base}/tools/call", authorization=...)`.

## Runner wire and dispatch (TypeScript)

- `services/agent/src/protocol.ts`
  - `ResolvedToolSpec` (`~63`): `name`, `description`, `inputSchema`, `callRef`,
    `kind:"callback"|"code"|"client"`, `runtime`, `code`, `env`, `needsApproval`, `render`,
    `readOnly`, `permission`. **Workstream A adds optional `call`.**
  - `ToolCallbackContext` (`~87`): `{ endpoint, authorization }`, single, on
    `AgentRunRequest.toolCallback` (`~340`). Stays for gateway.
- `services/agent/src/tools/dispatch.ts` `runResolvedTool` (`~53`): branches on `spec.kind`:
  `code` → `runCodeTool`; `client` → throw; default/`callback` → relay (Daytona) or
  `callAgentaTool(endpoint, auth, callRef, ...)`. **Workstream A adds the `if (spec.call)`
  direct branch before the gateway fallback.**
- `services/agent/src/tools/relay.ts` `startToolRelay` (`~159`): the host-side relay loop holds
  the FULL specs in `specsByName` (`~169`) and looks each up by name (`~177`).
  `executeRelayedTool` (`~118`) currently branches code vs gateway-callback. **The host can
  branch on `spec.call` here with the sandbox unchanged** (the sandbox still posts name + args).

## The reference-invoke seam (important nuance)

- `api/oss/src/apis/fastapi/tools/router.py` `_call_workflow_tool` (`~1086-1188`): parses
  `workflow.{slug}[.{version}]`, builds
  `WorkflowServiceRequest(references={"workflow": Reference(slug, version)}, data=WorkflowServiceRequestData(inputs=arguments))`,
  and calls `workflows_service.invoke_workflow(...)`.
- `api/oss/src/core/workflows/service.py` `invoke_workflow` resolves the references to a revision
  + service URL, then `_post_service_json(url=f"{service_url}/invoke", credentials=Secret {token}, payload=...)` (`~1952`).
- `WorkflowServiceRequest` = `WorkflowInvokeRequest` in `sdks/python/agenta/sdk/models/workflows.py`
  (`~234-300`): `references` (`{workflow|workflow_variant|environment|...: Reference}`), `data`
  (`inputs`, `parameters`, `revision`), `version`, `session_id`.
- `resolve_references_with_info` (`core/workflows/service.py ~269-364`) resolves by workflow,
  variant, **environment** (deployment slot), or revision. This is what makes env/variant
  targeting work, and it resolves at CALL time.

**Where resolution happens (corrected).** Resolving slug/env/variant → a concrete revision
needs server-side access, but that server side is the **agent service at resolve time**, not
the API at call time. The service already calls the API to resolve gateway tools
(`/tools/resolve`), inline embeds (`/workflows/revisions/resolve`), and secrets while it builds
the run's tool specs. A reference resolves the same way: the service turns the reference into a
concrete revision id and bakes it into the tool's `call.body`. The sidecar then POSTs the
resolved revision + inputs directly to the invoke endpoint. There is no call-time resolution
hop. The only thing the invoke endpoint does at call time is load and run that revision (the
execution), plus enforce the recursion/budget guard.

Decision (2026-06-27): always bake the resolved revision at resolve time, including for
`environment` references. The sidecar is always invoked fresh by the service, so the service
re-resolves on every invoke and the baked revision stays current; no call-time env resolution is
needed. Revisit only if a long-lived sidecar ever calls itself with no service in front.

**Args-placement wrinkle.** The model's tool args must land at `body.data.inputs` for an invoke,
but at the body root for most platform ops. A flat merge is not enough. The `call` descriptor
needs an `args_into` path (see `design.md`).

## Platform-op catalog precedent

- `api/oss/src/core/workflows/platform_catalog.py`: `_PLATFORM_WORKFLOWS` (`~58`) keys reserved
  `_agenta.*` slugs to `{ "current": "vN", "versions": { "vN": <payload> } }`; `get_revision`
  (`~139`) resolves current-or-pinned; deterministic `uuid5` ids (`~68`). Mirror this as a
  `_PLATFORM_TOOLS` catalog: `op → { description?, method, path, schema_ref, default_permission }`.

## Schema source (refines the openapi idea)

- `CATALOG_TYPES` in `sdks/python/agenta/sdk/utils/types.py` (`~1392`) is built at import from
  `Model.model_json_schema()` (dereferenced), and served by `GET /workflows/catalog/types/{type}`
  (`api/oss/src/apis/fastapi/workflows/router.py ~429`, impl `resources/workflows/catalog.py ~222`).
- Recommendation: expose each platform op's input schema through this in-process catalog
  mechanism (a small `/tools/catalog/...` or reuse the types catalog), NOT by parsing
  `/openapi.json` over HTTP. In-process pydantic `model_json_schema()` is the repo's existing
  pattern and avoids coupling to route structure. This is the "probably other places" Mahmoud
  expected. Descriptions still live in the SDK catalog; only the input schema is fetched.

## Auth (already established earlier this session)

- The sidecar holds the run's caller credential (`toolCallback.authorization`, derived per
  request from the tracing context, `platform/connection.py ~64`). Direct calls reuse it.
- The API mints a short-lived `Secret` JWT internally when forwarding to a runner
  (`api/oss/src/middlewares/auth.py ~727`, `sign_secret_token ~914`). That stays server-side.
  (A scoped/attenuated token is a known future hardening, out of scope here.)
