from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE --------------------------------------------------------------
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
                "slug": f"workflow-{workflow_variant_slug}",
                "name": f"Workflow {workflow_variant_slug}",
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
                "workflow_id": workflow_id,
            }
        },
    )

    assert response.status_code == 200

    workflow_variant_0 = response.json()["workflow_variant"]

    workflow_variant_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"workflow-{workflow_variant_slug}",
                "name": f"Workflow {workflow_variant_slug}",
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
                "workflow_id": workflow_id,
            }
        },
    )

    assert response.status_code == 200

    workflow_variant_1 = response.json()["workflow_variant"]

    response = authed_api(
        "POST",
        f"/preview/workflows/variants/{workflow_variant_1['id']}/archive",
    )

    assert response.status_code == 200

    response = authed_api(
        "POST",
        "/preview/workflows/variants/query",
        json={
            "include_archived": True,
            "workflow_variant": {"tags": {"_marker": unique_marker}},
        },
    )

    assert response.status_code == 200
    response = response.json()

    assert response["count"] == 2
    variant_ids = {v["id"] for v in response["workflow_variants"]}
    assert workflow_variant_0["id"] in variant_ids
    assert workflow_variant_1["id"] in variant_ids
    # --------------------------------------------------------------------------

    _mock_data = {
        "workflow_variants": [workflow_variant_0, workflow_variant_1],
        "_marker": unique_marker,
    }

    return _mock_data


class TestWorkflowVariantsQueries:
    def test_query_non_archived_workflow_variants(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/variants/query",
            json={
                "workflow_variant": {"tags": {"_marker": mock_data["_marker"]}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert (
            response["workflow_variants"][0]["id"]
            == mock_data["workflow_variants"][0]["id"]
        )
        # ----------------------------------------------------------------------

    def test_query_all_workflow_variants(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/variants/query",
            json={
                "include_archived": True,
                "workflow_variant": {"tags": {"_marker": mock_data["_marker"]}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        variant_ids = {v["id"] for v in response["workflow_variants"]}
        assert mock_data["workflow_variants"][0]["id"] in variant_ids
        assert mock_data["workflow_variants"][1]["id"] in variant_ids
        # ----------------------------------------------------------------------

    def test_query_paginated_workflow_variants(
        self,
        authed_api,
        mock_data,
    ):
        marker = mock_data["_marker"]
        expected_ids = {v["id"] for v in mock_data["workflow_variants"]}

        # ACT — page 1 --------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/variants/query",
            json={
                "include_archived": True,
                "workflow_variant": {"tags": {"_marker": marker}},
                "windowing": {"limit": 1},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        seen_ids = {response["workflow_variants"][0]["id"]}
        # ----------------------------------------------------------------------

        # ACT — page 2 --------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/variants/query",
            json={
                "include_archived": True,
                "workflow_variant": {"tags": {"_marker": marker}},
                "windowing": {
                    "limit": 1,
                    "next": response["workflow_variants"][0]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        seen_ids.add(response["workflow_variants"][0]["id"])
        assert seen_ids == expected_ids
        # ----------------------------------------------------------------------

        # ACT — page 3 (empty) ------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/variants/query",
            json={
                "include_archived": True,
                "workflow_variant": {"tags": {"_marker": marker}},
                "windowing": {
                    "limit": 1,
                    "next": response["workflow_variants"][0]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_query_workflow_variants_by_flags(
        self,
        authed_api,
        mock_data,
    ):
        marker = mock_data["_marker"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/variants/query",
            json={
                "workflow_variant": {
                    "flags": mock_data["workflow_variants"][0]["flags"],
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
            response["workflow_variants"][0]["id"]
            == mock_data["workflow_variants"][0]["id"]
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/variants/query",
            json={
                "workflow_variant": {
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

    def test_query_workflow_variants_by_tags(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/variants/query",
            json={
                "workflow_variant": {
                    "tags": mock_data["workflow_variants"][0]["tags"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert (
            response["workflow_variants"][0]["id"]
            == mock_data["workflow_variants"][0]["id"]
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/variants/query",
            json={
                "workflow_variant": {
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
