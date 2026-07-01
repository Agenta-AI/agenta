# Plan: validate the invoke request at the boundary

## The core idea

Validate the invoke request before any run starts. When the request cannot resolve to a config,
return a 400 whose message names the two valid ways to call an application. Do this in the shared
SDK resolver boundary that already validates reference families, so the behavior is consistent
across the agent, completion, and chat services.

The rule the boundary enforces: **a well-formed invoke supplies its config in one of two ways.**
There is no legitimate empty or default intent — the caller either gives a config or specifies a
revision.

1. **Inline configuration:** `data.parameters = {"agent": {...}}`.
2. **A revision.** Either:
   - a complete revision, nested correctly: `data.revision = {"data": <revision.data>}`; or
   - a resolvable reference that pins one committed config: a variant, an environment, or a
     revision (`latest` is fine), not a bare application.

If neither holds, the request is malformed and gets a clear error instead of a silent default and
a late 500.

## What "validate" means, precisely

The check runs at the resolver boundary, right where `_validate_executable_reference_families`
already runs (`sdks/python/agenta/sdk/middlewares/running/resolver.py:69-98`). It answers one
question: can this request resolve to a caller-intended config? It raises `bad_request` (400) with
a specific message when it cannot. It ships as a sibling validator, `_validate_resolvable_config`,
called at the top of `ResolverMiddleware.__call__`, so it does not disturb the family check or the
`resolve_references_with_info` path.

### Rule A: a revision, if present, must be nested correctly

If `data.revision` is present, it must be the double-nested shape the resolver reads
(`data.revision["data"]`, `resolver.py:150`). If `data.revision` is a dict but has no `data`
key, the caller almost certainly sent the bare revision fields one level too shallow. Reject
with a message that shows the required shape:

> `data.revision` must be nested as `{"data": {...}}` (the revision's own fields go under
> `data`). You sent the fields at the top level. Wrap them: `data.revision = {"data":
> <revision fields>}`.

This turns the silent single-nested failure (live result: HTTP 500, `gpt-5.5`) into an
immediate, self-explaining 400.

### Rule B: a reference, if it is the intended target, must be resolvable

If the request supplies `references` but no `data.revision` and no inline `data.parameters`,
then the reference is the intended config source. Validate that the reference can pin one
committed config:

- A bare `application` reference (no variant, no environment, no revision) is not resolvable.
  An application has many revisions; nothing selects which one to run. Reject with:

  > A bare `application` reference cannot select a config. An application has many variants and
  > revisions. Provide one of: an `application_variant` reference, an `environment` reference,
  > or an `application_revision` reference.

- The same rule applies per family (workflow, evaluator) using their variant/revision members.

This reuses the family grouping already in `_validate_executable_reference_families`. That
function proves the pattern: it groups references into `workflow` / `application` / `evaluator`
families and raises a clear `bad_request`. Rule B extends it from "exactly one family" to "and
that family names a resolvable target."

### No "nothing to run" rule for the empty body

An earlier draft added a Rule C that rejected a request with no revision, no reference, and no
inline parameters. It is dropped. An empty request expresses no config intent, and config can
still arrive from the running context or a pre-installed handler, so rejecting it at the shared
boundary would regress completion and chat (and the local workflow path). The validator therefore
rejects only an EXPRESSED but unresolvable intent: a present single-nested `data.revision`
(Rule A) or references that pin nothing (Rule B). That covers the two shapes the lab actually hit
— a wrong nesting and a references-only call with no committed target — while leaving the empty
body alone.

## Scope of the strictness (what we are NOT doing)

- **No blanket `extra="forbid"` on the envelope.** Rules A and B fail loud on the load-bearing
  decision (is there a resolvable config), not on every unknown field. A caller can still attach
  extra metadata.
- **No OpenAPI.** Keeping the services' OpenAPI off stands. `/inspect` is the live contract. This
  plan does not touch that decision.
- **The self-hydration fix is separate and complementary.** Removing the agent's seeded
  parameters (`utils.py:285-287` -> `WorkflowRevisionData()`) would make a references-only agent
  call self-hydrate like completion and chat. That is a real fix, tracked as a follow-up, and is
  NOT bundled here. Validation is the deliverable because it helps even when self-hydration is
  intentionally off: a caller who sends a wrong nesting or a bare application still gets a clear
  error.

## Consistency across agent / completion / chat

The three services share the resolver, so Rules A and B live in the shared boundary and all three
get the same clear 400 for a wrong nesting or a bare application. The validator inspects only what
the caller sent, not what the resolver would fall back to, so it does not depend on the
agent-specific seeded default. Because there is no "nothing to run" rule, completion and chat keep
their empty-body behavior unchanged.

## Error model

Use the existing `bad_request` helper the family validator already uses (`_raise_bad_request`,
`resolver.py`), which sets `status_code = 400`. The message names which rule failed, shows the
correct shape (Rule A) or explains why the reference is not resolvable (Rule B), and lists the two
valid call shapes via the shared `_INVOKE_CALL_SHAPES` tail.

## Where the code changes landed

- `sdks/python/agenta/sdk/middlewares/running/resolver.py`: `_validate_resolvable_config`
  (Rules A and B) plus `_RESOLVABLE_REFERENCE_KEYS` and `_INVOKE_CALL_SHAPES`, sitting next to
  `_validate_executable_reference_families` and called at the top of `ResolverMiddleware.__call__`.
  One boundary, all three services.
- `sdks/python/oss/tests/pytest/utils/test_resolver_middleware.py`: `TestResolverConfigValidation`.
- Not touched: `sdks/python/agenta/sdk/models/workflows.py` (the nesting check stays in the
  resolver) and `services/oss/src/agent/app.py` (the shared message is clear enough).

## Supersedes / merges

This plan supersedes and merges the earlier `harden-invoke` decision and the `silent-fallback` /
`invoke-contract` threads under
`docs/design/agent-workflows/scratch/console/builder-kit/`. Their conclusion (add clear-error
validation, keep OpenAPI off, do not blanket-forbid) is carried forward here and reframed around
request validation and the two valid call shapes.

## Test plan (shipped)

Unit tests in `TestResolverConfigValidation`
(`sdks/python/oss/tests/pytest/utils/test_resolver_middleware.py`):

- References only, bare `application` -> 400 naming variant/environment/revision (Rule B). Also a
  bare `workflow` root -> 400.
- References only, a resolvable variant / environment / revision -> passes (no reject).
- Single-nested `data.revision` -> 400 with the nesting fix (Rule A).
- Double-nested `data.revision` -> passes (no reject).
- Inline `data.parameters` -> passes (no reject).
- Empty body -> passes (no "nothing to run" rule; completion / chat do not regress).
- The bare-application reject also fires through `ResolverMiddleware`, before `call_next`.

Capture a live pass with a replay test (see the `agent-replay-test` skill) once deployed.
