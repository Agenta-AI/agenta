"""
Metrics refresh dispatch (`POST /evaluations/metrics/refresh`).

`EvaluationsService.refresh_metrics` is a dispatcher over the request body: it
fans out to `_refresh_metrics` per run / scenario / timestamp depending on which
of `run_ids` / `run_id` / `scenario_ids` / `timestamps` are present, and returns
the union of the per-call metrics. These tests pin the dispatch contract and the
early-return paths that do not require traces, evaluator schemas, or the worker:

  - no `run_id`/`run_ids`            -> [] (count 0)
  - unknown `run_id`                 -> [] (run not found)
  - unknown ids in `run_ids`         -> [] (each run not found)
  - run with no metrics-bearing steps -> [] (nothing to refresh)

The trace-backed / schema-inference branches of `_refresh_metrics` are covered
by the flow tests that exercise a full run; here we lock the routing shape and
the "nothing to do" outcomes.
"""

from uuid import uuid4


def _create_run(authed_api, name=None) -> str:
    response = authed_api(
        "POST",
        "/evaluations/runs/",
        json={"runs": [{"name": name or f"run-{uuid4()}"}]},
    )
    assert response.status_code == 200, response.text
    return response.json()["runs"][0]["id"]


def _refresh(authed_api, **metrics):
    return authed_api(
        "POST",
        "/evaluations/metrics/refresh",
        json={"metrics": metrics},
    )


class TestRefreshMetricsDispatch:
    def test_refresh_with_empty_body_returns_no_metrics(self, authed_api):
        # No run_id and no run_ids -> the dispatcher short-circuits to [].
        response = _refresh(authed_api)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 0
        assert body["metrics"] == []

    def test_refresh_unknown_run_id_returns_no_metrics(self, authed_api):
        # A syntactically valid but non-existent run resolves to no run, so
        # _refresh_metrics returns [] rather than erroring.
        response = _refresh(authed_api, run_id=str(uuid4()))
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 0
        assert body["metrics"] == []

    def test_refresh_unknown_run_ids_returns_no_metrics(self, authed_api):
        # The run_ids branch loops per id; each unknown id contributes nothing.
        response = _refresh(authed_api, run_ids=[str(uuid4()), str(uuid4())])
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 0
        assert body["metrics"] == []

    def test_refresh_run_without_steps_returns_no_metrics(self, authed_api):
        # A bare run (created with just a name) has no metrics-bearing steps, so
        # there is nothing to refresh.
        run_id = _create_run(authed_api)
        response = _refresh(authed_api, run_id=run_id)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 0
        assert body["metrics"] == []

    def test_refresh_scenario_ids_branch_returns_no_metrics(self, authed_api):
        # With run_id set and scenario_ids present, the dispatcher loops the
        # scenario_ids branch. Unknown scenarios on a bare run yield nothing.
        run_id = _create_run(authed_api)
        response = _refresh(
            authed_api,
            run_id=run_id,
            scenario_ids=[str(uuid4()), str(uuid4())],
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 0
        assert body["metrics"] == []

    def test_refresh_timestamps_branch_returns_no_metrics(self, authed_api):
        # With run_id set and timestamps present (and no scenario_ids), the
        # dispatcher loops the timestamps branch. A bare run yields nothing.
        run_id = _create_run(authed_api)
        response = _refresh(
            authed_api,
            run_id=run_id,
            timestamps=["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
            interval=3600,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 0
        assert body["metrics"] == []

    def test_refresh_run_ids_takes_precedence_over_run_id(self, authed_api):
        # When both run_ids and run_id are present, the dispatcher uses run_ids
        # (the first branch). Two bare runs in run_ids both yield nothing, and a
        # would-be conflicting run_id is ignored — count stays 0 either way, but
        # this exercises the run_ids branch with real (empty) runs.
        run_id_1 = _create_run(authed_api)
        run_id_2 = _create_run(authed_api)
        response = _refresh(
            authed_api,
            run_ids=[run_id_1, run_id_2],
            run_id=str(uuid4()),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 0
        assert body["metrics"] == []
