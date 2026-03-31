from uuid import uuid4

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

    workflow_data = response.json()
    # --------------------------------------------------------------------------

    _mock_data = dict(
        workflows=[workflow_data["workflow"]],
    )

    return _mock_data


class TestWorkflowVariantsBasics:
    def test_create_workflow_variant(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
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
                    "workflow_id": mock_data["workflows"][0]["id"],
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        workflow_variant = response["workflow_variant"]
        assert workflow_variant["workflow_id"] == mock_data["workflows"][0]["id"]
        # ----------------------------------------------------------------------

    def test_fetch_workflow_variant(
        self,
        authed_api,
        mock_data,
    ):
        # ARRANGE --------------------------------------------------------------
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
                    "workflow_id": mock_data["workflows"][0]["id"],
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_variant_id = response["workflow_variant"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/workflows/variants/{workflow_variant_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_edit_workflow_variant(
        self,
        authed_api,
        mock_data,
    ):
        # ARRANGE --------------------------------------------------------------
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
                    "workflow_id": mock_data["workflows"][0]["id"],
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_variant_id = response["workflow_variant"]["id"]
        workflow_variant_slug = response["workflow_variant"]["slug"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "PUT",
            f"/preview/workflows/variants/{workflow_variant_id}",
            json={
                "workflow_variant": {
                    "id": workflow_variant_id,
                    "name": "Another Workflow Variant Name",
                    "description": "Another Workflow VariantDescription",
                    "flags": {
                        "is_custom": False,
                        "is_evaluator": False,
                        "is_human": False,
                    },
                    "tags": {
                        "tag1": "value3",
                        "tag2": "value2",
                        "tag3": "value1",
                    },
                    "meta": {
                        "meta1": "value3",
                        "meta2": "value2",
                        "meta3": "value1",
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_archive_workflow_variant(
        self,
        authed_api,
        mock_data,
    ):
        # ARRANGE --------------------------------------------------------------
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
                    "workflow_id": mock_data["workflows"][0]["id"],
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_variant_id = response["workflow_variant"]["id"]
        workflow_variant_slug = response["workflow_variant"]["slug"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/workflows/variants/{workflow_variant_id}/archive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow_variant"].get("deleted_at") is not None
        # ----------------------------------------------------------------------

    def test_unarchive_workflow_variant(
        self,
        authed_api,
        mock_data,
    ):
        # ARRANGE --------------------------------------------------------------
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
                    "workflow_id": mock_data["workflows"][0]["id"],
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_variant_id = response["workflow_variant"]["id"]
        workflow_variant_slug = response["workflow_variant"]["slug"]

        response = authed_api(
            "POST",
            f"/preview/workflows/variants/{workflow_variant_id}/archive",
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow_variant"].get("deleted_at") is not None
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/workflows/variants/{workflow_variant_id}/unarchive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow_variant"].get("deleted_at") is None
        # ----------------------------------------------------------------------
