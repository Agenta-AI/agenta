# Research: why a malformed invoke silently defaults

All paths below were read on the `big-agents` line. Line numbers are current as of
2026-07-01.

## The invoke path in one picture

`POST {host}/services/agent/v0/invoke` reaches the shared SDK running layer. A middleware
resolves the config to run, then the agent handler builds its template from that config. Three
services (agent, completion, chat) share this layer; they differ only in one seeded default.

The config the run uses is chosen by `resolve_revision(...)` and then adjusted by
`ResolverMiddleware.__call__(...)`, both in
`sdks/python/agenta/sdk/middlewares/running/resolver.py`.

## 1. The resolver requires a double-nested revision

`resolve_revision(...)` prefers a caller-supplied revision from `request.data.revision`:

- `resolver.py:147-152`:
  ```python
  if request and request.data and request.data.revision:
      rev_dict = request.data.revision
      # revision dict is the full WorkflowRevision dump; data sub-key holds the actual fields
      data_dict = rev_dict.get("data") if isinstance(rev_dict, dict) else None
      if data_dict:
          return WorkflowRevisionData(**data_dict)
  ```

The branch reads `rev_dict.get("data")` (`resolver.py:150`) and builds `WorkflowRevisionData`
from it (`resolver.py:152`). So the required shape is:

```json
"data": { "revision": { "data": { "uri": ..., "parameters": ... } } }
```

A caller who sends the bare revision fields (`data.revision = {"uri": ..., "parameters": ...}`)
has no nested `data` key, so `data_dict` is falsy, the branch is skipped, and the resolver falls
through to the seeded default. The wrong nesting produces no error; it produces a default.

Note the strict twin already exists: `WorkflowRevisionData` sets `model_config =
ConfigDict(extra="forbid")` (`sdks/python/agenta/sdk/models/workflows.py:152-153`). The revision
body is strictly validated, but only once the resolver reaches it. Wrong nesting means the
strict model never runs.

## 2. The seeded default disables reference hydration for the agent

When there is no usable `data.revision`, `resolve_revision` returns
`RunningContext.revision` (`resolver.py:154-162`), which the decorator seeded from the workflow's
registered default. For the agent workflow that default is not empty:

- `sdks/python/agenta/sdk/engines/running/utils.py:285-287`:
  ```python
  agent=dict(
      v0=WorkflowRevisionData(parameters={"agent": build_agent_v0_default()})
  ),
  ```
  `build_agent_v0_default()` is `pi_core` / `gpt-5.5`.

- Compare chat and completion, which seed empty data:
  `utils.py:279-280` → `chat=dict(v0=WorkflowRevisionData())`,
  `completion=dict(v0=WorkflowRevisionData())`. No parameters.

The hydration gate then behaves differently for the agent than for chat/completion:

- `resolver.py:572-577`:
  ```python
  request_has_parameters = bool(request.data and request.data.parameters)
  needs_reference_hydration = bool(
      request.references
      and not request_has_parameters
      and (revision is None or not revision.parameters)   # seeded default HAS parameters
  )
  ```

For the agent, the seeded default's `parameters` are non-empty, so
`revision is None or not revision.parameters` is False. `needs_reference_hydration` is False.
The reference is never fetched. The seeded default runs. For chat and completion the seed is
empty, the gate is True, and the reference is fetched and applied.

Net effect at the service: a references-only agent invoke runs `pi_core` / `gpt-5.5` and then
500s, because that model needs a provider prefix.

## 3. The request envelope ignores unknown fields

Even before the resolver, the request models accept junk quietly:

- `WorkflowRequestData` (`workflows.py:237-239`) has `revision: Optional[dict]` and
  `parameters: Optional[dict]`, and does not set `extra="forbid"`. A misspelled top-level field
  (for example `parameter` instead of `parameters`, or `revisions` instead of `revision`) is
  dropped, leaving the field `None`.
- `WorkflowInvokeRequest` (`workflows.py:296-297`) likewise does not forbid extras.
- `parameters` is an untyped dict, so the agent config inside it is never schema-checked at the
  envelope.

So a wrong field name and a wrong nesting both survive as "no config supplied," and the run
proceeds on the seeded default. The precedent for strictness exists in the same file
(`WorkflowRevisionData` at `workflows.py:152-153` uses `extra="forbid"`), it is just not applied
to the envelope.

## 4. Why the product path works but a direct service call does not

The product never sends a bare reference to the service. The API resolves the reference first
and forwards the double-nested revision:

- `api/oss/src/core/workflows/service.py:745-751`:
  ```python
  if workflow_revision and workflow_revision.data:
      if not request.data:
          request.data = WorkflowRequestData()
      request.data.revision = {
          "data": workflow_revision.data.model_dump(mode="json")
      }
  ```

`_ensure_request_revision` runs inside `_prepare_invoke`, and every product invoke caller
(triggers, HITL respond, sessions, evaluations, tools) routes through it. So the service always
receives the resolved, double-nested `data.revision`, and the committed config runs. The gap is
only visible when a caller talks to the service directly, which is exactly what the lab does.

## 5. Reference kinds: a bare application is not resolvable

Reference resolution lives in `resolve_references_with_info(...)`
(`sdks/python/agenta/sdk/middlewares/running/resolver.py`, around 240-460). Two facts matter for
validation.

**There is already a boundary validator, and it already raises 4xx.**
`_validate_executable_reference_families(refs)` (`resolver.py:69-98`) groups references into
families and rejects competing targets:

```python
if len(populated) > 1:
    _raise_bad_request(
        "Competing execution target references are not allowed. "
        "Provide exactly one of workflow, application, or evaluator "
        f"references; got {', '.join(populated)}."
    )
```

This is the natural home for the new check, and it proves the pattern: validate the reference
shape at the boundary and raise a clear `bad_request`.

**The application family has three identity levels, and only the deeper two pin a config.** The
mapping the resolver builds (`resolver.py`, application mapping) is:

- `application_ref` -> `application`
- `application_variant_ref` -> `application_variant`
- `application_revision_ref` -> `application_revision`

with a parallel `environment` family (`environment_ref`, `environment_variant_ref`,
`environment_revision_ref`).

The three reference-kind results:

| Reference supplied | Can it pin one committed config? | Why |
| --- | --- | --- |
| `application` only (bare app) | No | An application has many variants and revisions. A bare app id is ambiguous; nothing selects which revision to run. The retrieve call gets only `application_ref` and cannot resolve a single revision. |
| `application_variant` (or `environment`) | Yes | A variant selects its current revision; an environment selects the revision deployed to it. `environment_backed_application_lookup` (`resolver.py:348-356`) uses the environment mapping to pick the target. |
| `application_revision` | Yes | Names the exact committed revision. `resolve_references_with_info` returns `WorkflowRevisionData(**revision["data"])` for it. |

So "provide a resolvable reference" means: provide a variant, an environment, or a revision, not
a bare application. Today the resolver does not reject a bare application; it just fails to
resolve and (for the agent) falls through to the seeded default.

## 6. Live results that confirm the mechanism

From `docs/design/agent-workflows/scratch/console/builder-kit/findings/reference-invoke-definitive.md`
(reproduced live against `https://bighetzner.agenta.dev`):

- **Double-nested `data.revision = {"data": <revision.data>}`** -> HTTP 200, resolved
  `harness=claude, model=sonnet` (the committed config). Works.
- **References only (no `data.revision`, no `parameters`)** -> HTTP 500, resolved `gpt-5.5`. The
  seeded default ran; the reference was never hydrated (gate at `resolver.py:573-577`).
- **Single-nested `data.revision = <revision.data>`** -> HTTP 500, resolved `gpt-5.5`.
  `rev_dict.get("data")` was None, the branch was skipped, the seeded default ran.

The third working option is inline: `data.parameters = {"agent": {...}}`, which takes the
`request.data.parameters` branch directly (`resolver.py:605-610`) and never consults the seed.

## Files that changed

- `sdks/python/agenta/sdk/middlewares/running/resolver.py` — `_validate_resolvable_config` (the
  boundary validator, next to `_validate_executable_reference_families`), called from
  `ResolverMiddleware.__call__`.
- `sdks/python/oss/tests/pytest/utils/test_resolver_middleware.py` — `TestResolverConfigValidation`.

Not touched (deliberately): `sdks/python/agenta/sdk/models/workflows.py` (the revision-nesting
check stays in the resolver, not the model) and `services/oss/src/agent/app.py` (the shared
message is clear enough). The seeded-default self-hydration fix (`utils.py:285-287`) is a separate
follow-up, not bundled here.
