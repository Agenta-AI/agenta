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

    workflow_variant_data = response.json()

    workflow_variant_id = response.json()["workflow_variant"]["id"]

    workflow_revision_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_revision_slug}-first",
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
                "workflow_id": workflow_id,
                "workflow_variant_id": workflow_variant_id,
            }
        },
    )

    assert response.status_code == 200

    workflow_revision_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_revision_slug}-second",
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
                "workflow_id": workflow_id,
                "workflow_variant_id": workflow_variant_id,
            }
        },
    )

    assert response.status_code == 200

    workflow_revision_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_revision_slug}-third",
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
                "workflow_id": workflow_id,
                "workflow_variant_id": workflow_variant_id,
            }
        },
    )

    assert response.status_code == 200

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/query",
        json={
            "workflow_revision": {
                "workflow_variant_id": workflow_variant_id,
            },
        },
    )

    assert response.status_code == 200

    workflow_revision_data = response.json()
    # --------------------------------------------------------------------------

    _mock_data = dict(
        workflows=[workflow_data["workflow"]],
        workflow_variants=[workflow_variant_data["workflow_variant"]],
        workflow_revisions=workflow_revision_data["workflow_revisions"],
    )

    return _mock_data


class TestWorkflowRevisionsLineage:
    def test_log_all_workflow_revisions_by_variant(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        workflow_variant = mock_data["workflow_variants"][0]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/log",
            json={
                "workflow": {
                    "workflow_variant_id": workflow_variant["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 3
        # ----------------------------------------------------------------------

    def test_log_last_workflow_revisions_by_variant(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        workflow_variant = mock_data["workflow_variants"][0]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/log",
            json={
                "workflow": {
                    "workflow_variant_id": workflow_variant["id"],
                    "depth": 2,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 2
        # ----------------------------------------------------------------------

    def test_log_all_workflow_revisions(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        # Find the revision with the highest version (the latest explicit commit)
        revisions = mock_data["workflow_revisions"]
        workflow_revision = max(revisions, key=lambda r: r.get("version", 0))

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/log",
            json={
                "workflow": {
                    "workflow_revision_id": workflow_revision["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 3
        # ----------------------------------------------------------------------

    def test_log_last_workflow_revisions(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        revisions = mock_data["workflow_revisions"]
        workflow_revision = max(revisions, key=lambda r: r.get("version", 0))

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/log",
            json={
                "workflow": {
                    "workflow_revision_id": workflow_revision["id"],
                    "depth": 2,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 2
        # ----------------------------------------------------------------------

    def test_full_fork_workflow_variant(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        workflow_variant_id = mock_data["workflow_variants"][0]["id"]

        workflow_variant_slug = uuid4()
        workflow_revision_slug = uuid4()

        response = authed_api(
            "POST",
            "/preview/workflows/variants/fork",
            json={
                "workflow": {
                    "workflow_variant_id": workflow_variant_id,
                    # "depth": 1,
                    "workflow_variant": {
                        "slug": f"workflow-variant-{workflow_variant_slug}-fork",
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
                    },
                    "workflow_revision": {
                        "slug": f"workflow-revision-{workflow_revision_slug}-fork",
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
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 1

        workflow_variant = response_data["workflow_variant"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/log",
            json={
                "workflow": {
                    "workflow_variant_id": workflow_variant["id"],
                },
            },
        )

        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 4
        # ----------------------------------------------------------------------

    def test_shallow_fork_workflow_variant(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        workflow_variant_id = mock_data["workflow_variants"][0]["id"]

        workflow_variant_slug = uuid4()
        workflow_revision_slug = uuid4()

        response = authed_api(
            "POST",
            "/preview/workflows/variants/fork",
            json={
                "workflow": {
                    "workflow_variant_id": workflow_variant_id,
                    "depth": 1,
                    "workflow_variant": {
                        "slug": f"workflow-variant-{workflow_variant_slug}-fork",
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
                    },
                    "workflow_revision": {
                        "slug": f"workflow-revision-{workflow_revision_slug}-fork",
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
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 1

        workflow_variant = response_data["workflow_variant"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/log",
            json={
                "workflow": {
                    "workflow_variant_id": workflow_variant["id"],
                },
            },
        )

        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 2
        # ----------------------------------------------------------------------
