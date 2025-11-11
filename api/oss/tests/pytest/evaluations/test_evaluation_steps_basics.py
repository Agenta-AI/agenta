from uuid import uuid4

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


class TestEvaluationStepsBasics:
    def test_create_evaluation_steps(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][0]["id"]

        key = "input"
        repeat_id = str(uuid4())
        retry_id = str(uuid4())

        steps = [
            {
                "key": "input",
                "repeat_id": repeat_id,
                "retry_id": retry_id,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/steps/",
            json={"steps": steps},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["steps"][0]["key"] == key
        assert response["steps"][0]["repeat_id"] == repeat_id
        assert response["steps"][0]["retry_id"] == retry_id
        assert response["steps"][0]["scenario_id"] == scenario_id
        assert response["steps"][0]["run_id"] == run_id
        # ----------------------------------------------------------------------

    def test_fetch_evaluation_steps(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][1]["id"]

        key_1 = "input"
        key_2 = "invocation"
        key_3 = "annotation"
        repeat_id = str(uuid4())
        retry_id = str(uuid4())

        steps = [
            {
                "key": key_1,
                "repeat_id": repeat_id,
                "retry_id": retry_id,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "key": key_2,
                "repeat_id": repeat_id,
                "retry_id": retry_id,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "key": key_3,
                "repeat_id": repeat_id,
                "retry_id": retry_id,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/steps/",
            json={"steps": steps},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            "/preview/evaluations/steps/",
            params={"scenario_id": scenario_id},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        assert response["steps"][0]["key"] == key_1
        assert response["steps"][1]["key"] == key_2
        assert response["steps"][2]["key"] == key_3
        # ----------------------------------------------------------------------

    def test_edit_evaluation_steps(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][0]["id"]

        key_1 = "input"
        key_2 = "invocation"
        key_3 = "annotation"
        repeat_id = str(uuid4())
        retry_id = str(uuid4())

        steps = [
            {
                "key": key_1,
                "repeat_id": repeat_id,
                "retry_id": retry_id,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "key": key_2,
                "repeat_id": repeat_id,
                "retry_id": retry_id,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "key": key_3,
                "repeat_id": repeat_id,
                "retry_id": retry_id,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/steps/",
            json={"steps": steps},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        assert response["steps"][0]["key"] == key_1
        assert response["steps"][1]["key"] == key_2
        assert response["steps"][2]["key"] == key_3

        steps = response["steps"]
        step_ids = [step["id"] for step in steps]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        steps[0]["status"] = "success"
        steps[1]["status"] = "failure"
        steps[2]["status"] = "cancelled"

        response = authed_api(
            "PATCH",
            "/preview/evaluations/steps/",
            json={"steps": steps},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        assert response["steps"][0]["id"] == step_ids[0]
        assert response["steps"][0]["status"] == "success"
        assert response["steps"][1]["id"] == step_ids[1]
        assert response["steps"][1]["status"] == "failure"
        assert response["steps"][2]["id"] == step_ids[2]
        assert response["steps"][2]["status"] == "cancelled"
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------

        # ----------------------------------------------------------------------

    def test_delete_evaluation_steps(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][0]["id"]

        key_1 = "input"
        key_2 = "invocation"

        steps = [
            {
                "key": key_1,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
            {
                "key": key_2,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/steps/",
            json={"steps": steps},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2

        step_ids = [step["id"] for step in response["steps"]]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/preview/evaluations/steps/",
            json={"step_ids": step_ids},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert response["step_ids"] == step_ids
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/preview/evaluations/steps/",
            json={"step_ids": step_ids},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_fetch_evaluation_step(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][2]["id"]

        key_1 = "input"

        steps = [
            {
                "key": key_1,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/steps/",
            json={"steps": steps},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        step_id = response["steps"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/evaluations/steps/{step_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["step"]["id"] == step_id
        # ----------------------------------------------------------------------

    def test_edit_evaluation_step(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][0]["id"]

        key_1 = "input"

        steps = [
            {
                "key": key_1,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/steps/",
            json={"steps": steps},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["steps"][0]["key"] == key_1
        assert response["steps"][0]["status"] == "pending"

        step = response["steps"][0]
        step_id = step["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        step["status"] = "success"

        response = authed_api(
            "PATCH",
            f"/preview/evaluations/steps/{step_id}",
            json={"step": step},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        print(response)
        assert response["count"] == 1
        assert response["step"]["id"] == step_id
        assert response["step"]["status"] == "success"
        # ----------------------------------------------------------------------

    def test_delete_evaluation_step(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        scenario_id = mock_data["scenarios"][0]["id"]

        key_1 = "input"

        steps = [
            {
                "key": key_1,
                "scenario_id": scenario_id,
                "run_id": run_id,
            },
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/steps/",
            json={"steps": steps},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        step_id = response["steps"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/evaluations/steps/{step_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["step_id"] == step_id
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/evaluations/steps/{step_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------
