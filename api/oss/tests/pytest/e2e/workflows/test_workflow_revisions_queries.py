from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE ------------------------------------------------------------------
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
        },
        "meta": {
            "meta1": "value1",
            "meta2": "value2",
            "meta3": "value3",
        },
    }

    response = authed_api(
        "POST",
        "/preview/workflows/",
        json={"workflow": workflow},
    )

    assert response.status_code == 200

    workflow_id = response.json()["workflow"]["id"]

    workflow_variant_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"workflow-variant-{workflow_variant_slug}",
                "name": f"Workflow Variant {workflow_variant_slug}",
                "description": "Workflow Variant Description",
                "flags": {
                    "is_custom": False,
                    "is_evaluator": False,
                    "is_human": False,
                },
                "tags": {
                    "tag1": "value1",
                    "tag2": "value2",
                    "tag3": "value3",
                },
                "meta": {
                    "meta1": "value1",
                    "meta2": "value2",
                    "meta3": "value3",
                },
                "workflow_id": workflow_id,
            }
        },
    )

    assert response.status_code == 200

    workflow_variant_id = response.json()["workflow_variant"]["id"]

    workflow_revision_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_revision_slug}",
                "name": f"Workflow Revision {workflow_revision_slug}",
                "description": "Workflow Revision Description",
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
                "workflow_id": workflow_id,
                "workflow_variant_id": workflow_variant_id,
            }
        },
    )

    assert response.status_code == 200

    workflow_revision_0 = response.json()["workflow_revision"]

    workflow_revision_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-Revision-{workflow_revision_slug}",
                "name": f"Workflow Revision {workflow_revision_slug}",
                "description": "Workflow Revision Description",
                "flags": {
                    "is_custom": False,
                    "is_evaluator": False,
                    "is_human": False,
                },
                "tags": {
                    "tag1": "value3",
                    "tag2": "value2",
                    "tag3": "value1",
                    "_marker": unique_marker,
                },
                "meta": {
                    "meta1": "value3",
                    "meta2": "value2",
                    "meta3": "value1",
                    "_marker": unique_marker,
                },
                "workflow_id": workflow_id,
                "workflow_variant_id": workflow_variant_id,
            }
        },
    )

    assert response.status_code == 200

    workflow_revision_1 = response.json()["workflow_revision"]

    response = authed_api(
        "POST",
        f"/preview/workflows/revisions/{workflow_revision_1['id']}/archive",
    )

    assert response.status_code == 200

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/query",
        json={
            "include_archived": True,
            "workflow_revision": {"tags": {"_marker": unique_marker}},
        },
    )

    assert response.status_code == 200
    response = response.json()

    assert response["count"] == 2
    rev_ids = {r["id"] for r in response["workflow_revisions"]}
    assert workflow_revision_0["id"] in rev_ids
    assert workflow_revision_1["id"] in rev_ids
    # --------------------------------------------------------------------------

    _mock_data = {
        "workflow_revisions": [workflow_revision_0, workflow_revision_1],
        "_marker": unique_marker,
    }

    return _mock_data


class TestWorkflowRevisionsQueries:
    def test_query_non_archived_workflow_revisions(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/query",
            json={
                "workflow_revision": {"tags": {"_marker": mock_data["_marker"]}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert (
            response["workflow_revisions"][0]["id"]
            == mock_data["workflow_revisions"][0]["id"]
        )
        # ----------------------------------------------------------------------

    def test_query_all_workflow_revisions(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/query",
            json={
                "include_archived": True,
                "workflow_revision": {"tags": {"_marker": mock_data["_marker"]}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        rev_ids = {r["id"] for r in response["workflow_revisions"]}
        assert mock_data["workflow_revisions"][0]["id"] in rev_ids
        assert mock_data["workflow_revisions"][1]["id"] in rev_ids
        # ----------------------------------------------------------------------

    def test_query_paginated_workflow_revisions(
        self,
        authed_api,
        mock_data,
    ):
        marker = mock_data["_marker"]
        expected_ids = {r["id"] for r in mock_data["workflow_revisions"]}

        # ACT — page 1 --------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/query",
            json={
                "include_archived": True,
                "workflow_revision": {"tags": {"_marker": marker}},
                "windowing": {"limit": 1},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        seen_ids = {response["workflow_revisions"][0]["id"]}
        # ----------------------------------------------------------------------

        # ACT — page 2 --------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/query",
            json={
                "include_archived": True,
                "workflow_revision": {"tags": {"_marker": marker}},
                "windowing": {
                    "limit": 1,
                    "next": response["workflow_revisions"][0]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        seen_ids.add(response["workflow_revisions"][0]["id"])
        assert seen_ids == expected_ids
        # ----------------------------------------------------------------------

        # ACT — page 3 (empty) ------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/query",
            json={
                "include_archived": True,
                "workflow_revision": {"tags": {"_marker": marker}},
                "windowing": {
                    "limit": 1,
                    "next": response["workflow_revisions"][0]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_query_workflow_revisions_by_flags(
        self,
        authed_api,
        mock_data,
    ):
        marker = mock_data["_marker"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/query",
            json={
                "workflow_revision": {
                    "flags": mock_data["workflow_revisions"][0]["flags"],
                    "tags": {"_marker": marker},
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert (
            response["workflow_revisions"][0]["id"]
            == mock_data["workflow_revisions"][0]["id"]
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/query",
            json={
                "workflow_revision": {
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

    def test_query_workflow_revisions_by_tags(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/query",
            json={
                "workflow_revision": {
                    "tags": mock_data["workflow_revisions"][0]["tags"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert (
            response["workflow_revisions"][0]["id"]
            == mock_data["workflow_revisions"][0]["id"]
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/query",
            json={
                "workflow_revision": {
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
