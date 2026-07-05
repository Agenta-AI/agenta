# Tasks — git-backed entities

## Open

- [x] **Unified variant fork request shape**: all six entities now have `<Entity>VariantForkRequest(<Entity>ForkRequest)` — a named subclass of the artifact-level request with the same single `<entity>: <Entity>Fork` field. Old flat `EvaluatorVariantForkRequest` (source_/target_ shape) and `QueryVariantForkRequest` replaced. All six `/variants/fork` handlers updated to use `*VariantForkRequest`.

- [ ] **Fork parity — artifact level**: add `POST /<entities>/{id}/fork` to all six git-backed entities so artifact-level fork matches the variant-level surface. No entity has this route yet (only `/variants/fork` is wired). Requires `QueryFork` / `TestsetFork` / `EnvironmentFork` DTOs + `QueryForkRequest` / `TestsetForkRequest` / `EnvironmentForkRequest` models + router handlers + service methods.

- [x] **Dropped `resolve: bool` from all Revision-level Query endpoints** (applications, evaluators, environments models + routers). Partial-resolution failures on a list of revisions are undetectable and silently corrupt results — `resolution_info.errors` only works on single-revision `/retrieve`. Use `/revisions/retrieve` with `resolve: true` for per-revision observable resolution.

- [x] **Added inline-resolve mode to all entities with `/revisions/resolve`**: `application_revision`, `evaluator_revision`, `environment_revision` fields added to the respective `*RevisionResolveRequest` models, services, and routers — matching the existing `workflow_revision` pattern. Services check `embeds_service` once at the top (covers both branches). Only current SDK caller is via `/workflows/revisions/resolve`; other entities' inline mode is now available.

- [x] **Renamed `application_refs` → `references` on `EnvironmentRevisionQueryRequest`** (model + router + parse/merge helpers in `environments/utils.py` + service param + web). Only deep internal DAO-diff helpers keep entity-specific names. Web caller in `web/packages/agenta-entities/src/environment/api/api.ts` updated.

- [ ] **Create / Edit / Query wrappers drop the verb**: `WorkflowCreateRequest` → `workflow` (not `workflow_create`). Large blast radius to fix uniformly — all clients and docs would need updating. Document as deliberate exception or schedule unification?

## Done

- [x] **Fork parity — variant level (all six)**: `*VariantForkRequest` models + `*VariantFork` DTOs + service methods + router endpoints added. All six entities now have `POST /<entities>/variants/fork`. (Artifact-level `POST /<entities>/{id}/fork` remains open — see above.)
- [x] **Fork parity — variant level (queries)**: `QueryForkRequest` wired to existing `fork_query_variant` service + router endpoint added.
- [x] **Fork parity — variant level (testsets, environments)**: `TestsetFork`/`EnvironmentFork` DTOs + service methods + `TestsetForkRequest`/`EnvironmentForkRequest` models + router endpoints added.

---

## Previously done

- [x] Commit wrapper field unified to `<entity>_revision: <Entity>RevisionCommit` across all 6 entities (models, routers, tests, SDK, web)
- [x] Log wrapper field unified to `<entity>_revisions: <Entity>RevisionsLog` across all 6 entities (models, routers, tests, SDK, web)
- [x] `RetrievalInfo` moved from router layer to `core/git/` (PR #4469)
- [x] Full environment references (env triple + target triple) surfaced in retrieve responses and forwarded into traces (PR #4469)
