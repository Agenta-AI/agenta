# RFC: Snippet Entity Support on Legacy Application Infrastructure

Status: draft  
Author: TBD  
Last updated: 2026-02-11

## Summary

Define an explicit compatibility contract where `snippet` is supported as an entity concept while current storage/retrieval paths continue to rely on legacy `application` internals.

This RFC is intentionally implementation-specific for this branch.

## Current Implementation Snapshot (Branch Reality)

1. **Entity typing exists today**
`AppType.SNIPPET` is already present and maps to `snippet` as a friendly tag.  
Reference: `api/oss/src/models/shared_models.py:68`

2. **List API exposes snippet filtering**
`GET /apps` accepts `snippets: "exclude" | "include" | "only"` with default `exclude`.  
Reference: `api/oss/src/routers/app_router.py:352`

3. **DB semantics are explicit**
`exclude` filters out `SNIPPET`, `only` filters to `SNIPPET`, `include` applies no type filter.  
Reference: `api/oss/src/services/db_manager.py:1858`

4. **Embed-token aliasing is implemented**
Accepted key families:
- `snippet` and `application`
- `snippet_variant` and `application_variant`
- `snippet_revision` and `application_revision`  
Reference: `api/oss/src/services/embeds_service.py:816`

5. **Legacy fallback behavior exists**
Revision refs can backfill variant ref id/version when variant alias is absent.  
Reference: `api/oss/src/services/embeds_service.py:849`

6. **Retrieval boundary remains app-shaped**
`artifact_ref` is translated into `application_ref` at fetch boundaries.  
Reference: `api/oss/src/services/embeds_service.py:148`

7. **Endpoint UI is app-first in wording and pathing**
Imports and labels still center on app semantics (`Invoke LLM App`, `/apps/[app_id]/...`).  
Reference: `web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/endpoints/index.tsx:11`

## Problem

Behavior is partially snippet-aware but the compatibility contract is implicit. That makes it harder to maintain and risky to evolve.

## Goals

- Keep existing integrations stable.
- Make snippet/application alias behavior explicit and testable.
- Prevent divergence across API, resolver, and UI layers.

## Out of Scope (Current Phase)

- Storage model replacement.
- Breaking API renames.
- Full UI route migration away from `/apps`.

## Compatibility Contract

1. **Artifact concept**
`snippet` is valid as an external entity concept, even when internally backed by application infrastructure.

2. **Listing behavior**
`snippets` query semantics are normative:
- `exclude` (default): return non-snippet apps.
- `include`: return all apps.
- `only`: return only snippets.

3. **Reference behavior**
`@ag.references(...)` accepts both snippet and application alias families and canonicalizes to internal refs.

4. **Legacy fallback behavior**
Revision alias fallback to variant ref remains supported in this phase.

5. **Fetch boundary behavior**
Underlying fetchers continue receiving `application_ref` until boundary refactor is scheduled.

## Snippet Format (Normative for This Branch)

This section defines the concrete snippet embed format and resolution semantics implemented today.

### 1) Where embeds can appear

Embeds are resolved inside a config `params` object via:
- `POST /variants/configs/fetch` with `resolve=true`
- `POST /variants/configs/resolve` with a provided `params` payload  
Reference: `api/oss/src/routers/variants_router.py:786`

Two embed forms are supported:

1. **String embed** inside any string value:

```json
{
  "prompt": "Use this: @ag.references(snippet=Reference(slug=my_snippet) path=params.prompt.messages.0.content)"
}
```

2. **Object embed** as a dict node containing `@ag.references`:

```json
{
  "context": {
    "@ag.references": {
      "snippet": {"slug": "my_snippet"},
      "snippet_variant": {"slug": "prod"}
    },
    "path": "params"
  }
}
```

Reference: `api/oss/src/services/embeds_service.py:194`

### 2) Accepted object-embed payload shape

Inside object embed `{"@ag.references": ...}` the value can be:
- a token string (already in `@ag.references(...)` format), or
- a dict of roles -> reference payloads.

For dict payloads, each role value can be:
- UUID string (treated as `Reference(id=<uuid>)`), or
- object with optional `id`, `slug`, `version`.

Reference: `api/oss/src/services/embeds_service.py:513`

### 3) Token grammar and supported roles

Resolver parses tokens of the shape:

```text
@ag.references(<key>=Reference(id=...,slug=...,version=...) ... [path=<dot.path>])
```

Supported alias key families:
- artifact: `snippet` or `application`
- variant: `snippet_variant` or `application_variant`
- revision: `snippet_revision` or `application_revision`

Token-level `path=...` is supported and used during injection selection.

References:
- `api/oss/src/services/embeds_service.py:688`
- `api/oss/src/services/embeds_service.py:816`

### 4) Path selection precedence

For **object embeds**, injected subpath precedence is:
1. token `path=...`
2. object-level `"path": "..."`
3. default `OBJECT_DEFAULT_PATH = "params"`

For **string embeds**, precedence is:
1. token `path=...`
2. default `STRING_DEFAULT_PATH = "params.prompt.messages.0.content"`

Path parser uses dot-separated segments and numeric list indexes only (no bracket syntax).

References:
- `api/oss/src/services/embeds_service.py:49`
- `api/oss/src/services/embeds_service.py:283`
- `api/oss/src/services/embeds_service.py:771`

### 5) Dereference and resolution flow

Resolver behavior (single call):
1. Find object embeds and string embeds in `params`.
2. Resolve object embeds first (structural replacement).
3. Resolve string embeds next (string substitution).
4. Repeat iteratively until no new canonical embeds are found or limits/policies trigger.

Notes:
- String scanning/replacement is values-only (dict keys are not scanned).
- Object embed replacement replaces the whole node at that path.
- `artifact_ref` is ultimately passed as `application_ref` to store fetchers.

References:
- `api/oss/src/services/embeds_service.py:453`
- `api/oss/src/services/embeds_service.py:566`
- `api/oss/src/services/embeds_service.py:574`
- `api/oss/src/services/embeds_service.py:148`

### 6) Guardrails and error/policy behavior

Defaults:
- `MAX_EMBEDS = 100`
- `MAX_DEPTH = 10`
- policy defaults: `ON_MISSING`, `ON_CYCLE`, `ON_DEPTH` = `PLACEHOLDER`

Default placeholder mode emits non-rescannable placeholders like:
- `<missing:...>`
- `<cycle:...>`
- `<depth:...>`

If policy is switched to `EXCEPTION`, API surfaces 422 with code families:
- `tokens`, `depth`, `cycle`, `missing`

References:
- `api/oss/src/services/embeds_service.py:33`
- `api/oss/src/services/embeds_service.py:598`
- `api/oss/src/routers/variants_router.py:818`

### 7) Output typing behavior

- Object embed injects JSON object/value into the node.
- String embed injects:
  - raw text if selected value is string,
  - JSON-encoded text for non-string selected values.

Reference: `api/oss/src/services/embeds_service.py:338`

### 8) Legacy compatibility behavior (currently intentional)

- `snippet*` and `application*` aliases are both accepted.
- Revision refs can backfill variant refs for older flows.
- Revision ref is accepted even though low-level store fetch currently uses variant/environment boundaries.

Reference: `api/oss/src/services/embeds_service.py:849`

## Implementation Plan

1. **Alias canonicalization as single source of truth**
- Keep `_map_token_to_refs` as the canonical mapper.
- Add/refresh contract tests around each alias family and fallback path.

2. **Preserve router + DB behavior**
- Keep existing `snippets` param and default.
- Clarify expected semantics in docs and API reference text.

3. **UI wording hardening without route breakage**
- Add terminology clarifications where user-facing strings remain app-centric.
- Do not change route shape in this phase.

4. **Observability for deprecation planning**
- Track alias family usage (`snippet*` vs `application*`).
- Track `snippets` filter mode usage.
- Track revision->variant fallback usage frequency.

## Contract Examples

```text
GET /apps?snippets=only
```

Expected: records where `app_type == SNIPPET`.

```text
@ag.references(snippet=Reference(slug=my_snippet) snippet_variant=Reference(slug=prod))
@ag.references(application=Reference(slug=my_snippet) application_variant=Reference(slug=prod))
```

Expected: both resolve to equivalent internal `artifact_ref` + `variant_ref`.

## Risks

- Dual terminology may stay ambiguous longer than desired.
- Legacy fallback can mask malformed references.
- UI naming can imply stricter app semantics than intended.

## Mitigations

- Keep explicit contract docs + tests in sync.
- Instrument fallback usage before any deprecation.
- Prefer “snippet” in new copy while preserving transport compatibility.

## Rollout

1. Land this contract in docs.
2. Add/refresh alias and list-filter behavior tests.
3. Add minimal telemetry for alias and fallback usage.
4. Revisit deprecation policy after usage data.

## Open Questions

- Should `snippets` default stay `exclude`, or move to `include` later?
- Should API responses expose explicit snippet/app provenance metadata?
- When should revision-only fallback become strict instead of permissive?
- Which SDK versions need compatibility notices before deprecation warnings?
