## ADDED Requirements

### Requirement: Fixed range for evaluator score histograms

When the server computes the metrics of a run, the histogram of a `numeric/continuous` evaluator output SHALL use 10 bins on the range the output schema declares when every value fits it, else 10 bins on 0 to 1 when every value fits, else 10 bins on the run's own min to max. The rules apply in this order, so a declared range that the values do not fit falls through to 0 to 1.

#### Scenario: Declared range
- **WHEN** an evaluator's output schema declares `score` as a number with `minimum` 1 and `maximum` 5, and every value of the run is between 1 and 5
- **THEN** the stored histogram of `score` has 10 bins from 1 to 5

#### Scenario: No declared range, values in 0 to 1
- **WHEN** the schema declares no range and the run's values are 0.45, 0.8 and 1
- **THEN** the stored histogram has 10 bins from 0 to 1, with the interval of the first bin starting at 0 and the last ending at 1

#### Scenario: Values outside every range
- **WHEN** the schema declares no range and the run's values go from 2 to 40
- **THEN** the stored histogram has 10 bins from 2 to 40

#### Scenario: Value outside the declared range
- **WHEN** the schema declares 0 to 1 and one value of the run is 1.2
- **THEN** the histogram does not use the declared range, and no value is left out of the bin counts

#### Scenario: Declared range that the values do not fit, values in 0 to 1
- **WHEN** the schema declares 1 to 5 and the run's values are 0.2 and 0.8
- **THEN** the stored histogram has 10 bins from 0 to 1

#### Scenario: One value
- **WHEN** a run has one value 0.7 and no declared range
- **THEN** the stored histogram has 10 bins from 0 to 1, and the value is in the bin from 0.7 to 0.8

### Requirement: The score rule is internal

Only the evaluations service SHALL apply the score rule, through an internal metric spec; the public `/tracing/analytics` request SHALL NOT change, and `vmin`, `vmax` and `bins` SHALL win over the rule.

#### Scenario: A public analytics request
- **WHEN** a `/tracing/analytics` request sends a numeric spec
- **THEN** the result is the same as before this change

#### Scenario: Invocation metrics
- **WHEN** the server computes the cost, duration, tokens and errors of a run step
- **THEN** their specs do not use the score rule and their histograms keep today's bins

### Requirement: Refresh recomputes old runs

A metrics refresh of a run (`EvaluationMetricsRefresh` with its run id) SHALL rewrite the stored run-level histograms with the new rule.

#### Scenario: Old run refreshed
- **WHEN** an old run with a 0 to 1 score has histograms on its own min to max, and its metrics are refreshed
- **THEN** its stored run-level histogram of that score has 10 bins from 0 to 1
