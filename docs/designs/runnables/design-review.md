# Runnables Design Review

> Status: review
> Date: 2026-03-13
> Scope: consistency and design critique across `docs/designs/runnables/*`

This review is about the design issues that remain after the latest contract decisions were folded back into the docs.

## Review Outcome

The document set is now broadly aligned around these decisions:

- workflows are the canonical runnable contract family
- applications and evaluators are filtered workflow projections
- `WorkflowFlags` and `WorkflowRequestFlags` are separate contract types
- `evaluate` is the external contract term, while lower-level tracing may still use annotation terminology
- API-to-services handoff uses redirect
- `openapi.json` must come from the same provenance as `inspect`
- catalog is list-plus-presets only; there is no single-entry fetch
- `flags.remote` is the SDK-side remote-forwarding control and must be cleared on forwarded requests
- legacy `WorkflowRevisionData.service` / `configuration` are removal targets

The main remaining issues are migration and precedence questions rather than first-order contract direction. F1 and F2 are explicitly gated on production-data inspection.

## Findings

### F1. URI Normalization Still Needs a Compatibility Plan

**Severity:** High

**Why it matters:** The design now narrows URI/git alignment to backend-defined `user:custom` cases, while builtins keep handler-key and builtin-version semantics. That is better, but it still leaves a real compatibility surface for existing custom URIs and alias resolution.

**Evidence:**

- [plan.md](./plan.md) checkpoint `1a` now aligns only backend-defined `user:custom` URI key/version with backend variant/revision identity.
- [taxonomy.md](./taxonomy.md) narrows the mapping so builtins keep builtin key/version semantics.
- [README.md](./README.md) still documents current user auto-generation as `user:custom:{module}.{name}:latest`, which reflects the existing runtime reality.

**Recommendation:**

- inspect production data first
- define how old `user:custom:{module}.{name}:latest` URIs resolve after normalization
- decide whether aliases are persisted or resolved dynamically
- decide whether `latest` survives in stored revision data or only at request time

### F2. Legacy `service` / `configuration` Removal Still Needs Production-Data Validation

**Severity:** High

**Why it matters:** The docs now define the normalization direction, but production data will determine whether the flat normalized fields can simply replace the nested legacy fields or whether migration has to hydrate from nested data first.

**Evidence:**

- [plan.md](./plan.md) checkpoint `1fa` now says to prefer flat normalized fields when both flat and nested data coexist, and to hydrate from nested fields when flat fields are absent.
- [gap-analysis.md](./gap-analysis.md) `G12b` records active usage in generated client types, evaluator builders, and tests.
- Current code still uses the legacy fields in places like [defaults.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/defaults.py#L145), [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/service.py#L924), and [workflow_revision_data_input.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/sdk/agenta/client/backend/types/workflow_revision_data_input.py#L35).

**Recommendation:**

- inspect production payloads first
- prefer existing flat normalized fields when both flat and nested data coexist
- hydrate flat normalized fields from nested legacy data when flat fields are absent
- remove nested legacy fields only after compatibility coverage is complete

### F3. Persisted Discovery Truth vs Live Inspect Truth Still Needs Precedence Rules

**Severity:** Medium

**Why it matters:** The docs now correctly lock redirect and shared inspect/OpenAPI provenance, but they still do not fully specify what wins when persisted discovery data and live runtime truth disagree.

**Evidence:**

- [gap-analysis.md](./gap-analysis.md) `G2` raises inspect caching/persistence as an unresolved issue.
- [plan.md](./plan.md) checkpoint `1g` adds refresh-on-read/write for builtin URLs and schemas.
- [runnables-system-layer.md](./runnables-system-layer.md) now says `openapi.json` must share the same provenance as `inspect`, but persisted-versus-live precedence still needs to be specified per target kind.

**Recommendation:**

- use live runtime truth for runnable targets when the runtime is reachable, and refresh persisted discovery from that truth
- use persisted discovery truth for non-runnable targets
- use persisted discovery truth as a fallback only when a runnable target is currently unreachable
- define whether fallback responses need an explicit stale/offline marker

## Open Questions

- Are normalized URIs persisted as the only stored form, or do legacy URI aliases remain first-class?
- What production-data patterns actually exist for legacy nested `service` / `configuration` versus flat normalized fields?
- Do fallback discovery responses need an explicit stale/offline marker when persisted truth is used because a runtime is unreachable?

## Risk Register

- **Drift risk:** runtime `inspect`, persisted revision data, and `openapi.json` can diverge if precedence and refresh rules stay implicit.
- **Migration risk:** removing `service` / `configuration` touches generated SDK clients, stored data, evaluator defaults, and acceptance tests.
- **Compatibility risk:** URI normalization can break lookup, caching, or catalog matching if alias behavior is not designed up front.
- **Operational risk:** redirect-based API-to-services dispatch can still regress auth or streaming if redirect invariants are not specified tightly.
- **SDK recursion risk:** `flags.remote` must be cleared on forwarded requests or the runtime-side SDK can recurse into another remote forward.

## Suggested Next Step

Before implementation starts in earnest, add one short “migration and precedence appendix” to [plan.md](./plan.md) that explicitly records the production-data findings for F1/F2 and the final stale/offline behavior for F3.
