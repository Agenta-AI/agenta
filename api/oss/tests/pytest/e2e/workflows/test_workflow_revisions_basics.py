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

    workflow_variant_data = response.json()
    # --------------------------------------------------------------------------

    _mock_data = dict(
        workflows=[workflow_data["workflow"]],
        workflow_variants=[workflow_variant_data["workflow_variant"]],
    )

    return _mock_data


class TestWorkflowRevisionsBasics:
    def test_create_workflow_revision(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        workflow_variant_slug = uuid4()

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/",
            json={
                "workflow_revision": {
                    "slug": f"workflow-revision-{workflow_variant_slug}",
                    "name": f"Workflow Revision {workflow_variant_slug}",
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
                    },
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                        "meta3": "value3",
                    },
                    "workflow_id": mock_data["workflows"][0]["id"],
                    "workflow_variant_id": mock_data["workflow_variants"][0]["id"],
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        workflow_revision = response["workflow_revision"]
        assert workflow_revision["workflow_id"] == mock_data["workflows"][0]["id"]
        # ----------------------------------------------------------------------

    def test_fetch_workflow_revision(
        self,
        authed_api,
        mock_data,
    ):
        # ARRANGE --------------------------------------------------------------
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
                    },
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                        "meta3": "value3",
                    },
                    "workflow_id": mock_data["workflows"][0]["id"],
                    "workflow_variant_id": mock_data["workflow_variants"][0]["id"],
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_revision_id = response["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/workflows/revisions/{workflow_revision_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_edit_workflow_revision(
        self,
        authed_api,
        mock_data,
    ):
        # ARRANGE --------------------------------------------------------------
        workflow_revision_slug = uuid4()

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/",
            json={
                "workflow_revision": {
                    "slug": f"workflow-revision-{workflow_revision_slug}",
                    "name": f"Workflow revision {workflow_revision_slug}",
                    "description": "Workflow revision Description",
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
                    "workflow_variant_id": mock_data["workflow_variants"][0]["id"],
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_revision_id = response["workflow_revision"]["id"]
        workflow_revision_slug = response["workflow_revision"]["slug"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "PUT",
            f"/preview/workflows/revisions/{workflow_revision_id}",
            json={
                "workflow_revision": {
                    "id": workflow_revision_id,
                    "name": "Another Workflow revision Name",
                    "description": "Another Workflow revisionDescription",
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

    def test_archive_workflow_revision(
        self,
        authed_api,
        mock_data,
    ):
        # ARRANGE --------------------------------------------------------------
        workflow_revision_slug = uuid4()

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/",
            json={
                "workflow_revision": {
                    "slug": f"workflow-revision-{workflow_revision_slug}",
                    "name": f"Workflow revision {workflow_revision_slug}",
                    "description": "Workflow revision Description",
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
                    "workflow_variant_id": mock_data["workflow_variants"][0]["id"],
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_revision_id = response["workflow_revision"]["id"]
        workflow_revision_slug = response["workflow_revision"]["slug"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/workflows/revisions/{workflow_revision_id}/archive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow_revision"].get("deleted_at") is not None
        # ----------------------------------------------------------------------

    def test_unarchive_workflow_revision(
        self,
        authed_api,
        mock_data,
    ):
        # ARRANGE --------------------------------------------------------------
        workflow_revision_slug = uuid4()

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/",
            json={
                "workflow_revision": {
                    "slug": f"workflow-revision-{workflow_revision_slug}",
                    "name": f"Workflow revision {workflow_revision_slug}",
                    "description": "Workflow revision Description",
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
                    "workflow_variant_id": mock_data["workflow_variants"][0]["id"],
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_revision_id = response["workflow_revision"]["id"]
        workflow_revision_slug = response["workflow_revision"]["slug"]

        response = authed_api(
            "POST",
            f"/preview/workflows/revisions/{workflow_revision_id}/archive",
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow_revision"].get("deleted_at") is not None
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/workflows/revisions/{workflow_revision_id}/unarchive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow_revision"].get("deleted_at") is None
        # ----------------------------------------------------------------------

    def test_commit_workflow_revision(
        self,
        authed_api,
        mock_data,
    ):
        # ARRANGE --------------------------------------------------------------
        workflow_revision_slug = uuid4()

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/",
            json={
                "workflow_revision": {
                    "slug": f"workflow-revision-{workflow_revision_slug}",
                    "name": f"Workflow revision {workflow_revision_slug}",
                    "description": "Workflow revision Description",
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
                    "workflow_variant_id": mock_data["workflow_variants"][0]["id"],
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_revision_id = response["workflow_revision"]["id"]
        workflow_revision_slug = response["workflow_revision"]["slug"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        message = f"Initial commit for workflow revision {workflow_revision_slug}"
        configuration = {"key1": "value1"}

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "revision_id": workflow_revision_id,
                    "slug": f"workflow-revision-new-{workflow_revision_slug}",
                    "name": f"Workflow revision new {workflow_revision_slug}",
                    "description": "Workflow revision new Description",
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
                    "message": message,
                    "data": {"configuration": configuration},
                    "workflow_id": mock_data["workflows"][0]["id"],
                    "workflow_variant_id": mock_data["workflow_variants"][0]["id"],
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow_revision"]["message"] == message
        assert response["workflow_revision"]["data"]["configuration"] == configuration
        # ----------------------------------------------------------------------
