---
title: Agent invoke service — reference resolution, contract exposure, and silent fallback
task: invoke-service
date: 2026-07-01
---

# Agent invoke service — three findings (A / B / C)

Scope: the deployed agent workflow service (`services/oss/src/agent/app.py`), the shared
SDK running layer that serves its `/invoke` (`sdks/python/agenta/sdk/...`), and how it
compares to the completion (`services/oss/src/completion.py`) and chat
(`services/oss/src/chat.py`) services. All three are `ag.create_app()` + `ag.route()` apps
mounted in one `agenta-services` container (`services/entrypoints/main.py:135-137`), reached
through Traefik at `POST {host}/services/<name>/v0/invoke` (Traefik strips `/services`).

The three services are structurally identical at the handler level: each reads
`parameters` and builds its config from it (`_agent` / `_completion` / `_chat`). None of them
resolve references themselves — the shared **ResolverMiddleware** hydrates
`references` → `data.parameters` before the handler runs. So the differences below are all in
the shared middleware/registry, plus one agent-only registry seed.

---

## A. Reference-only invocation silently runs the default config (gpt-5.5 / pi_core)

### What's happening

A `POST /services/agent/v0/invoke` that carries only `references.application.id` (no inline
`data.parameters.agent`) runs a hardcoded default agent (`gpt-5.5` + `pi_core`), not the
committed revision's config. The same request shape works for completion and chat. This is a
**genuine, agent-specific bug** — not intentional and not an unimplemented path. The reference-
resolution machinery exists and fires for completion/chat; an agent-only registry seed
shadows it.

### The mechanism (exact resolution code)

The agent handler has no reference logic. It reads `parameters` and, when empty, falls back to
its own file defaults:

- `services/oss/src/agent/app.py:218-222` — `params = parameters or {}`;
  `AgentTemplate.from_params(params, defaults=_default_agent_template())`.
- `AgentTemplate.from_params` defaults `harness="pi_core"`
  (`sdks/python/agenta/sdk/agents/dtos.py:569`) and `_default_agent_template()` supplies
  `model="gpt-5.5"` (`services/oss/src/agent/config.py:21`,
  `sdks/python/agenta/sdk/utils/types.py:1059`). So empty `params` ⇒ **gpt-5.5 / pi_core** —
  exactly the observed default.

Reference → parameters hydration is a shared middleware, run for every service:

- `sdks/python/agenta/sdk/middlewares/running/resolver.py:564-617` — `ResolverMiddleware`.
  It only fetches the committed revision when `needs_reference_hydration` is true:
  ```py
  # resolver.py:570-577
  revision = await resolve_revision(request=request)          # from RunningContext.revision
  request_has_parameters = bool(request.data and request.data.parameters)
  needs_reference_hydration = bool(
      request.references
      and not request_has_parameters
      and (revision is None or not revision.parameters)        # <-- the gate that fails for agent
  )
  ```
  When true, it calls `resolve_references_with_info` → `POST {api}/applications/revisions/retrieve`
  (`resolver.py:374-400`) and sets `request.data.parameters = revision.parameters`
  (`resolver.py:611-617`). When false, it just copies the already-present `revision.parameters`
  into `request.data.parameters` (same lines) — i.e. the reference is never fetched.

### Why the gate is false for agent but true for completion/chat (root cause)

`resolve_revision` reads the workflow's own registered revision out of `RunningContext.revision`
(`resolver.py:154-163`), which `wf.invoke` seeded from `self.revision`
(`sdks/python/agenta/sdk/decorators/running.py:385-389`). `self.revision.data.parameters` is
populated at workflow-construction time from the SDK's **configuration registry**:

- `sdks/python/agenta/sdk/decorators/running.py:240-244`
  ```py
  registered_config = retrieve_configuration(self.uri)
  if registered_config and not self.revision.data.parameters:
      self.revision.data.parameters = registered_config.parameters
  self.parameters = self.revision.data.parameters
  ```
- `sdks/python/agenta/sdk/engines/running/utils.py:266-306` — `CONFIGURATION_REGISTRY`:
  - `chat` → `WorkflowRevisionData()` (line 279) — **no parameters**
  - `completion` → `WorkflowRevisionData()` (line 280) — **no parameters**
  - `agent` → `WorkflowRevisionData(parameters={"agent": build_agent_v0_default()})`
    (lines 285-287) — **has default parameters**

`build_agent_v0_default()` is `{llm.model: "gpt-5.5", harness.kind: "pi_core", ...}`
(`sdks/python/agenta/sdk/utils/types.py:1399-1444`, constants at `types.py:1059`/`1070`).

Consequence:
- **agent**: the seeded default makes `revision.parameters` non-empty, so
  `needs_reference_hydration` is **False** → `/applications/revisions/retrieve` is skipped →
  `request.data.parameters` = the seeded default → handler runs gpt-5.5 / pi_core. The
  committed revision named by `references.application.id` is never fetched.
- **completion / chat**: `revision.parameters` is empty → `needs_reference_hydration` is
  **True** → the reference is fetched and the committed config applied.

Inline works for the agent because `request_has_parameters` is True, which takes the
`request.data.parameters` branch directly (`resolver.py:605-610`) and never consults the seed.

Confirmed not an environment no-op: `ag.init()` runs in the services container
(`services/entrypoints/main.py:49`), so `ag.async_api` is set and the retrieve call
(`resolver.py:250-251` early-return guard) is available — chat/completion in the *same*
container resolve references fine. The agent-only seed is the sole cause.

The seed's comment (`utils.py:281-284`) says its intent is "a run that binds
`agenta:builtin:agent:v0` with no parameters gets the same default the interface advertises."
It solved the no-refs/no-params direct-bind case but unintentionally suppresses reference
hydration whenever refs are present without inline params.

### Fix recommendation

Primary (smallest, restores parity): drop the parameters from the agent's configuration-registry
seed so it matches chat/completion —
`utils.py:285-287` → `agent=dict(v0=WorkflowRevisionData())`. The handler already produces a
sane default from empty params (`app.py:218-222` + `_default_agent_template()`), and `/inspect`
still advertises the default via `AGENT_SCHEMAS` (`services/oss/src/agent/schemas.py:41-56`,
`AGENT_TEMPLATE_SCHEMA.default`), so nothing that needs the default loses it. After the change,
`needs_reference_hydration` becomes True for reference-only agent calls.

Alternative (if the seeded default must stay for a pure URI-bind path): tighten the gate in
`ResolverMiddleware` so a present `request.references` with no *inline* request parameters forces
hydration even when the resolved revision's parameters came from the registry default — e.g. gate
on `request.data.parameters` (caller-supplied) rather than the merged `revision.parameters`
(`resolver.py:572-577`). This is riskier because the resolver cannot easily distinguish a
registry-seeded default from a real committed revision.

Validate either fix against the no-references + no-parameters direct-bind case (must still yield
gpt-5.5 / pi_core) and the reference-only case (must now yield the committed config).

---

## B. No live-documented invoke contract (openapi.json / docs are 404)

### What's happening

`GET /services/agent/v0/openapi.json` and `/docs` 404 because the SDK's `create_app` disables
OpenAPI, Swagger, and ReDoc for **every** workflow service (agent, completion, chat alike) — this
is by-design and uniform, not an agent gap. The invoke contract is instead self-described at
runtime through `/inspect`.

### Evidence

- `sdks/python/agenta/sdk/decorators/routing.py:73-78` — `create_app` sets
  `openapi_url=None`, `docs_url=None`, `redoc_url=None`. All three services call it
  (`completion.py:32`, `chat.py:36`, `agent/app.py:328`), and sub-app mounts reuse it
  (`routing.py:717`).
- `services/entrypoints/main.py:106-110` — the outer services app also sets
  `openapi_url=None` / `docs_url=None`, so nothing under `/services/*` publishes OpenAPI.
- The API gateway *does* publish OpenAPI at `/api/openapi.json`
  (`api/entrypoints/routers.py:433-437`), but it does **not** document the `/services/*` family —
  those are a separate container behind Traefik
  (`hosting/docker-compose/oss/docker-compose.gh.yml` services router;
  `services/entrypoints/main.py:135-137`).
- Existing contract mechanism: `/inspect` returns the revision's JSON Schemas (inputs,
  parameters, outputs) plus a ready-made request. `sdks/python/agenta/sdk/decorators/routing.py:456-483`
  (`_to_inspect_response` / `handle_inspect_success`); the agent's schemas are
  `services/oss/src/agent/schemas.py:76-80` (`AGENT_SCHEMAS`). So the invoke body shape
  (`WorkflowInvokeRequest`, `sdks/python/agenta/sdk/models/workflows.py:296-297`) and the
  parameters shape (`parameters.agent` = `agent-template`) are already machine-readable — just not
  as OpenAPI.

### Fix recommendation

Two independent options, pick per goal:

1. Discoverability with what exists: document that the contract lives at
   `POST /services/agent/v0/inspect` (schemas) and that the request envelope is
   `WorkflowInvokeRequest`. This is the pattern completion/chat already rely on; no code change.
2. Real OpenAPI on the services: since disabling is a single shared default
   (`routing.py:74-76`), enable it deliberately for the mounted service apps (pass
   `openapi_url="/openapi.json"`, `docs_url="/docs"` when building the sub-app in `route`, or in
   `services/entrypoints/main.py`). Because `invoke_endpoint(req, request: WorkflowInvokeRequest)`
   is a typed FastAPI route, FastAPI would generate a request/response schema automatically. This
   is the copyable pattern and would cover all three services at once. Gate it behind a flag/env if
   you don't want it on public deployments.

---

## C. Wrong-shaped body silently falls back instead of returning 422

### What's happening

A malformed invoke body (misspelled top-level field, wrong nesting, wrong key inside
`parameters.agent`) does not 422. The request-envelope models ignore unknown fields, the
`parameters` payload is an unvalidated free-form dict, and `AgentTemplate.from_params` is
best-effort (missing/misnamed keys → defaults). So the run proceeds on the default config and the
caller cannot tell "field ignored by design" from "field name wrong." This is a design
consequence (loose-by-intent request boundary), not a targeted bug.

### Evidence

- Request models do not forbid extras (Pydantic v2 default = ignore):
  `sdks/python/agenta/sdk/models/workflows.py:237-245` (`WorkflowRequestData`),
  `:256-289` (`WorkflowBaseRequest`), `:296-297` (`WorkflowInvokeRequest`) — none set
  `extra="forbid"`. A misspelled top-level field (e.g. `parameter` instead of `parameters`) is
  silently dropped, leaving `data.parameters = None`.
  (Contrast: `WorkflowInvokeRequestFlags` DOES set `extra="forbid"` at `workflows.py:153` — the
  precedent exists, just not applied to the body.)
- `parameters` is an untyped dict: `WorkflowRequestData.parameters: Optional[dict]`
  (`workflows.py:239`). The agent config inside is never schema-validated at the boundary.
- Best-effort parse: `sdks/python/agenta/sdk/agents/dtos.py:1166-1204` (`_parse_agent_fields`)
  and `:1029` (`_template`) read `params.get("agent")` and per-field `.get(...)`, each falling
  back to `defaults` when absent (lines 1187-1189, 1204). A wrong-shaped `agent` block yields the
  default silently.
- The empty-params default itself is silent: `services/oss/src/agent/app.py:218-222`.

### Fix recommendation

Add strict validation at the invoke boundary, scoped to the agent service so it does not change
the intentionally-loose generic envelope:

1. Minimal: in `_agent` (`app.py`), when `parameters` is non-empty but carries no recognizable
   agent template (`"agent"` key absent and none of the flat template keys / `prompt` present —
   the same signal `_parse_agent_fields` uses at `dtos.py:1175-1177`), raise a 422 instead of
   falling through to defaults. This catches "wrong shape" while still allowing a deliberate
   empty-body default.
2. Stronger: validate `parameters.agent` against the `agent-template` schema (a strict twin with
   `extra="forbid"`, mirroring `_SkillFileSchema` at `dtos.py:1447-1454`) and 422 on unknown
   fields. Requires a strict AgentTemplate model; more work, but turns silent field-drop into a
   real error.
3. Envelope-level (affects all services, decide deliberately): set `extra="forbid"` on
   `WorkflowRequestData` / `WorkflowInvokeRequest` (`workflows.py:237`, `:296`) so a misspelled
   top-level field 422s. This is the highest-signal fix for "wrong field name" but is a
   cross-service behavior change; weigh against callers that rely on forgiving extras.

---

## One-line summary

- **A** — agent-only registry seed (`utils.py:285-287`) gives the agent workflow default
  parameters, which flips `needs_reference_hydration` off (`resolver.py:572-577`) so
  `references.application.id` is never fetched; **bug**; remove the seed's parameters to match
  chat/completion.
- **B** — `create_app` disables OpenAPI/docs for all services (`routing.py:74-76`); **by-design**;
  either document `/inspect` (existing pattern) or enable `openapi_url` on the typed
  `/invoke` route.
- **C** — loose request models (no `extra="forbid"`, `parameters: Optional[dict]`) +
  best-effort `from_params` (`dtos.py:1166-1204`) swallow wrong shapes; **by-design looseness**;
  add strict validation on `parameters.agent` (or a scoped 422 in `_agent`).
</content>
</invoke>
