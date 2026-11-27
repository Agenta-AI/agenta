## Context

Base: `origin/release/v0.131.2`. Paths: `M` = `web/mobile/src/features/evaluation-run`, `E` = `web/packages/agenta-entities/src/evaluationRun`, `U` = `web/packages/agenta-ui/src`, `T` = `api/oss/src/dbs/postgres/tracing/utils.py`, `S` = `api/oss/src/core/evaluations/service.py`.

### What the Overview tab shows today

- A "Run summary" card with a label and value list and, with 3 axes or more, a radar (`M/overview/RunOverviewView.tsx:52-70`). The list rows are test set, evaluation, status, query (live runs), created, updated, application, variant, cost, duration, tokens, errors, then one row per evaluator metric (`M/overview/runSummaryRows.tsx:112-212`).
- Under the card, one chart card per evaluator metric (`M/overview/MetricCardsSection.tsx:121-134`). A finished run gets a bar chart per metric (`M/overview/metricChartSpec.ts:24-56`). An online run gets a line chart over time (`M/overview/TemporalMetricCard.tsx:76-125`).
- The empty, loading and error states are in `M/overview/MetricCardsSection.tsx:50-103`.
- The header shows the run name, the "⋮" menu, Stop or Resume, and the compare bar (`M/RunDetailsHeader.tsx:28-46`). It has no meta line.

### Where the data comes from today

- One request reads the run-level metric rows of a set of runs: `POST /evaluations/metrics/query` with `scenario_ids: false` (`E/api/runDetails.ts:78-92`). A batch fetcher joins runs into one request (`E/state/runMetrics.ts:38-61`). It polls every 5 s until the run finishes (`E/state/runMetrics.ts:32,63-65,101`).
- The API writes one stat blob per metric path per step, with its `type` (`api/oss/src/dbs/postgres/tracing/dao.py:592-677`). For an evaluator step, the paths come from the properties of the evaluator's output schema (`api/oss/src/core/evaluations/utils.py:180-219`, `S:1553-1603`). So one schema property is one metric with one type.
- `buildRunMetricCatalog` makes one entry per (annotation step, metric path) (`E/state/runMetrics.ts:255-276`). It drops `string` and `json` metrics (`E/state/runMetrics.ts:262`, `E/core/metricStats.ts:93,101`). It adds four invocation entries: cost, duration, tokens, errors (`E/state/runMetrics.ts:134-139,278-324`).
- The API returns every per-test-case metric row of a run when the request sends `scenario_ids: true` (`api/oss/src/dbs/postgres/evaluations/dao.py:2350-2353`). It also accepts `run_ids` and `windowing` (`dao.py:2337-2340,2406-2413`, `api/oss/src/apis/fastapi/evaluations/models.py:350-353`). The entity API does not use this today (`E/api/api.ts:185-210`). A per-test-case blob describes one trace (`E/core/scenarioMetrics.ts:27-32`).

### How the server bins a numeric histogram today

- The service builds one `MetricSpec(type, path)` per metric and sets no option (`S:1660-1666`). `MetricSpec` has the options `bins`, `vmin`, `vmax`, `edge` (`api/oss/src/core/tracing/dtos.py:270-277`). The same DTO is the `specs` of the public `/tracing/analytics` request (`api/oss/src/apis/fastapi/tracing/models.py:404`).
- The SQL carries the options per spec (`T:1085-1107`, `T:1254-1257`, `T:1276-1279`). It bins on `vmin`/`vmax` when they are set, else on the data's own min and max, with `bins` or `ceil(sqrt(n))` bins (`T:1367-1385`). One value or min = max gives one bin (`T:1393-1396`).
- `width_bucket` puts a value above `vmax` in the last bin (`T:1469-1477`), but a value below `vmin` gets bucket 0, which is not in the bin series 1 to `bins` (`T:1507-1511`). So a fixed range that the data does not fit loses values from the histogram.
- `numeric/discrete` has no histogram, only `freq` (`T:1589-1720`).
- An output schema can declare a range: the built-in evaluators at `api/oss/src/resources/evaluators/evaluators.py:115-116` and `:206-207` declare `minimum: 0` and `maximum: 1` on `score`. An LLM judge's `json_schema` becomes the outputs schema (`api/oss/src/core/evaluators/utils.py:39-42`). The default schema has no range (`api/oss/src/core/evaluators/utils.py:64-69`). `get_metrics_keys_from_schema` keeps only `path` and `type`, so the range is dropped (`api/oss/src/core/evaluations/utils.py:210-217`).
- The metric keys are not stored as they are. The refresh writes only run mappings (column kind and name, step key and path) for a schema it inferred (`S:1848-1875`). The other two callers copy only `path` and `type` (`S:3925-3935`, `S:5116-5125`).
- `EvaluationMetricsRefresh` (`api/oss/src/core/evaluations/types.py:529-539`) recomputes the metric rows of a run with the current specs.

### Compare today

- `?compare=` swaps the Overview body for `CompareOverviewTab` (`M/RunDetailsBody.tsx:37-57,131-135`). At most 4 compared runs, only finished test set runs (`E/core/runCompare.ts:12,118`).
- It shows a summary table built from the single-run rows (`M/compare/overview/compareSummaryRows.ts:23-50`), a radar with one series per run, and one card per metric with the change against the base run as a relative percent (`E/core/runCompare.ts:231-248`).
- Metrics match across runs by `"{evaluatorId or slug or stepKey}:{path}"` (`E/core/runCompare.ts:212-223`).
- Run colors are `var(--ag-chart-series-{slot})` (`M/compare/compareColor.ts:5`). The design rule COLOR-05 and `U/design/theme.config.ts:91-120` name `data-1` to `data-6`; `var(--data-1)` exists (`U/design/theme.css:16`).

### Charts and kit today

- `BarChart` (vertical bars, one bar per series per category, `yMax`), `RadarChart` (axes already 0 to 1, nothing under 3 axes), `LineChart` are hand-drawn SVG (`U/components/presentational/charts/types.ts:21-60`, `RadarChart.tsx:22`). `BarChart` draws horizontal x labels and skips some when they do not fit (`BarChart.tsx:63,138-140`). It has no value label above a bar.
- `PageToolbar` (`U/components/ui/page-toolbar.tsx:17-74`), `FilterMenu` and `GroupMenu` (`U/filter-menu/index.ts`), `Segmented` (`U/components/ui/segmented.tsx:303`), `Popover`, `Command`, `Checkbox`, `Badge` (`U/components/ui/index.ts:9,48,91,149`) exist.

## Goals / Non-Goals

**Goals**

- One row per evaluator, with every metric of the evaluator inside the row, drawn by its type.
- One chart that puts every comparable metric on one 0 to 1 scale.
- Score histograms that share one axis when the scores share one scale.
- The same shape in compare, with the change of the newest run against the run before it.

**Non-Goals**

- The "By test case" view, the view switch and the "Review" link of the mockup rows (Q4, decided).
- Any change to the Scenarios, Configuration or Annotate tabs.
- Any change to how online runs collect metrics. Online runs keep working (decision 8).
- Any change to the compare header, the compare bar or which runs can be compared.
- A backfill of old runs. An old run gets the new bins when its metrics are refreshed.
- A saved state for the toolbar or the picker. Both reset when the page reloads.

## Decisions

### 1. An evaluator row is one annotation step, and a metric is one blob path

| Option | Trade-off |
| --- | --- |
| **One row per run step of type `annotation`; its metrics are the blob paths under the step key** | Matches the schema: the API writes one path per output property. The step key already links a metric to its evaluator (`E/state/runMetrics.ts:255-274`). |
| One row per evaluator id | Two steps of the same evaluator would merge into one row. |
| Rows from a grouping in the browser (for example by name prefix) | Invents groups that are not in the schema. Mahmoud ruled this out. |

Rules:

- Every evaluator step of the run gets a row, also a step with no metric yet (from `runReferencesAtomFamily`, `E/state/runDetails.ts:116-128`).
- Paths under `attributes.ag.metrics.` stay out of the rows, as today (`E/state/runMetrics.ts:259`).
- The catalog keeps `string` and `json` metrics. Only a path with no stat blob is dropped. The rows leave text metrics out (decided by Mahmoud, 2026-11-27): an evaluator step whose metrics are all text has no row and its text metrics are not counted in "{n} metrics". A step with no metric yet keeps its row with "No results yet".
- Two metrics are never merged. A metric never shows as both a pass rate and a score.
- The row name is the evaluator name, else its slug (`M/overview/useRunOverview.ts:45-74`). The metric label is today's display label (`M/metricLabel.ts:7-13`).
- Inside a row, metrics are ordered by kind (binary, numeric, categorical), then by label. The order does not change while a running run polls.

### 2. Metric kind and the cell of each kind

The kind comes from `stats.type`. A legacy blob with no type uses today's tests (`E/core/metricStats.ts:99-120`).

| Kind | API types | Cell |
| --- | --- | --- |
| Binary | `binary` | Pass rate as the value ("93%"), "63 of 68" next to it, and a bar: passed in `success`, failed in `destructive`. |
| Numeric | `numeric/continuous`, `numeric/discrete` | Mean as the value ("0.82"), "mean" next to it, and a small histogram (decision 4). |
| Categorical | `categorical/single`, `categorical/multiple` | A share bar with one segment per value in `data-1` to `data-6` (in order, then again from `data-1`), and a caption "formal 60%, casual 29%, rude 10%". |
| Text | `string`, `json`, anything else | Not shown (decided by Mahmoud, 2026-11-27). |

- The pass rate is true count divided by (true + false) count of `frequency` (`E/core/metricStats.ts:123-135`).
- A categorical share is a value's count divided by the sum of all value counts. For `categorical/multiple` this is the share of all chosen values, not of test cases.
- A metric with no stat blob yet shows "No results yet".

### 3. One chart value per metric on a 0 to 1 scale

| Option | Trade-off |
| --- | --- |
| **Pass rate (0 to 1) of a binary metric; mean of a numeric metric whose values are all in 0 to 1** | The value means the same in the chart, in the table and in compare. |
| Mean divided by the largest mean over runs, as the radar does today (`E/core/metricStats.ts:256-264`) | A 1 to 5 rating at 4.0 draws as a full axis. The value has no fixed meaning. |

- A numeric metric is "on a 0 to 1 scale" when its run-level `min` is 0 or more and its `max` is 1 or less. Compare uses the `min` and `max` of every compared run.
- Categorical and text metrics are not in the chart.
- Numeric metrics that are not on a 0 to 1 scale: see decision 5.

### 4. Score histograms: the server bins them (decided by Mahmoud, Q1 option C)

| Option | Trade-off |
| --- | --- |
| Bin in the browser from the per-test-case values | One axis without an API change. A large request per run only to draw histograms, and the bins differ from the API's. |
| Keep the API histogram as it is | No change. Each histogram has its own axis and bin count, so two rows cannot be read against each other. |
| **The server bins on a fixed range when the scores have one** | One axis in the stored data, the same for every reader. A small API change and a refresh for old runs. |

The rule, for each `numeric/continuous` output of an evaluator step, in this order:

1. The output schema declares `minimum` and `maximum` for the number, and every value of the run is in that range: 10 bins on that range.
2. Else every value of the run is in 0 to 1: 10 bins on 0 to 1.
3. Else 10 bins on the run's own min to max.

The rules are tried in this order for every score, so a declared range that the values do not fit falls through to rule 2. Example: a schema declares 1 to 5 and the values are 0.2 and 0.8. Rule 1 does not apply (0.2 is below 1), rule 2 does: 10 bins on 0 to 1.

"Every value is in the range" is checked in the SQL. A declared range alone is not enough: a value below `vmin` would drop out of the histogram (`T:1507-1511`). With a fitting range, one value or min = max still gets the 10 bins of the range.

Where the change goes:

| Option | Trade-off |
| --- | --- |
| Only in `S:1660-1666`: set `vmin`, `vmax`, `bins` on the spec | Rule 1 only. Rule 2 depends on the data, which the service does not know before the query. Values below the range are lost. |
| Change the SQL default for every spec without options | No new field. Changes the public `/tracing/analytics` result for every caller, also outside evaluations. |
| Two new optional public `MetricSpec` fields `vmin_hint` and `vmax_hint`: a range that the SQL uses only when every value fits it | Rules 1 to 3 in one SQL condition. One additive field pair on a public request model, which other callers can send. |
| **An internal subclass `ScoreMetricSpec(MetricSpec)` with `declared_min` and `declared_max`, built only by the evaluations service** | Rules 1 to 3 in one SQL condition. The public `/tracing/analytics` request does not change. (Built in PR 8629.) |

Exact places:

- `api/oss/src/core/tracing/dtos.py`: add `ScoreMetricSpec(MetricSpec)` with `declared_min: Optional[float]` and `declared_max: Optional[float]`. `vmin`, `vmax` and `bins` keep their meaning and win over the rule.
- `T:1085-1107`: add the columns `score_rule`, `declared_min` and `declared_max` to `specs_values`. `T:1191-1194`, `T:1254-1257`, `T:1276-1279`: carry them like `vmin`/`vmax`.
- `T:1367-1385`: `fits_declared` = a score spec with both bounds and data `vmin >= declared_min` and data `vmax <= declared_max`; `fits_unit` = a score spec with data `vmin >= 0` and `vmax <= 1`. `chosen_min` = `vmin_opt`, else `declared_min` when `fits_declared`, else 0 when `fits_unit`, else data `vmin`. Same for `chosen_max`. `chosen_bins` = `bins_opt`, else 10 for a score spec, else `ceil(sqrt(n))`.
- `T:1393`: the one-bin shortcut does not apply to a score spec.
- `api/oss/src/core/evaluations/utils.py:210-217`: for a `number` with numeric `minimum` and `maximum`, add `"minimum"` and `"maximum"` to the returned dict.
- `S:1596-1603`: mark the evaluator output paths with `"score": True` and carry `minimum` and `maximum` into `steps_metrics_keys` (not `DEFAULT_METRICS`, which holds cost, duration, tokens and errors).
- `S:1660-1666`: a `numeric/continuous` path marked as a score gets a `ScoreMetricSpec` with the declared range (or none). Invocation metrics get a plain `MetricSpec`.

Interface check (design-interfaces lens) for `declared_min` and `declared_max`:

- Role: configuration of the computation (a binning policy), not data and not metadata.
- Owner: the evaluations service. Lifetime: one refresh. Never stored: the stored metric rows keep the `hist` shape `{bin, count, interval, density}`, only the edges change.
- Stored contracts: none change. The metric keys with `minimum`/`maximum` live only in memory; the run mappings and the other callers copy `path` and `type` only (`S:1848-1875`, `S:3925-3935`, `S:5116-5125`). An inferred schema (`S:1572-1589`) has no range, so rule 2 or 3 applies.
- Public request: none. `/tracing/analytics` callers cannot send a `ScoreMetricSpec`, so their result does not change.

The web page:

- `numeric/continuous`: draws the server's `distribution` bins as they come, with the first bin's start and the last bin's end as the two axis labels ("0" and "1" for rules 1 and 2 with 0 to 1). The page does not re-bin.
- `numeric/discrete` has no `hist`: one bar per value of `frequency`, ordered by value, with the lowest and highest value as the axis labels.
- A bar's height is its count divided by the metric's `count`. Bar tooltip: "0.0 to 0.1: 3 of 68 test cases".
- An old run shows its old bins until its metrics are refreshed. The page does not trigger a refresh: opening a run page must not change the run (`E/state/runDetails.ts:1-5`).
- The server rule could later replace the "on a 0 to 1 scale" test of decision 3 with the bin range. Out of scope here.

Optional follow-up, not in the tasks: add `minimum: 0` and `maximum: 1` to the built-in evaluators whose score is always in 0 to 1, so rule 1 applies to them directly.

### 5. Scores that are not on a 0 to 1 scale (decided by Mahmoud, Q2 option A)

| Option | Trade-off |
| --- | --- |
| **The table shows them with their own axis (decision 4). The chart leaves them out and says how many it left out, under the chart.** | No value is drawn on a scale it does not have. One line of text. |
| Scale them to 0 to 1 by min and max | Every metric is in the chart, but a 4.0 of 5 can draw as 0 or 1 depending on the run's data. |
| A second axis | Two scales in one chart are easy to misread. More chart code. |

### 6. Meta tiles ("Passed" decided by Mahmoud, Q3)

Up to six tiles, in this order.

| Tile | Value | Lines under the value |
| --- | --- | --- |
| Test cases | The `count` of the `duration` entry (one per traced test case, `E/state/runMetrics.ts:185-202`) | "all finished" when the run status is `success`; "some test cases failed to run" when it is `errors`; none for other statuses |
| Passed | Share of test cases that passed: "11%" | "1 of 9 test cases", then a smaller line "92 of 138 assertions true" |
| Cost | Mean per test case, as today (`M/overview/runSummaryRows.tsx:48-63`) | "per case, average" |
| Duration | Mean per test case | "per case, average" |
| Tokens | Mean per test case | "per case, average" |
| Errors | Total, as today (`M/overview/runSummaryRows.tsx:64-73`) | "total" |

"Passed" rules:

- An assertion is one value of a binary metric for one test case.
- A test case passed when every binary value it has is true. A binary metric with no value for that test case does not make it fail. A test case with no binary value at all is not counted, and neither is a test case that did not run (below). So the count is over the test cases that ran and have at least one binary value: "{passed} of {n} that ran" uses that `n`.
- The value and the first line come from the per-test-case rows: one request per run, `POST /evaluations/metrics/query` with `{metrics: {run_ids: [runId], scenario_ids: true}, windowing: {limit: 5000}}`, read by a new atom `runScenarioMetricsQueryAtomFamily(runId)` that loads when the run has finished. It reads again on "Try again" after a failure, after an annotation save or a re-run on the run page, and when the overview opens again after 30 s (the stale time of the run-level metrics). It never polls on a timer: a running run would send a large request every 5 s (design review, 2026-11-27). A running run shows "—" in the "Passed" value until it finishes. The browser computes the count. This can move to the server later as a run-level field.
- "92 of 138 assertions true" comes from the run-level `frequency` of every binary metric (true count over true plus false count). It needs no per-test-case data.
- A run with no binary metric shows no "Passed" tile (five tiles).
- The per-test-case rows are not available when the request fails, when it returns 5,000 rows, or for an online run (decision 8). Then the tile shows "—" as the value, no "of … test cases" line, and the assertions line. A failed request goes to `console.error`; the page shows no alert.
- A value that is not there shows "—", and "…" while it loads, as today (`M/overview/runSummaryRows.tsx:45-46`).
- An online run labels the first tile "Traces", and its cost, duration and tokens lines say "per trace, average".

Failed test cases (decision page question 5, built as the recommended option A; still open with Mahmoud):

- The stored status of each step result tells which steps failed: one `POST /evaluations/results/query` with `{result: {run_ids: [runId], statuses: ["failure", "errors"]}, windowing: {limit: 5000}}`, read with the per-test-case rows. A test case "did not run" when a step that is not an evaluator step (the application) failed. An evaluator "failed" on a test case that ran when that evaluator step failed. The trace errors metric is not used for this: it also counts an error inside the application that the application recovered from.
- When there is at least one such test case: the "Test cases" tile shows "{ran} of {total}" and "{n} did not run", with a dotted underline and a tooltip that says why they did not run and that they count as neither passed nor failed; a red alert above the tiles only when an evaluator failed on a test case that ran, with its count and a "Show test cases" link to the Scenarios tab (the link does not filter the table). Decided by Mahmoud on 2026-11-27: no alert for test cases that did not run; "Passed" counts only the test cases that ran ("{passed} of {ran} that ran"); the "Errors" tile shows the failed test cases with "{runs} runs, {evaluator} evaluator", as on the canvas page "run with failed test cases". Each row shows a striped "no result" part for the test cases its evaluator failed on.
- Without failures, or without the per-test-case rows, the tiles keep the run-level values above and no alert shows.

### 7. The meta line under the title

| Option | Trade-off |
| --- | --- |
| **One line in `RunDetailsHeader`, under the title row and above the compare bar: status badge, "Test set {name} v{n}", "Application {name}", "Variant {name} v{n}", created date** | The facts stay visible on every tab. They no longer push the results down. |
| Keep the facts as a list on the Overview | Takes the first screen, which the design gives to the results. |

- The test set and variant names are links, as in today's chips (`M/overview/runSummaryRows.tsx:123-191`, `M/overview/useRunReferenceLinks.ts`). The status uses `RunStatusTag` (`M/overview/RunStatusTag.tsx:7-13`).
- A live run adds "Query" with today's filter text and "Sample rate: {rate}" (`M/overview/runSummaryRows.tsx:144-160`). Long text is cut with an ellipsis; the full text is in the title tooltip.
- "Updated at" and the "Evaluation" name row are dropped: the name is the title.

### 8. Online (live) runs

| Option | Trade-off |
| --- | --- |
| Keep today's Overview for online runs | No risk for live runs. The summary list and the radar stay in the code only for them. |
| **The new tiles, chart and table from the run-wide row, then today's charts over time under the table, under the heading "Over time"** | One layout for every run. The old summary and radar code can go. `TemporalMetricCard` stays as it is. |
| Drop the charts over time | A live run loses its only view over time. |

- Online runs do not read the per-test-case rows: they have one per trace and no upper bound. The "Passed" tile shows only the assertions line.
- The table and the chart use only run-wide stats (`statsAreRunWide`, `E/state/runMetrics.ts:126-128`). A metric with no run-wide row shows "No results yet". This matches today's chart cards, which show no run value then (`M/overview/TemporalMetricCard.tsx:87-90`).

### 9. Charts reuse the SVG charts of `@agenta/ui`

| Option | Trade-off |
| --- | --- |
| **`BarChart` and `RadarChart` with `var(--data-N)` colors, plus two optional `BarChart` props: `valueLabel(value, category, seriesKey)` (a label above each bar, also used in the tooltip) and `verticalLabels` (x labels turned 90 degrees)** | Matches the mockup (63% above a bar, every metric name readable). The props default off, so other callers do not change. |
| `BarChart` as it is | Some metric names are skipped with 16 bars, and the tooltip shows "0.63" for a pass rate. |
| The Recharts wrapper (`U/components/ui/chart.tsx`) | Adds a large dependency to the first-load JavaScript of the run page. |

- Single run: one series. A third optional `BarChart` prop, `barColor(category, seriesKey)`, colors each bar by its kind, as in the canvas legend: a pass rate in `data-2`, a score mean in `data-1`, with the legend "Pass rate of a true or false metric" and "Mean of a score". Several runs: one series per run in `data-N`, no kind colors. The value label shows a pass rate as "63%" and a mean as "0.82".
- Radar: each axis has `normalized` = the value and `raw` = the value, `max` = 1.
- Small parts in the table are two new presentational components in `U/components/presentational/charts/`: `ShareBar` (segments with widths and tooltips, used for binary and categorical) and `MiniHistogram` (bars and the two axis end labels). Both are plain divs or SVG, with no state.

### 10. The metric picker

- A `Popover` with a `Command` list, one `Checkbox` row per chartable metric: "{evaluator}: {metric}" and its value. Trigger text: "Metrics: {k} of {n}".
- Default for one run: every chartable metric when there are 16 or fewer, else the 16 with the lowest value.
- Default in compare: the 16 metrics with the largest change between the newest run and the run before it (decision 12), all of them when there are 16 or fewer.
- The selection is kept in React state as a set of metric ids, or "default". While it is "default", the default is computed again on each poll. Once the user changes it, it stays.
- The Bars and Radar switch is a `Segmented`. Radar is disabled with fewer than 3 selected metrics, and the note says "A radar chart needs at least 3 metrics."

### 11. Toolbar: search, filter, group, sort

- A `PageToolbar` between the chart and the table. It changes the table only, not the chart. State is React state.
- Search: a row shows when its evaluator name or one of its metric labels contains the text (case is ignored). The row then shows all its metrics.
- Filter: a `FilterMenu` with one section "Evaluator", one checkbox per evaluator. Default: all.
- Group: a `GroupMenu` with one option, "Evaluator", always on. Mahmoud asked to keep the control; a second option can come later without a layout change.
- Sort, one run: "Lowest first" (default) by the row's lowest chart value; rows with no chartable metric go last. "Name" by evaluator name.
- The search, filter and sort of the rows are pure functions in `E/core/evaluatorRowsView.ts` (`filterAndSortRows`, `lowestChartValue`). The filter keeps the step keys of the hidden rows, so a row that appears on a later poll is shown.
- Sort, compare: "Largest drop first" (default) by the row's most negative change; "Lowest first" by the newest run's lowest value; "Name".
- No match: "No evaluators match this search."

### 12. Compare: change of the newest run against the run before it

| Option | Trade-off |
| --- | --- |
| **The newest run by `createdAt` against the run created just before it; pass rates in points, means and meta values as an absolute difference** | Answers "did my last change help". Points work when the older pass rate is 0. |
| Each run against the base run, as a relative percent (today, `E/core/runCompare.ts:231-248`) | "-" when the base is 0, which is common for pass rates. A relative change of a pass rate is hard to read. |

- Columns keep today's order: the page's run first, then the compared runs in URL order. The two runs in the change are marked "newest" and "before" in their column header.
- Colors: `compareColor(slot)` becomes `var(--data-{slot + 1})` (COLOR-05). Chips, rows and series of one run keep one color.
- Change text: "+5 points", "−5 points", "+0.12", "−0.12", "no change" (after rounding to whole points or 2 decimals). A metric not on a 0 to 1 scale uses 3 significant digits. When one of the two runs has no value: "—".
- Metric change is a `Badge`: `success` up, `destructive` down, `default` for "no change". Changes in the summary table are plain `muted-foreground` text, because up is good for some values (passed) and bad for others (cost).
- Summary rows: Test cases, Passed, Cost per test case, Duration per test case, Tokens per test case, Errors. Each cell has the value and the lines of the tile. The "Passed" row is left out when no compared run has a binary metric. Compare reads the per-test-case rows of each compared run with the same atom as one run (at most 5 requests, finished runs only, so no poll).
- Metric lines, one per run: binary is a bar of the pass rate with "75% 3 of 4"; numeric on 0 to 1 is a bar of the mean with "0.82 mean"; other numeric is the mean with no bar; categorical is a `ShareBar` with no change badge; text metrics are not shown. A run without the metric shows "—".
- Rows match across runs with `compareMetricKey` (`E/core/runCompare.ts:212-223`), grouped by its evaluator part. Two steps of the same evaluator in one run share one row (documented limit, see Risks).
- Compare uses no histograms.

### 13. No "By test case" view in this change (decided by Mahmoud, Q4 option A)

| Option | Trade-off |
| --- | --- |
| **Leave the view switch out; the by-test-case view is the next change** | This change stays small. A switch with one working side would be a dead control. |
| Build the by-test-case view here as one more part | One release for both views. Needs its own design (rows, paging, per-test-case data at the size of the Scenarios tab). |

- The "Review" link of each row in the mockup goes with the by-test-case view, so it is also left out.

### 14. Where the code lives

- `E/core/evaluatorRows.ts` (new, pure): `metricKind`, `isUnitScale`, `chartValue`, `buildEvaluatorRows`, `passedTestCases`, `runTiles`, `compareChange`. Unit tested in `@agenta/entities`.
- `E/api/runDetails.ts` gets `queryRunScenarioMetrics`; `E/state/runScenarioMetrics.ts` (new) has the atom.
- `U/components/presentational/charts/` gets `ShareBar`, `MiniHistogram` and the two `BarChart` props.
- `M/overview/` and `M/compare/overview/` hold the views. `M/RunMetaLine.tsx` (new) is used by `M/RunDetailsHeader.tsx`.
- The bin rule lives in `T` and `S` (decision 4), in its own lane.
- New strings go in a new catalog `evaluations.runOverview` (English). Strings that move keep their text and keys (`web/mobile/AGENTS.md`, Translations).

## User-facing strings

Every new string. Strings from the mockups are marked (m); strings Mahmoud gave are marked (M); the others are plain labels.

- Meta line: "Test set", "Application", "Variant", "Query" (plain); "Sample rate: {rate}" (today).
- Tiles: "Test cases" (m), "Traces" (plain), "all finished" (m), "some test cases failed to run" (m), "Passed" (M), "{passed} of {total} test cases" (M), "{true} of {total} assertions true" (M), "Cost" (m), "Duration" (m), "Tokens" (m), "per case, average" (m), "per trace, average" (plain), "Errors" (m), "total" (m).
- Chart: "Metrics" (m), "Bars" (m), "Radar" (m), "Chart type" (m, aria), "Metrics: {k} of {n}" (m), "Every metric of this run." (m), "The {k} lowest of {n} metrics." (m), "Each value is on one scale from 0 to 1." (m), "A radar chart needs at least 3 metrics." (m), "{n} metrics are not on a 0 to 1 scale and are not in the chart." and "1 metric is not on a 0 to 1 scale and is not in the chart." (plain), "Search metrics" (plain), "Radar chart of the selected metrics" (m, aria), "Bar chart of the selected metrics" (plain, aria), "Pass rate of a true or false metric" and "Mean of a score" (canvas legend).
- Toolbar: "Search evaluators and metrics" (m), "Filter" (m), "Filter: all evaluators" (m), "Evaluator" (plain), "Group: evaluator" (m), "Sort: lowest first" (m), "Sort: name" (plain), "Sort: largest drop first" (m), "Lowest first", "Name", "Largest drop first" (plain), "No evaluators match this search." (plain).
- Table: "Evaluator" (m), "Metrics" (plain), "{n} metrics" and "1 metric" (m), "mean" (m), "{passed} of {total}" (m), "{passed} passed, {failed} failed" (m), "{from} to {to}: {count} of {total} test cases" (m), axis end labels from the bins, for example "0" and "1" (m), "No results yet" (plain), "Passed" (m), "Failed" (m), "Score distribution: every chart goes from 0 to 1, and bar height is the share of test cases" (m, when every histogram is on 0 to 1), "Score distribution: bar height is the share of test cases" (m, shortened, when a histogram has another range), "Over time" (plain).
- Compare: "Summary" (m), "Change" (m), "newest" (m), "before" (m), "Cost per test case" (m), "Duration per test case" (m), "Tokens per test case" (m), "The change column compares the newest evaluation with the one before it." (m), "Metrics, one line per evaluation" (m), "+{n} points", "−{n} points" (m), "no change" (m), "The {k} metrics that changed most between the two newest evaluations, of {n}." (m), "Every metric of these evaluations." (plain), "Radar chart with one shape per evaluation" (m, aria).
- Kept as they are: "Unable to load evaluator metrics", "Unable to refresh evaluator metrics. The scores below may be out of date.", "Try again", "No metric values generated", "No evaluator metrics available", "Temporal evaluator metrics" and their descriptions, and the human-run annotate prompt (`M/overview/MetricCardsSection.tsx:50-117`).

## Risks / Trade-offs

- **Size of the per-test-case request.** It grows with test cases × evaluators × metrics. The 5,000-row limit keeps a very large run from loading a huge response; such a run shows "—" in the "Passed" value. Part A measures the response size of the dev copy runs and records it in the PR. Moving the count to the server removes the request later.
- **Old runs keep old bins** until their metrics are refreshed. No backfill in this change.
- **"On a 0 to 1 scale" is read from the data** when the schema declares no range. A 0 to 10 score whose values in this run are all 0 or 1 is binned and charted as 0 to 1. Accepted; a declared range avoids it.
- **No public request field is added.** The score rule lives in the internal `ScoreMetricSpec`, so `/tracing/analytics` callers get today's result.
- **Two steps of one evaluator in compare** share one row (`E/core/runCompare.ts:221`). Rare; documented, as today.
- **Compare colors change** from `--ag-chart-series-*` to `--data-*` on the chips and the scenario compare rows too. Intended (COLOR-05).
- **Test cases tile** counts traced test cases (`count` of duration). A test case that failed before it made a trace is not counted. The Errors tile shows those errors.
- **Online runs with no run-wide row** show "No results yet" in the table; their charts over time still show the values.
- **Speed.** New code adds to the run page's first-load JavaScript. The removed summary list, metric cards and radar card offset it. `speed:check` must pass in each frontend part.

## Migration

No data migration. The new bins apply to metrics computed after Part E ships, and to an old run when `EvaluationMetricsRefresh` recomputes it. Each part is one PR that can be reverted alone: C, B and D before A; E alone at any time (the page draws whatever bins the server sends).

## Decisions taken by Mahmoud

All open questions are decided (2026-11-27):

1. **Q1, option C.** The server bins score histograms on a fixed range (decision 4).
2. **Q2, option A.** Scores not on a 0 to 1 scale stay in their evaluator row with their own axis, and the chart leaves them out with one line under it that says how many (decision 5).
3. **Q3.** "Passed" counts the test cases where every binary value is true; a missing value does not fail; no tile without a binary metric (decision 6).
4. **Q4, option A.** No "By test case" view and no view switch in this change (decision 13).
