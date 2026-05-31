# Tasks — git-backed entities

## Open

- [x] **Unified variant fork request shape**: all six entities now have `<Entity>VariantForkRequest(<Entity>ForkRequest)` — a named subclass of the artifact-level request with the same single `<entity>: <Entity>Fork` field. Old flat `EvaluatorVariantForkRequest` (source_/target_ shape) and `QueryVariantForkRequest` replaced. All six `/variants/fork` handlers updated to use `*VariantForkRequest`.

- [ ] **Fork parity — artifact level**: add `POST /<entities>/{id}/fork` to `queries`, `testsets`, and `environments` so all six git-backed entities have artifact-level fork. Requires `QueryFork` / `TestsetFork` / `EnvironmentFork` DTOs + `QueryForkRequest` / `TestsetForkRequest` / `EnvironmentForkRequest` models + router handlers + service methods.

- [ ] **Fork parity — variant level**: add `POST /<entities>/variants/fork` to all six git-backed entities. Currently only evaluators and queries have it; workflows, applications, testsets, and environments are missing it.

  **What exists already** (can be used as-is or as the pattern):
  - `WorkflowVariantFork(VariantFork)` + `WorkflowVariantForkAlias` in `core/workflows/dtos.py`
  - `ApplicationVariantFork(WorkflowVariantFork)` + `ApplicationVariantForkAlias` in `core/applications/dtos.py`
  - `QueryVariantFork(VariantFork)` + `QueryVariantForkAlias` in `core/queries/dtos.py`

  **What needs to be created**:
  - `EvaluatorVariantFork(VariantFork)` + `EvaluatorVariantForkAlias` in `core/evaluators/dtos.py` — the existing `EvaluatorVariantForkRequest` is marked `# TODO: FIX ME` and uses a flat `source_` / `target_` shape instead of a typed DTO.
  - `TestsetVariantFork(VariantFork)` + `TestsetVariantForkAlias` in `core/testsets/dtos.py`
  - `EnvironmentVariantFork(VariantFork)` + `EnvironmentVariantForkAlias` in `core/environments/dtos.py`

  **Request model shape** — replace the current ad-hoc `source_<entity>_variant_ref` + `target_<entity>_ref` flat fields with a typed wrapper, matching the artifact-level Fork pattern:
  ```
  <Entity>VariantForkRequest:
      <entity>_variant_fork: <Entity>VariantFork    # typed DTO carrying slug, name, description, flags
      <entity>_variant_ref:  Reference              # variant to fork from
      <entity>_ref:          Reference              # artifact that will receive the new variant
  ```

  **Remaining work per entity**:
  - `workflows`: DTO exists; add `WorkflowVariantForkRequest` model + router handler + service method.
  - `applications`: DTO exists; add `ApplicationVariantForkRequest` model + router handler + service method.
  - `evaluators`: replace `EvaluatorVariantForkRequest` (remove `# TODO: FIX ME`); add `EvaluatorVariantFork` DTO + router handler + service method.
  - `queries`: DTO exists; replace `QueryVariantForkRequest` flat shape with typed wrapper; add router handler + service method.
  - `testsets`: create `TestsetVariantFork` DTO + `TestsetVariantForkRequest` model + router handler + service method.
  - `environments`: create `EnvironmentVariantFork` DTO + `EnvironmentVariantForkRequest` model + router handler + service method.

- [x] **Dropped `resolve: bool` from all Revision-level Query endpoints** (applications, evaluators, environments models + routers). Partial-resolution failures on a list of revisions are undetectable and silently corrupt results — `resolution_info.errors` only works on single-revision `/retrieve`. Use `/revisions/retrieve` with `resolve: true` for per-revision observable resolution.

- [x] **Added inline-resolve mode to all entities with `/revisions/resolve`**: `application_revision`, `evaluator_revision`, `environment_revision` fields added to the respective `*RevisionResolveRequest` models, services, and routers — matching the existing `workflow_revision` pattern. Services check `embeds_service` once at the top (covers both branches). Only current SDK caller is via `/workflows/revisions/resolve`; other entities' inline mode is now available.

- [x] **Renamed `application_refs` → `references` on `EnvironmentRevisionQueryRequest`** (model + router + web). Service/DAO internal name stays `application_refs`; only the request body field is renamed. Web caller in `web/packages/agenta-entities/src/environment/api/api.ts` updated.

- [ ] **Create / Edit / Query wrappers drop the verb**: `WorkflowCreateRequest` → `workflow` (not `workflow_create`). Large blast radius to fix uniformly — all clients and docs would need updating. Document as deliberate exception or schedule unification?

## Done

- [x] **Fork parity — artifact level**: `QueryForkRequest`, `TestsetForkRequest`, `EnvironmentForkRequest` + DTOs (`TestsetFork`, `EnvironmentFork`) + service methods + router endpoints added. All six entities now have `POST /variants/fork`.
- [x] **Fork parity — variant level (queries)**: `QueryForkRequest` wired to existing `fork_query_variant` service + router endpoint added.
- [x] **Fork parity — variant level (testsets, environments)**: `TestsetFork`/`EnvironmentFork` DTOs + service methods + `TestsetForkRequest`/`EnvironmentForkRequest` models + router endpoints added.

---

## Previously done

- [x] Commit wrapper field unified to `<entity>_revision: <Entity>RevisionCommit` across all 6 entities (models, routers, tests, SDK, web)
- [x] Log wrapper field unified to `<entity>_revisions: <Entity>RevisionsLog` across all 6 entities (models, routers, tests, SDK, web)
- [x] `RetrievalInfo` moved from router layer to `core/git/` (PR #4469)
- [x] Full environment references (env triple + target triple) surfaced in retrieve responses and forwarded into traces (PR #4469)
