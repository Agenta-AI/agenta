# Evaluations → packages migration plan

Branch: `fe-chore/move-evals-to-packages`

Status: **PLAN — locked structure, not yet executed.** This document is the source of
truth for the migration. If an action you're about to take is not traceable to a Work
Package below, stop and re-read §0.

---

## 0. Guardrails (read first, every session)

This migration has gone sideways once already (a whole session was spent Fern-migrating the
OSS *service/HTTP layer* — which was never the goal — instead of relocating *state/engine
logic*). These rules exist to prevent that.

**The goal, in one sentence:** unify the evaluation-run *state/engine* (scenario session,
metrics, columns, list/table store, run creation) into a layered package architecture
(`entities ← evaluations ← annotations`, plus `-ui` mirrors), so that **human evaluations
and annotation queues become presets over one evaluation engine** — then delete the OSS
duplicates.

**Cardinal rules:**

1. **Move/extract, do NOT rewrite.** The engine already exists twice (in `@agenta/annotation`
   and in OSS `EvalRunDetails`/`EvaluationRunsTablePOC`). We extract the cleaner copy
   (annotation) into `evaluations`, rename as needed, and re-point consumers. Writing
   new logic is a last resort, only for genuine gaps named in §6.
2. **Annotation stays green the entire time** (it is the source of truth AND it ships). Every
   Work Package keeps `@agenta/annotation` + `@agenta/annotation-ui` + their routes working.
3. **OSS is deleted only after parity is proven** against the OSS regression baseline (§4).
   No OSS eval view/atom is removed until the package-driven replacement is regression-tested
   against it.
4. **One generic, configurable table** in `evaluations-ui` — move the existing
   `AnnotationQueuesView` into it (with renaming/config props), do not author a second table.
5. **`entities` stays as-is for entity *definitions*.** Each entity is a molecule/api/core in
   `entities`; the *wiring* of entities into evaluation functionality goes in `evaluations`.
   Do not put cross-entity orchestration in `entities`.
6. **No half-and-half / no bridges.** When a capability moves to a package, the OSS shell is
   deleted in the same Work Package (or explicitly tracked as debt with a deletion WP).
7. **Clean up after yourself — zero OSS residue (HARD gate).** After this migration, OSS must
   contain **no eval-related services, utils, or data-layer atoms** — only thin route handlers
   and `-ui` providers. Every WP that moves a capability **deletes its OSS counterpart in the
   same WP**; deletion is never deferred to "later." The migration is NOT done until the
   cleanup ledger in §7 is fully checked off and its verification commands return empty. If
   you finish a WP and left an OSS service/atom/util behind, the WP is not done.

**Explicit non-goals (do NOT do these as part of this work):**

- Do NOT Fern-migrate or refactor the *legacy* evaluations bridge
  (`oss/src/services/evaluations/api/index.ts` — `_Evaluation` types, `GET /evaluations`,
  `POST /simple/evaluations/`). Different domain; separate effort.
- Do NOT take on online-evaluations (`services/onlineEvaluations`) beyond what the shared
  engine naturally covers; it has its own controller plan.
- Do NOT change backend models or regenerate the Fern client (settled: the FE aligns to the
  real contract; see the prior session's findings).
- Do NOT build a new table, a new paginated store, a new session controller, or a new
  metrics processor. They exist — move them.

**Anti-stray check** — before writing code, answer in your head:
*"Which Work Package is this? What existing package code am I moving? What keeps annotation
green? What OSS thing does this let me delete, and how will I prove parity first?"* If you
can't answer all four, you're about to stray.

---

## 1. The unified entity model

There is ONE core entity: the **evaluation run** —
`run → scenarios → results → metrics`, with `data.steps` (`input` | `invocation` |
`annotation`) and `data.mappings`. A run's *kind* is a **projection**, derived from step
origins + flags (see `deriveEvaluationKind`):

| Kind | How it's identified |
|---|---|
| auto eval | invocation steps + `annotation` steps with `origin="auto"` |
| human eval | `annotation` steps with `origin="human"` |
| annotation queue | human-eval run with `is_queue=true` (+ assignment semantics) |
| online eval | `is_live=true` (or `meta.source="online_evaluation_drawer"`) |

**Strategic driver:** human evaluations will be *replaced by* annotation queues. They are the
same entity with different flags — so the engine must be kind-agnostic, and "annotation
queue" is a thin preset on top.

---

## 2. Target package architecture

```
shared ← ui ← entities ← evaluations ← annotations
                              │              │
                              └ evaluations-ui ← annotations-ui
```

Dependency rule: arrows only point left/down. `annotations` MAY depend on `evaluations`;
`evaluations` MUST NOT depend on `annotations`.

| Package | Owns | Status |
|---|---|---|
| `@agenta/entities` | Each entity: `evaluationRun`, **`evaluationScenario`** (done), `evaluationResult`, `evaluationMetric`, `evaluationQueue`/`simpleQueue`, `annotation`, `workflow` (evaluators), `testcase`/`testset`/`trace`. **Entity definitions only** — the `evaluationRun/etl` (hydration/mapping/filtering) MOVES to `evaluations` (see WP-3.5; decision reversed 2026-06-09). | Mostly exists |
| `@agenta/evaluations` | Generic *wiring*: run creation (exists), the **run list store**, the **scenario session engine**, **metrics processing**, the **eval-run ETL** (scenario hydration, mapping/column resolution, **client-side filtering** — moved from `entities/evaluationRun/etl` + OSS `EvalRunDetails/etl`, the ahead impl), kind derivation, status rollup. Kind-agnostic. | Has run-creation only; rest extracted here |
| `@agenta/annotations` (rename/refocus current `@agenta/annotation`) | The queue delta only: annotation submit form, queue assignment, focus-mode, testset write-back. Depends on `evaluations` (and thereby GAINS the ETL filtering it lacks today). | Exists but "upside-down" — see §3 |
| `@agenta/evaluations-ui` (NEW) | Run list table (ONE generic configurable table, moved from `AnnotationQueuesView`), run detail view, scenario table, metric cells, `CreatedByCell`, **the ETL filter bar / column headers / resolved cells** (moved from OSS `EvalRunDetails/etl`). | New; populated by moving existing UI |
| `@agenta/annotations-ui` (current `@agenta/annotation-ui`) | Queue-specific UI: submit form/session, `CreateQueueDrawer`, `AddToQueuePopover`, the run table configured with a "queue" preset. Depends on `evaluations-ui`. | Exists; sheds generic parts |

---

## 3. The core realization: `@agenta/annotation` is upside-down

`@agenta/annotation` currently holds the **generic evaluation engine**, flavored as
"annotation":

- `annotationSessionController.ts` (~3.7k lines) — scenario navigation, scenario data
  (trace/steps/testcase/rootSpan), metrics (run-level + per-scenario), column defs, statuses,
  views — **all generic eval-run logic** — plus a thin annotation shell.
- `annotationFormController.ts` (~1.7k lines) — generic metric/schema extraction
  (`getOutputsSchema`, `getMetricFieldsFromEvaluator`, `getMetricsFromAnnotation`) + the
  annotation submit form.

Meanwhile OSS `EvalRunDetails/atoms` reimplements the SAME generic engine (~38 atoms across
`run.ts`, `scenarioSteps.ts`, `scenarioColumnValues.ts`, `metrics.ts`, `runMetrics.ts`,
`traces.ts`, `references.ts`) directly on the molecules + `etl`, never importing
`@agenta/annotation`.

So this migration = **extract the generic engine out of `@agenta/annotation` down into
`@agenta/evaluations`**, leave the annotation delta behind (now depending on `evaluations`),
then **re-point the OSS eval views at `evaluations`/`evaluations-ui` and delete the OSS
duplicates** — proving parity against OSS first.

### 3.1 Controller decomposition (the extraction map) — RE-SCOPED 2026-06-09 (verified from code)

**Verified before any cut (no assumptions):**
- The session engine is founded on `simpleQueueMolecule`: `activeRunId ← simpleQueueMolecule.runId(queueId)`,
  `rawScenarioRecords ← simpleQueueMolecule.scenarios(queueId)`,
  `scenariosQuery ← simpleQueueMolecule.scenariosQuery(queueId)`.
- The two consumers source the scenario LIST from **different endpoints**:
  annotation → `POST /simple/queues/{id}/scenarios/query` (queue-scoped, optional `user_id`
  annotator filter → may be a **subset** of run scenarios); EvalRunDetails → `POST
  /evaluations/scenarios/query` by `run_id` (run-scoped, windowed). Both return
  `EvaluationScenario`-shaped rows.
- Scenario *data* (steps/results/metrics) is derived by `{projectId, runId, scenarioId}` from
  the evaluationRun/result/metric molecules in BOTH; trace/testcase refs are read off the
  scenario row itself (source-agnostic).

**Consequence — the engine is parameterized by an injected SCENARIO SOURCE, not a molecule.**
The `evaluations` session engine MUST NOT hardcode `simpleQueueMolecule` or
`evaluationScenarioMolecule`. It takes `{projectId, runId, scenarios[], scenariosQuery}` (the
source) and owns the rest. Annotation injects the queue source (user-scoped); the eval-run
view injects the run source (`evaluationScenarioMolecule`/`/evaluations/scenarios/query`).

`annotationSessionController` →

- **Generic → `evaluations` (the TRULY-shared core, both consumers derive this):**
  scenario-DATA selectors keyed by `{projectId, runId, scenarioId}` — `scenarioStepsQuery`,
  `scenarioTraceRef`, `scenarioTestcaseRef`, `scenarioTraceQuery`, `scenarioRootSpan`,
  `scenarioMetrics`, `scenarioMetricsQuery`, `scenarioMetricForEvaluator`; column/evaluator
  derivations — `evaluatorIds`, `evaluatorRevisionIds`, `evaluatorStepRefs`,
  `annotationColumnDefs` (rename → `evaluatorColumnDefs`), `listColumnDefs`, `traceInputKeys`,
  `testcaseInputKeys`, `testcaseData`. These delegate to the entities molecules.
- **Generic-but-source-PARAMETERIZED → `evaluations` session engine:** `activeProjectId`,
  `activeRunId`, `currentScenarioId`, `currentScenarioIndex`, `focusedScenarioId`,
  `scenarioIds`, `navigableScenarioIds`, `progress`, `hasNext`, `hasPrev`,
  `isCurrentCompleted`, `scenarioStatuses`, `activeView`, `completedScenarioIds`,
  `scenarioOrder`; actions `openSession`, `navigateNext/Prev/ToIndex`, `syncScenarioOrder`,
  `markCompleted`, `completeAndAdvance`, `closeSession`, `setActiveView`, `applyRouteState`.
  The scenario LIST + its query state are INJECTED (annotation: queue source; eval view: run
  source) — `scenarioRecords`/`scenariosQuery` are NOT owned by the engine.
- **Annotation-specific → stays in `annotations` (injects the queue source + owns the delta):**
  `activeQueueId`, `activeQueueType`, the queue→engine wiring (feeds queue scenarios + runId
  into the engine), `queueName`/`queueKind`/`queueDescription`, `hideCompletedInFocus`,
  `focusAutoNext` (focus-mode UX), `scenarioAnnotations*`, `scenarioAnnotationByEvaluator`
  (annotation entity reads), all add-to-testset (`defaultTargetTestsetName`,
  `pendingTestsetSelection*`, `addToTestset*`, `selectedScenarioIds`, `canSyncToTestset`,
  `syncToTestsets`, `addScenariosToTestset`).
- **Regression risk to watch:** the queue source applies user-scoping; do NOT swap annotation
  to a run-scoped source. Annotation keeps feeding the QUEUE scenarios into the engine; only
  the engine code is shared, not the source.

`annotationFormController` →

- **Generic → `evaluations`:** `getOutputsSchema`, `getMetricFieldsFromEvaluator`,
  `getMetricsFromAnnotation`, `evaluators`, `evaluatorResolution`, `effectiveMetrics`,
  `baseline`.
- **Annotation submit → stays in `annotations`:** `updateMetric`, `submitAnnotations`,
  `resetEdits`, `hasPendingChanges`, `hasFilledMetrics`, `isSubmitting`, `submitError`,
  `setScenarioContext`, `clearFormState`.

---

## 4. Source-of-truth & regression baselines

- **Extract FROM (source of truth):** `@agenta/annotation` + `@agenta/annotation-ui` — for the
  session/scenario/metrics engine.
- **EXCEPTION — the ETL filtering feature:** here OSS `EvalRunDetails/etl` is the source of
  truth; **annotation has no filtering at all** (verified — it imports none of the etl
  filtering). So the ETL (scenario hydration + mapping/column resolution + client-side
  filtering) is extracted from OSS, not annotation, in WP-3.5, and moved into `evaluations` /
  `evaluations-ui`. Annotation queues GAIN filtering by depending on `evaluations`.
- **Keep GREEN throughout (live annotation consumers):**
  `web/oss/src/pages/.../annotations/index.tsx`, `.../annotations/[queue_id].tsx`,
  `web/oss/src/components/Annotations/AnnotationTraceContent.tsx`,
  `.../AnnotationTestcaseContent.tsx`.
- **Regression BASELINE (OSS to be deleted — prove parity before removal):**
  `EvalRunDetails` + `EvaluationRunsTablePOC`, rendered at:
  - `web/oss/src/pages/.../evaluations/results/[evaluation_id]/index.tsx`
  - `.../evaluations/single_model_test/[evaluation_id]/index.tsx`
  - `.../apps/[app_id]/evaluations/results/[evaluation_id]/index.tsx`
  - `.../apps/[app_id]/overview/index.tsx`
  - EE equivalents under `web/ee/src/pages/...evaluations/results/[evaluation_id]`.

---

## 5. Work Packages (sequenced; each keeps annotation green)

Each WP lists: **Move** (what/from→to), **DoD** (definition of done), **Integration test**
(real API, real atoms), and **Regression gate**. Do them in order. Do not start a WP until
the previous one's DoD + tests + gate pass.

> **Testing is part of every WP's DoD — non-negotiable (see §8).** Every WP that moves
> state/logic ships a **real-API integration test that drives the SHIPPED atoms/molecules/
> controllers** — never a test-local replica of the logic. Setup may seed data via the raw
> Fern client, but assertions go through the real package surface. A WP without its
> integration test is NOT done. (Why: this migration's own mapping-kind bug shipped because a
> test hand-built `mappings:[]` instead of calling the real `buildRunConfig` — it passed
> against broken code. Never again.)
>
> Pre-flight (every WP touching package manifests): keep all `package.json` + lock changes in
> ONE commit (prettier hook rewrites the lock otherwise). Respect import hierarchy. `no any`.
> Run `pnpm --filter <pkg> build` + `lint` before committing.

### WP-0 — Scaffold + entity promotion (no behavior change)
- **Move:** create `@agenta/evaluations-ui` package (manifest, build, lint, test config,
  empty `src/index.ts`) registered in OSS+EE `next.config` + `ee/package.json` (mirror the
  `@agenta/evaluations` registration done this session). Promote `evaluationScenario` to a
  first-class `entities` module (molecule/api/core) from the half-schema currently under
  `evaluationRun`.
- **DoD:** packages build; `evaluationScenario` is a first-class molecule.
- **Integration test (real API, real atoms):** drive the **shipped `evaluationScenario`
  molecule** (its api + atom selectors) against a real run's scenarios — create → query →
  read selectors → assert; like the existing eval-run integration suite. Not a replica schema.
- **Regression gate:** full entities unit (591+) green; eval integration green; OSS/EE build.

### WP-1 — Extract the scenario **session engine** → `@agenta/evaluations` (injected source)
- **Move (per the re-scoped §3.1):** extract the generic engine from `annotationSessionController`
  into `evaluations`, in two parts:
  1. **Scenario-data selectors** keyed by `{projectId, runId, scenarioId}` (steps/results/
     metrics/trace/testcase/columns/evaluator refs) — pure delegations to the entities
     molecules. These are the truly-shared core.
  2. **Session engine** that takes an **injected scenario source** — `{projectId, runId,
     scenarios[], scenariosQuery}` — and owns navigation/progress/current/focus/view/completion.
     It MUST NOT import `simpleQueueMolecule` or `evaluationScenarioMolecule` (source-agnostic).
- `@agenta/annotation` keeps the annotation shell, **feeds the QUEUE scenario source**
  (`simpleQueueMolecule`, user-scoped — do NOT swap to a run-scoped source) + runId into the
  engine, and imports the generic engine from `evaluations` (add the dependency). Rename
  annotation-flavored names to kind-agnostic (`openQueue`→`openSession`,
  `annotationColumnDefs`→`evaluatorColumnDefs`) with temporary re-exports in `annotation`.
- **DoD:** `@agenta/annotation` controller is now a thin wrapper over `evaluations`; no logic
  duplicated.
- **Integration test (real API, real atoms):** drive the **shipped `evaluations` session
  controller** (its real atoms/selectors — `scenarioIds`, `currentScenarioId`, navigate
  actions, `scenarioStatuses`, `scenarioMetrics`, `evaluatorColumnDefs`) against a real
  populated run; extend the existing harness. Assert through the controller surface, not a
  copy. Worker-computed metrics via the real-project read-only smoke. Because the annotation
  controller is now a wrapper, the existing annotation tests also exercise the moved engine.
- **Regression gate:** annotation routes manually QA'd green (open queue, navigate scenarios,
  metrics render); annotation package tests green.

### WP-2 — Extract metric/schema extraction (form controller generic half) → `evaluations`
- **Move:** `getOutputsSchema`, `getMetricFieldsFromEvaluator`, `getMetricsFromAnnotation`,
  `evaluators`, `evaluatorResolution` into `evaluations`. The annotation submit form stays in
  `annotation`, importing these.
- **DoD:** no metric/schema extraction logic left duplicated.
- **Integration test (real API, real atoms):** seed a real run with evaluator (annotation)
  steps, then drive the **shipped `evaluations` metric/schema functions** (`getMetricFieldsFromEvaluator`,
  `getOutputsSchema`, `getMetricsFromAnnotation`, `evaluatorResolution`) against the real
  evaluator workflow — assert the metric fields/schema resolve. Do NOT re-derive the schema in
  the test. Worker-computed metric values verified via the real-project read-only smoke.
- **Regression gate:** annotation submit flow QA'd (fill metric → submit → persists).

### WP-3 — Move the run **list store + table** → `evaluations` / `evaluations-ui`
- **Move:** the queue list store (`simpleQueue/paginatedStore` pattern) generalized into an
  `evaluations` run-list store; **move `AnnotationQueuesView` into `evaluations-ui` as ONE
  generic, configurable table** (config props for columns/cells/filters/kind preset). Cells
  (`CreatedByCell`, `EvaluatorNamesCell`, `QueueProgressCell`) move with it. `annotations-ui`
  renders the table with a "queue" preset.
- **DoD:** one table component; annotation queue list renders via the generic table + preset;
  no second table authored.
- **Integration test (real API, real atoms):** drive the **shipped `evaluations` run-list
  store** (its real atoms — list query, kind/status filters, search term, pagination/windowing
  cursor) against real runs/queues; assert the returned, parsed rows. Reuse the populated-run
  seeding + the real-project read-only smoke. Do NOT reimplement the list query in the test.
- **Regression gate:** annotation queue list QA'd (list, filter, search, pagination,
  created-by, progress).

### WP-3.5 — Move the eval-run ETL (hydration / columns / filtering) → `evaluations` + `evaluations-ui`
This is the one capability where **OSS is ahead of annotation** (annotation has no filtering),
so the source of truth is OSS `EvalRunDetails/etl`, not annotation (see §4 exception).
- **Move:**
  - **Headless primitives** `entities/evaluationRun/etl` (`hydrateScenariosTransform`,
    `resolveMappings`/`groupRunColumns`, `rowPredicateFilter`/`filterSchema`/
    `predicateToEntitySlices`, `realScenarioSource`, cache fetchers) → `@agenta/evaluations`.
    First verify nothing in `entities/*` source (only a test) imports it, so there's no
    `entities → evaluations` cycle. Update the `@agenta/entities/evaluationRun/etl` subpath
    consumers to the new `evaluations` path.
  - **Filtering state/hooks (CLEAN subset only)** from OSS `EvalRunDetails/etl/` →
    `@agenta/evaluations`: `scenarioFilterState`, `useScenarioFilter`, `useHydrateScenarios`,
    `useScopeChangeEviction`, `useCellMaterialization`, `cellMaterializerContext`. These import
    only entities + `@agenta/evaluations/etl` + react/jotai (verified) — no OSS atom layer.

> **RE-SCOPED 2026-06-10 (atom dependency inversion — verified from code).** The remaining ETL
> pieces — the **column hooks** `useEtlColumns`/`columnValueTypes`/`useScenarioLiveUpdates` and
> the **filtering UI** `ScenarioFilterBar`/`EtlColumnHeader`/`cells/EtlResolvedCell` — import the
> OSS `EvalRunDetails/atoms/*` + `state/*` layer (`atoms/tableRows`, `atoms/table`,
> `atoms/compare`, `atoms/references`, `atoms/table/evaluators`, `state/rowHeight`,
> `evaluationPreviewTableStore`). That atom layer is WP-4 scope and transitively pulls in most of
> the OSS eval data layer (`lib/evaluations`, `services/evaluations`, `usePreviewEvaluations`,
> `References/atoms`, `EvaluationRunsTablePOC/atoms`, …). So these ETL pieces **CANNOT move before
> the atom layer**, and the atom-layer move IS WP-4. They are therefore **moved in WP-4**, not
> here. WP-3.5 ships only the headless primitives (done, 3.5a) + the clean filtering hooks.
> Consequently the OSS `EvalRunDetails/etl/` dir is NOT fully deleted in WP-3.5 — only its clean
> files move; the entangled remainder + the dir deletion happen in WP-4.

- **DoD (re-scoped):** the headless ETL primitives + the clean filtering hooks live in
  `@agenta/evaluations`; the OSS consumers (incl. the still-OSS entangled etl files) re-point to
  the package; no `entities → evaluations` cycle. The filtering UI + column hooks + the OSS
  `EvalRunDetails/etl/` deletion move to WP-4 (gated on the atom-layer move).
- **Integration test (real API, real atoms):** drive the **shipped `evaluations` ETL** —
  hydrate a real run's scenarios and apply a real `rowPredicateFilter`/`filterSchema` over the
  hydrated rows; assert the filtered set. Use real run data; do NOT hand-roll the filter.
- **Regression gate:** scenario filtering QA'd on the eval run detail (apply/clear filters,
  column resolution) against the OSS baseline (§4) — this is parity for an OSS-sourced feature.

### WP-4 — Point OSS eval views at the packages; prove parity; DELETE OSS dups
- **Move:** re-point `EvaluationRunsTablePOC` (run list) and `EvalRunDetails` (run detail +
  scenario table + metrics) to consume the `evaluations`/`evaluations-ui` engine + table.
  Then **delete** the OSS eval atoms (~38 in `EvalRunDetails/atoms`, the `EvaluationRunsTablePOC`
  store/atoms) and the now-thin OSS service shells from the prior session.
- **Absorbs from WP-3.5 (re-scoped 2026-06-10):** the atom-coupled ETL pieces deferred from
  WP-3.5 — column hooks `useEtlColumns`/`columnValueTypes`/`useScenarioLiveUpdates` →
  `@agenta/evaluations`; filtering UI `ScenarioFilterBar`/`EtlColumnHeader`/`cells/EtlResolvedCell`
  → `@agenta/evaluations-ui` — move together with the `EvalRunDetails/atoms`+`state` layer they
  depend on, and the OSS `EvalRunDetails/etl/` dir is deleted here.
- **DoD:** OSS eval views are thin route handlers + a `-ui` provider supplying inputs (like
  `AnnotationUIProvider`); the ~50 OSS eval atom files are gone; no `@agenta/*` ← OSS bridge.
- **Regression gate (the big one):** parity vs the §4 OSS baseline on every listed route —
  auto eval results, human eval, single-model test, app overview, EE results — covering: run
  list (filters/search/sort/delete), run detail (scenario table, columns, metric columns
  run-level + temporal, annotate drawer write-back + status rollup). Use integration tests at
  the atom/API layer + the real-project read-only smoke + a manual UI matrix. Capture
  before/after screenshots per route.

#### WP-4 execution DAG (leaves-first, mapped 2026-06-10)

No circular deps between subsystems; everything flows lib → services → hooks → atoms → state →
etl/UI → views. ~12k LOC across 60+ files. Move leaves first, commit each, parity-gate before
ANY deletion. Sub-steps:

- **4a** `oss/lib/evaluations/` (buildRunIndex, utils/{evaluationKind,metrics}, types, legacy) →
  `@agenta/evaluations`. ⚠️ Verify: it imports OSS-local legacy (`components/pages/evaluations/
  cellRenderers`, `services/evaluations/api`) — untangle or carry; and resolve the §6 question
  (does `buildRunIndex` overlap/collapse into the already-moved `resolveMappings`/`groupRunColumns`?).
- **4b** `oss/services/evaluations/` (results/scenarios/invocations api + workerUtils) → `@agenta/evaluations`.
- **4c** `oss/services/evaluationRuns/` (createEvaluationRunConfig) → `@agenta/evaluations` (note buildRunConfig already exists there — dedup).
- **4d** `oss/lib/hooks/usePreviewEvaluations/` → `@agenta/evaluations` (blocks on 4a, 4c).
- **4e** `EvalRunDetails/atoms/` (~22 movable files + `evaluationPreviewTableStore`) → `@agenta/evaluations` (blocks on 4a, 4d). `runInvocationAction.ts` couples to EvaluationRunsTablePOC — inject the invalidation callback (don't hard-import).
- **4f** `EvalRunDetails/state/` → `@agenta/evaluations` (blocks on 4e).
- **4g** deferred ETL: column hooks `useEtlColumns`/`columnValueTypes`/`useScenarioLiveUpdates` →
  `@agenta/evaluations`; UI `ScenarioFilterBar`/`EtlColumnHeader`/`EtlResolvedCell` → `@agenta/evaluations-ui` (blocks on 4e, 4b).
- **4h** re-point `EvalRunDetails/Table.tsx` + index → packages (blocks on 4e/4f/4g).
- **4i** re-point `EvaluationRunsTablePOC` (+ its export layer) → packages atoms.
- **4j** resolve `runInvocationAction` coupling (callback injection).
- **4k** DELETE OSS dups — only after 4h/4i green. Point of no return.
- **4l** PARITY GATE: integration tests at atom/API layer + real-project smoke + **manual UI
  matrix + before/after screenshots** across all §4 routes. No deletion sign-off without it.

Stays in OSS (broadly-shared, NOT eval-specific; packages import via `@/oss`-provided or already
package-provided equivalents): `@/oss/state/{project,workspace,entities,app}`, `@/oss/lib/Types`,
`@/oss/lib/api`, `@/oss/components/InfiniteVirtualTable`, generic helpers.

#### WP-4 STATUS (2026-06-10) — leaves done; atom move BLOCKED on a prerequisite

Landed + green (oss tsc steady 588 throughout): WP-4 unblocker (promote metricUtils →
`@agenta/shared/metrics`, EvaluationStatus → `@agenta/entities/evaluationRun`, SnakeToCamelCaseKeys
→ `@agenta/shared/types`), **4a** (buildRunIndex + evaluationKind → `@agenta/evaluations/core`),
**4b** (active eval services → `@agenta/evaluations/services`), **4c+4d** (usePreviewEvaluations →
`@agenta/evaluations/hooks`; evaluationRuns deduped).

**4e (atom move) is BLOCKED.** Verified: ~18 of the `EvalRunDetails/atoms` couple to OSS entity-state
(`@/oss/state/entities/{testcase,testset,shared}`), which is a **divergent parallel implementation of
the existing `@agenta/entities` molecules**. Promoting it cascades into a **14–18 day, ~331-file,
app-wide entity-layer re-platform with a tsc-invisible silent-regression risk** (flat vs nested
testcase data). That is its own initiative — see
[entity-state-consolidation-plan.md](./entity-state-consolidation-plan.md).

**Two ways to unblock 4e (decide when resuming):**
1. **Injection seams** (recommended to finish the eval migration in isolation): the eval atoms receive
   testcase/testset/References/workspace data injected from the OSS `-ui` provider (the DoD pattern);
   OSS entity layer untouched. Moves 4e safely without the consolidation.
2. **Entity-state consolidation first** (the broader platform goal): execute the C1–C7 plan in the
   consolidation doc (human-in-the-loop, QA-gated), then 4e is a clean re-point.

4f–4l (state, ETL UI, view re-point, EvaluationRunsTablePOC, delete, parity) all follow 4e and are
unchanged. The irreversible deletions (4k / consolidation C7) remain gated on manual parity QA.

### WP-5 — Rename `annotation`→`annotations`, `annotation-ui`→`annotations-ui` (optional/last)
- Cosmetic alignment with `evaluations`/`evaluations-ui`. Pure rename + re-export shims, no
  logic. Do last to avoid churn during WP-1..4.

---

## 6. Genuine gaps (the only places new code is allowed)

Quantify during WP-1/WP-4; if a capability exists in neither annotation nor a clean OSS form,
it's a gap. Known candidates (verify, don't assume):

- **ETL filtering is NOT a gap — it's an OSS-ahead feature to MOVE** (WP-3.5), not rebuild.
  OSS `EvalRunDetails/etl` (filter bar, scenario filter state, column resolution) is the
  source; annotation has none. Move it into `evaluations`/`evaluations-ui`.
- **Auto/invocation specifics** the annotation engine never needed: the auto-eval run loop,
  invocation-step columns, run-level metric *aggregates* (annotation is human/per-scenario).
  `runMetrics.ts` (13 atoms, temporal + run-level) is the prime suspect for eval-only logic.
- **`buildRunIndex`** (OSS `lib/evaluations`) vs `etl/resolveMappings`/`groupRunColumns`:
  overlapping column resolution. Determine if `buildRunIndex` is a true gap or a thin
  pre-grouping layer collapsible into the `evaluations` ETL. (Earlier investigation said "no
  equiv"; the `etl` evidence suggests otherwise — re-verify during WP-3.5.)

Anything found here gets a one-line gap entry + a focused, tested addition in `evaluations` —
NOT a reimplementation of something that already exists.

---

## 7. Zero OSS residue — cleanup ledger & gate

After the migration, the only eval code allowed in `web/oss` / `web/ee` is **route handlers**
(`pages/...`) and **`-ui` providers** that supply inputs (like `AnnotationUIProvider`).
Everything below MUST be deleted (moved into packages), each in the WP that owns its
capability. This ledger is the checklist; do not mark the migration done until every row is
`DELETED` and §7.2 returns empty.

### 7.1 Cleanup ledger (OSS paths that must be gone)

**Services (data layer) — `web/oss/src/services/`**
- [ ] `evaluations/results/` → `@agenta/entities/evaluationRun` (done: Fern api) → **delete shell** (WP-4)
- [ ] `evaluations/scenarios/` → `evaluations`/entities → **delete shell** (WP-4)
- [ ] `evaluations/invocations/` → `evaluations`/entities → **delete shell** (WP-4)
- [ ] `evaluations/runShape/` → audit → `evaluations` controller → **delete** (WP-4)
- [ ] `evaluationRuns/` (run-config builder) → `@agenta/evaluations` (`buildRunConfig`) → **delete** (WP-4)
- [ ] `evaluations/api/` (legacy bridge: `GET /evaluations`, `POST /simple/evaluations/`, `_Evaluation`) → **terminal WP**, gated on legacy auto-eval UI replacement; tracked, NOT silently left
- [ ] `onlineEvaluations/` → **terminal WP**, gated on online-eval engine adoption; tracked, NOT silently left

**Utils / libs / hooks — `web/oss/src/lib/`**
- [ ] `evaluations/` (`buildRunIndex`, `legacy`, `metricUtils` callers) + `evaluations/utils/` (`metrics`, `evaluationKind`) → `@agenta/evaluations` (incl. the ETL home) → **delete** (WP-1/WP-3.5/WP-4; resolve `buildRunIndex` vs ETL per §6)
- [ ] `hooks/usePreviewEvaluations/` (+ `assets/`, `states/`) → `@agenta/evaluations` run hub → **delete** (WP-3/WP-4)
- [ ] `hooks/useEvaluationRunMetrics/` → `@agenta/evaluations` metrics → **delete** (WP-1/WP-4)
- [ ] `evalRunner/`, `evaluators/` → audit; eval-data parts → packages, evaluator defs already in `entities/workflow` → **delete data-layer parts** (WP-4)

**ETL feature (OSS-ahead; source of truth for filtering) — `web/oss/src/components/EvalRunDetails/etl/`**
- [ ] `EvalRunDetails/etl/` state+hooks (`scenarioFilterState`, `useScenarioFilter`, `useHydrateScenarios`, `useEtlColumns`, `useCellMaterialization`, `useScopeChangeEviction`, `columnValueTypes`) → `@agenta/evaluations` → **delete** (WP-3.5)
- [ ] `EvalRunDetails/etl/` UI (`ScenarioFilterBar`, `EtlColumnHeader`, `cells/EtlResolvedCell`) → `@agenta/evaluations-ui` → **delete** (WP-3.5)
- [ ] `@agenta/entities/evaluationRun/etl` headless primitives → **moved to `@agenta/evaluations`**; remove the `./evaluationRun/etl` subpath export from `entities` once consumers re-point (WP-3.5)

**Data-layer atoms / state — `web/oss/src/components/` & `state/`**
- [ ] `EvalRunDetails/atoms/` (incl. `mutations/`, `runMetrics/`, `table/`) — the ~38-atom engine → `@agenta/evaluations` → **delete** (WP-4)
- [ ] `EvalRunDetails/state/`, `EvalRunDetails/hooks/`, `EvalRunDetails2/hooks/` → packages → **delete** (WP-4)
- [ ] `EvaluationRunsTablePOC/atoms/`, `EvaluationRunsTablePOC/hooks/` → `@agenta/evaluations`(+`-ui`) → **delete** (WP-3/WP-4)
- [ ] `Evaluations/atoms/` (e.g. `runMetrics` re-export) → packages → **delete** (WP-4)
- [ ] `pages/evaluations/NewEvaluation/state/` (run-creation state) → `@agenta/evaluations` → **delete** (WP-4)
- [ ] `state/evaluator/` → confirm superseded by `entities/workflow` → **delete if dup** (WP-4)

> Presentational, app-specific components (e.g. EmptyState\*) may remain in OSS — they are not
> services/utils/data-layer. Views with embedded data logic (`EvalRunDetails`,
> `EvaluationRunsTablePOC`) move to `evaluations-ui`; only their route wrappers stay.

### 7.2 Verification gate (must pass at final DoD — run with a backend-less grep)

Run from `web/`. Each must return **no output** (except paths on the explicitly-tracked
terminal list — legacy bridge + onlineEvaluations — until their terminal WPs land):

```bash
# 1. No eval HTTP calls left in OSS/EE (axios to eval endpoints)
grep -rnE "axios\.(get|post|patch|delete)\(.*/(evaluations|simple/evaluations)" oss/src ee/src | grep -v node_modules

# 2. No eval service dirs left
find oss/src/services -type d | grep -iE "eval"

# 3. No eval data-layer atom dirs left
find oss/src/components -type d | grep -iE "EvalRunDetails/atoms|EvaluationRunsTablePOC/atoms|Evaluations/atoms"

# 4. No eval data hooks/utils left
find oss/src/lib -type d | grep -iE "usePreviewEvaluations|useEvaluationRunMetrics|lib/evaluations"

# 5. No OSS-side eval ETL left (moved to @agenta/evaluations + evaluations-ui)
find oss/src/components -type d | grep -iE "EvalRunDetails/etl"

# 6. No jotai atoms defined in remaining OSS eval code (should be 0)
grep -rlE "atom\(|atomFamily\(|atomWithQuery\(|atomWithMutation\(" oss/src/components/EvalRunDetails oss/src/components/EvaluationRunsTablePOC 2>/dev/null | grep -v node_modules
```

A non-empty result that is NOT on the tracked-terminal list = the migration is **not done**.
The terminal list (legacy bridge, onlineEvaluations) must have its own filed deletion WPs so
it is never "forgotten" — track them in §10 Open until closed.

## 8. Testing & regression methodology

**Hard rule — test the SHIPPED atoms, against the REAL API, never a replica.** Every WP that
moves state/logic ships a headless integration test that:
1. **Imports and exercises the exact shipped surface** being moved — the real molecule
   selectors, the real controller atoms/actions, the real store atoms, the real api functions.
   The test must NOT re-derive, re-implement, or hand-roll the logic it's verifying. If you
   delete the package code, the test must fail to compile — that's the proof it's testing the
   real thing.
2. **Runs against the real backend** (gated on `AGENTA_API_URL`+`AGENTA_AUTH_KEY`, ephemeral
   account; pattern: `evaluationRun.integration.test.ts`). Setup MAY seed data via the raw Fern
   client (entities can't depend on `evaluations`), but **all assertions go through the shipped
   package surface**, not the raw client.
3. **Covers worker-computed data** (metrics) via the read-only real-project smoke
   (`parseExistingRuns.integration.test.ts`) — it can't be produced in the ephemeral harness.

Anti-pattern that is explicitly banned (it caused this migration's mapping-kind bug): a test
that constructs its own payload/logic (e.g. hand-built `mappings:[]`) instead of calling the
shipped builder/selector — it passes against broken code and proves nothing.

**Per-WP integration coverage (the shipped surface each WP's test must drive):**

| WP | Shipped surface under test (real atoms) | Seed | Worker-data |
|---|---|---|---|
| WP-0 | `evaluationScenario` molecule (api + selectors) | create run+scenario via Fern | — |
| WP-1 | `evaluations` session controller (scenario nav/status/metrics/`evaluatorColumnDefs`) + annotation wrapper | populated run | real-project smoke |
| WP-2 | `evaluations` metric/schema fns (`getMetricFieldsFromEvaluator`, `getOutputsSchema`, …) | run with evaluator steps | real-project smoke |
| WP-3 | `evaluations` run-list store (list query, filters, search, windowing) | runs/queues | — |
| WP-3.5 | `evaluations` ETL — hydrate real scenarios + apply a real `rowPredicateFilter`/`filterSchema` | populated run | real-project smoke |
| WP-4 | parity: package-driven derived data == OSS baseline, for the same run id | real runs | real-project smoke |

- **Parity tests (WP-4):** assert the package-driven view produces the same rows/columns/
  metric values as the OSS baseline for the same run id (snapshot the derived data, not pixels).
- **Manual UI matrix:** the §4 routes, for both annotation (keep-green) and eval (parity)
  flows. Required before any OSS deletion.
- **Gating reminder:** integration tests SKIP (read green) without env — never treat a skipped
  run as a pass. Run with the backend explicitly. A WP's "tests green" gate means *ran with a
  backend and passed*, not *skipped*.

---

## 9. Definition of done (whole migration)

- One evaluation engine in `evaluations`/`evaluations-ui`; `annotations`/`annotations-ui` are
  the queue delta on top, depending on it.
- `@agenta/annotation` no longer contains generic eval logic.
- OSS owns only route handlers + `-ui` providers for eval. **Zero OSS residue:** the §7
  cleanup ledger is fully checked off and the §7.2 verification commands return empty (no eval
  services, no eval data-layer atoms, no eval data utils/hooks in `web/oss`/`web/ee`) — save
  the explicitly-tracked terminal items, which must each have a filed deletion WP, not be left
  silently.
- Human-eval and annotation-queue are presets over the same engine (unblocks replacing human
  evals with annotation queues).
- All regression gates green; annotation never regressed.
- **The §11 known-bugs ledger is fully resolved** — every entry fixed (or explicitly waived
  with the owner's sign-off). The migration is NOT done with an open §11 bug.

---

## 10. Decisions locked (from review) vs open

**Locked:** extract from annotation (source of truth for the session/scenario/metrics engine)
with OSS-parity gating before deletion; `entities` is the entity-definitions home; ONE generic
configurable table moved (not rewritten) from `AnnotationQueuesView`.

**Reversed 2026-06-09:** the eval-run **ETL moves to `evaluations`** (was "stays in
entities"). The ETL filtering is a feature where **OSS is ahead of annotation** (annotation
has none), so it's extracted from OSS `EvalRunDetails/etl` into `evaluations`/`evaluations-ui`
(WP-3.5), and `entities` keeps only entity definitions.

**Open (decide in-flight, narrowly):** exact home of `markCompleted`/completion + queue
metadata (§3.1 judgment calls); whether `annotation`→`annotations` rename happens now or later
(WP-5); the `buildRunIndex` vs `etl` gap resolution (§6).

---

## 11. Known bugs / coverage gaps to fix before DoD

Bugs and migration-introduced test-coverage gaps that must be resolved before §9 DoD. Each is
either a real user-facing defect (note the origin) or a test dropped/disabled by a move. Do NOT
close the migration with an open entry here.

### 11.1 Batch "add all matching to queue" ignores the observability time window (pre-existing)

- **Discovered:** 2026-06-09, during WP-1 manual QA. **Origin:** pre-existing OSS observability
  code — **NOT** a WP-1/migration regression (the batch-add scan path is untouched by the
  migration commits; confirmed via `git diff`).
- **Symptom:** with an observability filter + "Last 7 days" range active, "add all matching to
  queue" adds up to the cap (1000 / `DEFAULT_MAX_ITEMS`, hobby tier) including traces far older
  than the window ("some look invalid"), even when the project has far fewer than 1000 traces
  in the last 7 days.
- **Root cause (traced):** the two trace-query paths shape the time window differently. The main
  table builds an explicit `windowing: {oldest, newest}` object and the cursor loop is bounded by
  it. The batch-add **scan** path passes `oldest`/`newest` as **flat top-level params**
  (`buildTraceQueryParams` → `params.oldest` from `sort`) and pages **backward via the `newest`
  cursor** through `createAdaptiveTracePageFetcher` → `executeTraceQuery`. The lower-bound
  termination (`nextCursor <= params.oldest` → stop) is wired **only in the `has_annotation`
  branch** of `executeTraceQuery` (`oss/src/state/newObservability/atoms/queryHelpers.ts` ~L304–308);
  on the **plain-filter path** nothing stops backward paging at `params.oldest`, so it walks all
  history to the cap.
- **Files:** `oss/src/components/pages/observability/components/ObservabilityHeader/useBatchAddTracesToQueue.tsx`,
  `oss/src/state/newObservability/etl/adaptiveTracePageFetcher.ts`,
  `oss/src/state/newObservability/atoms/queryHelpers.ts` (`executeTraceQuery`), and
  `fetchAllPreviewTracesWithMeta` (confirm it forwards `oldest` to the backend — last piece to verify).
- **Fix direction:** apply the `params.oldest` lower-bound termination on the plain-filter scan
  branch too (mirror the has-annotation branch), or have the scan reuse the main table's
  `windowing` shape so both paths bound identically. Fix on its **own branch**, not mixed into a
  migration WP.
- **UPDATE 2026-06-11 — original root cause FALSIFIED by code inspection.** The plain-filter
  branch DOES have the lower-bound cursor termination (`minVal <= lowerBound → nextCursor =
  undefined`, in `executeTraceQuery`'s tail) and it has existed since 2025-12-19 (`80b99892f4`) —
  pre-dating the Jun 9 repro. The full chain is verified correct in current code: scan
  `params.oldest` (from sort) → `createAdaptiveTracePageFetcher` preserves it →
  `fetchAllPreviewTracesWithMeta` → `buildWindowAndFilter` maps flat `oldest`/`newest` →
  Fern `windowing.{oldest,newest}` → backend-bounded query; cursor pages stop at the lower bound.
  Candidate explanations for the observed over-add: (a) the legacy pre-Fern transport in the code
  running at repro time (replaced by the AGE-3788 Fern path now merged via v0.103.1) handled the
  flat window params differently; (b) accumulation across multiple scan runs (one screenshot
  showed a queue at 10,647 items — far above one run's 1,000 cap); (c) "invalid-looking" rows
  being unresolvable-ref scenarios rather than out-of-window traces.
- **Status: ✅ CLOSED 2026-06-11.** Re-repro on the current stack captured the actual
  `/traces/query` payloads: `windowing.oldest` present, cursor descending — transport correct.
  The "over-add" was real data: the seeded eval runs generated thousands of in-window
  invocation traces (one queue holds 11,647 items), so 1,000+ matches were legitimate; user
  concurred ("maybe that was my mistake"). Related but separate: the queues-table ordering
  complaint from the same QA was a REAL bug (id-DESC paging vs created_at display) — fixed
  end-to-end in commit `43523a6695` (backend created_at windowing + tie-break fix + FE
  windowing threading), verified live by the user.

### 11.2 Combined paginatedStore+molecule leak test dropped in WP-3.5a (coverage gap)

- **Discovered/introduced:** WP-3.5a (moving `evaluationRun/etl` → `@agenta/evaluations`).
- **What:** the entities longrun leak test `runLoop.combinedLeak.test.ts` had a "Combined leak:
  paginatedStore + molecule layer" block that depended on `evaluationRun/etl/cacheDiagnostics`.
  Keeping it in entities after the ETL moved would force an `entities → evaluations` import cycle
  (forbidden). It was **removed from entities and NOT relocated** to evaluations — relocating it
  faithfully needs a raw `node --import tsx` leak harness that crashes on the entities barrels'
  transitive `@agenta/ui` CSS imports, which would require 3+ new UI-free entities subpaths +
  a react-query dep + a CSS-stub loader — beyond the WP-3.5a "≤2 API gaps" guard. The generic
  `instrumentedAtomFamily` leak block stays in entities and still runs.
- **Net:** lost leak-regression coverage for the paginatedStore + molecule combination.
- **Fix direction:** add a UI-free `@agenta/evaluations`-side leak harness (or narrow UI-free
  entities subpaths) that exercises the combined paginatedStore + molecule path. Its own task.
- **Status:** ✅ RESOLVED — restored as `web/packages/agenta-evaluations/tests/unit/combinedLeak.test.ts`
  (vitest, runs in the standard unit suite): 12-iteration paginatedStore+molecule pipeline asserting
  atom-family params and TanStack cache entries drain to baseline after per-iteration teardown
  (heap-slope budget additionally asserted when `--expose-gc` is available).

### 11.3 Pre-existing latent runtime bugs in EvalRunDetails, surfaced by WP-4e-2a (NOT migration regressions)

WP-4e-2a type-checked the EvalRunDetails atom layer (which OSS ships with ~45 tsc errors the bundler
ignores). Five latent runtime bugs were **typed-as-is, NOT fixed** (behavior preserved). They predate
the migration; triage/fix separately (likely with the EvalRunDetails parity QA). For QA:
1. **`atoms/metrics.ts` `applyAggregatesToRaw`** — referenced in `buildRunLevelMetricData`, defined/
   imported nowhere → `ReferenceError` whenever run-level metric data is built.
2. **`atoms/runMetrics.ts` `metricProcessor`** — referenced at the run-level-gap branch (~L880) but the
   in-scope processor is named `processor` → `ReferenceError` when `shouldMarkRunLevelGap` is true.
3. **`utils/buildSkeletonColumns.ts`** — the "outputs" group call passes 5 positional args (omits
   `stepType`) → at runtime `order: NaN`, `stepType: 200` for the outputs skeleton group.
4. **`utils/buildPreviewColumns.tsx`** — `column.kind === "input"` is always false (kind has no
   `"input"`; likely meant `stepType`/`columnType`) → width always falls through to `metric`.
5. **`atoms/runMetrics.ts` (~L1223/1352)** — `loadable.data` is the full `AtomWithQueryResult` wrapper,
   not the unwrapped `RunLevelStatsMap` (elsewhere at ~L1050 it's correctly unwrapped via `"data" in`).
   Possible run-level-stats unwrap inconsistency.
- **Status:** OPEN — pre-existing; flag to eval owners; verify during EvalRunDetails parity QA.

### 11.4 `no-explicit-any` file-disables on relocated eval atoms (WP-4e-2b debt)

- **Introduced:** WP-4e-2b (relocating EvalRunDetails atoms → `@agenta/evaluations/state/evalRun`).
- **What:** 27 relocated files carry a file-level `/* eslint-disable @typescript-eslint/no-explicit-any */`
  header — ~294 load-bearing dynamic-backend-shape `any`s. Done deliberately to keep the move
  byte-identical (faithful) on a keep-green parity layer rather than risk a 294-site retype; matches
  existing package precedent (`buildRunIndex`, `usePreviewEvaluations/types`).
- **Fix direction:** tighten to precise/`unknown` types incrementally, file-by-file, after the
  EvalRunDetails parity QA confirms behavior.
- **Status:** OPEN — debt, not a blocker; incremental cleanup.
- **WP-4h extension:** the 3 relocated `MetricDetails` files (`MetricDetailsPreviewPopover.tsx`,
  `MetricDetailsPopover/assets/{ResponsiveMetricChart,utils}.tsx|ts`) carry the same file-level
  disable for the same reason (dynamic backend stat blobs as `Record<string, any>`). Same fix
  direction.

### 11.6 Eval render trees still on the OSS InfiniteVirtualTable copy (follow-up WP)

- **Discovered:** 2026-06-11 components/hooks consolidation audit. The `EvaluationRunsTablePOC`
  and `EvalRunDetails` RENDER TREES still consume the OSS `@/oss/components/InfiniteVirtualTable`
  copy (shell, export hook, columnVisibility base, scroll-container context). The `@agenta/ui`
  copy has diverged **ahead** (row-height, type-chips, grouped trees — 300+ diff lines on the
  shell). Partial re-points would split jotai context/atom identity between the two copies, so
  the switch must be done per render-tree in one pass (POC tree, then EvalRunDetails tree), with
  behavioral QA. Self-contained leaf pieces were already re-pointed (FiltersPopoverTrigger,
  TableTabsConfig). Its own WP; pairs naturally with 4h (view move to evaluations-ui).
- **Status:** ✅ RESOLVED (slice 1 `c2a420bd02` switched the eval trees; slice 2 `c7baf6d2e8`
  re-pointed the remaining consumers — Testsets/Testcases/Playground/AddToTestsetDrawer trees +
  the testcase/testset/shared entity-state paginatedStores' table-infra imports — and **DELETED
  the entire OSS `components/InfiniteVirtualTable/` copy** (55 files / ~9,928 LOC). The entity-state
  table-infra imports were independent of the molecule consolidation, so deletion did NOT need it.
  oss tsc 480→471. Whole app now uses one table component (`@agenta/ui/table`).

### 11.5 `useScenarioLiveUpdates` + `evaluationPreviewTableStore` not yet moved (WP-4g deferral)

- **Discovered:** WP-4g. `EvalRunDetails/etl/useScenarioLiveUpdates.ts` (eval data logic) is still in
  OSS because it imports `EvalRunDetails/evaluationPreviewTableStore.ts`, which is `@/oss`-coupled via
  `@/oss/components/InfiniteVirtualTable`.
- **Fix direction:** migrate `evaluationPreviewTableStore` onto `@agenta/ui/table`'s
  `createInfiniteTableStore`/`useInfiniteTablePagination` (the package equivalents `EvaluationListView`
  already uses) → `@agenta/evaluations`, then `useScenarioLiveUpdates` moves cleanly. Its own small WP.
- **Status:** ✅ RESOLVED (WP-4g-2). The OSS `InfiniteVirtualTable` turned out to be an API-compatible
  STALE COPY of `@agenta/ui/table` (not divergent) — both files moved with a simple re-point. KEY
  finding: the table infra is re-pointable; only the ENTITY-STATE (testcase/testset) is genuinely
  divergent (the consolidation doc). oss tsc dropped 522→487 (index-sig fix unmasked+fixed ~35 latent).

> **Note:** the OSS tsc baseline dropped from **588 → 522** at WP-4e-2a (the ~45 eval-atom errors +
> ~21 root-caused side effects fixed). **All subsequent "oss tsc steady" gates use 522, not 588.**

## 12. WP-4h — eval VIEW layer → `@agenta/evaluations-ui` (classified cascade + phased plan)

User explicitly chose the full view-layer move (2026-06-11) over the cheaper in-OSS tidy.
The data goal is already done bar one service (`onlineEvaluations` start/stop), so WP-4h is
purely a **presentation relocation**: the three OSS dirs `Evaluations/` (9 files, the
`MetricDetailsPopover`), `EvaluationRunsTablePOC/` (37 files, run-list), `EvalRunDetails/`
(113 files, run-details) → one `@agenta/evaluations-ui` tree as siblings
`{RunsTable, RunDetails, MetricDetails}` (drop the `POC` suffix; fold the misnamed
`Evaluations/`).

### 12.1 The ~90 `@/oss` couplings, classified

Destination `@agenta/evaluations-ui` already exists (nearly empty) and the seam registry
(`evalRunInjection.ts` / `registerEvalRunInjections`) from WP-4e is reusable.

| Bucket | Count | Disposition |
|---|---|---|
| Internal cross-refs (the 3 dirs) | ~9 | become relative on move — free |
| Pure utils (`lib/helpers/*`, `runMetrics/formatters`, `onboarding`) | ~8 | move → `@agenta/shared` |
| Generic UI (`GenericDrawer`, `EnhancedUIs/Drawer`, `SimpleSharedEditor`, `EmptyComponent`, `QuickDateRangePicker`, `lib/atoms/virtualTable`, `CustomTreeComponent`, `DrillInView`) | ~10 | move → `@agenta/ui` **or** seam if self-coupled |
| OSS app state/hooks (`state/{project,app,appState,workspace,session,url,workflow,queries}`, `hooks/{useURL,useProjectPermissions,useQuery,useAppId}`, `lib/hooks/{useBreadcrumbs,useAnnotations}`) | ~25 | **inject via seam** (extend `registerEvalRunInjections`) |
| `state/entities/{testset,testcase}` | 3 | **seam** — do NOT drag in the entity consolidation (the 14–18d initiative) |
| `services/{onlineEvaluations,annotations}/api` | 5 | move the eval-exclusive ones → `@agenta/evaluations`; seam annotations if shared |
| **References subsystem** | 23 | ⚠️ **shared** — 3,478 LOC / 20 files / **8 non-eval consumers** → **seam, do not relocate** |
| **onlineEvaluation pages** | ~12 | 2,863 LOC / 20 files, eval-specific but cascades → **seam** (inject EmptyStates/FiltersPreview/EvaluatorDetails) |
| `SharedDrawers/AnnotateDrawer/*`, `SharedGenerationResultUtils` | ~7 | shared → seam or move-to-package |

### 12.2 Locked decision: SEAM the shared subsystems, MOVE the eval-exclusive code

"Full move" is only completable if References / onlineEvaluation / AnnotateDrawer are
**injected from OSS**, not physically relocated. References especially is a shared
annotation subsystem with **8 non-eval consumers** — relocating it is a separate,
unbounded migration and out of scope. This mirrors the WP-4e discipline (seam the
`@/oss` wall rather than drag in the consolidation). Physical relocation of References can
be an additive follow-up. End-state: eval VIEW layer is fully package-resident; the
genuinely-shared subsystems stay in OSS behind seams.

### 12.3 Phased execution (each phase: build+lint+integration-test, STOP-on-cascade)

- **4h-0 — data tail.** Move `startSimpleEvaluation`/`stopSimpleEvaluation` + `QueryWindowingPayload`
  → `@agenta/evaluations`; delete `@/oss/services/onlineEvaluations`. 3 importers. On-goal, small.
- **4h-1 — utils/UI base.** Move pure utils → `@agenta/shared`, generic UI → `@agenta/ui`
  (or seam the self-coupled ones). tsc-catchable, no behavioral change.
- **4h-2 — seam scaffolding.** Extend `registerEvalRunInjections` with the view-layer seams:
  OSS app state/hooks, `state/entities/{testset,testcase}`, References renderers,
  onlineEvaluation components, AnnotateDrawer. OSS `-ui` provider registers the real sources.
- **4h-3 — relocate `MetricDetails`** (`Evaluations/`, only 1 `@/oss` coupling) → `evaluations-ui`. Canary.
  ✅ DONE — moved 9 files → `evaluations-ui/src/components/MetricDetails/`, fixed 7 latent strict-null
  type errors + added `usehooks-ts`/`jotai-scheduler` deps, re-pointed 9 OSS consumers to the barrel,
  deleted OSS `components/Evaluations/`. evaluations-ui check green; oss tsc 471→464 (latent errors left
  with the files); behavioral QA pending (annotations queue metric popover + run-details metric cells).
- **4h-4 — relocate `RunsTable`** (`EvaluationRunsTablePOC` → `RunsTable`, drop POC) → `evaluations-ui`.
- **4h-5 — relocate `RunDetails`** (`EvalRunDetails`) → `evaluations-ui`. Largest; behavioral QA.
- **4h-6 — repoint route shells** (the 6 pages) at `@agenta/evaluations-ui`; OSS keeps only
  route shells + the injection-seam provider. Delete the 3 emptied OSS dirs.
- **Gate:** full behavioral QA across run-list (app overview), run-details (results +
  single_model_test), annotation queue metric popover, annotate flow.
