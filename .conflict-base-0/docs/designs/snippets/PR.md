# PR Draft: Snippets + Legacy Applications (Entity-Specific Design Pass)

Status: draft  
Last updated: 2026-02-11

## Title

`chore(docs): define snippet/application compatibility contract for legacy-backed entities`

## Why

This branch already contains snippet-aware behavior in multiple code paths, but the contract is implicit and spread across router/service/UI layers.

This PR documents the implementation reality and proposed compatibility contract before further code changes.

## What Changed in This PR

- Added design docs under `docs/designs/snippets/`.
- Tightened `RFC.md` to be implementation-specific with concrete file-level behavior.
- Added explicit snippet format contract in RFC (embed shapes, token grammar, path precedence, resolution flow, guardrails).
- Kept `PRD.md` intentionally higher-level for later product iteration.

## Files Added/Updated

- `docs/designs/snippets/README.md`
- `docs/designs/snippets/PRD.md`
- `docs/designs/snippets/RFC.md`
- `docs/designs/snippets/PR.md`

## Implementation Evidence Captured in RFC

1. **Type system**
`AppType.SNIPPET` exists and is tagged as `snippet`.  
Source: `api/oss/src/models/shared_models.py:68`

2. **API surface**
`GET /apps` accepts `snippets=exclude|include|only` (default `exclude`).  
Source: `api/oss/src/routers/app_router.py:352`

3. **DB behavior**
`exclude` and `only` are implemented as explicit `AppType.SNIPPET` filters.  
Source: `api/oss/src/services/db_manager.py:1858`

4. **Resolver aliasing**
Embed references support snippet/application alias pairs across artifact, variant, and revision keys.  
Source: `api/oss/src/services/embeds_service.py:816`

5. **Legacy fallback**
Revision references may backfill variant references for compatibility.  
Source: `api/oss/src/services/embeds_service.py:849`

6. **Boundary detail**
Internal fetch boundaries still pass `artifact_ref` as `application_ref`.  
Source: `api/oss/src/services/embeds_service.py:148`

7. **UI behavior**
Endpoint code snippet generation is functionally compatible but still app-first in route/copy.  
Source: `web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/endpoints/index.tsx:11`

8. **Format + resolver contract**
RFC now documents exact snippet format and embed dereferencing behavior used by `/variants/configs/fetch` and `/variants/configs/resolve`.  
Source: `api/oss/src/routers/variants_router.py:786`

## Scope of This PR

- Documentation and design alignment only.
- No runtime logic changes.
- No API schema changes.

## Suggested Follow-Up Code PRs (Separate)

1. Add contract tests for alias mapping and fallback behavior.
2. Add telemetry around alias family usage and fallback-path usage.
3. Harden user-facing naming in UI copy where safe, without breaking routes.

## Reviewer Checklist

- Validate that RFC accurately reflects current branch implementation.
- Confirm compatibility contract matches intended near-term behavior.
- Confirm open questions are the right ones before implementation PRs.

## Open Questions

- Should `snippets` default stay `exclude` or eventually move to `include`?
- Should revision-only alias fallback remain permissive or become strict over time?
- Which SDK/client versions require explicit compatibility/deprecation communication?
- What is the minimum telemetry period before deciding on deprecation milestones?
