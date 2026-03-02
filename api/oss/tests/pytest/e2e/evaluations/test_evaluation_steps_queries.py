import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE ------------------------------------------------------------------
    runs = [
        {"name": "test_evaluation_steps_queries"},
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

    repeat_idx_1 = 0
    repeat_idx_2 = 1

    tags = {
        "tag1": "value1",
        "tag2": "value2",
    }

    meta = {
        "meta1": "value1",
        "meta2": "value2",
    }

    results = [
        {
            "step_key": "input",
            "repeat_idx": repeat_idx_1,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "success",
            "tags": tags,
            "meta": meta,
        },
        {
            "step_key": "invocation",
            "repeat_idx": repeat_idx_1,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "failure",
        },
        {
            "step_key": "annotation",
            "repeat_idx": repeat_idx_1,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "cancelled",
        },
        {
            "step_key": "input",
            "repeat_idx": repeat_idx_2,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "success",
        },
        {
            "step_key": "invocation",
            "repeat_idx": repeat_idx_2,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "failure",
            "tags": tags,
            "meta": meta,
        },
        {
            "step_key": "annotation",
            "repeat_idx": repeat_idx_2,
            "scenario_id": scenarios[0]["id"],
            "run_id": run_1["id"],
            "status": "cancelled",
        },
        {
            "step_key": "input",
            "repeat_idx": repeat_idx_1,
            "scenario_id": scenarios[1]["id"],
            "run_id": run_1["id"],
            "status": "success",
        },
        {
            "step_key": "invocation",
            "repeat_idx": repeat_idx_1,
            "scenario_id": scenarios[1]["id"],
            "run_id": run_1["id"],
            "status": "failure",
            "tags": tags,
            "meta": meta,
        },
        {
            "step_key": "annotation",
            "repeat_idx": repeat_idx_1,
            "scenario_id": scenarios[1]["id"],
            "run_id": run_1["id"],
            "status": "cancelled",
        },
    ]

    response = authed_api(
        "POST",
        "/preview/evaluations/results/",
        json={"results": results},
    )

    assert response.status_code == 200
    response = response.json()
    assert response["count"] == 9

    results = response["results"]
    # --------------------------------------------------------------------------

    _mock_data = {
        "runs": [run_1],
        "scenarios": scenarios,
        "results": results,
    }

    return _mock_data


class TestEvaluationResultsQueries:
    def test_query_results_all(self, authed_api, mock_data):
        run_id = mock_data["runs"][0]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "result": {
                    "run_id": run_id,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 9
        # ----------------------------------------------------------------------

    def test_query_results_by_tags(self, authed_api, mock_data):
        run_id = mock_data["runs"][0]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "result": {
                    "run_id": run_id,
                    "tags": {
                        "tag1": "value1",
                        "tag2": "value2",
                    },
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
                "result": {
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
                "result": {
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
                "result": {
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
                "result": {
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
                "result": {
                    "ids": [s["id"] for s in mock_data["results"][:-1]],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 9 - 1
        # ----------------------------------------------------------------------

    def test_query_results_by_step_key(self, authed_api, mock_data):
        run_id = mock_data["runs"][0]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "result": {
                    "run_id": run_id,
                    "step_key": "input",
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

    def test_query_results_by_step_keys(self, authed_api, mock_data):
        run_id = mock_data["runs"][0]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "result": {
                    "run_id": run_id,
                    "step_keys": ["input", "invocation"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 6
        # ----------------------------------------------------------------------

    def test_query_results_by_repeat_idx(self, authed_api, mock_data):
        run_id = mock_data["runs"][0]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "result": {
                    "run_id": run_id,
                    "repeat_idx": mock_data["results"][0]["repeat_idx"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 6
        # ----------------------------------------------------------------------

    def test_query_results_by_repeat_idxs(self, authed_api, mock_data):
        run_id = mock_data["runs"][0]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "result": {
                    "run_id": run_id,
                    "repeat_idxs": [
                        mock_data["results"][0]["repeat_idx"],
                        mock_data["results"][3]["repeat_idx"],
                    ],
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
        run_id = mock_data["runs"][0]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "result": {
                    "run_id": run_id,
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
        run_id = mock_data["runs"][0]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/results/query",
            json={
                "result": {
                    "run_id": run_id,
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
