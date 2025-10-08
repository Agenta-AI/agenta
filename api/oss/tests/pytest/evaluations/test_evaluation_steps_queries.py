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
    ]

    response = authed_api(
        "POST",
        "/preview/evaluations/scenarios/",
        json={"scenarios": scenarios},
    )

    assert response.status_code == 200

    scenarios = response.json()["scenarios"]

    repeat_id_1 = str(uuid4())
    retry_id_1 = str(uuid4())
    repeat_id_2 = str(uuid4())
    retry_id_2 = str(uuid4())

    tags = {
        "tag1": "value1",
        "tag2": "value2",
    }

    meta = {
        "meta1": "value1",
        "meta2": "value2",
    }

    steps = [
        {
            "key": "input",
            "repeat_id": repeat_id_1,
            "retry_id": retry_id_1,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "success",
            "tags": tags,
            "meta": meta,
        },
        {
            "key": "invocation",
            "repeat_id": repeat_id_1,
            "retry_id": retry_id_1,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "failure",
        },
        {
            "key": "annotation",
            "repeat_id": repeat_id_1,
            "retry_id": retry_id_1,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "cancelled",
        },
        {
            "key": "input",
            "repeat_id": repeat_id_2,
            "retry_id": retry_id_2,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "success",
        },
        {
            "key": "invocation",
            "repeat_id": repeat_id_2,
            "retry_id": retry_id_2,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "failure",
            "tags": tags,
            "meta": meta,
        },
        {
            "key": "annotation",
            "repeat_id": repeat_id_2,
            "retry_id": retry_id_2,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "cancelled",
        },
        {
            "key": "input",
            "repeat_id": repeat_id_1,
            "retry_id": retry_id_1,
            "scenario_id": scenarios[1]["id"],
            "run_id": run_1["id"],
            "status": "success",
        },
        {
            "key": "invocation",
            "repeat_id": repeat_id_1,
            "retry_id": retry_id_1,
            "scenario_id": scenarios[1]["id"],
            "run_id": run_1["id"],
            "status": "failure",
            "tags": tags,
            "meta": meta,
        },
        {
            "key": "annotation",
            "repeat_id": repeat_id_1,
            "retry_id": retry_id_1,
            "scenario_id": scenarios[1]["id"],
            "run_id": run_1["id"],
            "status": "cancelled",
        },
    ]

    response = authed_api(
        "POST",
        "/preview/evaluations/results/",
        json={"steps": steps},
    )

    assert response.status_code == 200
    response = response.json()
    assert response["count"] == 9

    steps = response["steps"]
    # --------------------------------------------------------------------------

    _mock_data = {
        "runs": [run_1],
        "scenarios": scenarios,
        "steps": steps,
    }

    return _mock_data


class TestEvaluationResultsQueries:
    def test_query_results_all(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 9
        # ----------------------------------------------------------------------

    def test_query_results_by_tags(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "tags": {
                        "tag1": "value1",
                        "tag2": "value2",
                    }
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

    def test_query_results_by_meta(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                    }
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

    def test_query_results_by_run_id(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "run_id": mock_data["runs"][0]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 9
        # ----------------------------------------------------------------------

    def test_query_results_by_run_ids(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "run_ids": [mock_data["runs"][0]["id"]],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 9
        # ----------------------------------------------------------------------

    def test_query_results_by_scenario_id(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "scenario_id": mock_data["scenarios"][0]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 6
        # ----------------------------------------------------------------------

    def test_query_results_by_scenario_ids(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "scenario_ids": [s["id"] for s in mock_data["scenarios"]],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 9
        # ----------------------------------------------------------------------

    def test_query_results_by_ids(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "ids": [s["id"] for s in mock_data["steps"][:-1]],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 9 - 1
        # ----------------------------------------------------------------------

    def test_query_results_by_key(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "key": "input",
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

    def test_query_results_by_keys(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "keys": ["input", "invocation"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 6
        # ----------------------------------------------------------------------

    def test_query_results_by_repeat_id(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "repeat_id": mock_data["steps"][0]["repeat_id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 6
        # ----------------------------------------------------------------------

    def test_query_results_by_repeat_ids(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "repeat_ids": [
                        mock_data["steps"][0]["repeat_id"],
                        mock_data["steps"][3]["repeat_id"],
                    ]
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 9
        # ----------------------------------------------------------------------

    def test_query_results_by_retry_id(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "retry_id": mock_data["steps"][0]["retry_id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 6
        # ----------------------------------------------------------------------

    def test_query_results_by_retry_ids(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "retry_ids": [
                        mock_data["steps"][0]["retry_id"],
                        mock_data["steps"][3]["retry_id"],
                    ]
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 9
        # ----------------------------------------------------------------------

    def test_query_results_by_status(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "status": "success",
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

    def test_query_results_by_statuses(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "step": {
                    "statuses": ["success", "failure"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 6
        # ----------------------------------------------------------------------
