# PR 4117 Synced Findings

> PR: `Agenta-AI/agenta#4117` (`[feat] Migrate workflows, registries, and playgrounds`)
> Branch: `frontend-feat/evaluator-playground-integration`
> Base: `release/v0.96.0`
> Head synced: `a0fec101a`
> Synced on: `2026-04-07`
> Previous record: PR 4022 (`feat/extend-runnables`, synced `2026-03-31`, all findings closed)

## Sources

- Local review: `docs/designs/runnables/CR.md` (PR 4022)
- Remote PR 4022: `https://github.com/Agenta-AI/agenta/pull/4022` (closed, historical)
- Remote PR 4117: `https://github.com/Agenta-AI/agenta/pull/4117`
- Copilot review threads on PR 4117 through `2026-04-07`

## Sync Summary

- This file is the canonical synced findings record, updated from PR 4022 to PR 4117.
- PR 4022 findings are fully closed and preserved in the Closed Findings section below.
- PR 4117 (`[feat] Migrate workflows, registries, and playgrounds`) targets `release/v0.96.0` and covers the frontend migration, evaluator playground integration, workflow catalog, tracing hashes, and evaluation runtime locking.
- Copilot reviewed 88 of 1261 changed files and generated 7 review threads:
  - Thread `3043605385`: `ground_truth_key` Copilot concern — no frontend consumer exists; only dead backend code used this flag. Promoted to **F25**, closed as `stale`.
  - Thread `3043605455`: `application_refs` adapter O(n²) membership test — fixed by switching to a `seen_dbe_ids` set. Promoted to **F26**, now `fixed`.
  - Thread `3043605474`: `retrieve_environment_revision` logs at INFO on every call — previously noted in CR.md but not promoted; now has an explicit thread. Promoted to **F27**.
  - Thread `3043605492`: `.pre-commit-config.yaml` switches to `language: system` — addresses the open question from PR 4022. Promoted to **F28**.
  - Thread `3043605526`: `log.warn` deprecated in favor of `log.warning` in `live.py:720` — previously noted (PR 4022 thread `3017096701`), still not promoted; updated in Notes.
  - Threads `3043605546` + `3043605562`: Workflow catalog `_catalog` lazy init at `catalog.py:138,157` is not thread-safe — a new gap in the F21 fix. Promoted to **F29**.
- PR 4022 open questions carried forward:
  - SDK export compatibility (`agenta.sdk.types`, removed `config` export) — still unresolved policy.
  - Tracing API contract changes (`POST /traces` now 202, `PUT /traces/{trace_id}`) — still unresolved policy.
  - Pre-commit reproducibility concern promoted from open question to F28 given the explicit PR 4117 thread.

## Rules

- `findings.md` is the canonical synced findings record for this PR path.
- All non-findings sections stay above `Open Findings` so context and policy are visible before the finding list.
- GitHub review threads are only replied to and resolved when the corresponding finding is clearly closed.

## Notes

- PR 4022 findings are fully closed. The PR 4022 review was against `feat/extend-runnables` on `origin/main`.
- PR 4117 targets `release/v0.96.0` with `frontend-feat/evaluator-playground-integration` as the frontend migration and evaluator playground follow-on.
- `log.warn(...)` in `live.py:720` (PR 4117 thread `3043605526`, also PR 4022 thread `3017096701`) flags a real Python deprecation. The standard call is `log.warning()`. Not promoted to a finding; treat as style cleanup during any edit of that file.
- Copilot suppressed one low-confidence comment about `evaluator_query` variable reuse in `api/oss/src/core/evaluators/service.py` — naming confusion between the loop variable and a constructed `SimpleEvaluator`. Not promoted; clean up if touching that scope.
- PR 4022 historical notes (annotation NameError, lock-key packing, missing-environment-revision, absolute local filesystem links) remain accurate for that branch and are preserved in the closed findings section below.

## Open Questions

- Should SDK export compatibility be preserved for `agenta.sdk.types` and the removed `config` export, or is that public export break intentional for this release?
- Should the tracing API contract changes (`POST /traces` now `202`, added `PUT /traces/{trace_id}`, legacy span-route changes) be treated as accepted migration-scope breaks and tracked in backlog, or should this branch preserve backward-compatible behavior?

## Open Findings

## Closed Findings

### [CLOSED] F29. Workflow catalog lazy init thread-safety

- Severity: `P2`
- Confidence: `medium`
- Status: `wontfix`
- Category: `Correctness`, `Robustness`
- Summary: Module-level `_catalog` lazy init is not guarded against concurrent builds. Deferred — acceptable under the current forked-worker process model; revisit if the process model changes.
- Sources:
  - PR threads `3043605546`, `3043605562`
  - Closed finding F21 (PR 4022)

### [CLOSED] F28. `.pre-commit-config.yaml` `language: system` reproducibility

- Severity: `P3`
- Confidence: `high`
- Status: `wontfix`
- Category: `Compatibility`, `Process`
- Summary: Pre-commit hooks now use `language: system` instead of pinned upstream hooks. Accepted as-is for now.
- Sources:
  - PR thread `3043605492`

### [CLOSED] F27. `retrieve_environment_revision` INFO logs on high-frequency path

- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Performance`, `Maintainability`
- Summary: All 5 `log.info` calls inside `retrieve_environment_revision` commented out.
- Evidence:
  - `api/oss/src/core/environments/service.py:590-672`
- Files:
  - `api/oss/src/core/environments/service.py`
- Sources:
  - PR thread `3043605474`

### [CLOSED] F26. `application_refs` adapter O(n²) membership test

- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Performance`
- Summary: The `application_refs` post-fetch filtering adapter used `if dbe not in filtered_dbes` (list membership, O(n)) inside nested loops. Fixed by tracking seen revision IDs in a `seen_dbe_ids: set[UUID]` and guarding with `if dbe.id not in seen_dbe_ids`.
- Evidence:
  - `api/oss/src/dbs/postgres/git/dao.py:1294-1333`
- Files:
  - `api/oss/src/dbs/postgres/git/dao.py`
- Cause: Deduplication guard used list membership rather than set membership.
- Suggested Fix: None.
- Sources:
  - PR thread `3043605455`
  - Closed finding F15 (PR 4022)

### [CLOSED] F25. `ground_truth_key` Copilot concern — stale

- Severity: `P3`
- Confidence: `low`
- Status: `stale`
- Category: `Compatibility`
- Summary: Copilot flagged the removal of `ground_truth_key: True` from evaluator schemas as a potential frontend regression. Investigation found no frontend consumer of this flag. The only backend consumers were `db_manager.add_default_simple_evaluators()` (dead code, never called) and a historical data migration. The active evaluator seeding path (`defaults.py`) does not use the flag. The frontend reads `correct_answer_key` from evaluator settings values, not from the schema flag. No action needed.
- Sources:
  - PR thread `3043605385`
  - Closed finding F14 (PR 4022)

### [CLOSED] F23. Default evaluator bootstrap masks real failures behind broad exception handling

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Robustness`
- Summary: Default evaluator bootstrap now treats duplicate-create conflicts as idempotent success while allowing real failures to surface.
- Evidence:
  - `api/oss/src/core/evaluators/defaults.py:175-225`
  - `api/oss/tests/pytest/unit/evaluators/test_defaults.py`
- Files:
  - `api/oss/src/core/evaluators/defaults.py`
  - `api/oss/tests/pytest/unit/evaluators/test_defaults.py`
- Cause: `create_default_evaluators()` had wrapped the full create path in `except Exception`, collapsing duplicate collisions and genuine failures into the same warning path.
- Explanation: The bootstrap path now handles `EntityCreationConflict` explicitly as the idempotent duplicate case and re-raises unexpected exceptions after logging them with stack context.
- Impact: Repeated bootstrap runs stay quiet and safe, while real default-evaluator failures are no longer silently downgraded into warning-only behavior.
- Suggested Fix: None.
- Alternatives: Reintroduce a pre-create existence check, but that is not required once duplicate conflicts are handled explicitly.
- Sources:
  - PR threads `3017323130`, `3017323163`, `3017323235`, `3017323290`, `3017323352`

### [CLOSED] F24. Trace-type propagation helper reorders spans in mixed-trace batches

- Severity: `P2`
- Confidence: `medium`
- Status: `fixed`
- Category: `Correctness`, `Robustness`
- Summary: Trace-type inference now preserves the original span order while still propagating the inferred trace type per trace.
- Evidence:
  - `api/oss/src/core/tracing/utils/trees.py:89-132`
  - `api/oss/tests/pytest/unit/tracing/utils/test_trees.py`
- Files:
  - `api/oss/src/core/tracing/utils/trees.py`
  - `api/oss/tests/pytest/unit/tracing/utils/test_trees.py`
- Cause: The helper used to rebuild the output list by grouped trace buckets instead of annotating spans in original order.
- Explanation: The function now computes trace type per `trace_id` first and then mutates the original `span_dtos` sequence in place, so mixed-trace batches keep their input order.
- Impact: Ordering-sensitive consumers no longer observe a grouped reorder as a side effect of trace-type inference.
- Suggested Fix: None.
- Alternatives: Document order instability explicitly, but preserving input order is the stronger contract.
- Sources:
  - PR threads `2960191266`, `2960191298`, `2960191323`, `2960191348`, `2969327992`, `2969327996`, `2969328001`

### [CLOSED] F19. Cached evaluator reuse could skip repeats if selected cached trace entries were unusable

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Robustness`
- Summary: Reuse selection used to count raw cached trace entries before filtering unusable ones, which could skip fallback invocation for later repeats if malformed cached entries leaked through.
- Evidence:
  - `api/oss/src/core/evaluations/utils.py:311-327`
  - `api/oss/tests/pytest/unit/evaluations/test_cache_split_utils.py`
- Files:
  - `api/oss/src/core/evaluations/utils.py`
  - `api/oss/tests/pytest/unit/evaluations/test_cache_split_utils.py`
- Cause: `select_traces_for_reuse()` sliced the queried traces without first dropping entries missing `trace_id`.
- Explanation: Under the intended contract, reusable traces should have `trace_id`. The helper now enforces that defensive assumption directly, so later valid cached traces are still reused and fallback invocation counts stay aligned.
- Impact: Cached reuse no longer undercounts fallback work when malformed cached entries are present.
- Suggested Fix: None.
- Alternatives: None.
- Sources:
  - PR thread `3016391790`

### [CLOSED] F14. Evaluator schema key migration is deferred to catalog and migration backlog

- Severity: `P2`
- Confidence: `high`
- Status: `wontfix`
- Category: `Compatibility`, `Migration`
- Summary: `ground_truth_key` removal and `advanced` -> `x-ag-ui-advanced` are no longer treated as active branch defects; the remaining work is scoped to catalog/web integration and migration follow-up.
- Evidence:
  - `api/oss/src/resources/evaluators/evaluators.py`
  - `web/packages/agenta-entities/src/workflow/state/evaluatorUtils.ts:457`
  - `web/packages/agenta-entities/src/workflow/state/molecule.ts:579`
  - `docs/designs/runnables/gap.catalog.md`
  - `docs/designs/runnables/gap.migrations.md`
- Files:
  - `api/oss/src/resources/evaluators/evaluators.py`
  - `docs/designs/runnables/gap.catalog.md`
  - `docs/designs/runnables/gap.migrations.md`
- Cause: The branch intentionally adopted the new catalog contract without preserving the old keys, and the remaining consumer work belongs to dedicated catalog/migration scope rather than this findings loop.
- Explanation: If the new contract turns into a real bug during active catalog/web or migration work, reopen it there as a concrete scoped defect instead of carrying a generic open finding on this branch.
- Impact: The current branch does not restore backward compatibility for the removed keys; follow-up work is now explicit backlog rather than an active unresolved finding.
- Suggested Fix: Handle consumer alignment in `gap.catalog.md` and `gap.migrations.md`; reopen only if an actual integration bug is reproduced.
- Alternatives: Reintroduce compatibility keys now, but that is not the chosen approach.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2983188635`, `2984134999`

### [CLOSED] F20. Application deploy now uses `retrieve_environment_revision(...)`

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Compatibility`
- Summary: The applications deploy endpoint now uses the retrieval path that resolves refs and follows the newer environment-revision lookup contract.
- Evidence:
  - `api/oss/src/apis/fastapi/applications/router.py:1047-1055`
  - `api/oss/src/core/environments/service.py:573-671`
  - `api/oss/tests/pytest/unit/applications/test_router.py`
- Files:
  - `api/oss/src/apis/fastapi/applications/router.py`
  - `api/oss/tests/pytest/unit/applications/test_router.py`
- Cause: The deploy flow had still been calling the older fetch helper directly.
- Explanation: The deploy handler now routes through `retrieve_environment_revision(...)`, and the unit test asserts that `fetch_environment_revision(...)` is no longer used for this path.
- Impact: Deploy lookup now matches the retrieval semantics expected by the rest of the branch.
- Suggested Fix: None.
- Alternatives: None.
- Sources:
  - PR thread `3016846345`

### [CLOSED] F21. Workflow catalog now loads lazily and computes metadata once per build

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Performance`, `Maintainability`
- Summary: Workflow catalog loading no longer does eager import-time construction with per-entry metadata recomputation.
- Evidence:
  - `api/oss/src/resources/workflows/catalog.py`
  - `api/oss/tests/pytest/unit/workflows/test_catalog_registry.py`
  - `api/oss/tests/pytest/unit/workflows/test_catalog_lazy_loader.py`
- Files:
  - `api/oss/src/resources/workflows/catalog.py`
  - `api/oss/tests/pytest/unit/workflows/test_catalog_lazy_loader.py`
- Cause: The previous module-global list built the catalog eagerly and recalculated evaluator metadata inside the comprehension.
- Explanation: Catalog construction is now lazy, cached once per process, and computes the evaluator metadata map once per build rather than once per entry.
- Impact: Startup avoids the unnecessary eager catalog build, and catalog construction cost is no longer quadratic in the number of entries due to metadata recomputation.
- Suggested Fix: None.
- Alternatives: None.
- Sources:
  - PR threads `3016846423`, `3016980136`, `3017096727`

### [CLOSED] F22. Evaluation request models removed `jit` intentionally

- Severity: `P3`
- Confidence: `high`
- Status: `wontfix`
- Category: `Compatibility`, `Migration`
- Summary: Evaluation request models no longer accept `jit`, and that contract break is intentional.
- Evidence:
  - `api/oss/src/apis/fastapi/evaluations/models.py:87-102`
  - `api/oss/src/apis/fastapi/evaluations/models.py:318-329`
- Files:
  - `api/oss/src/apis/fastapi/evaluations/models.py`
- Cause: The legacy compatibility shim for `jit` was removed as part of the intended contract cleanup.
- Explanation: The no-backward-compatibility policy was confirmed explicitly, so clients that still send `jit` are out of contract and this branch will not preserve the old request shape.
- Impact: Older clients can fail validation with `422`, but that is an accepted contract break rather than an unintended regression for this rollout.
- Suggested Fix: None.
- Alternatives: Reintroduce an ignored compatibility shim temporarily, but that is not the chosen policy.
- Sources:
  - PR thread `3017096638`

### [CLOSED] F15. Git DAO applies `application_refs` filtering after DB fetch

- Severity: `P2`
- Confidence: `high`
- Status: `wontfix`
- Category: `Performance`, `Correctness`
- Summary: `application_refs` filtering remains a Python-side post-fetch adapter because the current web UX/UI wants history grouped by application and only wants entries where that grouping changes.
- Evidence:
  - `api/oss/src/dbs/postgres/git/dao.py:1281-1327`
- Files:
  - `api/oss/src/dbs/postgres/git/dao.py`
- Cause: The current frontend view still depends on application-grouped diff behavior that is not part of the canonical persistence contract.
- Explanation: This is an intentional temporary adapter for the current web UX/UI. It should not live in the DAO long-term, but the plan is not to move it elsewhere; the plan is to remove it once the frontend no longer depends on this behavior. The DAO code is now explicitly commented as temporary adapter logic, and the non-dict `application` case is guarded.
- Impact: Pagination semantics remain adapter-driven for this path until the frontend changes, but the current intent and removal direction are now explicit.
- Suggested Fix: Remove the adapter when the frontend no longer needs application-grouped diff history; do not migrate this behavior deeper into the persistence layer.
- Alternatives: Move the adapter to a higher layer temporarily, but that is not the chosen path because the expected transition is direct removal.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2983188658`, `2984134983`, `2991025273`, `3016846465`, `3016980223`

### [CLOSED] F7. Runnable docs still contained stale discovery-contract language

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Consistency`, `Maintainability`
- Summary: Runnable design docs and one legacy helper path were still describing or depending on per-route `openapi.json` or API-owned application/evaluator inspect routes even though the target contract is persisted revision truth first with `/inspect` as the live fallback.
- Evidence:
  - `docs/designs/runnables/runnables-subsystem-layer.md`
  - `docs/designs/runnables/runnables-component-layer.md`
  - `docs/designs/runnables/gap-analysis.md`
  - `docs/designs/runnables/README.md`
  - `docs/designs/runnables/design-review.md`
  - `docs/designs/runnables/plan.G18.md`
  - `docs/designs/runnables/plan.GFlags.md`
  - `api/oss/src/services/llm_apps_service.py`
- Files:
  - `docs/designs/runnables/runnables-subsystem-layer.md`
  - `docs/designs/runnables/runnables-component-layer.md`
  - `docs/designs/runnables/gap-analysis.md`
  - `docs/designs/runnables/README.md`
  - `docs/designs/runnables/design-review.md`
  - `docs/designs/runnables/plan.G18.md`
  - `docs/designs/runnables/plan.GFlags.md`
  - `api/oss/src/services/llm_apps_service.py`
- Cause: Older design material and one legacy runtime-parameter extraction path still assumed OpenAPI was part of the target runtime discovery contract.
- Explanation: The remaining docs were updated to one contract: no per-route `openapi.json`, no new API-owned application/evaluator invoke/inspect routes, persisted revision/query truth first, and `/inspect` used only for live discovery fallback. The legacy runtime parameter extraction helper now reads `/inspect` instead of runtime `openapi.json`.
- Impact: Implementers and reviewers now have one consistent discovery story across the design set and the touched runtime helper.
- Suggested Fix: None.
- Alternatives: None.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2948797791`, `2948797838`, `2949000437`, `2952354703`, `2952354726`, `2954804833`, `2954804871`, `2956985931`, `2962186277`, `2962294682`, `2962294716`, `2964630533`, `2964630562`, `2964630579`

### [CLOSED] F1. Migration framing no longer matches the branch's actual mixed expand/contract behavior

- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Completeness`, `Migration`
- Summary: The runnable plans still present checkpoint 1 as expand-only, while the branch already removes or contracts multiple legacy public surfaces.
- Evidence:
  - `docs/designs/runnables/plan.md:7-18`
  - `docs/designs/runnables/gap.GMigrations.md:1-36`
  - `api/entrypoints/routers.py:523-848`
- Files:
  - `docs/designs/runnables/plan.md`
  - `docs/designs/runnables/gap.GMigrations.md`
  - `api/entrypoints/routers.py`
- Cause: The code rollout and the documented rollout strategy diverged.
- Explanation: Legacy route families are already gone or contracted, and the primary plan and migration backlog now describe checkpoint 1 as mixed expand/contract with explicit migration obligations.
- Impact: Review, migration, and compatibility work can be mis-scoped or missed entirely.
- Suggested Fix: Reframe checkpoint 1 as mixed expand/contract and explicitly track intentional breaks as migration work.
- Alternatives: Restore legacy compatibility shims temporarily, but only if that matches the actual rollout plan.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2954804958`, `2954805038`, `2956986020`, `2956986030`, `2960191383`, `2962186091`, `2964630612`, `2964630626`, `2965828569`

### [CLOSED] F3. Evaluator schema hydration can erase hydrated outputs during merge

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Hydrated `schemas.outputs` can be overwritten by sparse stored `schemas` during normalization.
- Evidence:
  - `api/oss/src/core/evaluators/service.py:957-987`
- Files:
  - `api/oss/src/core/evaluators/service.py`
- Cause: The merge overlays existing stored data after hydration rather than preserving repaired fields.
- Explanation: Builtin evaluator schema parts that are inferred are now reapplied as inferred truth during normalization instead of being overwritten by sparse stored `schemas`.
- Impact: Builtin evaluators can remain schema-incomplete and downstream consumers can observe inconsistent behavior.
- Suggested Fix: Keep inferred evaluator schema parts black-or-white: if a part is inferred for that evaluator kind, reapply the inferred value during normalization instead of trusting stored overrides.
- Alternatives: None.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2965828550`, `2971482846`

### [CLOSED] F4. Application flags no longer enforce `is_evaluator=False`

- Severity: `P2`
- Confidence: `high`
- Status: `wontfix`
- Category: `Correctness`, `Consistency`
- Summary: Some SDK/API wording and creation paths still implied that application DTOs should force `is_evaluator=False`, but the intended contract is to rely on the default-false behavior instead of writing `False` explicitly.
- Evidence:
  - `api/oss/src/core/applications/dtos.py:84-99`
- Files:
  - `api/oss/src/core/applications/dtos.py`
- Cause: Earlier review framing treated default-false booleans as invariants that should be actively normalized.
- Explanation: The intended rule is that these flags default to `False` unless explicitly set; the SDK/API wording and application-creation code now reflect that instead of forcing explicit false values.
- Impact: Forcing `False` would add misleading normalization and blur which flags the caller actually supplied.
- Suggested Fix: Do not write explicit false values in application creation paths, and document that the default is false.
- Alternatives: None.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2962186164`, `2962294547`, `2964690962`, `2964690972`, `2991933141`, `3016980197`

### [CLOSED] F5. Workflow catalog metadata overrides still mishandle explicit `False` and sparse flags

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Robustness`
- Summary: Catalog enrichment still uses `or` for boolean overrides and direct indexing for inherited flags.
- Evidence:
  - `api/oss/src/resources/workflows/catalog.py:29-37`
  - `api/oss/src/resources/workflows/catalog.py:54-60`
  - `api/oss/tests/pytest/unit/workflows/test_catalog_registry.py`
- Files:
  - `api/oss/src/resources/workflows/catalog.py`
- Cause: Boolean override logic treats `False` as absent, and inherited flags are assumed complete.
- Explanation: The catalog code now uses safe inherited-flag defaults and `is not None` override semantics, so explicit `False` overrides and sparse flag payloads no longer misbehave.
- Impact: Catalog rows can report the wrong archival/recommended state and sparse data can fail unexpectedly.
- Suggested Fix: Use `.get(..., False)` for inherited flags and `is not None` semantics for metadata overrides.
- Alternatives: Normalize flags through a dedicated typed helper before enrichment.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2962294573`, `2964690925`, `2964690953`, `2969327983`, `2969327989`, `2983188509`, `2984134965`, `2991025226`, `3016391904`

### [CLOSED] F6. Invocation query path filters invocation traces as evaluators

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `InvocationsService.query()` seeds `is_evaluator=True`, which can filter out the invocation traces it is supposed to return.
- Evidence:
  - `api/oss/src/core/invocations/service.py:435`
  - `api/oss/src/core/invocations/service.py:706-715`
- Files:
  - `api/oss/src/core/invocations/service.py`
- Cause: Query flags are initialized with evaluator semantics rather than invocation semantics.
- Explanation: Invocation traces created by `_create_invocation()` do not set `is_evaluator=True`.
- Impact: If the compatibility invocation router is remounted, query behavior will be wrong.
- Suggested Fix: Use the trace-kind and links-based definition for invocation versus annotation, and stop seeding query filters with evaluator flags.
- Alternatives: Split invocation-specific filtering into a dedicated query DTO and mapper.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2949000394`, `2960190986`, `2962186211`, `2962294499`, `2965208073`

### [CLOSED] F8. `llm_apps_service` logs credentials in a curl command

- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Security`
- Summary: The service logs a curl command containing the plaintext `Authorization` header.
- Evidence:
  - `api/oss/src/services/llm_apps_service.py:247-263`
- Files:
  - `api/oss/src/services/llm_apps_service.py`
- Cause: Debug logging includes the full header dict without redaction.
- Explanation: Current HEAD no longer shows an active curl log call, and the curl-format helper now redacts sensitive headers so future reuse does not reintroduce the leak.
- Impact: This is an active credential-leak surface.
- Suggested Fix: Redact or drop sensitive headers before logging and keep only non-sensitive request metadata.
- Alternatives: Gate full request logging behind an explicit secure debug mode with redaction.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2984134903`

### [CLOSED] F9. Annotation edit response can diverge from persisted references and links

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `annotations/service.py` forwards edited references and links to persistence but returns the pre-edit values in the response.
- Evidence:
  - `api/oss/src/core/annotations/service.py`
- Files:
  - `api/oss/src/core/annotations/service.py`
- Cause: The response object is built from the pre-edit fetch rather than the edited values.
- Explanation: Persisted state and returned state can diverge.
- Impact: Callers cannot trust the edit response to represent the post-edit entity.
- Suggested Fix: Treat annotation references and links as mutable and return the edited values in the response after applying evaluator-reference normalization.
- Alternatives: Re-fetch after edit and build the response from persisted state.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2982653419`, `2982653442`, `2982653455`

### [CLOSED] F10. Simple trace edit silently drops incoming references and links

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `SimpleTracesService.edit()` ignores incoming `references` and `links` even though the edit DTO allows them.
- Evidence:
  - `api/oss/src/core/tracing/service.py`
  - `api/oss/tests/pytest/unit/tracing/test_simple_traces_service.py`
- Files:
  - `api/oss/src/core/tracing/service.py`
- Cause: The edit path always reuses `existing.references` and `existing.links`.
- Explanation: The edit path now applies the incoming references and links instead of always reusing the pre-edit values.
- Impact: Callers can lose edits silently.
- Suggested Fix: Either implement reference/link updates or remove them from the edit DTO.
- Alternatives: Validate and reject edits that attempt to set immutable fields.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2982653283`, `2982653312`, `2983188576`

### [CLOSED] F11. Trace query rewriting relies on `conditions[0]`

- Severity: `P2`
- Confidence: `high`
- Status: `stale`
- Category: `Correctness`, `Robustness`
- Summary: This was mis-triaged as an arbitrary positional-ordering bug, but the helper intentionally operates on the single initial trace-kind condition that the trace-query builder inserts first.
- Evidence:
  - `api/oss/src/core/tracing/service.py:445`
  - `api/oss/src/core/tracing/service.py:1155-1163`
- Files:
  - `api/oss/src/core/tracing/service.py`
- Cause: The original review read the helper as arbitrary positional mutation instead of a constrained helper over the known single-condition shape.
- Explanation: `_extract_trace_ids_from_query()` already guards on exactly one condition, and `build_simple_trace_filtering()` always inserts the trace-kind condition first, so this report does not describe an actionable defect on current HEAD.
- Impact: No confirmed bug remains here.
- Suggested Fix: None.
- Alternatives: Re-triage only if the helper shape changes later.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2982653363`

### [CLOSED] F12. Trace edit quota check uses create semantics

- Severity: `P2`
- Confidence: `high`
- Status: `wontfix`
- Category: `Correctness`, `API semantics`
- Summary: `tracing/router.py` charges edit operations with `delta=1` rather than edit semantics.
- Evidence:
  - `api/oss/src/apis/fastapi/tracing/router.py`
- Files:
  - `api/oss/src/apis/fastapi/tracing/router.py`
- Cause: The entitlement check was copied from create behavior.
- Explanation: The product decision is that edit is still an ingestion or mutation operation, so both create and edit count toward quota.
- Impact: This is intentional quota behavior, not a contract bug.
- Suggested Fix: None; keep quota accounting on both create and edit.
- Alternatives: Introduce a separate edit quota policy later if product semantics change.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2982653342`

### [CLOSED] F13. `applications/router.py` wraps one handler with `@intercept_exceptions()` twice

- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Maintainability`
- Summary: `list_application_catalog_types` is double-decorated with `@intercept_exceptions()`.
- Evidence:
  - `api/oss/src/apis/fastapi/applications/router.py`
- Files:
  - `api/oss/src/apis/fastapi/applications/router.py`
- Cause: Duplicate decorator application.
- Explanation: Double-wrapping can duplicate logging and alter exception interception order.
- Impact: Unnecessary complexity and potentially noisy error handling.
- Suggested Fix: Remove the duplicate decorator.
- Alternatives: None needed; this is a straightforward cleanup.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2983188596`, `2991025251`

### [CLOSED] F16. `urlparse` no longer handles scheme-less localhost inputs correctly

- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Robustness`
- Summary: `urlparse('localhost:8000')` now yields `hostname=None`, so the localhost-rewrite path is skipped.
- Evidence:
  - `api/oss/src/utils/helpers.py`
  - `api/oss/tests/pytest/unit/test_helpers.py`
- Files:
  - `api/oss/src/utils/helpers.py`
- Cause: The new implementation assumes `urlparse()` will always expose a hostname for local inputs.
- Explanation: The helper now prepends `http://` when no scheme is present before applying localhost rewrite logic.
- Impact: Localhost normalization becomes inconsistent.
- Suggested Fix: Prepend a default scheme when missing or add a hostname fallback path.
- Alternatives: Use a dedicated URL-normalization helper for local development inputs.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR thread `2984134945`

### [CLOSED] F17. Runtime locks depend on a private cache helper

- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Maintainability`
- Summary: `evaluations/runtime/locks.py` uses private `caching._pack` for lock-key generation.
- Evidence:
  - `api/oss/src/core/evaluations/runtime/locks.py`
  - `api/oss/src/utils/caching.py`
  - `api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py`
- Files:
  - `api/oss/src/core/evaluations/runtime/locks.py`
- Cause: The lock implementation depends on an underscore-prefixed internal helper.
- Explanation: The lock code now uses a public cache-packing helper instead of binding directly to the private underscore-prefixed implementation.
- Impact: Hidden coupling and fragile maintenance boundary.
- Suggested Fix: Expose a public pack helper or move the packing logic into the locks module.
- Alternatives: Inline a stable lock-key serializer next to the lock code.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2991025290`, `2991933179`

### [CLOSED] F2. Environment revision commit validation

- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Summary: Empty-payload and missing-slug commit validation issues were fixed in-branch and covered by tests.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2964690992`, `2965903693`, `2966111988`, `2966112048`, `2971482852`, `2982653472`, `2982653494`, `2982653521`

### [CLOSED] C1. `script` shape compatibility

- Severity: `P2`
- Confidence: `medium`
- Status: `wontfix`
- Summary: The `script` shape change is treated as an intentional compatibility break under the co-versioned setup.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2948797838`, `2952354703`

### [CLOSED] F18. Trace type inference from links

- Severity: `N/A`
- Confidence: `high`
- Status: `wontfix`
- Summary: Link presence is treated as the definitional property of an annotation trace, so the reported issue is by-design.
- Sources:
  - `docs/designs/runnables/CR.md`
  - PR threads `2982653209`, `2982653258`
