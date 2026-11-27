## ADDED Requirements

### Requirement: Compare summary table

While runs are compared, the Overview tab SHALL show a summary table with one column per run and the rows Test cases, Passed, Cost per test case, Duration per test case, Tokens per test case and Errors, plus a Change column.

#### Scenario: Three runs
- **WHEN** a user compares three runs
- **THEN** the table has one column per run in today's order (the page's run first), each headed by its color square and name, and the rows show the same values and second lines as the single-run tiles

#### Scenario: Change column
- **WHEN** 7 of 9 test cases passed in the newest run and 6 of 9 in the run before it
- **THEN** the Change cell of "Passed" shows "+11 points" in `muted-foreground` text, and the note under the table reads "The change column compares the newest evaluation with the one before it."

#### Scenario: No binary metric in any run
- **WHEN** no compared run has a binary metric
- **THEN** the table has no "Passed" row

#### Scenario: Missing value
- **WHEN** one of the two runs in the change has no cost
- **THEN** the Change cell of "Cost per test case" shows "—"

### Requirement: Newest run and the run before it

The change SHALL compare the compared run with the latest `createdAt` against the run created just before it, and their column headers SHALL say "newest" and "before".

#### Scenario: Page run is the oldest
- **WHEN** the page's run is the oldest of three compared runs
- **THEN** the change uses the two other runs, and the page's run column has no role label

### Requirement: Compare chart

The compare chart SHALL show one series per run on one 0 to 1 scale, as grouped bars per metric or as one radar shape per run, with the same picker and switch as the single run.

#### Scenario: Default selection
- **WHEN** the compared runs have 54 chartable metrics
- **THEN** the chart shows the 16 metrics with the largest change between the newest run and the run before it, and the note reads "The 16 metrics that changed most between the two newest evaluations, of 54. Each value is on one scale from 0 to 1."

#### Scenario: Run colors
- **WHEN** three runs are compared
- **THEN** the page's run is drawn in `data-1` and the compared runs in `data-2` and `data-3`, the same colors as their chips

### Requirement: Compare evaluator rows

While runs are compared, the table SHALL show one row per evaluator, with one line per run for each metric and a change badge for each binary or numeric metric.

#### Scenario: Binary metric
- **WHEN** a binary metric is 3 of 4 in the older run and 4 of 4 in the newest run
- **THEN** its lines show "75% 3 of 4" and "100% 4 of 4" with bars in the runs' colors, and a `success` badge "+25 points"

#### Scenario: Numeric metric
- **WHEN** a numeric metric on 0 to 1 has the mean 0.83 before and 0.75 in the newest run
- **THEN** its lines show "0.83 mean" and "0.75 mean" with bars, and a `destructive` badge "−0.08"

#### Scenario: Metric a run does not have
- **WHEN** one compared run has no value for a metric
- **THEN** that run's line shows "—"

#### Scenario: Categorical and text metrics
- **WHEN** a metric is categorical or text
- **THEN** a categorical metric shows one share bar per run and no badge, and a text metric shows one line "not summarized"

### Requirement: Compare toolbar sort

The compare toolbar SHALL have the same search, filter and group as the single run, and the sort SHALL offer "Largest drop first" (default), "Lowest first" and "Name".

#### Scenario: Largest drop first
- **WHEN** the sort is "Largest drop first"
- **THEN** the row whose metric has the most negative change comes first, and rows with no change come last

### Requirement: Metric requests in compare

Compare SHALL read the run-level metrics of all compared runs in one request, and the per-test-case rows with one request per run.

#### Scenario: Three runs load
- **WHEN** a user compares three runs
- **THEN** the page sends one `POST /evaluations/metrics/query` with the three run ids and `scenario_ids: false`, and one request with `scenario_ids: true` for each run
