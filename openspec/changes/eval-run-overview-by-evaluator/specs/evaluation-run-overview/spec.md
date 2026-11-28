## ADDED Requirements

### Requirement: Run facts in the meta line

The run page SHALL show the run facts in one meta line under the run title, on every tab: status, test set, application, variant and created date, and for a live run its query and sample rate.

#### Scenario: A finished run with a test set
- **WHEN** a user opens a finished run that used test set "support_tickets" version 3, application "ticket_router" and variant "default" version 4
- **THEN** the line under the title shows the status badge, "Test set support_tickets v3" as a link, "Application ticket_router", "Variant default v4" as a link, and the created date

#### Scenario: A live run
- **WHEN** a user opens a live run with a query
- **THEN** the meta line also shows "Query" with the filter text and "Sample rate: {rate}", cut with an ellipsis when long, with the full text in the tooltip

#### Scenario: The summary list is gone
- **WHEN** a user opens the Overview tab
- **THEN** no "Run summary" card, label and value list or "Updated at" row is shown

### Requirement: Meta tiles

The Overview tab SHALL show the tiles test cases, passed, cost, duration, tokens and errors in this order, and SHALL leave out the "Passed" tile when the run has no binary metric.

#### Scenario: Values of a finished run
- **WHEN** a finished run has 9 test cases, a mean cost of $0.021 per test case and 2 errors
- **THEN** the tiles show "Test cases 9", "Cost $0.021" with "per case, average", and "Errors 2" with "total"

#### Scenario: Test case status line
- **WHEN** the run status is `errors`
- **THEN** the "Test cases" tile shows "some test cases failed to run" under the value

#### Scenario: Values not loaded yet
- **WHEN** the run-level metrics are still loading
- **THEN** each metric tile shows "…" and no tile shows 0

### Requirement: Passed tile

The "Passed" tile SHALL show the share of test cases whose binary values are all true, counted in the browser from the per-test-case rows, and the count of true assertions from the run-level rows.

#### Scenario: Some test cases passed
- **WHEN** 1 of 9 test cases has every binary value true, and the binary metrics have 92 true and 46 false values in all
- **THEN** the tile shows "Passed", "11%", "1 of 9 test cases" and the smaller line "92 of 138 assertions true"

#### Scenario: A missing value does not fail
- **WHEN** a test case has the values true and true for two binary metrics and no value for a third
- **THEN** that test case counts as passed

#### Scenario: A test case with no binary value, or that did not run, is not counted
- **WHEN** a test case has no binary value (its only binary evaluator failed), or its application step failed
- **THEN** that test case is in neither the passed count nor the total of the "Passed" tile

#### Scenario: An error the application recovered from
- **WHEN** a traced call inside the application raised an error, the application still returned an output, and its step result is a success
- **THEN** that test case ran, and the "Test cases" tile does not count it as "did not run"

#### Scenario: No binary metric
- **WHEN** no evaluator of the run has a binary metric
- **THEN** the page shows no "Passed" tile and the other five tiles

#### Scenario: One request for the values
- **WHEN** the Overview tab of a finished test set run loads
- **THEN** the page sends one `POST /evaluations/metrics/query` with `scenario_ids: true` and `windowing.limit` 5000 for that run

#### Scenario: Per-test-case values not available
- **WHEN** that request fails, returns 5000 rows, the run is still running, or the run is an online run
- **THEN** the tile shows "—" as the value, no test case line, the assertions line, and no alert

#### Scenario: No poll of the per-test-case rows
- **WHEN** a test set run is running
- **THEN** the page sends no `scenario_ids: true` request, and sends one when the run finishes

### Requirement: Failed test cases

When the per-test-case rows are available, the Overview tab SHALL show the test cases that did not run (the stored result of the application step is a failure) and the test cases an evaluator failed on (the stored result of an evaluator step is a failure), and the "Passed" tile SHALL count only the test cases that ran and have a binary value.

#### Scenario: Some test cases did not run
- **WHEN** a run of 100 test cases has 6 where the application returned an error and 3 more where one evaluator failed
- **THEN** an alert above the tiles says "6 of 100 test cases did not run, because the application returned an error. 3 more test cases have no result from one evaluator, because the evaluator failed." with a "Show test cases" link to the Scenarios tab
- **AND** the "Test cases" tile shows "94 of 100" and "6 did not run", the "Passed" tile counts over the test cases that ran ("16 of 94 that ran"), and the "Errors" tile shows "9" with "6 runs, 3 evaluator"

#### Scenario: A test case with no result in a row
- **WHEN** an evaluator failed on a test case that ran
- **THEN** that evaluator's binary bar has a striped "no result" part for it, and it counts as neither passed nor failed

#### Scenario: No failures
- **WHEN** no step reported an error, or the per-test-case rows are not available
- **THEN** the page shows no alert, and the "Test cases" and "Errors" tiles show the run-level values

### Requirement: One table row per evaluator

The Overview tab SHALL show one table row per run step of type `annotation`, and every metric of that step SHALL be inside its row, one metric per output property, never merged.

#### Scenario: An evaluator with nine metrics
- **WHEN** an evaluator step reports seven binary metrics and two numeric metrics
- **THEN** the table shows one row with the evaluator name, "9 metrics", the seven binary metrics first and then the two numeric metrics, each ordered by label

#### Scenario: An evaluator with no values yet
- **WHEN** an evaluator step of the run has no stat blob yet
- **THEN** its row is shown with "No results yet"

#### Scenario: Evaluator cost and duration stay out
- **WHEN** an evaluator step reports paths under `attributes.ag.metrics.`
- **THEN** those paths are not shown as metrics in its row

### Requirement: Metric cells by type

Each metric cell SHALL be drawn by the metric's type: binary as a passed and failed bar with its count, numeric as a histogram with its mean, and categorical as the share of each value. A string or json metric SHALL NOT be shown, and an evaluator with only string or json metrics SHALL NOT have a row.

#### Scenario: Binary metric
- **WHEN** a binary metric has 63 true and 5 false values
- **THEN** the cell shows "93%", "63 of 68" and a bar with the passed part in `success` and the failed part in `destructive`, with the tooltip "63 passed, 5 failed"

#### Scenario: Categorical metric
- **WHEN** a categorical metric has the values formal 41, casual 20 and rude 7
- **THEN** the cell shows one segment per value in `data-1`, `data-2` and `data-3` and the caption "formal 60%, casual 29%, rude 10%"

#### Scenario: Text metric
- **WHEN** an evaluator reports `success` (binary) and `reason` (`string`)
- **THEN** its row shows only `success`, and the row reads "1 metric"

#### Scenario: Evaluator with only text metrics
- **WHEN** an evaluator step reports only `string` or `json` metrics
- **THEN** the table has no row for it

### Requirement: Score histograms from the server bins

A numeric metric cell SHALL draw the histogram bins the API sends, without binning again, and SHALL label the two axis ends with the first bin's start and the last bin's end.

#### Scenario: Score on 0 to 1
- **WHEN** the API sends 10 bins from 0 to 1 for a metric with the values 1 (64 test cases), 0.8 (3) and 0.45 (1)
- **THEN** the cell shows the mean "0.98", "mean", the histogram with axis labels "0" and "1", and the tooltip "0.4 to 0.5: 1 of 68 test cases" on the fifth bar

#### Scenario: Score with its own range
- **WHEN** the API sends bins from 1 to 5
- **THEN** the histogram has "1" and "5" at the ends, and the legend reads "Score distribution: bar height is the share of test cases"

#### Scenario: Integer score
- **WHEN** a `numeric/discrete` metric has no histogram and the frequencies 3: 10, 4: 20, 5: 38
- **THEN** the cell shows one bar per value, ordered by value, with "3" and "5" at the ends

### Requirement: Metrics chart

The Overview tab SHALL show one chart with one value per selected metric on one 0 to 1 scale: the pass rate of a binary metric and the mean of a numeric metric on a 0 to 1 scale.

#### Scenario: Default selection
- **WHEN** a run has 54 chartable metrics
- **THEN** the chart shows the 16 with the lowest value, the picker reads "Metrics: 16 of 54", and the note reads "The 16 lowest of 54 metrics. Each value is on one scale from 0 to 1."

#### Scenario: Bar values
- **WHEN** the bar view shows a binary metric at 0.63 and a numeric metric at 0.82
- **THEN** the bars are drawn in `data-1` on an axis from 0 to 1, with "63%" and "0.82" above them and vertical metric labels

#### Scenario: Scores left out
- **WHEN** 2 numeric metrics are not on a 0 to 1 scale
- **THEN** they are not in the chart or the picker, and the note adds "2 metrics are not on a 0 to 1 scale and are not in the chart."

#### Scenario: Categorical and text metrics
- **WHEN** a run has categorical, string or json metrics
- **THEN** they are not in the chart or the picker

### Requirement: Metric picker and chart type

The chart SHALL have a metric picker with one checkbox per chartable metric and a switch between bars and radar, and radar SHALL need 3 selected metrics or more.

#### Scenario: Pick metrics
- **WHEN** the user clears 4 of 16 selected metrics in the picker
- **THEN** the chart shows the 12 that remain, and the selection stays when the running run polls again

#### Scenario: Radar with too few metrics
- **WHEN** fewer than 3 metrics are selected
- **THEN** the "Radar" option is disabled, the chart shows bars, and the note adds "A radar chart needs at least 3 metrics."

### Requirement: Toolbar over the table

The Overview tab SHALL show a toolbar over the evaluator table with search, a filter by evaluator, a group menu with the one option "Evaluator", and a sort, and the toolbar SHALL change the table only.

#### Scenario: Search by metric name
- **WHEN** the user types "tone" and one evaluator has a metric "Tone"
- **THEN** only that evaluator's row is shown, with all its metrics, and the chart does not change

#### Scenario: Filter by evaluator
- **WHEN** the user clears two evaluators in the filter
- **THEN** their rows are hidden

#### Scenario: Sort
- **WHEN** the sort is "Lowest first"
- **THEN** rows are ordered by their lowest chart value, and rows with no chartable metric come last

#### Scenario: No match
- **WHEN** no row matches the search and the filter
- **THEN** the table shows "No evaluators match this search."

### Requirement: Online runs keep their charts over time

An online run SHALL show the tiles, the chart and the table from its run-wide row, then today's charts over time under the heading "Over time", and SHALL NOT read per-test-case rows.

#### Scenario: Live run with a run-wide row
- **WHEN** a user opens a live run with a run-wide metric row
- **THEN** the table shows each metric from that row, with API histograms, and one chart over time per metric follows under "Over time"

#### Scenario: Live run without a run-wide row
- **WHEN** a live run has only timestamped metric rows
- **THEN** the metric cells show "No results yet" and the charts over time show the points

### Requirement: Overview states

The Overview tab SHALL keep today's loading, empty and error states with their texts, and the skeleton SHALL have the shape of the tiles, the chart and the table.

#### Scenario: Metrics fail to load
- **WHEN** the run-level metric request fails and nothing is loaded
- **THEN** the page shows "Unable to load evaluator metrics" with "Try again"

#### Scenario: Human run before annotation
- **WHEN** a human run has evaluators and no annotations yet
- **THEN** the page shows today's annotate prompt in place of the table
