# Eval Scenarios Table — ETL Integration

**Created:** 2026-05-22
**Status:** RFC — Eng-reviewed; ready to implement (Phase 1)
**Related:** [eval-etl-engine](./eval-etl-engine.md), [etl-engine](./etl-engine.md), [eval-filtering](./eval-filtering.md)
**Authors:** Arda

---

## Summary

The `EtlPocScenarios` PoC (the `/etl-poc` page) showed an evaluation run
scenarios table can be fast with a specific strategy: thin rows (identity
only), page-level bulk hydration into molecule caches, self-resolving cells,
and ETL-engine-backed predicate filtering.

This doc covers folding that strategy into the **real** eval run scenarios
table (`EvalRunDetails/Table.tsx`) and retiring the PoC. It is **phased** — a
core production table never big-bangs.

> **Eng review reframe.** The first draft called the data-layer swap a
> "low-risk mechanical port." That was wrong. The PoC only ever ran against
> *finished* runs — it fabricates `scenario: {status: "success"}`
> (`EtlResolvedCell.tsx:135`, `index.tsx:692`). Rendering pending / running /
> failed scenarios and a real "skeleton while pending" policy is **unbuilt
> design work**, now scoped into Phase 1. See [Resolved decisions](#resolved-decisions).

---

## Current state — two implementations of one table

| | Production (`EvalRunDetails/Table.tsx`) | PoC (`EtlPocScenarios`) |
|---|---|---|
| Store | `evaluationPreviewTableStore` — semi-full rows | `scenarioThinPaginatedStore` — `{key, id, scenarioId}` |
| Columns | backend metadata (`usePreviewColumns`) | run graph (`useEtlColumns` → `resolveMappings`) |
| Cell data | per-visible-cell fetch (`useScenarioCellValue`) | `EtlResolvedCell` from molecule caches; `useHydrateScenarios` bulk-fills per page |
| Filtering | none | predicate bar + ETL viewport-fill loop |
| Comparison | interleaved rows, 2-4 runs | single run |
| Live runs | 5s run-status poll; 15-30s `staleTime`; human-only metrics gap-fill | none — assumes terminal data |
| Fetch path | `fetchEvaluationScenarioWindow` | **same** `fetchEvaluationScenarioWindow` |

`scenarioPaginatedStore.ts`'s own header states the intent: *"replace
`evaluationPreviewTableStore` with this once the scenarios view is on the
molecule-cache pattern."* This is that project.

---

## Resolved decisions

| # | Decision |
|---|----------|
| **Hydration shape** | Thin rows + self-hydrating cells. The thin row carries identity + `testcaseId` (comparison join key) + `status` (live-update + skeleton) — never column data. |
| **Column source** | Run graph (`data.steps` + `data.mappings`) via `resolveMappings`. **Correction:** `useEtlColumns` currently drops `group.kind === "other"` columns (`useEtlColumns.tsx:56`, "skip in the test page"). Production must keep them — that shortcut is removed in T2. |
| **Cell caching** | Same molecules over the same TanStack layer; no net regression *expected* — validated, not asserted, by the Phase 1 perf gate. |
| **D1 — phasing** | Phase the migration. Phase 1: data-layer swap. Phase 2: filtering. Phase 3: comparison + live + co-consumers. Then retire the PoC. Each phase reviewable and revertable; the table works between phases. |
| **D2 — comparison display** | Interleaved rows (today's model), not testcase-aligned columns. Compare-mode column set = shared testcase inputs + the **common-evaluator intersection** across compared runs + the standard invocation output. Reuses single-run column derivation. |
| **D3 — live updates** | Match production's modest bar: run-status poll + page invalidation while non-terminal + human-eval metrics gap-fill. No real scenario streaming. |
| **D5 — perf gate** | After Phase 1, benchmark the new table vs the current `useScenarioCellValue` table on a 1000+ scenario run with comparison on. A regression stops Phase 2. |
| **D8 — filter composition** | **Multi-predicate from day 1.** Phase 2 ships multi-condition AND/OR filtering, not the PoC's single predicate. The predicate type generalises to a condition *group* (`{op: "and" \| "or", conditions: RowPredicate[]}`); the filter bar reuses the observability multi-condition filter UI. Closed at Phase 2 start (was the one open decision). |

**No open decisions.**

---

## Architecture — target

The production table adopts the PoC strategy in place. Four layers (per
`eval-etl-engine.md`):

```
EvalRunDetails table (OSS UI)
  └── thin scenarios store ──> ETL filter pipeline ──> rendered viewport
        (identity + join keys)   (runLoop + filterTransform)   (InfiniteVirtualTable)
                                        │
        cells self-resolve from ────────┘
        molecule caches (results / metrics / testcases / traces)
        bulk-hydrated per page; cell-materialized on demand
```

- **Source** — the thin scenarios store; reuses `fetchEvaluationScenarioWindow`.
- **Transform** — the eval-specific `filterTransform`. "Skeleton while
  pending" for rows whose slices are not yet hydrated **or whose scenario has
  not yet run** — these two cases are distinct and both must be handled.
- **Sink** — the rendered viewport; the loop runs until the viewport fills.
- **Cells** — `EtlResolvedCell`, resolving from molecule caches.

---

## Phase 1 — column + cell swap

The table's internals, table-only. The focus drawer and `SingleScenarioViewer`
stay on `useScenarioCellValue` (kept alive) until Phase 3.

> **Implementation-time finding — T1 dropped.** Reading
> `evaluationPreviewTableStore.ts` confirmed it is *already* a thin store:
> `PreviewTableRow` carries only identity + `testcaseId` + `status` +
> `scenarioIndex` + comparison fields — zero column data — and it already does
> per-eval-type window order (line 114). The PoC's separate
> `scenarioThinPaginatedStore` exists only to drop a couple of cheap unused
> fields. **The store stays as-is — there is no T1.** The eng-review outside
> voice flagged this; a direct read confirmed it.

Phase 1 is the **column + cell swap** in `Table.tsx`. T2 and T3 are **coupled**
— a column definition carries its own cell `render` function, so the column
source and the cell renderer swap together in one change.

- **T2 — schema columns (display only).** Wire `useEtlColumns` /
  `resolveMappings` into `Table.tsx` for the **rendered** columns. **Remove the
  "other"-column drop** (`useEtlColumns.tsx:56`) so the visible set matches
  today — note this ripples: `ColumnLeaf["kind"]`, `EtlResolvedCell`'s
  `columnKind`, and `useCellMaterialization`'s slice map all need an "other"
  case. `usePreviewColumns` / `usePreviewTableData` / `columnResult` **stay
  alive** — the CSV export (`exportResolveValue`, `columnLookupMap`) is keyed
  off `columnResult` ids, which differ from `useEtlColumns` keys. Full
  retirement of the old column path moves to Phase 3 with the export
  migration (T5). Two column systems coexist transitionally (accepted under D1).
- **T3 — self-hydrating cells + non-terminal rendering.** `EtlResolvedCell` +
  `useHydrateScenarios` + `useCellMaterialization`, against the existing
  `evaluationPreviewTableStore` rows (keyed by `scenarioId`). **Not** purely
  mechanical: add real rendering for pending / running / failed / partial
  scenarios, and a "skeleton while pending" policy that distinguishes
  *slice-not-hydrated* from *scenario-not-run*. The PoC's `status: "success"`
  fabrication is removed.

**Perf gate (D5)** — after T2+T3 land: benchmark the new table against the
current one on a 1000+ scenario run, comparison on. Regression → stop, rethink.

---

## Phase 2 — filtering

- **T4 — multi-predicate filtering (D8).** Ships multi-condition AND/OR
  from day 1 — not the PoC's single predicate. `filterSchema` derives
  filterable fields: columns → evaluator steps → evaluator output schemas
  → typed fields + type-matched operators (`eval-filtering.md` D4). The
  predicate generalises from `RowPredicate` to a condition *group*
  (`{op: "and" | "or", conditions: RowPredicate[]}`, one nesting level for
  v1 — flat AND/OR, no arbitrary trees); `predicateToEntitySlices` takes
  the union of every condition's slices. The `filterTransform` evaluates
  the group per row against hydrated metrics; the loop runs until the
  viewport fills. The filter bar reuses the observability multi-condition
  filter UI. **Reuse `withRateLimitRetry`** for the scan — a low-hit-ratio
  filter scans many scenario + metric pages and EE throttling will 429 it
  (the batch-add lesson).

---

## Phase 3 — comparison, live updates, co-consumers

- **T5 — comparison.** A **build, not a port** — the PoC has zero multi-run
  code. Per compared run: a second store scope, a **schema fetch** (needed for
  the common-evaluator intersection), and per-run hydration of result slices
  (`testcase_id` lives on results). Then align compared runs to the *filtered*
  main rows by `testcase_id` (the `mergedRows` logic exists in production —
  port it over the thin/cache model). The **CSV export path**
  (`Table.tsx:542`) rebuilds the merge logic and migrates here too.
- **T6 — live updates.** Run-status poll + non-terminal page invalidation +
  human-eval metrics gap-fill.
- **T8 — co-consumer migration.** Migrate the focus drawer (`focusDrawerAtom`,
  `FocusDrawerHeader`, `FocusDrawerSidePanel`, `FocusDrawer`) and
  `SingleScenarioViewerPOC` off `useScenarioCellValue` + `evaluationPreviewTableStore`,
  then delete `useScenarioCellValue`.

---

## Retire the PoC

- **T7** — delete `EtlPocScenarios/` and the `/etl-poc` routes (oss + ee).
  Gated on Phase 3 parity verified.

---

## Design — interaction states & filter UX

From the design review (focused — the migration preserves the table's visual
design; these are the genuinely new design surfaces).

**Cell states:**
- *Skeleton (not hydrated)* — reuse the PoC's `EtlSkeletonCell`: a fixed-height
  placeholder bar, identical row height to a populated row, so there is no
  layout jump when data lands.
- *Non-terminal scenarios (running / failed / pending)* — match production's
  existing live-table rendering. Hard rule: a *running* cell must read as
  in-progress, visually distinct from a missing value — never a bare "—" for a
  running scenario (the user must be able to tell "computed nothing" from
  "still computing").

**Filter states:**
- *Scanning* — a live hit-ratio counter ("Scanned N / matched M", from
  `hitRatioAtom`), not a silent spinner. A picky filter scans thousands of
  scenarios to surface a few; the counter explains the wait and keeps trust.
- *No match* — a real empty state: "No scenarios match this filter" + a
  one-click **Clear filter** action. Not "No items found."
- *Rate-limited / scan failed* — keep the partial viewport visible with a
  non-blocking inline indicator ("Filtering paused — retrying…"). Never a
  blocking overlay.

**Filter bar** — lives in the eval run details header row, following the
observability `Filters` placement. Multi-predicate AND/OR composition (D8) —
reuses the observability multi-condition filter UI.

## Test plan

```
PLANNED COMPONENT                                    TESTS
T1 thin store          [GAP] page fetch → skeleton+merge; per-eval-type order
T2 schema columns      [GAP][CRITICAL][REGRESSION] resolveMappings column set
                              == usePreviewColumns for auto/human/online,
                              "other" columns INCLUDED — before deleting the old path
T3 cells               [GAP] resolve from caches; pending/running/failed render
                       [GAP] skeleton-while-pending: not-hydrated vs not-run
T4 filtering           [GAP] filterSchema typed fields; multi-predicate
                              AND/OR filterTransform — match/no-match/pending
                              + group semantics; [→E2E] multi-condition → rows
T5 comparison          [GAP] compare-run schema fetch; testcase_id join;
                              common-evaluator intersection; [→E2E] compare+filter
T6 live updates        [GAP] poll stops at terminal; page invalidation; gap-fill
T8 co-consumers        [VERIFIED] focus drawer + scenario viewer render
                              unchanged — independent old data path (D9)
```

Pure logic — `filterTransform`, `filterSchema` derivation, the comparison
testcase-join — unit-tests in `@agenta/entities` vitest (the batch-add
harness). The two `[→E2E]` flows go to Playwright. The T2 and T8 **regression
guards are mandatory** — they protect a user-visible column set and two live
co-consumers.

---

## Edge cases & constraints

- **Non-terminal scenarios** — pending / running / failed / partial rows must
  render; the PoC never did. Distinguish slice-not-hydrated from
  scenario-not-run.
- **"Other" columns** — `useEtlColumns` must keep them (T2).
- **Eval types** — auto / human / online all derive columns from the run
  schema; online fetches `descending`.
- **Filtered + comparison** — filtering the main run re-drives compare
  alignment; a filtered-out main row drops its compare group.
- **Filter scan throttling** — reuse `withRateLimitRetry` (T4).
- **Large-run memory** — within a run, bulk-hydrate fills caches;
  `useScopeChangeEviction` only evicts on run change. Verify at 10k scenarios;
  per-chunk eviction exists if needed.
- **Testset mismatch** — compared runs not sharing the main testset produce an
  empty testcase join (the candidate filter already guards this).
- **`EvalRunDetails` / `EvalRunDetails2` split** — do not deepen it; touched
  code consolidates into `EvalRunDetails/`.

---

## NOT in scope

- **Testcase-aligned comparison columns** — interleaved rows for now (D2).
- **Real scenario streaming** — match production's poll bar (D3).
- **Cross-run filter predicates** ("main high, run B regressed") — filter the
  main run only; cross-run is a v2 feature.
- **Consolidating `EvalRunDetails2`** — only the touched code moves.
- **Backend filter param** — client-side filter is v1 (`eval-filtering.md`).

## What already exists (reused, not rebuilt)

- The ETL engine + generic primitives (`@agenta/entities/etl`) — built and
  tested this session.
- `evaluationPreviewTableStore` — already a thin store (identity + `status`,
  no column data, per-eval-type order); kept as-is, no swap needed (T1 dropped).
- `fetchEvaluationScenarioWindow` — the scenario fetch; reused unchanged.
- `mergedRows` testcase_id-join alignment — ported, not reinvented.
- `withRateLimitRetry` — reused for the filter scan.
- The PoC's `useHydrateScenarios` / `useEtlColumns` / `EtlResolvedCell` /
  `useCellMaterialization` — ported (with the corrections above).

---

## Implementation tasks

**Phase 1 — column + cell swap** (T1 dropped — `evaluationPreviewTableStore` is already thin; see Phase 1)
- [x] **T2 (P1)** — schema columns for the **rendered** table; keeps "other" columns; **column-parity regression test** (`groupRunColumns.test.ts`). `usePreviewColumns`/`columnResult` kept alive for the export path. Landed with T3.
- [x] **T3 (P1)** — self-hydrating cells **plus non-terminal scenario rendering + skeleton-while-pending**. Landed with T2.
- [ ] **Perf gate (P1)** — benchmark vs the old table, 1000+ scenarios, comparison on. **Gates T4.**

**Phase 2 — filtering**
- [x] **T4 (P1)** — multi-predicate AND/OR filtering (D8): `filterSchema` + `evaluateRowFilter` / `PredicateGroup` core (entities, unit-tested) + a popover filter bar in the run header + confirmed-match incremental rendering + viewport-fill loop. Column value types come from the evaluator output schema. v1 withholds testset/application columns behind a UI allowlist and `in`/`nin` operators from the UI.

**Phase 3 — comparison, live, co-consumers**
- [x] **T5 (P1)** — comparison: testcase-id join on the filtered base run; compare runs are eagerly paged while a filter is active so each matched base row finds its counterpart. Compare rows resolve against the base run's schema (best-effort, per the Phase-1 note).
- [x] **T6 (P2)** — live updates (`useScenarioLiveUpdates`): while the run is non-terminal, periodically refetch the loaded scenario pages (row statuses) and evict + re-prefetch the results / metrics molecule caches of running / just-finished scenarios; one final pass at terminal, then stop.
- [x] **T8 (P1)** — verified: the focus drawer + `SingleScenarioViewer` are **not regressed** by the cell swap — both run on the fully-preserved, independent old data path (`scenarioColumnValues.ts` + its dependency atoms), fetching their own values regardless of what the table renders. Full ETL migration is **deferred** (see D9): `useScenarioCellValue` cannot be deleted while the static invocation-metrics group (kept in the table, D7) and the CSV export both still depend on the old-path cells.

**Cleanup**
- [x] **T7** — `EtlPocScenarios/` + `/etl-poc` routes (oss + ee) deleted. Done ahead of the Phase-3 gate at the maintainer's direction: production has its own copies of the ported hooks, so the PoC was dead test-page code.

**Open / advisory**
- The **D5 perf gate** was not formally benchmarked — the table was QA'd functionally throughout Phase 1 + 2 instead.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 5 decisions resolved, 0 critical gaps open |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 5/10 → 9/10, 2 decisions, focused on states |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE VOICE (eng):** Claude subagent — caught 5 real gaps the section review under-weighted: T1-T3 mislabeled as "low-risk mechanical port" (non-terminal rendering is unbuilt), `useEtlColumns` drops "other" columns (guaranteed regression), the perf premise was asserted not measured (→ D5 perf gate), T5 comparison is a build not a port (+ unlisted compare-schema fetch), the CSV export path was missed. All folded into the plan.
- **ENG DECISIONS:** D1 phase the migration · D2 interleaved rows + common-evaluator intersection columns · D3 match production's live bar · D4 outside voice ran · D5 perf-validation gate after Phase 1.
- **DESIGN DECISIONS:** focused review (migration preserves the visual design) · live hit-ratio counter for filter scanning · interaction-state specs added (skeleton, non-terminal cells, filter no-match empty state, rate-limited indicator).
- **D6 (implementation-time finding):** starting Phase 1 confirmed `evaluationPreviewTableStore` is already a thin store (identity + status, no column data, per-eval-type order). **T1 is dropped** — Phase 1 is the coupled T2+T3 column+cell swap against the existing store. Confirms the eng-review outside voice's "T1 re-implements an existing store" point.
- **D7 (implementation-time finding):** reading `Table.tsx` showed the CSV export path (`exportResolveValue`, `columnLookupMap`, `loadAllPagesBeforeExport`) is keyed off `columnResult` column ids, which differ from `useEtlColumns` keys. **Phase 1 swaps display columns only** and keeps `usePreviewColumns`/`columnResult` alive for export; the old column path fully retires in Phase 3 with the export migration (T5). The "other"-column un-drop ripples into `ColumnLeaf`, `EtlResolvedCell`, and `useCellMaterialization`.
- **D8 (Phase 2 decision):** filter composition resolved — **multi-predicate AND/OR from day 1**, not the PoC's single predicate. The predicate type generalises to a flat condition group; the filter bar reuses the observability multi-condition UI.
- **D9 (implementation-time finding):** **T8 co-consumers verified, full migration deferred.** Tracing `scenarioColumnValues.ts` and `SingleScenarioViewerPOC` confirmed the focus drawer and `SingleScenarioViewer` resolve their values through the old data path's independent atom families — they do not depend on the table's cells and so are **not regressed** by the T2+T3 cell swap. The design's "delete `useScenarioCellValue`" goal is blocked: that hook still backs `MetricCell`/`InputCell`/`InvocationCell`, which render the static invocation-metrics group kept in the production table (`metricGroupKeys`, D7) and feed the CSV export. A full ETL rebuild of the 1551-line `FocusDrawer` (incl. compare mode) is out of proportion to "no regression to fix" and would not enable the deletion. T8 closes as verified; the migration moves to the eventual old-column-path retirement.
- **UNRESOLVED:** 0 — filter composition closed (D8). No open decisions.
- **STATUS:** Phases 1–3 shipped — T2+T3 column/cell swap, T4 multi-predicate filtering, T5 comparison (testcase-id join), T6 live updates, T7 PoC retired, T8 co-consumers verified (no regression; full migration deferred per D9). Feature complete on `fe-experiment/etl-eval-scenario-filtering`.
- **VERDICT:** ENG + DESIGN REVIEW CLEARED — all phases shipped.
