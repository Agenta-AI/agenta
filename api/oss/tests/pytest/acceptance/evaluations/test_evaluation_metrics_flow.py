"""
End-to-end metric VALUE tests as part of the evaluation flow.

The other metric suites cover plumbing — CRUD (`_basics`), refresh dispatch
routing on bare runs (`_refresh`), and query filters (`_queries`). None of them
assert that a REAL run produces correctly COMPUTED metrics. These tests close
that gap: they run a deterministic flow (mock app + mock evaluator, no LLM),
then assert the computed metric values and the three metric scopes.

Metric model recap (see `simplified-interface.md` and
`EvaluationsService._refresh_metrics`):
  - metric `data` is keyed by step (`{step_key: {...aggregates...}}`)
  - variational = per scenario  (scenario_id set), across its repeats
  - temporal    = per interval  (timestamp/interval set)
  - global      = whole run      (scenario_id null) — used for batch evaluations

Scope: BATCH path (variational + global). TEMPORAL metrics belong to LIVE evals,
re-evaluated by a cron that POSTs `/admin/evaluations/runs/refresh` over a narrow
(~1 min) window. Asserting them from a test depends on trace-ingestion timing vs.
that window, which is too brittle to pin here — temporal is left to the live
infrastructure; the live path's "stays running/active" is covered in
`test_evaluation_flows_run.py`.
"""

from ._flow_helpers import (
    create_mock_application,
    create_mock_evaluator,
    create_testset,
    create_simple_evaluation,
    wait_for_run_terminal,
    query_scenarios,
    wait_for_metrics,
)


def _metric_for(metrics, *, scenario_id):
    """Return the single metric row matching scenario_id (None = global)."""
    matches = [m for m in metrics if m.get("scenario_id") == scenario_id]
    return matches[0] if matches else None


# The evaluator score aggregate lives under the evaluator step, keyed by the
# canonical output path. Computed metrics are numeric distributions with
# count/mean/sum (see `_refresh_metrics` -> analytics buckets).
SCORE_PATH = "attributes.ag.data.outputs.score"


def _score_aggregate(metric):
    """Return the evaluator score aggregate ({count, mean, sum, ...}) or None.

    Walks the step-keyed metric `data` for the evaluator step that carries the
    score path, without coupling to the evaluator step's generated slug.
    """
    for step_key, step_metrics in (metric.get("data") or {}).items():
        if SCORE_PATH in (step_metrics or {}):
            return step_metrics[SCORE_PATH]
    return None


def _refresh_global_score(authed_api, run_id, *, expect_count, attempts=8):
    """Drive the whole-run metric refresh and return the global score aggregate.

    The refresh is synchronous, but the run can report "terminal" a beat before
    every scenario's result cell is durably persisted under parallel load, so the
    first refresh may aggregate fewer cells. Re-refresh (short, ~15s total) until
    the global score reaches `expect_count`, then return it; fail fast otherwise.
    """
    import time

    last = None
    for attempt in range(attempts):
        response = authed_api(
            "POST",
            "/evaluations/metrics/refresh",
            json={"metrics": {"run_id": str(run_id)}},
        )
        assert response.status_code == 200, response.text
        global_metric = _metric_for(response.json()["metrics"], scenario_id=None)
        last = _score_aggregate(global_metric) if global_metric else None
        if last and last.get("count") == expect_count:
            return last
        time.sleep(min(0.5 * (2**attempt), 4.0))
    raise AssertionError(
        f"global score did not reach count={expect_count} (last={last})"
    )


class TestEvaluationMetricsFlow:
    def test_batch_run_produces_global_and_variational_metrics(self, authed_api):
        # A deterministic batch run: 2 testcases -> echo app -> score evaluator
        # returning a fixed score. After the run finishes, the worker has
        # computed metrics. Assert both the global (whole-run) metric and the
        # per-scenario (variational) metrics exist, keyed by the evaluator step,
        # carrying the score.
        # ARRANGE --------------------------------------------------------------
        testset = create_testset(authed_api)  # 2 testcases
        application = create_mock_application(authed_api, key="echo")
        evaluator = create_mock_evaluator(
            authed_api, key="score", kwargs={"score": 0.7, "threshold": 0.5}
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-metrics-batch",
            data={
                "testset_steps": [testset["revision_id"]],
                "application_steps": [application["revision_id"]],
                "evaluator_steps": {evaluator["revision_id"]: "auto"},
            },
        )
        run_id = evaluation["id"]
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        final = wait_for_run_terminal(authed_api, run_id)
        assert final.json()["run"]["status"] == "success", final.json()

        scenarios = query_scenarios(authed_api, run_id)
        assert len(scenarios) == 2, scenarios
        scenario_ids = {s["id"] for s in scenarios}

        # global metric: drive the whole-run refresh ourselves (synchronous),
        # but POLL it — the run can report "terminal" a beat before BOTH
        # scenarios' result cells are durably persisted under parallel load, so a
        # single refresh may aggregate count=1. Poll the refresh until it sees
        # both (count=2), capped to ~15s so a stuck env fails fast.
        global_score = _refresh_global_score(authed_api, run_id, expect_count=2)
        # the score evaluator returns 0.7 for both testcases.
        assert global_score["count"] == 2, global_score
        assert global_score["mean"] == 0.7, global_score
        assert global_score["min"] == 0.7 and global_score["max"] == 0.7, global_score

        # variational metrics: one per scenario, written per-scenario during the
        # run (so they are present once the run is terminal), scenario_id set,
        # keyed by step. Each scenario has one repeat, so its score mean is 0.7.
        metrics = wait_for_metrics(
            authed_api,
            run_id,
            condition=lambda ms: (
                len([m for m in ms if m.get("scenario_id") in scenario_ids]) == 2
            ),
            max_retries=6,
        )
        variational = [m for m in metrics if m.get("scenario_id") in scenario_ids]
        assert len(variational) == 2, f"expected 2 variational metrics: {variational}"
        for metric in variational:
            score = _score_aggregate(metric)
            assert score is not None, f"variational metric has no score: {metric}"
            assert score["mean"] == 0.7, (metric.get("scenario_id"), score)
        # ----------------------------------------------------------------------

    def test_refresh_recomputes_metrics_for_a_finished_run(self, authed_api):
        # `refresh` is the standalone metrics op (decoupled from process). After
        # a run finishes, re-invoking refresh over the run scope must recompute
        # and return the same metrics (idempotent over a stable run).
        # ARRANGE --------------------------------------------------------------
        testset = create_testset(authed_api)
        application = create_mock_application(authed_api, key="echo")
        evaluator = create_mock_evaluator(
            authed_api, key="score", kwargs={"score": 1.0, "threshold": 0.5}
        )
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-metrics-refresh",
            data={
                "testset_steps": [testset["revision_id"]],
                "application_steps": [application["revision_id"]],
                "evaluator_steps": {evaluator["revision_id"]: "auto"},
            },
        )
        run_id = evaluation["id"]
        wait_for_run_terminal(authed_api, run_id)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/evaluations/metrics/refresh",
            json={"metrics": {"run_id": str(run_id)}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        # refresh over a finished run returns the recomputed metric(s).
        assert body["count"] >= 1, body
        refreshed = body["metrics"]
        # the recomputed global metric carries the evaluator score (mean 1.0).
        global_metric = _metric_for(refreshed, scenario_id=None)
        assert global_metric is not None, f"no global metric after refresh: {refreshed}"
        score = _score_aggregate(global_metric)
        assert score is not None and score["mean"] == 1.0, score
        # ----------------------------------------------------------------------

    def test_failing_evaluator_metrics_reflect_zero_score(self, authed_api):
        # The computed metric must reflect the evaluator's actual output, not a
        # constant. A `fail` evaluator scores 0.0 — the metric value must differ
        # from the passing case, proving the value is computed, not hardcoded.
        # ARRANGE --------------------------------------------------------------
        testset = create_testset(authed_api)
        application = create_mock_application(authed_api, key="echo")
        evaluator = create_mock_evaluator(authed_api, key="fail")
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-metrics-fail",
            data={
                "testset_steps": [testset["revision_id"]],
                "application_steps": [application["revision_id"]],
                "evaluator_steps": {evaluator["revision_id"]: "auto"},
            },
        )
        run_id = evaluation["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        final = wait_for_run_terminal(authed_api, run_id)
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert final.json()["run"]["status"] == "success", final.json()
        # drive + poll the global refresh (see batch test) until both scenarios
        # are aggregated, rather than waiting for the worker's lagging refresh.
        score = _refresh_global_score(authed_api, run_id, expect_count=2)
        # the score aggregate is the failing value (mean 0.0), not 1 — proving
        # the metric reflects the evaluator's real output, not a constant.
        assert score["mean"] == 0.0 and score["max"] == 0.0, score
        # ----------------------------------------------------------------------
