"""Acceptance tests for the tensor slice HTTP endpoints (PR: unify eval loops).

Covers the coordinate-addressed ops over EXISTING scenarios exposed on the
simple-evaluations router:

  POST /simple/evaluations/{id}/process   -> dispatch re-execution (async, 202-ish)
  POST /simple/evaluations/{id}/probe     -> read result cells in a slice
  POST /simple/evaluations/{id}/populate  -> bulk-write result cells

These assert the HTTP contract (routes exist, accept the TensorSlice-shaped
body, return the right envelope) without depending on live-LLM execution, which
is covered elsewhere and is inherently flaky.
"""

from uuid import uuid4


def _create_simple_evaluator(authed_api) -> dict:
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/evaluators/",
        json={
            "evaluator": {
                "slug": f"evaluator-{slug}",
                "name": f"Evaluator {slug}",
                "data": {
                    "schemas": {
                        "outputs": {
                            "type": "object",
                            "properties": {"score": {"type": "number"}},
                            "required": ["score"],
                            "additionalProperties": False,
                        }
                    }
                },
            }
        },
    )
    assert response.status_code == 200
    return response.json()["evaluator"]


def _create_simple_testset(authed_api) -> dict:
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/testsets/",
        json={
            "testset": {
                "slug": f"testset-{slug}",
                "name": f"Testset {slug}",
                "data": {
                    "testcases": [
                        {"data": {"input": "hello", "expected": "world"}},
                    ]
                },
            }
        },
    )
    assert response.status_code == 200
    return response.json()["testset"]


def _create_testset_evaluator_evaluation(authed_api) -> dict:
    """A run with a testset input + auto evaluator (no application/LLM)."""
    testset = _create_simple_testset(authed_api)
    evaluator = _create_simple_evaluator(authed_api)
    response = authed_api(
        "POST",
        "/simple/evaluations/",
        json={
            "evaluation": {
                "name": f"tensor-slice-{uuid4().hex[:8]}",
                "flags": {"is_cached": False, "is_split": False},
                "data": {
                    "testset_steps": {testset["revision_id"]: "custom"},
                    "evaluator_steps": {evaluator["revision_id"]: "auto"},
                    "repeats": 1,
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["evaluation"]


def _input_step_key(authed_api, run_id) -> str:
    """Read the run's actual input step key (e.g. 'testset-<slug>').

    Step keys are derived from the revision slug at build time, so they can't be
    hardcoded — fetch the run and read its graph.
    """
    response = authed_api("GET", f"/evaluations/runs/{run_id}")
    assert response.status_code == 200, response.text
    run = response.json().get("run") or {}
    steps = (run.get("data") or {}).get("steps") or []
    input_steps = [s for s in steps if s.get("type") == "input"]
    assert input_steps, f"run {run_id} has no input step: {steps}"
    return input_steps[0]["key"]


class TestTensorSliceEndpoints:
    def test_probe_returns_results_envelope_for_empty_slice(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        # Probe a coordinate that addresses nothing yet -> empty results envelope.
        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/probe",
            json={"scenario_ids": [str(uuid4())]},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert "count" in body
        assert "results" in body
        assert body["results"] == []
        assert body["count"] == 0

    def test_probe_accepts_full_coordinate_body(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/probe",
            json={
                "scenario_ids": [str(uuid4())],
                "step_keys": ["evaluator-step"],
                "repeat_idxs": [0],
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert isinstance(body["results"], list)

    def test_probe_accepts_empty_body(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/probe",
            json={},
        )

        assert response.status_code == 200, response.text
        assert "results" in response.json()

    def test_populate_writes_input_result_cells(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]
        scenario_id = str(uuid4())
        step_key = _input_step_key(authed_api, run_id)

        # Populate an input cell (the source identity) directly.
        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/populate",
            json={
                "results": [
                    {
                        "run_id": run_id,
                        "scenario_id": scenario_id,
                        "step_key": step_key,
                        "repeat_idx": 0,
                        "status": "success",
                    }
                ]
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert "count" in body
        assert "results" in body
        assert body["count"] == len(body["results"])

    def test_populate_accepts_empty_results(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/populate",
            json={"results": []},
        )

        assert response.status_code == 200, response.text
        assert response.json()["results"] == []

    def test_process_accepts_coordinate_slice_and_acknowledges(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        # Dispatch re-execution over a coordinate slice. Async dispatch -> the
        # endpoint acknowledges acceptance with 202 and an empty body (it does
        # not wait for execution).
        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/process",
            json={
                "scenario_ids": [str(uuid4())],
                "step_keys": ["evaluator-step"],
                # overwrite omitted -> defaults to False (fill-missing)
            },
        )

        assert response.status_code == 202, response.text

    def test_process_accepts_overwrite(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/process",
            json={"overwrite": True},
        )

        assert response.status_code == 202, response.text

    def test_process_round_trips_populate_then_probe(self, authed_api):
        """add a scenario, populate its input cell, then probe it by coordinate."""
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]
        step_key = _input_step_key(authed_api, run_id)

        # A result cell FKs to an existing scenario — you cannot populate into a
        # scenario that does not exist. Add the scenario first via the height op
        # (`/scenarios/add`), then populate its input cell.
        created = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/scenarios/add",
            json={"count": 1},
        )
        assert created.status_code == 200, created.text
        scenario_id = created.json()["scenarios"][0]["id"]

        populate = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/populate",
            json={
                "results": [
                    {
                        "run_id": run_id,
                        "scenario_id": scenario_id,
                        "step_key": step_key,
                        "repeat_idx": 0,
                        "status": "success",
                    }
                ]
            },
        )
        assert populate.status_code == 200, populate.text

        probe = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/probe",
            json={"scenario_ids": [scenario_id]},
        )
        assert probe.status_code == 200, probe.text
        results = probe.json()["results"]
        # the populated cell is now readable by coordinate
        assert any(
            str(r.get("scenario_id")) == scenario_id and r.get("step_key") == step_key
            for r in results
        )


class TestGraphShapeEndpoints:
    """The graph-shape ops: add/remove scenarios, add/remove steps, set repeats."""

    def test_add_scenarios_returns_created_rows(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/scenarios/add",
            json={"count": 3},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 3
        assert len(body["scenarios"]) == 3

    def test_add_scenarios_floors_timestamp_to_minute(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/scenarios/add",
            json={"count": 1, "timestamp": "2026-06-02T14:23:47.500000Z"},
        )

        assert response.status_code == 200, response.text
        scenario = response.json()["scenarios"][0]
        # floored to the minute (interval fixed at 1 minute server-side)
        assert scenario["timestamp"].startswith("2026-06-02T14:23:00")
        assert scenario["interval"] == 1

    def test_remove_scenarios_returns_204(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        created = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/scenarios/add",
            json={"count": 1},
        )
        assert created.status_code == 200, created.text
        scenario_id = created.json()["scenarios"][0]["id"]

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/scenarios/remove",
            json={"scenario_ids": [scenario_id]},
        )

        assert response.status_code == 204, response.text

    def test_prune_returns_204(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/prune",
            json={"scenario_ids": [str(uuid4())]},
        )

        assert response.status_code == 204, response.text

    def test_set_repeats_returns_run(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/repeats/set",
            json={"repeats": 3},
        )

        assert response.status_code == 200, response.text
        run = response.json()["run"]
        assert (run.get("data") or {}).get("repeats") == 3


class TestSliceScoping:
    """Path evaluation_id is enforced so a slice cannot reach another run."""

    def test_populate_rejects_result_for_a_different_run(self, authed_api):
        """UEL-017: a result whose run_id != path evaluation_id is rejected 400."""
        eval_a = _create_testset_evaluator_evaluation(authed_api)
        eval_b = _create_testset_evaluator_evaluation(authed_api)
        run_a, run_b = eval_a["id"], eval_b["id"]
        step_key = _input_step_key(authed_api, run_b)

        # POST to run_a's populate, but the result targets run_b.
        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_a}/populate",
            json={
                "results": [
                    {
                        "run_id": run_b,
                        "scenario_id": str(uuid4()),
                        "step_key": step_key,
                        "repeat_idx": 0,
                        "status": "success",
                    }
                ]
            },
        )

        assert response.status_code == 400, response.text

    def test_remove_scenarios_rejects_a_different_runs_scenario(self, authed_api):
        """UEL-018: scenario_ids must belong to the path evaluation_id (else 400)."""
        eval_a = _create_testset_evaluator_evaluation(authed_api)
        eval_b = _create_testset_evaluator_evaluation(authed_api)
        run_a, run_b = eval_a["id"], eval_b["id"]

        # A real scenario in run_b.
        created = authed_api(
            "POST",
            f"/simple/evaluations/{run_b}/scenarios/add",
            json={"count": 1},
        )
        assert created.status_code == 200, created.text
        scenario_b = created.json()["scenarios"][0]["id"]

        # Try to delete run_b's scenario through run_a's path.
        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_a}/scenarios/remove",
            json={"scenario_ids": [scenario_b]},
        )

        assert response.status_code == 400, response.text

        # And the scenario still exists in run_b (was not deleted).
        probe = authed_api(
            "POST",
            f"/simple/evaluations/{run_b}/probe",
            json={"scenario_ids": [scenario_b]},
        )
        assert probe.status_code == 200, probe.text


class TestClosedRunReturns409:
    """Write ops against a closed run return 409, not 500 (UEL-020)."""

    def test_add_scenarios_on_closed_run_returns_409(self, authed_api):
        evaluation = _create_testset_evaluator_evaluation(authed_api)
        run_id = evaluation["id"]

        closed = authed_api("POST", f"/evaluations/runs/{run_id}/close")
        assert closed.status_code in (200, 204), closed.text

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/scenarios/add",
            json={"count": 1},
        )

        assert response.status_code == 409, response.text
