# Invoke-by-reference research: agent config hydration + OpenAPI enablement

Read-only investigation. Repo `/home/mahmoud/code/agenta`. Date 2026-07-01.

Question under dispute: invoking the agent service **by reference only** (no inline
`data.parameters.agent`) runs the SDK default agent (`pi_core` / `gpt-5.5`) instead of the
committed config, because the agent workflow seeds a non-empty default config that turns off
"reference hydration". Is that a bug, and where does it actually bite?

**Bottom line (corrected from the earlier investigation):** The seeded-default-defeats-hydration
behavior is **real at the SDK-service layer and is agent-specific**. BUT it does **not** bite the
product's real invoke paths, because they never let a reference-only request reach the SDK
resolver "naked":

- **Playground** always sends the full config **inline** (`data.parameters`).
- **Triggers / schedules** send references only, but the **API backend hydrates
  `data.revision` server-side** (`_ensure_request_revision`) *before* forwarding to the agent
  service, and the SDK resolver prioritizes `data.revision` over the seeded default.

The only way to actually hit the default is a **direct reference-only `/invoke` to the deployed
agent service that bypasses the API** (no `data.revision`, no `data.parameters`). That is not a
product path, but it IS a valid SDK contract that behaves inconsistently for agents vs
completion/chat. So: **not a production bug; a real latent SDK-level inconsistency.** The user is
right to dispute the "every scheduled agent runs the wrong config" framing.

---

## 1. WHERE does reference invocation happen?

| Caller | What it sends to the API/service | Config the agent actually runs | Evidence |
|---|---|---|---|
| **Playground — agent chat** | `data.parameters` = **full inline config**, always; plus `references` only when clean/committed (dirty → `references: null`) | **Inline / committed config** (inline params win) | `web/packages/agenta-playground/src/state/execution/agentRequest.ts:349-353, 385-393` |
| **Playground — completion/chat** | `data.parameters` = **full inline ag_config**, always; refs only when clean | Inline / committed | `web/packages/agenta-playground/.../executionItems.ts:1217-1246`; `web/packages/agenta-entities/.../runnableSetup.ts:151-167, 556-621` |
| **Triggers / schedules fire (THE KEY ONE)** | **references only** (`workflow`+`workflow_variant`+`workflow_revision`), `data.inputs` only, **no** `data.parameters`, **no** `data.revision` | **Committed config** — the API's `_ensure_request_revision` fills `data.revision` from the refs server-side, then forwards it | dispatcher `api/oss/src/tasks/asyncio/triggers/dispatcher.py:262-300`; hydration `api/oss/src/core/workflows/service.py:701-751, 2035-2071` |
| **Evaluations** | **both** inline `data.revision` dump **and** `references` | Committed / inline | `api/oss/src/core/evaluations/runtime/adapters.py:501-506` |
| **SDK request-driven `invoke_workflow`/`invoke_application`** | Whatever the caller passes; builds a fresh workflow with **no fixed URI** → nothing seeded | Whatever arrives (no default fallback) | `sdks/python/agenta/sdk/decorators/running.py:603-632, 704-732` |
| **Direct reference-only `/invoke` to the deployed agent service (bypassing API)** | `references` only, no `data.revision`, no `data.parameters` | **SDK DEFAULT `pi_core`/`gpt-5.5`** (the latent bug) | see §2 mechanism |

### Schedule / trigger fire — resolved

A schedule/trigger fires **by reference**, but it does **NOT** run the wrong config:

1. The dispatcher builds `WorkflowServiceRequest(references=..., data=WorkflowRequestData(inputs=...))`
   — references only, no `data.parameters`, no `data.revision`
   (`dispatcher.py:262-268`). Both the batch path (`invoke_workflow`, `dispatcher.py:296`) and
   the detached/runner path (`_dispatch_fn` → `invoke_workflow_detached`, `dispatcher.py:270-276`)
   go through the same prelude.
2. `_prepare_invoke` (`service.py:2035-2071`) calls **`_ensure_request_revision`**
   (`service.py:701-751`): since `data.revision` is empty and `references` are present, it calls
   `retrieve_workflow_revision(...)` and sets
   `request.data.revision = {"data": <committed revision data>.model_dump()}` (`service.py:746-751`).
3. It forwards the **whole request, including the now-populated `data.revision`**, to
   `{service_url}/invoke` (`service.py:2101-2108` batch, `service.py:2143-2158` detached).
4. At the agent service, the SDK resolver's `resolve_revision` returns `request.data.revision`
   (priority 2, `resolver.py:147-152`) — the committed config — **before** it would ever fall
   back to the seeded default in `RunningContext.revision` (priority 3, `resolver.py:154-162`).
   Committed config runs.

Note (expected, not the bug): if the stored trigger references are incomplete (no
`workflow_revision`), `retrieve_workflow_revision` resolves the **default variant / latest
committed revision** — that is the correct "latest committed" semantics, not the SDK default
agent. Triggers are normalized to a complete reference family at create time
(`api/oss/src/core/triggers/service.py:752-814`), so this is moot in practice.

---

## 2. Reference-vs-default behavior, traced precisely

There are **two layers**. The confusion in the earlier investigation comes from analyzing only
the second (SDK) layer in isolation.

### 2a. The SDK-service resolver decision (given what actually arrives at the agent `/invoke`)

The deployed agent service binds the handler to a **fixed URI** and dispatches every request to
that **same decorated instance** (not a fresh per-request one):
- `services/oss/src/agent/app.py:324` `AGENT_URI = "agenta:builtin:agent:v0"`;
  `app.py:354-355` `routed = ag.workflow(uri=AGENT_URI, schemas=AGENT_SCHEMAS)(_agent)` +
  `ag.route("/", app=app, ...)(routed)`.
- `sdks/python/agenta/sdk/decorators/routing.py:536` `wf = auto_workflow(foo)` returns the same
  instance (`running.py:591-593`); `routing.py:589` `await wf.invoke(request=request)`.

At **decorator/startup time**, because the URI is set, the constructor seeds the builtin's
registered default into its own revision:
- `sdks/python/agenta/sdk/decorators/running.py:240-244`
  `registered_config = retrieve_configuration(self.uri); if registered_config and not
  self.revision.data.parameters: self.revision.data.parameters = registered_config.parameters`.
- The agent's registered default is **non-empty**:
  `sdks/python/agenta/sdk/engines/running/utils.py:285-287`
  `agent=dict(v0=WorkflowRevisionData(parameters={"agent": build_agent_v0_default()}))`.
- `build_agent_v0_default()` = `pi_core` / `gpt-5.5` / local:
  `sdks/python/agenta/sdk/utils/types.py:1399-1439`, constants at `types.py:1059`
  (`_DEFAULT_AGENT_MODEL="gpt-5.5"`), `types.py:1070` (`_DEFAULT_HARNESS="pi_core"`),
  `types.py:1071` (`_DEFAULT_SANDBOX="local"`).

At invoke time, `wf.invoke` copies that instance's revision into `RunningContext.revision`
(`running.py:385-389`). Then the resolver decides:
- `sdks/python/agenta/sdk/middlewares/running/resolver.py:570-577`
  ```python
  revision = await resolve_revision(request=request)     # priority: data.revision > ctx.revision
  request_has_parameters = bool(request.data and request.data.parameters)
  needs_reference_hydration = bool(
      request.references and not request_has_parameters
      and (revision is None or not revision.parameters)   # seeded default is TRUTHY
  )
  ```

Resulting table (what the agent service produces for a request that arrives with...):

| Arriving request | `resolve_revision` returns | Config used | Why (file:line) |
|---|---|---|---|
| `data.revision` present (committed) — **what the API always produces** | the committed revision (priority 2) | **COMMITTED** | `resolver.py:147-152`; then params copied at `resolver.py:611-617` |
| `data.parameters` present (inline) — **what the playground always sends** | (n/a; inline branch taken) | **INLINE / committed** | `resolver.py:605-610` |
| **references only, no `data.revision`, no `data.parameters`** | the **seeded default** from `ctx.revision` (priority 3) | **SDK DEFAULT** `pi_core`/`gpt-5.5` | `resolver.py:154-162`; `needs_reference_hydration=False` (`resolver.py:573-577`) so `resolve_references_with_info` (`resolver.py:219-466`) is **never called**; default copied at `resolver.py:611-617` |

The last row is the whole bug: the seeded non-empty default makes `not revision.parameters`
False, so the SDK's own reference-hydration safety net
(`POST /workflows/revisions/retrieve` inside `resolve_references_with_info`) is switched off for
agents. It is **switched on** for completion/chat, whose registered default is **empty**
(`utils.py:279-280` `chat=dict(v0=WorkflowRevisionData())`,
`completion=dict(v0=WorkflowRevisionData())`) — so `revision.parameters` is falsy and
`needs_reference_hydration=True`. Same route pattern (`services/oss/src/completion.py:32-34`,
`services/oss/src/chat.py`), one different fact (`utils.py:285-287` vs `:279-280`).

### 2b. The four cases the question asks about

The reference **kind** (app id / variant id / revision id) makes **no difference** to which
branch above fires — the guard keys off `revision.parameters`, not the ref kind; the ref kind is
only ever inspected *inside* `resolve_references_with_info`, which the seeded default prevents
from running. So:

| Case | Via the product (API-mediated: playground or trigger) | Via a direct reference-only call to the agent `/invoke` |
|---|---|---|
| **(a) app id only** (default variant, latest revision) | **COMMITTED** (API fills `data.revision`, or playground inline) | **SDK DEFAULT** |
| **(b) explicit variant id** | **COMMITTED** | **SDK DEFAULT** |
| **(c) explicit revision id** | **COMMITTED** | **SDK DEFAULT** |
| **(d) inline config** | **COMMITTED / inline** | **INLINE** |

So the user's mental model ("call by app reference → default variant → latest committed version")
**is honored** through the product paths (a/b/c all commit-correct via API hydration), and is
**identical/broken only for a direct, API-bypassing reference-only call** (a/b/c all fall to the
same SDK default). The fallback is the same for all three reference kinds.

---

## 3. OpenAPI enablement on the typed invoke route

The services disable schema/docs in `create_app`
(`sdks/python/agenta/sdk/decorators/routing.py:73-76`):
```python
kwargs.setdefault("openapi_url", None)
kwargs.setdefault("docs_url", None)
kwargs.setdefault("redoc_url", None)
```

### What FastAPI would generate if `openapi_url` were enabled

**Request body — technically valid but under-specified / misleading.** The route is
`invoke_endpoint(req: Request, request: WorkflowInvokeRequest)` (`routing.py:542`). FastAPI would
emit a schema for `WorkflowInvokeRequest`, but the field carrying the actual config is a **bare,
untyped `dict`**:
- `sdks/python/agenta/sdk/models/workflows.py:239` `parameters: Optional[dict] = None`
  (`inputs`, `testcase`, `revision` are bare `Optional[dict]` too, `workflows.py:238-244`).
- A bare `dict` serializes to `{"type": "object"}` with no properties (open
  `additionalProperties`). So the doc describes the **envelope** (`data`/`inputs`/`parameters`/
  `references`/`flags`/...) but says nothing about **what goes in `parameters`** for an agent vs
  a completion vs a chat — which is the entire useful part.
- `references` is `Optional[Dict[str, Union[Reference, Dict[str, Any]]]]` (`workflows.py:265`) —
  the `Dict[str, Any]` union arm degrades it to a permissive map.
- All three services share the **same** `WorkflowInvokeRequest`, so the generated request schema
  is **identical** across agent/completion/chat and cannot distinguish them. It would look
  authoritative while hiding the per-URI config shape — worse than nothing for a consumer trying
  to learn the agent config.

**Response side — already well-described (this part is fine).** The route attaches rich
content-negotiated response docs even though openapi is off (`routing.py:637-673`): a 200 with
`WorkflowBatchResponse.model_json_schema()` for JSON plus string-schema stream variants
(ndjson/jsonl/sse), and a 406. Enabling openapi would surface a *good* response doc; the weakness
is entirely the request `parameters` opacity.

**Turning it on for agent + completion + chat at once.** Each is a separate FastAPI app
(`create_app` per service; the routes register on the app root via `path="/"`,
`routing.py:701-715`). It is per-service, no cross-app leak, no security exposure beyond the
already-known envelope. The real risk is **accuracy**: three near-identical docs each advertising
an opaque `parameters`, implying free-form config and inviting malformed calls. Documentation-
correctness risk, not a security one.

**Is `/inspect` strictly better for now? Yes.** `/inspect` is request/URI-driven and returns the
**concrete per-workflow JSON Schema** — `parameters`, `inputs`, `outputs` — from the live
registered interface (`AGENT_SCHEMAS`), at `response.revision.data.schemas`
(`WorkflowInspectResponse`, `workflows.py:331-358`; the agent registers its real interface at
`services/oss/src/agent/app.py:350-352`). That is exactly the "what config does THIS agent take"
answer a static OpenAPI on `/invoke` cannot give. **Recommendation: keep `openapi_url` off; rely
on `/inspect`.** If openapi is ever enabled, first give `parameters` a real (per-service /
discriminated) type; otherwise it adds authoritative-looking noise that under-specifies the one
field that matters.

---

## Verdict

**Bug-or-not for the reference behavior:** **Not a production bug; a real but latent SDK-level
inconsistency.** Reasoning: the "reference-only → SDK default" fallback is genuine and
agent-specific at the SDK-service layer (the agent builtin is the only one that seeds non-empty
default parameters, `utils.py:285-287`, which defeats the `needs_reference_hydration` guard,
`resolver.py:573-577`). BUT neither product path lets a naked reference-only request reach the
resolver: the **playground always sends inline `data.parameters`**, and **triggers/schedules go
through the API's `_ensure_request_revision`, which populates `data.revision` server-side before
forwarding**, and the SDK resolver prioritizes `data.revision` over the seeded default
(`resolver.py:147-162`). The default is reachable only by a **direct reference-only `/invoke` to
the deployed agent service that bypasses the API** — not a product path today, but a valid SDK
contract that behaves inconsistently for agents vs completion/chat and is worth fixing (e.g. seed
the agent registry default empty, or make `needs_reference_hydration` ignore the process-local
seeded default). So: no scheduled agent runs the wrong config today; the defect is a latent trap
for any future direct-by-reference caller of the agent service.
