from uuid import uuid4
from json import dumps
from urllib.parse import quote

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE --------------------------------------------------------------
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

    workflow_variant_id_0 = response.json()["workflow_variant"]["id"]

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

    workflow_variant_id_1 = response.json()["workflow_variant"]["id"]

    response = authed_api(
        "POST",
        f"/preview/workflows/variants/{workflow_variant_id_1}/archive",
    )

    assert response.status_code == 200

    response = authed_api(
        "GET",
        "/preview/workflows/variants/?include_archived=true",
    )

    assert response.status_code == 200
    response = response.json()

    assert response["count"] == 2
    assert response["workflow_variants"][0]["id"] == workflow_variant_id_0
    assert response["workflow_variants"][1]["id"] == workflow_variant_id_1
    # --------------------------------------------------------------------------

    return response


class TestWorkflowVariantsQueries:
    def test_query_non_archived_workflow_variants(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            "/preview/workflows/variants/",
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
            "GET",
            "/preview/workflows/variants/?include_archived=true",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert (
            response["workflow_variants"][0]["id"]
            == mock_data["workflow_variants"][0]["id"]
        )
        # ----------------------------------------------------------------------

    def test_query_paginated_workflow_variants(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            "/preview/workflows/variants/?include_archived=true" "&limit=1",
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
            "GET",
            "/preview/workflows/variants/?include_archived=true"
            f"&limit=1&next={response['workflow_variants'][0]['id']}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert (
            response["workflow_variants"][0]["id"]
            == mock_data["workflow_variants"][1]["id"]
        )
        # ----------------------------------------------------------------------

        response = authed_api(
            "GET",
            "/preview/workflows/variants/?include_archived=true"
            f"&limit=1&next={response['workflow_variants'][0]['id']}",
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
        # ACT ------------------------------------------------------------------
        flags = quote(dumps(mock_data["workflow_variants"][0]["flags"]))
        response = authed_api(
            "GET",
            f"/preview/workflows/variants/?flags={flags}",
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
        flags = quote(dumps({"is_custom": True}))

        response = authed_api(
            "GET",
            f"/preview/workflows/variants/?flags={flags}",
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
        tags = quote(dumps(mock_data["workflow_variants"][0]["tags"]))
        response = authed_api(
            "GET",
            f"/preview/workflows/variants/?tags={tags}",
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
        tags = quote(dumps({"tag1": "value2"}))

        response = authed_api(
            "GET",
            f"/preview/workflows/variants/?tags={tags}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_query_workflow_variants_by_meta(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        meta = quote(dumps(mock_data["workflow_variants"][0]["meta"]))
        response = authed_api(
            "GET",
            f"/preview/workflows/variants/?meta={meta}",
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
        meta = quote(dumps({"meta1": "value2"}))

        response = authed_api(
            "GET",
            f"/preview/workflows/variants/?meta={meta}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------
