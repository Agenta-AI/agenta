"""
Closed-run mutation guard.

Closing a run (`POST /runs/{id}/close`) locks it: subsequent content mutations
(edit run, create scenario/result, edit/refresh metrics) raise
`EvaluationClosedConflict`, surfaced as HTTP 409. Opening the run again
(`POST /runs/{id}/open`) lifts the lock.

Queue archive/unarchive is intentionally NOT blocked on a closed run — that is a
worklist action, covered by test_evaluation_flows_modify.py.
"""

from uuid import uuid4


def _create_run(authed_api, steps=None) -> dict:
    payload = {"name": f"closed-guard-{uuid4()}"}
    if steps is not None:
        payload["data"] = {"steps": steps}
    response = authed_api("POST", "/evaluations/runs/", json={"runs": [payload]})
    assert response.status_code == 200, response.text
    return response.json()["runs"][0]


def _create_scenario(authed_api, run_id) -> str:
    response = authed_api(
        "POST", "/evaluations/scenarios/", json={"scenarios": [{"run_id": run_id}]}
    )
    assert response.status_code == 200, response.text
    return response.json()["scenarios"][0]["id"]


def _close(authed_api, run_id):
    response = authed_api("POST", f"/evaluations/runs/{run_id}/close")
    assert response.status_code == 200, response.text


def _open(authed_api, run_id):
    response = authed_api("POST", f"/evaluations/runs/{run_id}/open")
    assert response.status_code == 200, response.text


class TestClosedRunGuard:
    def test_close_sets_is_closed_then_open_clears_it(self, authed_api):
        run = _create_run(authed_api)
        run_id = run["id"]

        _close(authed_api, run_id)
        fetched = authed_api("GET", f"/evaluations/runs/{run_id}").json()["run"]
        assert fetched["flags"]["is_closed"] is True

        _open(authed_api, run_id)
        fetched = authed_api("GET", f"/evaluations/runs/{run_id}").json()["run"]
        assert fetched["flags"]["is_closed"] is False

    def test_edit_closed_run_is_blocked(self, authed_api):
        run = _create_run(authed_api)
        run_id = run["id"]
        _close(authed_api, run_id)

        response = authed_api(
            "PATCH",
            f"/evaluations/runs/{run_id}",
            json={"run": {"id": run_id, "name": "renamed-after-close"}},
        )
        assert response.status_code == 409, response.text

    def test_create_scenario_in_closed_run_is_blocked(self, authed_api):
        run = _create_run(authed_api)
        run_id = run["id"]
        _close(authed_api, run_id)

        response = authed_api(
            "POST", "/evaluations/scenarios/", json={"scenarios": [{"run_id": run_id}]}
        )
        assert response.status_code == 409, response.text

    def test_create_result_in_closed_run_is_blocked(self, authed_api):
        run = _create_run(authed_api)
        run_id = run["id"]
        scenario_id = _create_scenario(authed_api, run_id)
        _close(authed_api, run_id)

        response = authed_api(
            "POST",
            "/evaluations/results/",
            json={
                "results": [
                    {
                        "step_key": "input",
                        "repeat_idx": 0,
                        "scenario_id": scenario_id,
                        "run_id": run_id,
                    }
                ]
            },
        )
        assert response.status_code == 409, response.text

    def test_edit_allowed_again_after_open(self, authed_api):
        run = _create_run(authed_api)
        run_id = run["id"]
        _close(authed_api, run_id)
        _open(authed_api, run_id)

        response = authed_api(
            "PATCH",
            f"/evaluations/runs/{run_id}",
            json={"run": {"id": run_id, "name": "renamed-after-open"}},
        )
        assert response.status_code == 200, response.text
        assert response.json()["run"]["name"] == "renamed-after-open"
