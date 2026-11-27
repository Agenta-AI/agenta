Five parts, one PR (one GitButler lane) each. Part A is the frontend base. Parts B, C and D stack on A and can run at the same time: they touch different files, except `M/overview/RunOverviewView.tsx` (B and D) and the new catalog (B, C and D). Merge order: A, then B, D, C in any order, rebasing on A's lane. Part E is the backend bin rule: its own lane on the release branch, independent of A to D, mergeable at any time (the page draws whatever bins the server sends).

Paths: `M` = `web/mobile/src/features/evaluation-run`, `E` = `web/packages/agenta-entities/src/evaluationRun`, `U` = `web/packages/agenta-ui/src`.

Backend paths: `T` = `api/oss/src/dbs/postgres/tracing/utils.py`, `S` = `api/oss/src/core/evaluations/service.py`.

Test commands: `pnpm --filter @agenta/entities test:unit`, `pnpm --filter @agenta/ui test:unit`, `pnpm --filter @agenta/mobile test:unit`. Before each PR: `pnpm lint-fix` in `web/`, `pnpm --filter @agenta/mobile types:check`, and `next build` then `speed:check` for `@agenta/mobile`.

Dev copy for every acceptance check: the "Evals UI" project on the dev copy, run "evals ui builder 20261119-192123-b29a" (ids in `~/agenta-evals-ui/created-run.json`), at `/m/w/<workspace>/p/<project>/evaluations/results/<run id>`.

## 1. Part A: evaluator rows, tiles and meta line (base)

Files: `E/core/evaluatorRows.ts` (new), `E/core/index.ts`, `E/index.ts`, `E/state/runMetrics.ts`, `E/api/runDetails.ts`, `E/state/runScenarioMetrics.ts` (new), `U/components/presentational/charts/ShareBar.tsx` and `MiniHistogram.tsx` (new), `U/components/presentational/charts/index.ts`, `M/RunDetailsHeader.tsx`, `M/RunMetaLine.tsx` (new), `M/overview/RunOverviewView.tsx`, `M/overview/useRunOverview.ts`, `M/overview/RunMetaTiles.tsx` (new), `M/overview/EvaluatorTable.tsx` and `MetricCell.tsx` (new), `M/overview/MetricCardsSection.tsx` (becomes `EvaluatorResultsSection.tsx`: states, table, and the "Over time" cards for online runs), `M/compare/overview/CompareMetricCards.tsx` (filter out text metrics until Part C), the new catalog `evaluations.runOverview` in `web/packages/agenta-i18n`.

- [ ] 1.1 Add `metricKind`, `isUnitScale`, `chartValue` and `buildEvaluatorRows` in `E/core/evaluatorRows.ts` (design decisions 1 to 3). Rows come from the annotation steps of `runReferencesAtomFamily` and the catalog entries by step key.
- [ ] 1.2 Keep `string` and `json` metrics in `buildRunMetricCatalog` (drop only a path with no stat blob). Update `tests/unit/evaluation-run-metrics.test.ts`.
- [ ] 1.3 Add `queryRunScenarioMetrics` (`scenario_ids: true`, `windowing.limit` 5000) and `runScenarioMetricsQueryAtomFamily(runId)`, loaded when the run has finished, read again after a save, a re-run, or when the overview opens again after 30 s, never polled, and disabled for running and online runs. It feeds the "Passed" tile and the failed test cases (decision 6, task 1.13); histograms use the server bins and are not computed from it. Add `passedTestCases` (a test case passes when every binary value it has is true; a missing value does not fail; a test case with no binary value is not counted). Test the request body in `tests/unit/evaluation-run-details-api.test.ts`.
- [ ] 1.4 Add `runTiles` (decision 6: no "Passed" tile without a binary metric; "—" value when the per-test-case rows are not available), moving the cost, duration, tokens and errors rules from `M/overview/runSummaryRows.tsx:48-74`.
- [ ] 1.5 Unit tests in `tests/unit/evaluation-run-evaluator-rows.test.ts`: one row per step, two steps of one evaluator stay two rows, metric order, every kind, the unit scale test, the histogram bars from server bins and from `frequency` for `numeric/discrete`, `passedTestCases` (missing value, no binary value), the 5000-row fallback, the tiles (with and without binary metrics, online labels).
- [ ] 1.6 Add `ShareBar` and `MiniHistogram` with render tests in `U/../tests/unit/chartsShareBar.render.test.tsx` and `chartsMiniHistogram.render.test.tsx`.
- [ ] 1.7 Add `RunMetaLine` to `RunDetailsHeader` (decision 7), reusing `RunStatusTag`, `useOverviewNames` and `useRunReferenceLinks`.
- [ ] 1.8 Rebuild `RunOverviewView`: tiles, then the evaluator table with the three cell kinds and the legend, then "Over time" cards for online runs. Keep the loading, empty and error states and their texts. Make the skeleton match the new layout (STATE-02).
- [ ] 1.9 Remove `M/overview/RunSummaryTable.tsx`, `M/overview/MetricCard.tsx` and their use. Keep `runSummaryRows.tsx`, `RunRadarCard.tsx` and `metricChartSpec.ts` until Part C, because compare still imports them.
- [ ] 1.10 Mobile tests: rewrite `web/mobile/tests/unit/runOverviewCharts.render.test.tsx` for the table and the states; replace `runSummaryTable.render.test.tsx` with `runOverviewTiles.render.test.tsx` and `runMetaLine.render.test.tsx`. Update `runDetailsHeader.render.test.tsx`.
- [ ] 1.11 Measure the per-test-case response size of the dev copy run and write it in the PR body.
- [ ] 1.12 Acceptance on the dev copy: the meta line shows the test set, application, variant and date; the tiles show values ("Passed" with "N of M test cases" and "N of M assertions true"); each evaluator is one row; every binary metric shows "N of M" and a bar; every score shows the server's histogram with its two axis ends labeled (0 and 1 once Part E is deployed and the run is refreshed); no radar, no summary list, no metric cards. A live run on the dev copy still shows its charts under "Over time".
- [ ] 1.13 Failed test cases (design decision 6, question 5 option A): `runFailures` from the per-test-case rows, `RunFailuresAlert` above the tiles, the "Test cases", "Passed" and "Errors" tiles with the failure counts, and the striped "no result" part in a row. Render tests for the alert and the tiles.

## 2. Part B: metrics chart, picker and bars or radar (on A)

Files: `U/components/presentational/charts/BarChart.tsx`, `types.ts`, `M/overview/MetricsChart.tsx` (new), `M/overview/MetricPicker.tsx` (new), `M/overview/RunOverviewView.tsx`, the catalog `evaluations.runOverview`.

- [x] 2.1 Add the optional `valueLabel` and `verticalLabels` props to `BarChart` (decision 9). Extend `tests/unit/chartsBar.render.test.tsx`; the other tests of the charts stay as they are.
- [x] 2.2 Build `MetricsChart`: chart values from `chartValue`, one series in `var(--data-1)`, `yMax` 1; the radar with `normalized` = `raw` = the value; the note texts of decisions 3, 5 and 10.
- [x] 2.3 Build `MetricPicker` (decision 10): `Popover`, `Command`, `Checkbox` rows, "Metrics: {k} of {n}", default 16 lowest, selection kept across polls once changed. Put the two parts in a function that takes a list of runs, so Part C can pass several.
- [x] 2.4 Add the `Segmented` switch "Bars" and "Radar", with radar disabled under 3 metrics.
- [x] 2.5 Mobile tests in `web/mobile/tests/unit/runMetricsChart.render.test.tsx`: default 16 of 54 lowest first, picker changes the bars, radar disabled under 3, scores off the 0 to 1 scale left out with the count line, categorical and text metrics left out.
- [x] 2.6 Acceptance on the dev copy: the chart shows one bar per metric on 0 to 1 with values above the bars; the picker reads "Metrics: k of n" and changes the bars; the switch shows the radar with 3 metrics or more and is disabled with 2.

## 3. Part C: compare view of the same shape (on A; uses B's chart when B is merged)

Files: `E/core/evaluatorRows.ts` (`compareChange`), `E/core/runCompare.ts`, `M/compare/compareColor.ts`, `M/compare/overview/CompareOverviewTab.tsx`, `CompareSummaryTable.tsx`, `useCompareOverview.ts`, `CompareEvaluatorTable.tsx` (new). Removed: `M/compare/overview/CompareMetricCards.tsx`, `CompareMetricCard.tsx`, `compareSummaryRows.ts`, `M/overview/runSummaryRows.tsx`, `M/overview/RunRadarCard.tsx`, `M/overview/metricChartSpec.ts`, and in entities `compareDelta`, `mergeCompareBars` and `radarAxes` when nothing else imports them.

- [ ] 3.1 Add `compareChange` (newest by `createdAt` against the run before it; points for pass rates, absolute difference for means and meta values; "no change" after rounding) with tests in `tests/unit/evaluation-run-compare.test.ts` (decision 12). Remove the tests of the removed functions.
- [ ] 3.2 Change `compareColor(slot)` to `var(--data-{slot + 1})`.
- [ ] 3.3 Rebuild `CompareSummaryTable` with the six rows (no "Passed" row when no run has a binary metric; per-test-case rows read with the Part A atom for each run), the second lines, the Change column, the "newest" and "before" header labels and the note.
- [ ] 3.4 Build `CompareEvaluatorTable`: one row per evaluator (matched by `compareMetricKey`), one line per run for each metric, a change `Badge` for binary and numeric metrics.
- [ ] 3.5 Show the chart with one series per run: if Part B is merged, reuse `MetricsChart` and `MetricPicker` with the compare default (largest change); if not, add the chart in a follow-up commit after B.
- [ ] 3.6 Remove the old compare cards, rows and the radar card, and their imports.
- [ ] 3.7 Update `web/mobile/tests/unit/runCompare.render.test.tsx`: one summary column per run, one line per run per metric, the change of the newest run against the run before it, one run-level metric request for all runs and one `scenario_ids: true` request per run (the case at `:505`).
- [ ] 3.8 Acceptance on the dev copy: create a second run of the same application on the same test set, compare the two; the summary table has one column per run with the change column; each evaluator is one row with one line per run per metric and a change badge; chips, lines and bars of one run have the same color.

## 4. Part D: toolbar search, filter, group and sort (on A; can run with B and C)

Files: `M/overview/EvaluatorToolbar.tsx` (new), `M/overview/evaluatorTableView.ts` (new, pure: search, filter and sort of rows), `M/overview/RunOverviewView.tsx`, `M/compare/overview/CompareOverviewTab.tsx` (if C is merged, else a follow-up commit), the catalog `evaluations.runOverview`.

- [ ] 4.1 Add `filterAndSortRows(rows, {search, evaluators, sort})` with unit tests: search by evaluator name and by metric label, filter, "Lowest first", "Name", "Largest drop first", rows with no chartable value last.
- [ ] 4.2 Build `EvaluatorToolbar` with `PageToolbar`, `FilterMenu` (section "Evaluator"), `GroupMenu` (one option "Evaluator") and a sort menu like `web/mobile/src/features/marketplace/TemplateSortMenu.tsx` (decision 11).
- [ ] 4.3 Place the toolbar between the chart and the table; show "No evaluators match this search." when nothing matches.
- [ ] 4.4 Use the toolbar in compare with the default sort "Largest drop first".
- [ ] 4.5 Mobile tests in `web/mobile/tests/unit/runOverviewToolbar.render.test.tsx`: search narrows rows and not the chart, the filter hides rows, the sort orders rows, the no-match text.
- [ ] 4.6 Acceptance on the dev copy: typing part of a metric name leaves only that evaluator's row; clearing an evaluator in the filter hides its row; "Sort: name" orders rows by name; the chart does not change.

## 5. Part E: server bin rule for evaluator score histograms (backend, own lane, independent of A to D)

Files: `api/oss/src/core/tracing/dtos.py`, `T`, `api/oss/src/core/evaluations/utils.py`, `S`, the API reference page of `/tracing/analytics` in `docs/`, and tests under `api/oss/tests/pytest/`.

- [ ] 5.1 Add the internal `ScoreMetricSpec(MetricSpec)` with `declared_min` and `declared_max` (optional floats) in `api/oss/src/core/tracing/dtos.py`. Not part of the public `/tracing/analytics` request.
- [ ] 5.2 In `T`, carry `score_rule`, `declared_min` and `declared_max` through `specs_values` (`T:1085-1107`), the extract (`T:1191-1194`), `cont_raw` (`T:1254-1257`) and `cont_minmax` (`T:1276-1279`). Add `fits_declared` and `fits_unit` and use them in `chosen_min` and `chosen_max` (`T:1367-1385`): `vmin`/`vmax` first, then the declared range when every value fits, then 0 to 1 when every value fits, else the data's min and max. `chosen_bins`: `bins` first, else 10 for a score spec. The one-bin shortcut (`T:1393`) does not apply to a score spec.
- [ ] 5.3 In `get_metrics_keys_from_schema` (`api/oss/src/core/evaluations/utils.py:210-217`), add `minimum` and `maximum` to the dict of a `number` that declares both as numbers. Leave `api/oss/src/utils/helpers.py:17` as it is (not used by the refresh).
- [ ] 5.4 In `S:1596-1603`, mark evaluator output paths as scores and carry `minimum` and `maximum` for them only. In `S:1660-1666`, build a `ScoreMetricSpec` with the declared range (or none) for a `numeric/continuous` score. `DEFAULT_METRICS` keep a plain `MetricSpec`. Acceptance case: a declared range of 1 to 5 with the values 0.2 and 0.8 gives 10 bins on 0 to 1.
- [ ] 5.5 Unit tests for `get_metrics_keys_from_schema` (range kept, no range, only one bound).
- [ ] 5.6 Integration tests of the analytics SQL against Postgres (next to the existing tracing analytics tests): declared range that fits, values in 0 to 1, values outside every range, a value outside the declared range (no value lost from the bin counts), a declared range that the values do not fit while they fit 0 to 1, one value, a plain `MetricSpec` gives today's bins, `vmin`/`vmax` win over the rule.
- [ ] 5.7 Integration test of the refresh: create a run with a 0 to 1 score whose stored histogram is on its own range (computed before the change), call the metrics refresh with `EvaluationMetricsRefresh(run_id=...)` (`api/oss/src/core/evaluations/types.py:529-539`), and check that the stored run-level histogram now has 10 bins from 0 to 1.
- [ ] 5.8 No API reference change: the public `/tracing/analytics` request does not change.
- [ ] 5.9 Run `ruff format` and `ruff check --fix` in `api/`, and `py-run-tests` in `api/`.
- [ ] 5.10 Acceptance on the dev copy: deploy the API, refresh the metrics of the dev copy run, and check that `POST /evaluations/metrics/query` returns 10 bins from 0 to 1 for each 0 to 1 score, and today's bins for cost and duration.
