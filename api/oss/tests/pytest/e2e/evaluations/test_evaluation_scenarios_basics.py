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

    _mock_data = {
        "runs": [run_1],
    }

    return _mock_data


class TestEvaluationScenariosBasics:
    def test_create_evaluation_scenarios(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]

        tags = {"tags1": "value1", "tags2": "value2"}

        meta = {"meta1": "value1", "meta2": "value2"}

        scenarios = [{"run_id": run_id, "tags": tags, "meta": meta}]

        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/",
            json={"scenarios": scenarios},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["scenarios"][0]["run_id"] == run_id
        # ----------------------------------------------------------------------

    def test_fetch_evaluation_scenarios(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]

        tags = {"tags1": "value1", "tags2": "value2"}

        meta = {"meta1": "value1", "meta2": "value2"}

        scenarios = [{"run_id": run_id, "tags": tags, "meta": meta}]

        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/",
            json={"scenarios": scenarios},
        )

        assert response.status_code == 200

        scenario_id = response.json()["scenarios"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/evaluations/scenarios/{scenario_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["scenario"]["id"] == scenario_id
        assert response["scenario"]["run_id"] == run_id
        assert response["scenario"]["tags"] == tags
        assert response["scenario"]["meta"] == meta
        # ----------------------------------------------------------------------

    def test_edit_evaluation_scenarios(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]

        tags = {"tags1": "value1", "tags2": "value2"}

        meta = {"meta1": "value1", "meta2": "value2"}

        scenarios = [{"run_id": run_id, "tags": tags, "meta": meta}]

        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/",
            json={"scenarios": scenarios},
        )

        assert response.status_code == 200

        scenario_id = response.json()["scenarios"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        tags = {"tags1": "value2", "tags2": "value1"}

        meta = {"meta1": "value2", "meta2": "value1"}

        scenario = {
            "id": scenario_id,
            "tags": tags,
            "meta": meta,
            "status": "success",
        }

        response = authed_api(
            "PATCH",
            f"/preview/evaluations/scenarios/{scenario_id}",
            json={"scenario": scenario},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["scenario"]["tags"] == tags
        assert response["scenario"]["meta"] == meta
        # ----------------------------------------------------------------------

    def test_delete_evaluation_scenarios(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]

        scenarios = [{"run_id": run_id}, {"run_id": run_id}]

        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/",
            json={"scenarios": scenarios},
        )

        assert response.status_code == 200

        scenario_ids = [scenario["id"] for scenario in response.json()["scenarios"]]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/preview/evaluations/scenarios/",
            json={"scenario_ids": scenario_ids},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert response["scenario_ids"] == scenario_ids
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/preview/evaluations/scenarios/",
            json={"scenario_ids": scenario_ids},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_fetch_evaluation_scenario(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]

        tags = {"tags1": "value1", "tags2": "value2"}

        meta = {"meta1": "value1", "meta2": "value2"}

        scenarios = [{"run_id": run_id, "tags": tags, "meta": meta}]

        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/",
            json={"scenarios": scenarios},
        )

        assert response.status_code == 200

        scenario_id = response.json()["scenarios"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/evaluations/scenarios/{scenario_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["scenario"]["id"] == scenario_id
        assert response["scenario"]["tags"] == tags
        assert response["scenario"]["meta"] == meta
        # ----------------------------------------------------------------------

    def test_edit_evaluation_scenario(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]

        tags = {"tags1": "value1", "tags2": "value2"}

        meta = {"meta1": "value1", "meta2": "value2"}

        scenarios = [{"run_id": run_id, "tags": tags, "meta": meta}]

        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/",
            json={"scenarios": scenarios},
        )

        assert response.status_code == 200

        scenario_id = response.json()["scenarios"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        tags = {"tags1": "value2", "tags2": "value1"}

        meta = {"meta1": "value2", "meta2": "value1"}

        scenario = {
            "id": scenario_id,
            "tags": tags,
            "meta": meta,
            "status": "success",
        }

        response = authed_api(
            "PATCH",
            f"/preview/evaluations/scenarios/{scenario_id}",
            json={"scenario": scenario},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["scenario"]["tags"] == tags
        assert response["scenario"]["meta"] == meta
        # ----------------------------------------------------------------------

    def test_delete_evaluation_scenario(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]

        scenarios = [{"run_id": run_id}]

        response = authed_api(
            "POST",
            "/preview/evaluations/scenarios/",
            json={"scenarios": scenarios},
        )

        assert response.status_code == 200

        scenario_id = response.json()["scenarios"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/evaluations/scenarios/{scenario_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["scenario_id"] == scenario_id
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/evaluations/scenarios/{scenario_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------
