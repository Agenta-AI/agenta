## Why

The Overview tab of an evaluation run does not answer the first question a user has: which evaluator failed, and how badly. Today the tab shows a long label and value list, a radar, and one chart card per metric (`web/mobile/src/features/evaluation-run/overview/RunOverviewView.tsx:52-82`). An evaluator with 9 metrics fills 9 cards, and the cards do not show which metrics belong to one evaluator. Each numeric chart has its own axis (`api/oss/src/dbs/postgres/tracing/utils.py:1367-1385`), so two charts side by side cannot be read against each other. The compare view repeats the same shape with one card per metric (`web/mobile/src/features/evaluation-run/compare/overview/CompareOverviewTab.tsx:60-81`).

Mahmoud decided the target in the canvas "Consolidated design" (2026-11-27): meta tiles, one metrics chart, a toolbar, and one table row per evaluator, with the same shape for compare.

## What Changes

- The run facts (status, test set, application, variant, created date) move from the summary list to one meta line under the run title.
- Up to six meta tiles on top of the Overview tab: test cases, passed (test cases where every binary metric is true), cost, duration, tokens, errors. A run with no binary metric has no "Passed" tile.
- One metrics chart: one value per metric on one 0 to 1 scale (the pass rate of a binary metric, the mean of a numeric metric). A metric picker chooses the metrics (default: up to 16, the lowest first). A switch shows bars or a radar (radar only with 3 metrics or more).
- A toolbar over the table: search by evaluator or metric name, filter by evaluator, group by evaluator, sort by lowest first or by name.
- A table with one row per evaluator (a run step of type `annotation`). Every metric of the evaluator is inside its row and is drawn by its type: binary, numeric or categorical. Metrics that cannot be summarized (string and json) are not shown, and an evaluator with only such metrics has no row.
- The "Run summary" card, the radar card and the per-metric chart cards go away for test set and human runs. Online (live) runs keep their charts over time, under the new table.
- Compare has the same shape: a summary table with one column per run, the chart with one series per run, and one row per evaluator with one line per run for each metric and the change of the newest run against the run before it.
- The server bins score histograms on a fixed range: the range the output schema declares, else 0 to 1 when every value fits, else the run's own min to max as today. The page draws the server's bins.
- The page reads the per-test-case metric values of a run in one request (`scenario_ids: true`) to count the test cases that passed. This uses the API as it is and can move to the server later.

## Capabilities

### New Capabilities

- `evaluation-run-overview`: the Overview tab of one evaluation run in `/m`: meta line, meta tiles, metrics chart, toolbar, and the evaluator table.
- `evaluation-run-compare`: the Overview tab while runs are compared: summary table, chart with one series per run, and the evaluator table with one line per run.
- `evaluation-metric-histograms`: how the server bins the histogram of a numeric evaluator output.

### Modified Capabilities

None. No spec for the run page exists in `openspec/specs/` yet.

## Impact

- `web/mobile/src/features/evaluation-run/` (`overview/`, `compare/overview/`, `RunDetailsHeader.tsx`): new views, and removal of the summary list, the radar card and the metric cards.
- `@agenta/entities` (`src/evaluationRun/`): pure functions for the evaluator rows, the tiles and the change; a query for per-test-case metric rows; the metric catalog keeps string and json metrics, so the rows can leave out an evaluator that has only those.
- `@agenta/ui` (`components/presentational/charts/`): two small presentational parts (a share bar and a small histogram), and two optional props on `BarChart`.
- `@agenta/i18n`: one new English catalog for the new strings.
- API: an internal `ScoreMetricSpec(MetricSpec)` with `declared_min` and `declared_max` in `api/oss/src/core/tracing/dtos.py`; the public `/tracing/analytics` request does not change. The analytics SQL (`api/oss/src/dbs/postgres/tracing/utils.py:1367-1396`), `get_metrics_keys_from_schema` (`api/oss/src/core/evaluations/utils.py:180-219`) and the spec building in `api/oss/src/core/evaluations/service.py:1596-1666` change. No new route, no new response field, no stored shape change: only the bin edges of stored histograms change. Old runs get the new bins when their metrics are refreshed.
- No data migration. The Scenarios and Configuration tabs do not change.
- Speed: `OverviewTab` is in the first-load JavaScript of the run page (`web/mobile/src/features/evaluation-run/RunDetailsBody.tsx:24`). The change removes as much chart code as it adds; `speed:check` must stay in budget.
