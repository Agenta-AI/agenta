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
| `@agenta/entities` | Each entity: `evaluationRun`, **`evaluationScenario`** (promote — today a half-schema under `evaluationRun`), `evaluationResult`, `evaluationMetric`, `evaluationQueue`/`simpleQueue`, `annotation`, `workflow` (evaluators), `testcase`/`testset`/`trace`. Plus `evaluationRun/etl` (hydration, mapping/column resolution, filtering) — **stays here** (decision locked). | Mostly exists |
| `@agenta/evaluations` | Generic *wiring*: run creation (exists), the **run list store**, the **scenario session engine**, **metrics processing**, kind derivation, status rollup. Kind-agnostic. | Has run-creation only; rest extracted here |
| `@agenta/annotations` (rename/refocus current `@agenta/annotation`) | The queue delta only: annotation submit form, queue assignment, focus-mode, testset write-back. Depends on `evaluations`. | Exists but "upside-down" — see §3 |
| `@agenta/evaluations-ui` (NEW) | Run list table (ONE generic configurable table, moved from `AnnotationQueuesView`), run detail view, scenario table, metric cells, `CreatedByCell`, etc. | New; populated by moving existing UI |
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

### 3.1 Controller decomposition (the extraction map)

`annotationSessionController` →

- **Generic → `evaluations` sessionController:** `activeRunId`, `currentScenarioId`,
  `currentScenarioIndex`, `focusedScenarioId`, `scenarioIds`, `navigableScenarioIds`,
  `progress`, `hasNext`, `hasPrev`, `isCurrentCompleted`, `scenarioStatuses`,
  `scenarioRecords`, `scenariosQuery`, `activeView`, `scenarioTraceRef`, `scenarioStepsQuery`,
  `scenarioTestcaseRef`, `scenarioTraceQuery`, `scenarioRootSpan`, `scenarioMetrics`,
  `scenarioMetricsQuery`, `scenarioMetricForEvaluator`, `evaluatorIds`,
  `evaluatorRevisionIds`, `evaluatorStepRefs`, `annotationColumnDefs` (rename →
  `evaluatorColumnDefs`), `listColumnDefs`, `traceInputKeys`, `testcaseInputKeys`,
  `testcaseData`; actions `openSession`(`openQueue`), `navigateNext/Prev/ToIndex`,
  `syncScenarioOrder`, `markCompleted`, `completeAndAdvance`, `closeSession`, `setActiveView`,
  `applyRouteState`.
- **Annotation-specific → stays in `annotations`:** `activeQueueId`, `activeQueueType`,
  `queueName`/`queueKind`/`queueDescription` (queue metadata), `hideCompletedInFocus`,
  `focusAutoNext` (focus-mode UX), `scenarioAnnotations*`, `scenarioAnnotationByEvaluator`
  (annotation entity reads), all add-to-testset (`defaultTargetTestsetName`,
  `pendingTestsetSelection*`, `addToTestset*`, `selectedScenarioIds`, `canSyncToTestset`,
  `syncToTestsets`, `addScenariosToTestset`).
- **Judgment calls (decide at extraction, don't pre-bake):** `markCompleted`/
  `completeAndAdvance` (generic completion vs human workflow), queue metadata (run metadata
  under unification). Default: put in `evaluations` if the eval-run view also needs it.

`annotationFormController` →

- **Generic → `evaluations`:** `getOutputsSchema`, `getMetricFieldsFromEvaluator`,
  `getMetricsFromAnnotation`, `evaluators`, `evaluatorResolution`, `effectiveMetrics`,
  `baseline`.
- **Annotation submit → stays in `annotations`:** `updateMetric`, `submitAnnotations`,
  `resetEdits`, `hasPendingChanges`, `hasFilledMetrics`, `isSubmitting`, `submitError`,
  `setScenarioContext`, `clearFormState`.

---

## 4. Source-of-truth & regression baselines

- **Extract FROM (source of truth):** `@agenta/annotation` + `@agenta/annotation-ui`.
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

Each WP lists: **Move** (what/from→to), **DoD** (definition of done), **Regression gate**.
Do them in order. Do not start a WP until the previous one's DoD + gate pass.

> Pre-flight (every WP touching package manifests): keep all `package.json` + lock changes in
> ONE commit (prettier hook rewrites the lock otherwise). Respect import hierarchy. `no any`.
> Run `pnpm --filter <pkg> build` + `lint` before committing.

### WP-0 — Scaffold + entity promotion (no behavior change)
- **Move:** create `@agenta/evaluations-ui` package (manifest, build, lint, test config,
  empty `src/index.ts`) registered in OSS+EE `next.config` + `ee/package.json` (mirror the
  `@agenta/evaluations` registration done this session). Promote `evaluationScenario` to a
  first-class `entities` module (molecule/api/core) from the half-schema currently under
  `evaluationRun`.
- **DoD:** packages build; `evaluationScenario` molecule has unit + integration tests
  (populated scenario round-trip, like the existing eval-run integration suite).
- **Regression gate:** full entities unit (591+) green; eval integration green; OSS/EE build.

### WP-1 — Extract the scenario **session engine** → `@agenta/evaluations`
- **Move:** the generic selectors/actions from `annotationSessionController` (§3.1) into a new
  `evaluations` session controller. `@agenta/annotation` keeps the annotation-specific shell
  and now *imports the generic engine from `evaluations`* (add the dependency). Rename
  annotation-flavored names to kind-agnostic (`openQueue`→`openSession`,
  `annotationColumnDefs`→`evaluatorColumnDefs`, etc.) with re-exports kept in `annotation`
  temporarily to avoid churn.
- **DoD:** `@agenta/annotation` controller is now a thin wrapper over `evaluations`; no logic
  duplicated. New `evaluations` session controller has headless integration tests
  (scenario nav, statuses, metrics, column defs against a real populated run — extend the
  existing harness; reuse the real-project read-only smoke for worker-computed metrics).
- **Regression gate:** annotation routes manually QA'd green (open queue, navigate scenarios,
  metrics render); annotation package tests green.

### WP-2 — Extract metric/schema extraction (form controller generic half) → `evaluations`
- **Move:** `getOutputsSchema`, `getMetricFieldsFromEvaluator`, `getMetricsFromAnnotation`,
  `evaluators`, `evaluatorResolution` into `evaluations`. The annotation submit form stays in
  `annotation`, importing these.
- **DoD:** no metric/schema extraction logic left duplicated; unit tests moved/added.
- **Regression gate:** annotation submit flow QA'd (fill metric → submit → persists).

### WP-3 — Move the run **list store + table** → `evaluations` / `evaluations-ui`
- **Move:** the queue list store (`simpleQueue/paginatedStore` pattern) generalized into an
  `evaluations` run-list store; **move `AnnotationQueuesView` into `evaluations-ui` as ONE
  generic, configurable table** (config props for columns/cells/filters/kind preset). Cells
  (`CreatedByCell`, `EvaluatorNamesCell`, `QueueProgressCell`) move with it. `annotations-ui`
  renders the table with a "queue" preset.
- **DoD:** one table component; annotation queue list renders via the generic table + preset;
  no second table authored.
- **Regression gate:** annotation queue list QA'd (list, filter, search, pagination,
  created-by, progress).

### WP-4 — Point OSS eval views at the packages; prove parity; DELETE OSS dups
- **Move:** re-point `EvaluationRunsTablePOC` (run list) and `EvalRunDetails` (run detail +
  scenario table + metrics) to consume the `evaluations`/`evaluations-ui` engine + table.
  Then **delete** the OSS eval atoms (~38 in `EvalRunDetails/atoms`, the `EvaluationRunsTablePOC`
  store/atoms) and the now-thin OSS service shells from the prior session.
- **DoD:** OSS eval views are thin route handlers + a `-ui` provider supplying inputs (like
  `AnnotationUIProvider`); the ~50 OSS eval atom files are gone; no `@agenta/*` ← OSS bridge.
- **Regression gate (the big one):** parity vs the §4 OSS baseline on every listed route —
  auto eval results, human eval, single-model test, app overview, EE results — covering: run
  list (filters/search/sort/delete), run detail (scenario table, columns, metric columns
  run-level + temporal, annotate drawer write-back + status rollup). Use integration tests at
  the atom/API layer + the real-project read-only smoke + a manual UI matrix. Capture
  before/after screenshots per route.

### WP-5 — Rename `annotation`→`annotations`, `annotation-ui`→`annotations-ui` (optional/last)
- Cosmetic alignment with `evaluations`/`evaluations-ui`. Pure rename + re-export shims, no
  logic. Do last to avoid churn during WP-1..4.

---

## 6. Genuine gaps (the only places new code is allowed)

Quantify during WP-1/WP-4; if a capability exists in neither annotation nor a clean OSS form,
it's a gap. Known candidates (verify, don't assume):

- **Auto/invocation specifics** the annotation engine never needed: the auto-eval run loop,
  invocation-step columns, run-level metric *aggregates* (annotation is human/per-scenario).
  `runMetrics.ts` (13 atoms, temporal + run-level) is the prime suspect for eval-only logic.
- **`buildRunIndex`** (OSS `lib/evaluations`) vs `etl/resolveMappings`/`groupRunColumns`:
  overlapping column resolution. Determine if `buildRunIndex` is a true gap or a thin
  pre-grouping layer collapsible into `etl`. (Earlier investigation said "no equiv"; the
  `etl` evidence suggests otherwise — re-verify.)

Anything found here gets a one-line gap entry + a focused, tested addition in `evaluations` —
NOT a reimplementation of something that already exists.

---

## 7. Testing & regression methodology

- **Headless integration** (gated on `AGENTA_API_URL`+`AGENTA_AUTH_KEY`, ephemeral account):
  every moved controller/store gets tests that create a real run/scenario and exercise the
  selectors/actions — the pattern established this session
  (`evaluationRun.integration.test.ts`, 18 tests). Worker-computed data (metrics) verified via
  the **read-only real-project smoke** (`parseExistingRuns.integration.test.ts`).
- **Parity tests (WP-4):** assert the package-driven view produces the same rows/columns/
  metric values as the OSS baseline for the same run id (snapshot the derived data, not pixels).
- **Manual UI matrix:** the §4 routes, for both annotation (keep-green) and eval (parity)
  flows. Required before any OSS deletion.
- **Gating reminder:** integration tests SKIP (read green) without env — never treat a skipped
  run as a pass. Run with the backend explicitly.

---

## 8. Definition of done (whole migration)

- One evaluation engine in `evaluations`/`evaluations-ui`; `annotations`/`annotations-ui` are
  the queue delta on top, depending on it.
- `@agenta/annotation` no longer contains generic eval logic.
- OSS owns only route handlers + `-ui` providers for eval; the ~50 OSS eval atom files and the
  Fern-wrapped OSS service shells are deleted.
- Human-eval and annotation-queue are presets over the same engine (unblocks replacing human
  evals with annotation queues).
- All regression gates green; annotation never regressed.

---

## 9. Decisions locked (from review) vs open

**Locked:** extract from annotation (source of truth) with OSS-parity gating before deletion;
`entities` stays as entity-definitions home; ONE generic configurable table moved (not
rewritten) from `AnnotationQueuesView`; `etl` stays in `entities`.

**Open (decide in-flight, narrowly):** exact home of `markCompleted`/completion + queue
metadata (§3.1 judgment calls); whether `annotation`→`annotations` rename happens now or later
(WP-5); the `buildRunIndex` vs `etl` gap resolution (§6).
</content>
