from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE ------------------------------------------------------------------
    unique_marker = uuid4().hex[:8]

    tags = {
        "tags1": "value1",
        "tags2": "value2",
        "_marker": unique_marker,
    }

    meta = {
        "meta1": "value1",
        "meta2": "value2",
        "_marker": unique_marker,
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
        "_marker": unique_marker,
    }

    meta = {
        "meta1": "value2",
        "meta2": "value3",
        "_marker": unique_marker,
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
    tags = {
        "tags1": "value3",
        "tags2": "value1",
        "_marker": unique_marker,
    }

    meta = {
        "meta1": "value3",
        "meta2": "value1",
        "_marker": unique_marker,
    }

    run = {
        "name": "My third evaluation run name",
        "description": "My third evaluation run description",
        "status": "failure",
        "tags": tags,
        "meta": meta,
    }

    response = authed_api(
        "POST",
        "/preview/evaluations/runs/",
        json={"runs": [run]},
    )
    assert response.status_code == 200

    run_3 = response.json()["runs"][0]

    response = authed_api(
        "POST",
        f"/preview/evaluations/runs/{run_3['id']}/close",
    )

    assert response.status_code == 200

    # --------------------------------------------------------------------------
    _mock_data = {
        "runs": [run_1, run_2, run_3],
        "_marker": unique_marker,
    }

    return _mock_data


class TestEvaluationRunsQueries:
    def test_query_evaluations_runs_by_marker(self, authed_api, mock_data):
        marker = mock_data["_marker"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "tags": {"_marker": marker},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        run_ids = [r["id"] for r in response["runs"]]
        assert mock_data["runs"][0]["id"] in run_ids
        assert mock_data["runs"][1]["id"] in run_ids
        assert mock_data["runs"][2]["id"] in run_ids
        # ----------------------------------------------------------------------

    def test_query_evaluations_runs_by_ids(self, authed_api, mock_data):
        run_ids = [r["id"] for r in mock_data["runs"]]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "ids": run_ids,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

    def test_query_evaluations_runs_by_flags(self, authed_api, mock_data):
        marker = mock_data["_marker"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "flags": {"is_closed": True},
                    "tags": {"_marker": marker},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["id"] == mock_data["runs"][2]["id"]
        # ----------------------------------------------------------------------

    def test_query_evaluations_runs_by_tags(self, authed_api, mock_data):
        marker = mock_data["_marker"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "tags": {
                        "tags1": "value1",
                        "tags2": "value2",
                        "_marker": marker,
                    },
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["id"] == mock_data["runs"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "tags": {
                        "tags1": "value2",
                        "tags2": "value3",
                        "_marker": marker,
                    },
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["id"] == mock_data["runs"][1]["id"]
        # ----------------------------------------------------------------------

    def test_query_evaluations_runs_by_status(self, authed_api, mock_data):
        marker = mock_data["_marker"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "status": "success",
                    "tags": {"_marker": marker},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["status"] == "success"
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "status": "pending",
                    "tags": {"_marker": marker},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["status"] == "pending"
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "status": "failure",
                    "tags": {"_marker": marker},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["status"] == "failure"
        # ----------------------------------------------------------------------
