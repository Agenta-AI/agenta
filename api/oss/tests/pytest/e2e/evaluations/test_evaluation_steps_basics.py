import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE ------------------------------------------------------------------
    runs = [
        {"name": "test_evaluation_steps_basics"},
    ]

    response = authed_api(
        "POST",
        "/preview/evaluations/runs/",
        json={"runs": runs},
    )

    assert response.status_code == 200

    run_1 = response.json()["runs"][0]

    scenarios = [
        {"run_id": run_1["id"]},
        {"run_id": run_1["id"]},
        {"run_id": run_1["id"]},
    ]

    response = authed_api(
        "POST",
        "/preview/evaluations/scenarios/",
        json={"scenarios": scenarios},
    )

    assert response.status_code == 200

    scenarios = response.json()["scenarios"]
    # --------------------------------------------------------------------------

    _mock_data = {
        "runs": [run_1],
        "scenarios": scenarios,
    }

    return _mock_data


class TestEvaluationResultsBasics:
    def test_create_evaluation_results(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][0]["id"]

        step_key = "input"
        repeat_idx = 0

        results = [
            {
                "step_key": step_key,
                "repeat_idx": repeat_idx,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/",
            json={"results": results},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["results"][0]["step_key"] == step_key
        assert response["results"][0]["repeat_idx"] == repeat_idx
        assert response["results"][0]["scenario_id"] == scenario_id
        assert response["results"][0]["run_id"] == run_id
        # ----------------------------------------------------------------------

    def test_fetch_evaluation_results(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][1]["id"]

        step_key_1 = "input"
        step_key_2 = "invocation"
        step_key_3 = "annotation"

        results = [
            {
                "step_key": step_key_1,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "step_key": step_key_2,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "step_key": step_key_3,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/results/",
            json={"results": results},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "result": {
                    "scenario_id": scenario_id,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        step_keys = [r["step_key"] for r in response["results"]]
        assert step_key_1 in step_keys
        assert step_key_2 in step_keys
        assert step_key_3 in step_keys
        # ----------------------------------------------------------------------

    def test_edit_evaluation_results(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][0]["id"]

        step_key_1 = "input"
        step_key_2 = "invocation"
        step_key_3 = "annotation"

        results = [
            {
                "step_key": step_key_1,
                "repeat_idx": 1,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "step_key": step_key_2,
                "repeat_idx": 1,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "step_key": step_key_3,
                "repeat_idx": 1,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/results/",
            json={"results": results},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3

        results = response["results"]
        result_ids = [r["id"] for r in results]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        results[0]["status"] = "success"
        results[1]["status"] = "failure"
        results[2]["status"] = "cancelled"

        response = authed_api(
            "PATCH",
            "/preview/evaluations/results/",
            json={"results": results},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        patched = {r["id"]: r for r in response["results"]}
        assert patched[result_ids[0]]["status"] == "success"
        assert patched[result_ids[1]]["status"] == "failure"
        assert patched[result_ids[2]]["status"] == "cancelled"
        # ----------------------------------------------------------------------

    def test_delete_evaluation_results(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        authed_api("POST", f"/preview/evaluations/runs/{run_id}/open")
        scenario_id = mock_data["scenarios"][0]["id"]

        results = [
            {
                "step_key": "input",
                "repeat_idx": 2,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "step_key": "invocation",
                "repeat_idx": 2,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/results/",
            json={"results": results},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2

        result_ids = [r["id"] for r in response["results"]]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/preview/evaluations/results/",
            json={"result_ids": result_ids},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert response["result_ids"] == result_ids
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/preview/evaluations/results/",
            json={"result_ids": result_ids},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_fetch_evaluation_result(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        authed_api("POST", f"/preview/evaluations/runs/{run_id}/open")
        scenario_id = mock_data["scenarios"][2]["id"]

        results = [
            {
                "step_key": "input",
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/results/",
            json={"results": results},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        result_id = response["results"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/evaluations/results/{result_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["result"]["id"] == result_id
        # ----------------------------------------------------------------------

    def test_edit_evaluation_result(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        authed_api("POST", f"/preview/evaluations/runs/{run_id}/open")
        scenario_id = mock_data["scenarios"][0]["id"]

        results = [
            {
                "step_key": "input",
                "repeat_idx": 3,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/results/",
            json={"results": results},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["results"][0]["step_key"] == "input"
        assert response["results"][0]["status"] == "pending"

        result = response["results"][0]
        result_id = result["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        result["status"] = "success"

        response = authed_api(
            "PATCH",
            f"/preview/evaluations/results/{result_id}",
            json={"result": result},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["result"]["id"] == result_id
        assert response["result"]["status"] == "success"
        # ----------------------------------------------------------------------

    def test_delete_evaluation_result(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        authed_api("POST", f"/preview/evaluations/runs/{run_id}/open")
        scenario_id = mock_data["scenarios"][0]["id"]

        results = [
            {
                "step_key": "input",
                "repeat_idx": 4,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/results/",
            json={"results": results},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        result_id = response["results"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/evaluations/results/{result_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["result_id"] == result_id
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/evaluations/results/{result_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------
