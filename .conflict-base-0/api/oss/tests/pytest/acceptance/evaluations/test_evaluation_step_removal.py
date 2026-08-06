from uuid import uuid4


def _input_step():
    return {
        "key": "input",
        "type": "input",
        "origin": "custom",
        "references": {"testset": {"id": str(uuid4())}},
    }


def _human_annotation_step():
    return {
        "key": "annotation",
        "type": "annotation",
        "origin": "human",
        "references": {"evaluator_revision": {"id": str(uuid4())}},
        "inputs": [{"key": "input"}],
    }


def _create_run(authed_api, steps):
    response = authed_api(
        "POST",
        "/evaluations/runs/",
        json={"runs": [{"name": "step removal run", "data": {"steps": steps}}]},
    )
    assert response.status_code == 200
    return response.json()["runs"][0]


def _create_scenario(authed_api, run_id):
    response = authed_api(
        "POST",
        "/evaluations/scenarios/",
        json={"scenarios": [{"run_id": run_id}]},
    )
    assert response.status_code == 200
    return response.json()["scenarios"][0]


def _create_result(authed_api, run_id, scenario_id, step_key):
    response = authed_api(
        "POST",
        "/evaluations/results/",
        json={
            "results": [
                {
                    "step_key": step_key,
                    "repeat_idx": 0,
                    "scenario_id": scenario_id,
                    "run_id": run_id,
                }
            ]
        },
    )
    assert response.status_code == 200
    return response.json()["results"][0]


def _query_results(authed_api, **result):
    response = authed_api(
        "POST",
        "/evaluations/results/query",
        json={"result": result},
    )
    assert response.status_code == 200
    return response.json()


def _patch_steps(authed_api, run, steps):
    response = authed_api(
        "PATCH",
        f"/evaluations/runs/{run['id']}",
        json={
            "run": {
                "id": run["id"],
                "name": run["name"],
                "data": {"steps": steps},
            }
        },
    )
    assert response.status_code == 200
    return response.json()


class TestEvaluationStepRemoval:
    def test_edit_dropping_a_non_input_step_prunes_only_its_cells(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run = _create_run(
            authed_api,
            steps=[_input_step(), _human_annotation_step()],
        )
        run_id = run["id"]
        scenario = _create_scenario(authed_api, run_id)
        scenario_id = scenario["id"]

        # Cells on both the input step and the annotation step.
        _create_result(authed_api, run_id, scenario_id, "input")
        _create_result(authed_api, run_id, scenario_id, "annotation")

        assert _query_results(authed_api, run_id=run_id)["count"] == 2
        # ----------------------------------------------------------------------

        # ACT — edit the run, dropping the annotation step from the graph.
        response = _patch_steps(authed_api, run, steps=[_input_step()])
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response["count"] == 1
        edited = response["run"]
        assert [s["key"] for s in edited["data"]["steps"]] == ["input"]
        # has_human dropped, queue eligibility gone.
        assert edited["flags"]["has_human"] is False
        assert edited["flags"]["is_queue"] is False

        # The annotation cell is pruned; the input cell survives.
        remaining = _query_results(authed_api, run_id=run_id)
        assert remaining["count"] == 1
        assert remaining["results"][0]["step_key"] == "input"

        # The scenario still has an input cell, so it is NOT orphaned.
        scenarios = authed_api(
            "POST",
            "/evaluations/scenarios/query",
            json={"scenario": {"run_id": run_id}},
        ).json()
        assert scenarios["count"] == 1
        # ----------------------------------------------------------------------

    def test_edit_dropping_the_input_step_prunes_orphan_scenarios(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run = _create_run(authed_api, steps=[_input_step()])
        run_id = run["id"]
        scenario = _create_scenario(authed_api, run_id)
        scenario_id = scenario["id"]

        # The scenario's only cell is on the input step.
        _create_result(authed_api, run_id, scenario_id, "input")
        assert _query_results(authed_api, run_id=run_id)["count"] == 1
        # ----------------------------------------------------------------------

        # ACT — drop the input step entirely (empty graph).
        response = _patch_steps(authed_api, run, steps=[])
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response["count"] == 1
        assert response["run"]["data"]["steps"] in (None, [])

        # Cells pruned.
        assert _query_results(authed_api, run_id=run_id)["count"] == 0

        # The scenario was sourced only from the removed input step -> orphaned
        # and removed.
        scenarios = authed_api(
            "POST",
            "/evaluations/scenarios/query",
            json={"scenario": {"run_id": run_id}},
        ).json()
        assert scenarios["count"] == 0
        # ----------------------------------------------------------------------

    def test_create_run_does_not_prune(self, authed_api):
        # Create is "edit from an empty graph": the shared reconcile path runs,
        # but prior_step_keys is empty so nothing is pruned and the graph is
        # preserved verbatim.
        run = _create_run(
            authed_api,
            steps=[_input_step(), _human_annotation_step()],
        )
        assert [s["key"] for s in run["data"]["steps"]] == ["input", "annotation"]
        assert run["flags"]["has_human"] is True

        # A human run gets an active default queue on create.
        response = authed_api("GET", f"/evaluations/runs/{run['id']}/queues/default")
        assert response.status_code == 200
        assert response.json()["count"] == 1
