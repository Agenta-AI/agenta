import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE ------------------------------------------------------------------
    tags = {
        "tags1": "value1",
        "tags2": "value2",
    }

    meta = {
        "meta1": "value1",
        "meta2": "value2",
    }

    run = {
        "name": "My first evaluation run name",
        "description": "My first evaluation run description",
        "status": "success",
        "tags": tags,
        "meta": meta,
    }

    response = authed_api(
        "POST",
        "/preview/evaluations/runs/",
        json={"runs": [run]},
    )
    assert response.status_code == 200

    run_1 = response.json()["runs"][0]

    # --------------------------------------------------------------------------
    tags = {
        "tags1": "value2",
        "tags2": "value3",
    }

    meta = {
        "meta1": "value2",
        "meta2": "value3",
    }

    run = {
        "name": "My second evaluation run name",
        "description": "My second evaluation run description",
        "status": "pending",
        "tags": tags,
        "meta": meta,
    }

    response = authed_api(
        "POST",
        "/preview/evaluations/runs/",
        json={"runs": [run]},
    )
    assert response.status_code == 200

    run_2 = response.json()["runs"][0]

    # --------------------------------------------------------------------------

    tags = {"tags1": "value1", "tags2": "value2"}

    meta = {"meta1": "value1", "meta2": "value2"}

    scenarios = [
        {
            "run_id": run_1["id"],
            "tags": tags,
            "meta": meta,
            "status": "success",
        }
    ]

    response = authed_api(
        "POST",
        "/preview/evaluations/scenarios/",
        json={"scenarios": scenarios},
    )

    assert response.status_code == 200

    scenario_1 = response.json()["scenarios"][0]

    # --------------------------------------------------------------------------

    tags = {"tags1": "value2", "tags2": "value3"}

    meta = {"meta1": "value2", "meta2": "value3"}

    scenarios = [
        {
            "run_id": run_2["id"],
            "tags": tags,
            "meta": meta,
            "status": "pending",
        }
    ]

    response = authed_api(
        "POST",
        "/preview/evaluations/scenarios/",
        json={"scenarios": scenarios},
    )

    assert response.status_code == 200

    scenario_2 = response.json()["scenarios"][0]

    # --------------------------------------------------------------------------

    tags = {"tags1": "value3", "tags2": "value4"}

    meta = {"meta1": "value3", "meta2": "value4"}

    scenarios = [
        {
            "run_id": run_2["id"],
            "tags": tags,
            "meta": meta,
            "status": "running",
        }
    ]

    response = authed_api(
        "POST",
        "/preview/evaluations/scenarios/",
        json={"scenarios": scenarios},
    )

    assert response.status_code == 200

    scenario_3 = response.json()["scenarios"][0]

    # --------------------------------------------------------------------------

    _mock_data = {
        "runs": [run_1, run_2],
        "scenarios": [scenario_1, scenario_2, scenario_3],
    }

    return _mock_data


class TestEvaluationScenariosQueries:
    def test_query_evaluation_scenarios_all(self, authed_api, mock_data):
        run_ids = [r["id"] for r in mock_data["runs"]]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/query",
            json={
                "scenario": {
                    "run_ids": run_ids,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        assert len(response["scenarios"]) == 3
        # ----------------------------------------------------------------------

    def test_query_evaluation_scenarios_by_tags(self, authed_api, mock_data):
        run_ids = [r["id"] for r in mock_data["runs"]]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/query",
            json={
                "scenario": {
                    "tags": {"tags1": "value1"},
                    "run_ids": run_ids,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert len(response["scenarios"]) == 1
        # ----------------------------------------------------------------------

    def test_query_evaluation_scenarios_by_run_ids(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/query",
            json={
                "scenario": {
                    "run_ids": [run_id],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["scenarios"][0]["run_id"] == run_id
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        run_id = mock_data["runs"][1]["id"]
        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/query",
            json={
                "scenario": {
                    "run_ids": [run_id],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert response["scenarios"][1]["run_id"] == run_id
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        run_1_id = mock_data["runs"][0]["id"]
        run_2_id = mock_data["runs"][1]["id"]
        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/query",
            json={
                "scenario": {
                    "run_ids": [run_1_id, run_2_id],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

    def test_query_evaluation_scenarios_by_status(self, authed_api, mock_data):
        run_ids = [r["id"] for r in mock_data["runs"]]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/query",
            json={
                "scenario": {
                    "status": "success",
                    "run_ids": run_ids,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/query",
            json={
                "scenario": {
                    "status": "pending",
                    "run_ids": run_ids,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/query",
            json={
                "scenario": {
                    "status": "running",
                    "run_ids": run_ids,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------
