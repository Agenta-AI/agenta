from uuid import uuid4

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
    tags = {
        "tags1": "value3",
        "tags2": "value1",
    }

    meta = {
        "meta1": "value3",
        "meta2": "value1",
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
        f"/preview/evaluations/runs/{run_3['id']}/archive",
    )

    assert response.status_code == 200

    # --------------------------------------------------------------------------
    _mock_data = {
        "runs": [run_1, run_2, run_3],
    }

    return _mock_data


class TestEvaluationRunsQueries:
    def test_query_evaluations_runs_non_archived(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

    def test_query_evaluations_runs_include_archived(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "include_archived": True,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

    def test_query_evaluations_runs_by_flags(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "include_archived": True,
                "run": {
                    "flags": {"is_closed": True},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["tags"] == {
            "tags1": "value3",
            "tags2": "value1",
        }
        # ----------------------------------------------------------------------

    def test_query_evaluations_runs_by_tags(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "tags": {
                        "tags1": "value1",
                        "tags2": "value2",
                    },
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["tags"] == {
            "tags1": "value1",
            "tags2": "value2",
        }
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
                    },
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["tags"] == {
            "tags1": "value2",
            "tags2": "value3",
        }
        # ----------------------------------------------------------------------

    def test_query_evaluations_runs_by_meta(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                    },
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["meta"] == {
            "meta1": "value1",
            "meta2": "value2",
        }
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "meta": {
                        "meta1": "value2",
                        "meta2": "value3",
                    },
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["runs"][0]["meta"] == {
            "meta1": "value2",
            "meta2": "value3",
        }
        # ----------------------------------------------------------------------

    def test_query_evaluations_runs_by_status(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/query",
            json={
                "run": {
                    "status": "success",
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
                "include_archived": True,
                "run": {
                    "status": "failure",
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
