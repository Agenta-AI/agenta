# Reference-invoke: does a by-reference/revision invoke run the committed config? (LIVE-proven)

Date: 2026-07-01
Host: `https://bighetzner.agenta.dev` (API under `/api`, agent service at `/services/agent/v0`)
Lab creds: `/home/mahmoud/code/agent-creation-lab/.env`

Committed test agent (app `019f1a7b-c42d-7d42-a878-95fe4651150b`, variant
`019f1a7b-c448-7c50-a90c-03731450a9a9`, revision `019f1a7b-c47d-7032-844f-c507ddccb8c0`):
committed `data.uri = agenta:builtin:agent:v0`, committed
`parameters.agent = { harness.kind: claude, llm: {model: sonnet, provider: anthropic,
connection.mode: self_managed} }`.

Signal: trace RESOLVED `ag.data.parameters.agent` shows **claude/sonnet** when the committed
config ran; shows **pi_core/gpt-5.5** (and 500s) when the SDK-seeded default ran instead.

---

## TL;DR

- **Only two payload shapes run the committed config at the service level:** (a) inline
  `data.parameters`, or (b) the **double-nested** `data.revision = {"data": <revision.data>}`.
- **A pure by-reference call (references only) does NOT run the committed config at the
  service** — it silently runs the SDK-seeded default (pi_core/gpt-5.5) and 500s.
- **Attempt 2 failed because its shape was single-nested** (`data.revision = <revision.data>`),
  and the resolver reads `data.revision["data"]`, which is absent in that shape.
- **The product path (playground / trigger / HITL) works** because the API's
  `_ensure_request_revision` pre-hydrates the reference into exactly the double-nested shape
  before forwarding to the service. So production runs the committed config.

---

## The resolver decision (cite: file:line)

`sdks/python/agenta/sdk/middlewares/running/resolver.py` — `resolve_revision(...)`
(lines 132-163). Priority order:

1. **`resolver.py:144-145`** — explicit `revision=` kwarg wins (used only by the *local*
   decorator path, which passes the seeded default; see below).
2. **`resolver.py:147-152`** — `request.data.revision`. The code does
   `rev_dict.get("data")` (line 150) and builds `WorkflowRevisionData(**data_dict)`.
   → the incoming shape MUST be `data.revision = {"data": {uri, parameters, ...}}`.
   A bare `WorkflowRevisionData` dump (keys `uri/url/schemas/parameters`) has **no `data`
   key**, so `data_dict` is falsy and this branch is skipped.
3. **`resolver.py:154-162`** — `RunningContext.revision` (the seeded default) is the
   fallback.

HTTP middleware calls it with **no kwarg**: `resolver.py:570`
(`revision = await resolve_revision(request=request)`), so priority 1 never applies over
HTTP — priority 2 (`data.revision`) is the only way a caller-supplied config wins over the
seeded default.

### Where the seeded default comes from

- The agent workflow is seeded with a non-empty default at
  `sdks/python/agenta/sdk/engines/running/utils.py:285-287`:
  `agent=dict(v0=WorkflowRevisionData(parameters={"agent": build_agent_v0_default()}))`
  → `build_agent_v0_default()` = **pi_core / gpt-5.5**.
- On every HTTP `/invoke`, the decorator seeds this into the RunningContext at
  `sdks/python/agenta/sdk/decorators/running.py:385-389`
  (`running_ctx.revision = self.revision.model_dump(...)`). That is the priority-3 value.

### The reference-hydration guard (why references-only can't win at the service)

`resolver.py:572-577`:
```python
request_has_parameters = bool(request.data and request.data.parameters)
needs_reference_hydration = bool(
    request.references
    and not request_has_parameters
    and (revision is None or not revision.parameters)   # <-- seeded default HAS parameters
)
```
When only `references` are sent, `resolve_revision` already returned the **seeded default**
(priority 3), which **has** `parameters`. So `revision is None or not revision.parameters`
is False → `needs_reference_hydration` is False → the reference is **never** retrieved →
the seeded default runs. This is the service-level gap.

---

## What the API forwards on a real trigger fire (cite: file:line)

`api/oss/src/core/workflows/service.py`:

- `_prepare_invoke` (2035-2071) always calls `_ensure_request_revision` (2063-2066).
- `_ensure_request_revision` (701-751) retrieves the revision from the request's refs and
  sets, at **service.py:749-751**:
  ```python
  request.data.revision = {"data": workflow_revision.data.model_dump(mode="json")}
  ```
  → the **double-nested** shape the resolver's priority-2 branch reads. Then the request is
  forwarded to `{service_url}/invoke` (2101-2108).

Every product invoke caller routes through `invoke_workflow` / `invoke_workflow_detached`
(both call `_prepare_invoke`):
- `api/oss/src/tasks/asyncio/triggers/dispatcher.py:262-268, 296` — builds the request with
  `references` + `selector` + `data.inputs` only (no revision, no params) and lets the API
  hydrate.
- `api/oss/src/apis/fastapi/sessions/router.py:845-856` (HITL respond) — same.
- `api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:72`,
  `api/oss/src/core/evaluations/runtime/adapters.py:104,508`,
  `api/oss/src/apis/fastapi/tools/router.py:1306` — same.

So the reference→revision hydration is done **API-side**, and the service always receives the
resolved double-nested `data.revision`.

---

## LIVE reproduction

Retrieve the committed revision (exact endpoint the SDK resolver uses):
```bash
curl -sS -X POST "$AGENTA_HOST/api/applications/revisions/retrieve" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" -H "Content-Type: application/json" \
  -d '{"resolve": true, "application_revision_ref": {"id": "019f1a7b-c47d-7032-844f-c507ddccb8c0"}}'
# 200 -> application_revision.data = { uri: agenta:builtin:agent:v0, url, schemas,
#        parameters: { agent: { harness.kind: claude, llm.model: sonnet, ... } } }
```

### WORKING: double-nested `data.revision = {"data": <revision.data>}`
```bash
# payload.data.revision.data = the retrieved application_revision.data (verbatim)
curl -sS -X POST "$AGENTA_HOST/services/agent/v0/invoke" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "data": {
      "revision": { "data": <application_revision.data> },
      "inputs": { "messages": [ {"role":"user","content":"Summarize: ..."} ] }
    },
    "references": { "application_revision": { "id": "019f1a7b-c47d-7032-844f-c507ddccb8c0" } },
    "flags": { "resolve": true }
  }'
```
Result: **HTTP 200**, real summary output (`trace_id cffc952469f05806637356aff0c8ec71`).
Trace RESOLVED (`ag.data.parameters.agent`): **harness.kind=claude, llm.model=sonnet,
provider=anthropic, connection.mode=self_managed** = the committed config.
(pi_core/gpt-5.5 appears ONLY under `schemas.…default`, i.e. the interface's advertised
default — never in the resolved parameters.)

### FAIL — attempt 1: references only (no data.revision, no parameters)
HTTP **500**, resolved model **gpt-5.5** (`trace_id 2300c78c843ca6713424fafeeb72fdce`).
Error: `model 'gpt-5.5' needs a provider prefix ...`. → seeded default ran; the reference
was never hydrated (guard at `resolver.py:573-577`).

### FAIL — attempt 2: single-nested `data.revision = <revision.data>`
HTTP **500**, resolved model **gpt-5.5** (`trace_id 4a091d1560332b26f0269bc954e8d40f`).
`resolve_revision` did `data.revision.get("data")` → None (no nested `data` key in a bare
`WorkflowRevisionData` dump) → priority 2 skipped → seeded default (priority 3) ran.
**This is exactly why the original attempt 2 failed: wrong nesting.**

---

## Verdict

- **(i) Product path (playground / trigger / HITL): NOT a bug.** It runs the committed
  config. The API's `_ensure_request_revision` (service.py:749-751) pre-hydrates the
  reference into the double-nested `data.revision` the resolver needs, and all product
  callers route through it. Proven live: that exact shape returns 200 + resolved
  claude/sonnet.
- **(ii) A by-reference call made directly to the service: BUG / design gap.** A pure
  references-only (or single-nested-revision) POST to `/services/agent/v0/invoke` does NOT
  run the committed config — it silently runs the SDK-seeded default (pi_core/gpt-5.5) and
  500s. The service does not self-hydrate a bare reference because the seeded default's
  parameters defeat the hydration guard (`resolver.py:573-577`). The service is only correct
  when the caller already carries the resolved revision (double-nested) or inline
  `data.parameters`.
- **(iii) The earlier "not a bug" conclusion: half right, and its stated mechanism is
  wrong.** Right that production runs the committed config (because the API pre-resolves).
  Wrong that "the resolver prioritizes `data.revision` so a by-reference service call
  works": the resolver needs the precise double-nested `{"data": {...}}` shape, and a
  references-only service call is NOT hydrated at all (seeded default wins). So "invoke by
  reference at the service" is broken; "invoke by reference through the API" works.

### Exact working invoke (by revision-shaped data, = what production forwards)
`POST {host}/services/agent/v0/invoke` with
`data.revision = {"data": <application_revision.data>}` (+ `data.inputs.messages`).
Third working option: inline `data.parameters = {"agent": {...}}` (resolver.py:605).
Non-working: references-only, and single-nested `data.revision`.
