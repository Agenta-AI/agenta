from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE --------------------------------------------------------------
    # Use unique tag values to isolate from default evaluators
    unique_marker = uuid4().hex[:8]

    workflow_slug = uuid4()

    workflow = {
        "slug": f"workflow-{workflow_slug}",
        "name": f"Workflow {workflow_slug}",
        "description": "Workflow Description",
        "flags": {
            "is_custom": False,
            "is_evaluator": False,
            "is_human": False,
        },
        "tags": {
            "tag1": "value1",
            "tag2": "value2",
            "tag3": "value3",
            "_marker": unique_marker,
        },
        "meta": {
            "meta1": "value1",
            "meta2": "value2",
            "meta3": "value3",
            "_marker": unique_marker,
        },
    }

    response = authed_api(
        "POST",
        "/preview/workflows/",
        json={"workflow": workflow},
    )

    assert response.status_code == 200

    workflow_0 = response.json()["workflow"]

    workflow_slug = uuid4()

    workflow = {
        "slug": f"workflow-{workflow_slug}",
        "name": f"Workflow {workflow_slug}",
        "description": "Workflow Description",
        "flags": {
            "is_custom": False,
            "is_evaluator": True,
            "is_human": False,
        },
        "tags": {
            "tag1": "value1",
            "tag2": "2value",
            "tag3": "value3",
            "_marker": unique_marker,
        },
        "meta": {
            "meta1": "value1",
            "meta2": "2value",
            "meta3": "value3",
            "_marker": unique_marker,
        },
    }

    response = authed_api(
        "POST",
        "/preview/workflows/",
        json={"workflow": workflow},
    )

    assert response.status_code == 200

    workflow_1 = response.json()["workflow"]

    response = authed_api(
        "POST",
        f"/preview/workflows/{workflow_1['id']}/archive",
    )

    assert response.status_code == 200

    # Verify with marker-scoped query
    response = authed_api(
        "POST",
        "/preview/workflows/query",
        json={
            "include_archived": True,
            "workflow": {"tags": {"_marker": unique_marker}},
        },
    )

    assert response.status_code == 200
    response = response.json()

    assert response["count"] == 2
    workflow_ids = {w["id"] for w in response["workflows"]}
    assert workflow_0["id"] in workflow_ids
    assert workflow_1["id"] in workflow_ids
    # --------------------------------------------------------------------------

    _mock_data = {
        "workflows": [workflow_0, workflow_1],
        "_marker": unique_marker,
    }

    return _mock_data


class TestWorkflowsQueries:
    def test_query_non_archived_workflows(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/query",
            json={
                "workflow": {"tags": {"_marker": mock_data["_marker"]}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflows"][0]["id"] == mock_data["workflows"][0]["id"]
        # ----------------------------------------------------------------------

    def test_query_all_workflows(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/query",
            json={
                "include_archived": True,
                "workflow": {"tags": {"_marker": mock_data["_marker"]}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        workflow_ids = {w["id"] for w in response["workflows"]}
        assert mock_data["workflows"][0]["id"] in workflow_ids
        assert mock_data["workflows"][1]["id"] in workflow_ids
        # ----------------------------------------------------------------------

    def test_query_paginated_workflows(
        self,
        authed_api,
        mock_data,
    ):
        marker = mock_data["_marker"]
        expected_ids = {w["id"] for w in mock_data["workflows"]}

        # ACT — page 1 --------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/query",
            json={
                "include_archived": True,
                "workflow": {"tags": {"_marker": marker}},
                "windowing": {"limit": 1},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        seen_ids = {response["workflows"][0]["id"]}
        # ----------------------------------------------------------------------

        # ACT — page 2 --------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/query",
            json={
                "include_archived": True,
                "workflow": {"tags": {"_marker": marker}},
                "windowing": {
                    "limit": 1,
                    "next": response["workflows"][0]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        seen_ids.add(response["workflows"][0]["id"])
        assert seen_ids == expected_ids
        # ----------------------------------------------------------------------

        # ACT — page 3 (empty) ------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/query",
            json={
                "include_archived": True,
                "workflow": {"tags": {"_marker": marker}},
                "windowing": {
                    "limit": 1,
                    "next": response["workflows"][0]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_query_workflows_by_flags(
        self,
        authed_api,
        mock_data,
    ):
        marker = mock_data["_marker"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/query",
            json={
                "workflow": {
                    "flags": mock_data["workflows"][0]["flags"],
                    "tags": {"_marker": marker},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflows"][0]["id"] == mock_data["workflows"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/query",
            json={
                "workflow": {
                    "flags": {"is_custom": True},
                    "tags": {"_marker": marker},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_query_workflows_by_tags(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/query",
            json={
                "workflow": {
                    "tags": mock_data["workflows"][0]["tags"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflows"][0]["id"] == mock_data["workflows"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/query",
            json={
                "workflow": {
                    "tags": {"tag1": "nonexistent_value"},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------
