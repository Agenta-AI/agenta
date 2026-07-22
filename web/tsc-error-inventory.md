# TSC Error Inventory — OSS + EE apps

Generated 2026-07-22 from `pnpm --filter @agenta/oss exec tsc --noEmit` and
`pnpm --filter @agenta/ee exec tsc --noEmit` (worktree `upbeat-shannon-c6fee8`, clean tree).

## Headline numbers

| App | Baseline | After quick-win pass (2026-07-22) |
| --- | --- | --- |
| OSS | 591 | **422** |
| EE  | 525 | **391** |

Quick wins QW1–QW3 and QW5–QW10 are DONE (QW4 TraceSpanNode deferred — see below).
Fixing exports also *surfaced* some previously-masked drift (broken imports resolve as
error-types that suppress downstream checks), so the net is smaller than the sum of
cluster sizes; the surfaced errors are real and belong to the medium clusters.

| App | Errors (baseline) | Notes |
| --- | --- | --- |
| OSS | **591** | 532 in `src/`, 56 in `tests/`, 3 elsewhere |
| EE  | **525** | **485 of these are shared `../oss/src` files** — duplicates of OSS errors |
| EE-only (files under `ee/src` + ee test fixtures) | **~40** | Billing page is the main hotspot |

**Effective unique universe ≈ 630 errors.** Fixing an OSS-side error usually removes it
from both columns, so all prioritization below is done on the OSS list.

## By error code (OSS)

| Code | Count | Meaning |
| --- | --- | --- |
| TS2339 | 150 | Property does not exist on type |
| TS2322 | 123 | Type not assignable |
| TS2345 | 88 | Bad argument type |
| TS7006 | 47 | Implicit `any` parameter |
| TS2353 | 27 | Unknown property in object literal |
| TS2307 | 19 | Cannot find module |
| TS18046 | 18 | Value is of type `unknown` |
| TS2554/2769/2344/2304/2305 | ~50 | Arity, overload, constraint, missing name/export |
| rest | ~70 | long tail |

## Hotspot directories (OSS)

| Directory | Errors |
| --- | --- |
| `src/components/EvalRunDetails` | 190 |
| `src/components/pages` (observability, settings, overview, evaluations) | 78 |
| `src/components/SharedDrawers` | 53 |
| `tests/` (playwright + manual) | 56 |
| `src/components/Webhooks` | 18 |
| `src/components/Playground` | 17 |
| `src/components/EvaluationRunsTablePOC` | 16 |

---

## Quick wins (one fix → many errors)

Ordered by errors-killed-per-unit-of-work. The first two are config/dep-level and kill ~80
errors across both apps without touching product code.

### QW1 — Exclude/delete stale `tests/manual/datalayer` scripts (~25 errors)
`oss/tests/manual/datalayer/test-apps.ts` (18 errs) and `test-observability.ts` (6 errs)
import modules that no longer exist (`src/state/newApps/*`, `src/state/app/atoms/fetcher`,
`src/state/newObservability/atoms/queries` — verified gone). These are dead manual scripts.
**Fix:** delete them, or add `tests/manual` to `oss/tsconfig.json` `exclude`.

### QW2 — `@playwright/test` unresolvable from OSS tsconfig (~9 direct + cascade)
`oss/tsconfig.json` includes `**/*.ts`, which pulls in `oss/tests/playwright/**`, but
`@playwright/test` is only a dependency of the `tests` workspace, not `@agenta/oss`.
Every playwright file then also produces downstream TS7006/TS2304 noise (~31 errors total
in `tests/playwright`). **Fix (choose one):** exclude `tests` from the app tsconfig (the
`tests` workspace has its own), or add `@playwright/test` as an OSS devDependency.

### QW3 — `RunLevelMetricSelection` atom vs value mixup (~27 errors)
`EvalRunDetails/components/views/OverviewView/*` (BaseRunMetricsSection,
MetadataSummaryTable, OverviewSpiderChart, OverviewMetricComparison, useRunMetricData)
access `.stats`/`.state` directly on `Atom<RunLevelMetricSelection>` — the selection is
passed around as an atom in the type but consumed as a plain value (or vice versa).
One type/unwrap decision in the shared hook/atom kills all 27.

### QW4 — Duplicate `TraceSpanNode` type (16 errors) — DEFERRED, not actually quick
Two incompatible `TraceSpanNode` definitions coexist:
`packages/agenta-entities/src/trace/core/schema` vs `oss/src/services/tracing/types`.
Investigation showed the divergence runs through the whole `TraceSpan` base: OSS uses TS
enums (`TraceType.INVOCATION`) where entities uses zod string-literal unions, and entities
is `| null` everywhere OSS is `undefined`-only. Aliasing the OSS type to the entities type
would break every `=== TraceType.X` comparison (TS2367) in OSS consumers. Needs a focused
boundary refactor: re-export entities types from `oss/src/services/tracing/types`, replace
OSS enum value-usages with the entities enum objects (`TraceTypeEnum.enum.invocation`) or
plain literals, then delete the local interfaces.

### QW5 — `WebhookFormValues` missing fields (~16 errors)
`Webhooks/utils/buildSubscription.ts` + `buildPreviewRequest.ts` read 8 properties
(`url`, `auth_mode`, `auth_value`, `github_pat`, `github_repo`, `github_branch`,
`github_workflow`, `github_sub_type`) that aren't on `WebhookFormValues`. Adding the
fields to the interface (they're clearly real form fields) clears all of them.

### QW6 — `setFilters` doesn't accept an updater function (~16 errors)
`ObservabilityHeader/index.tsx` calls `setFilters((prev) => …)` 4× but the setter is
typed `(filters: Filter[]) => void`. Each call site yields 1× TS2345 + 2–3× TS7006.
**Fix:** widen the setter type to `SetStateAction<Filter[]>` (it's almost certainly a
jotai/useState-backed setter) — one signature change kills 16.

### QW7 — react-query v5 leftovers in Organization settings (~6 errors)
`pages/settings/Organization/index.tsx`: 4× `useErrorBoundary` (renamed to
`throwOnError` in v5) + `string[]` passed where `QueryFilters` expected. Mechanical
v4→v5 migration of one file (13 errors in the file total).

### QW8 — Missing exports, 4 symbols (~16 errors)
- `MetricColumnDefinition` not exported from `EvalRunDetails/atoms/table` (4 errs)
- `Parameter` and `_EvaluationScenario` gone from `@/oss/lib/Types` (4 errs)
- `GenerationChatRow`/`GenerationInputRow` not exported from Playground state types (4 errs, tests)
- `TooltipButtonProps` / `statusMap` default-vs-named export confusion (2 errs)
Each is a one-line export (or an import-style fix at the call sites).

### QW9 — URL params type missing `variantId` (~9 errors)
`References/cells/*`, `EvaluationRunsTablePOC/export/referenceResolvers.ts` read
`variantId` off a URL-params object typed without it (`appId/revisionId/variantName/…`).
One field added to the params type in `src/state/url` clears 9.

### QW10 — `PreviewTableRow` doesn't satisfy `InfiniteTableRowBase` (~11 errors)
6× TS2344 + 5× TS2322 in EvalRunDetails table/query atoms trace to one constraint
mismatch. Fix the row type once (likely a missing `id`/index-signature member).

**Quick-win subtotal: ~150 of 591 OSS errors (and their ~120 EE duplicates) from ~10 targeted fixes.**

---

## Medium-effort clusters (real code drift, needs a bit of thought)

- **EvalRunDetails remainder (~100 errs after QW3/8/10):** the largest concentration;
  `Table.tsx`, `FocusDrawer(+Header)`, `EvaluatorMetricsChart/BarChart`, `ScenarioNavigator`,
  `ConfigurationView/EvaluatorSection`, `atoms/query.ts`, `runMetrics.ts`. Mix of
  TS2339/TS2322 from evolving run/metric entity types. Best attacked per-file after the
  atom-level quick wins land, since many will collapse.
- **SharedDrawers remainder (~35 errs after QW4):** AnnotateDrawer transforms treat JSON
  schema values as `{}` (`.type`, `.anyOf` on `{}` — needs a proper JSONSchema type);
  AddToTestsetDrawer drawer-state typing; tracing store `discard` API drift.
- **Observability pages (~35 errs after QW6):** `getObservabilityColumns`, tracing
  selectors, `usePostAuthRedirect` (7 errs — `unknown`-typed org/app data, TS18046
  cluster: `result`/`compatibleOrgs`/`appsData` need typed fetchers).
- **`state/url/playground.ts` (7)** + **`newObservability/selectors/tracing.ts` (7)**.
- **EE Billing (`ee/src/.../settings/Billing/index.tsx`, 7 + modal 1):** the only
  EE-app hotspot.

## Long tail / mechanical sweeps

- **TS7006 implicit `any` (47):** parameter annotations; many disappear with QW2/QW6.
- **TS2322 `string | undefined` → `string` (11):** add guards/defaults at call sites.
- **TS18046 `unknown` (18):** type the fetch/query results instead of casting.
- **EE test fixtures (~25 errs):** `oss/tests/playwright/acceptance/*` + `tests/tests/fixtures`
  — same root cause as QW2 (test workspace types leaking into app tsconfig).

## Suggested attack order

1. QW1 + QW2 (config only, −80 errors, zero product risk)
2. QW3–QW10 (−~130 more, each an isolated PR-able fix)
3. Re-run tsc, re-inventory EvalRunDetails — expect it to shrink well below 100
4. Then the per-file medium clusters, EvalRunDetails first (biggest, and shared with EE)

Raw outputs preserved at scratchpad `tsc-oss.txt` / `tsc-ee.txt` for this session.
