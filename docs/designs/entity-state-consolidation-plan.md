# OSS entity-state → `@agenta/entities` molecules consolidation

Status: **PLAN — not started.** A standalone platform initiative, surfaced while executing
WP-4 of the [evaluations→packages migration](./evaluations-packages-migration-plan.md). It is a
**prerequisite for WP-4e** (moving the eval-run atoms to `@agenta/evaluations`), but it is much
larger than the eval migration and must be run as its own deliberate, human-in-the-loop effort.

Branch context discovered on: `fe-chore/move-evals-to-packages`, 2026-06-10.

---

## 0. Why this exists (the trigger)

WP-4e (move `EvalRunDetails/atoms` → `@agenta/evaluations`) is blocked: ~18 of those atoms import
OSS entity-state (`@/oss/state/entities/{testcase,testset,shared}`). That OSS entity-state is a
**separate, older, DIVERGENT implementation that parallels the modern `@agenta/entities` molecules
that already exist** — not the same code awaiting a move. So WP-4e cannot "promote" it without
either (a) duplicating the package molecules, or (b) re-platforming OSS consumers onto the existing
molecules. (b) is the right end-state and is what this plan covers.

**Two ways out of the WP-4e block:**
1. **Injection seams** (recommended for the eval migration in isolation): the eval atoms receive
   testcase/testset/References/workspace data as injected inputs from the OSS `-ui` provider; the
   OSS entity layer is untouched. Unblocks WP-4e without this consolidation.
2. **This consolidation** (the broader platform goal): kill the divergent OSS entity-state, standardize
   the whole app on the `@agenta/entities` molecules. Worthwhile debt-reduction, but app-wide.

This doc captures (2).

---

## 1. The core hazard (read first)

**`tsc` will NOT catch the biggest regression risk.** The OSS testcase entity uses a *flattened*
shape (`FlattenedTestcase` — user fields hoisted to the row root); the package `testcaseMolecule`
uses a *nested* shape (`data: { ...fields }`). Re-pointing an importer from the OSS flat shape to the
package nested shape **compiles cleanly but silently breaks rendering at runtime** (cells read
`row.country`; package gives `row.data.country`). ~273 importers across **playground, testsets,
annotation, eval, drawers, settings** consume this. Therefore:

- **No step of this plan is "done" on `tsc`/`lint` green alone** — each importer-touching step needs
  **runtime/behavioral QA** of the affected feature.
- The OSS-deletion steps (C7) are **irreversible** and gated on that QA across all feature areas.

This is precisely why it must be human-in-the-loop, not an autonomous grind.

---

## 2. Scope (verified)

| | OSS (to retire) | Package (target) |
|---|---|---|
| shared infra | `state/entities/shared/` — `createEntityController` (743), `createEntityDraftState` (341), `createPaginatedEntityStore` (562), `createStatefulEntityAtomFamily` (168), utils — **~1,553 LOC** | `@agenta/entities/src/shared/` — `molecule/*`, `paginated/*` (createPaginatedEntityStore 680, createInfiniteTableStore 464), utils |
| testset | `state/entities/testset/` — revisionEntity (567), store (455), controller (650), testsetController (245), paginatedStore (411), mutations (387), revisionSchema (166), dirtyState (222) — **~2,790 LOC** | `@agenta/entities/src/testset/state/` — revisionMolecule (1,110), testsetMolecule (786), store (769), mutations (914), revisionTableState (511), paginatedStore (234) |
| testcase | `state/entities/testcase/` — 15 files incl. testcaseEntity (949), schema (482), columnState (661), paginatedStore (350), controller (370), queries (255), mutations (269), columnPathUtils (169) — **~5,292 LOC** | `@agenta/entities/src/testcase/state/` — molecule (1,008), store (1,005), paginatedStore (349), dataController (253), prefetch (138) |

**Totals:** ~9,573 LOC OSS to delete · ~273 importer files to re-point · ~331 files touched ·
**est. 14–18 engineering days.**

**Coverage verdict:** the package molecules are a **genuine superset** capability-wise; the gap is
mostly *organizational* (where things live) + the **data-format** and **API-shape** divergences below.

---

## 3. Gap details + divergences

### 3.1 shared infra — **coverage ~100%, risk LOW**
Every OSS export has a package equivalent (`createEntityController`, `createEntityDraftState`,
`createPaginatedEntityStore`, `EntityController*`/`DrillIn*`/`PathItem` types). Package uses a
`createMolecule` + `withController` composition layer over the same primitives; the OSS controller-only
API maps onto `molecule.controller(id)`. No OSS-only symbols. Package additionally has entity-relations
(OSS lacks) — additive, no conflict.

### 3.2 testset — **coverage ~95%, risk LOW–MEDIUM**
`revision`/`testset` controllers → `revisionMolecule`/`testsetMolecule` (molecule exposes
`atoms/selectors/actions/get/set`; controller-style use still works). Column dirty-state →
`revisionMolecule.tableReducers`. OSS-only **thin helpers to port** (~50 LOC): `getVersionDisplay`,
`isV0Revision`, `normalizeRevision` (package likely has normalization already).

### 3.3 testcase — **coverage ~80%, risk HIGH**
The hard one. Divergences:
- **Data format:** `FlattenedTestcase` (flat) vs package nested `data` — see §1. **Decision required.**
- **Column ops:** OSS has *testcase-level* column atoms (`currentColumnsAtom`, `addColumnAtom`,
  `renameColumnAtom`, `deleteColumnAtom`, `expandedColumnsAtom`); package moved these to *revision
  level* (`revisionMolecule.tableReducers.*`, `revisionMolecule.atoms.effectiveColumns`). Re-points
  must thread `revisionId` and may change read-only-vs-driven semantics.
- **OSS-only utils to port/refactor** (~300 LOC): `flattenTestcase`, `extractTestcaseUserData`,
  `deriveTestcaseColumnKeys` (package has `extractColumnsFromData`), `columnPathUtils` (package has
  `DataPath`/`getValueAtPath` in `@agenta/shared/utils`).
- Package adds `testcaseDataController` + `prefetchTestcasesByIds` (additive).

**The data-format decision (make first):**
- **Option A** — keep `FlattenedTestcase`; add flat↔nested converters at the boundary. Lower importer
  churn, but perpetuates two shapes + conversion cost.
- **Option B (recommended)** — refactor importers to the package nested shape; delete the flat shape.
  Cleaner long-term; higher one-time churn; **this is the §1 silent-regression surface** — gate on QA.

---

## 4. Leaves-first execution plan (C1–C7)

Internal cascade (leaf → root): `shared` → `testcase` → `testset` → importers. Each step: reconcile/port,
re-point, build+lint, **and behavioral-QA the touched features**; commit; only then proceed.

- **C1 — shared controller infra.** Reconcile OSS consumers onto `@agenta/entities/shared` molecule
  primitives. Mostly direct re-point (+ thin adapters if an API differs). ~1 day, LOW risk. No OSS delete yet.
- **C2 — testset schema + state.** Re-point onto `revisionMolecule`/`testsetMolecule`; port the 3 thin
  version helpers. ~1 day, LOW–MED. Blocks on C1.
- **C3 — testcase schema + state + DATA FORMAT.** The crux. Execute the §3.3 data-format decision; port
  `flatten`/`extract` utils or refactor importers; verify query/entity/draft/cell families map to
  `testcaseMolecule`. ~2–3 days, **HIGH**. Blocks on C1 (+ C2 schema). Prototype the EvalRunDetails ETL
  re-point first as the canary.
- **C4 — testcase column ops → revision level.** Re-point `currentColumnsAtom`/`add|rename|deleteColumnAtom`
  → `revisionMolecule.tableReducers`/`effectiveColumns(revisionId)`. ~1 day, MED. Blocks on C2,C3.
- **C5 — mutations.** Reconcile save/clear/batch onto molecule actions + package mutation APIs. ~0.5 day, LOW.
- **C6 — re-point all ~273 importers**, phased by feature area (testsets ~60 → testcases ~60 → shared
  ~60 → cross-feature ~90). Run feature QA after EACH phase. ~5–7 days, MED (large surface).
- **C7 — delete OSS `state/entities/{testcase,testset,shared}`** (~9.5k LOC). Irreversible; gated on
  full-app QA passing. ~0.5 day.
- **Integration testing** across testsets UI, playground, eval details, annotations. ~2–3 days.

---

## 5. Risks (and why QA — not tsc — is the gate)

1. **Flat vs nested testcase data (HIGH, tsc-invisible)** — §1. Mitigate: Option B + ETL canary +
   per-feature runtime QA + before/after screenshots; consider a temporary parallel-render check.
2. **Column ops moved to revision level (MED)** — audit every column-atom importer; thread `revisionId`;
   QA column add/rename/delete in testsets UI.
3. **Molecule vs controller API (MED)** — both valid; controller-style use maps onto the molecule;
   spot-check direct-controller consumers.
4. **273-file re-point surface (MED)** — phase by feature; full test run + manual QA per phase; rely on
   strict TS to catch *structural* misses (but NOT the data-format ones).
5. **Missing testcase utils (LOW–MED)** — port `flatten`/`extract` or eliminate via Option B.

---

## 6. Relationship to the evaluations migration (WP-4)

- WP-4e (eval atom move) is **blocked** on this consolidation **only if** we choose to move the eval
  atoms onto the package molecules directly. The **injection-seam** alternative (§0 option 1) unblocks
  WP-4e *without* this consolidation and is the recommended path for completing the eval migration in
  isolation.
- If this consolidation lands first, WP-4e becomes a clean re-point (eval atoms use the package
  molecules like every other consumer).
- Either way, this is **not** part of WP-4's scope and should not be grafted into it; it gets its own
  branch, review, and QA matrix.
