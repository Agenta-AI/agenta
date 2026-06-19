from uuid import uuid4

import pytest


def _log_count(authed_api, *, workflow_revision_id):
    response = authed_api(
        "POST",
        "/workflows/revisions/log",
        json={
            "workflow_revisions": {
                "workflow_revision_id": workflow_revision_id,
            },
        },
    )
    assert response.status_code == 200
    return response.json()["count"]


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
            "is_feedback": False,
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
        "/workflows/",
        json={"workflow": workflow},
    )

    assert response.status_code == 200

    workflow_data = response.json()

    workflow_id = response.json()["workflow"]["id"]

    workflow_variant_slug = uuid4()

    response = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"workflow-variant-{workflow_variant_slug}",
                "name": f"Workflow Variant {workflow_variant_slug}",
                "description": "Workflow Variant Description",
                "flags": {
                    "is_custom": False,
                    "is_evaluator": False,
                    "is_feedback": False,
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
        "/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_revision_slug}-first",
                "name": f"Workflow Revision {workflow_revision_slug}",
                "description": "Workflow Revision Description",
                "flags": {
                    "is_custom": False,
                    "is_evaluator": False,
                    "is_feedback": False,
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

    # Subsequent revisions on the same variant go through commit — the plain
    # create endpoint only seeds the variant's initial revision.
    response = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_revision_slug}-second",
                "name": f"Workflow Revision {workflow_revision_slug}",
                "description": "Workflow Revision Description",
                "flags": {
                    "is_custom": False,
                    "is_evaluator": False,
                    "is_feedback": False,
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
                "data": {"parameters": {"v": 2}},
                "workflow_id": workflow_id,
                "workflow_variant_id": workflow_variant_id,
            }
        },
    )

    assert response.status_code == 200

    workflow_revision_slug = uuid4()

    response = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_revision_slug}-third",
                "name": f"Workflow Revision {workflow_revision_slug}",
                "description": "Workflow Revision Description",
                "flags": {
                    "is_custom": False,
                    "is_evaluator": False,
                    "is_feedback": False,
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
                "data": {"parameters": {"v": 3}},
                "workflow_id": workflow_id,
                "workflow_variant_id": workflow_variant_id,
            }
        },
    )

    assert response.status_code == 200

    response = authed_api(
        "POST",
        "/workflows/revisions/query",
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
            "/workflows/revisions/log",
            json={
                "workflow_revisions": {
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
            "/workflows/revisions/log",
            json={
                "workflow_revisions": {
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
            "/workflows/revisions/log",
            json={
                "workflow_revisions": {
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
            "/workflows/revisions/log",
            json={
                "workflow_revisions": {
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
        # Pinning to the latest revision should fork the full lineage.
        # ACT ------------------------------------------------------------------
        workflow_variant_id = mock_data["workflow_variants"][0]["id"]

        workflow_variant_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/variants/fork",
            json={
                "workflow_variant_ref": {
                    "id": workflow_variant_id,
                },
                "workflow_variant": {
                    "slug": f"workflow-variant-{workflow_variant_slug}-fork",
                    "name": f"Workflow Variant {workflow_variant_slug}",
                    "description": "Workflow Variant Description",
                    "flags": {
                        "is_custom": False,
                        "is_evaluator": False,
                        "is_feedback": False,
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
                "workflow_revision_ref": {
                    "id": mock_data["workflow_revisions"][-1]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 1

        workflow_variant = response_data["workflow_variant"]

        # The fork's lineage must match the source lineage up to the pinned tip.
        expected = _log_count(
            authed_api,
            workflow_revision_id=mock_data["workflow_revisions"][-1]["id"],
        )

        response = authed_api(
            "POST",
            "/workflows/revisions/log",
            json={
                "workflow_revisions": {
                    "workflow_variant_id": workflow_variant["id"],
                },
            },
        )

        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == expected
        # ----------------------------------------------------------------------

    def test_shallow_fork_workflow_variant(self, authed_api, mock_data):
        # Pinning to an earlier revision should fork only the lineage up to that revision.
        # ACT ------------------------------------------------------------------
        workflow_variant_id = mock_data["workflow_variants"][0]["id"]

        workflow_variant_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/variants/fork",
            json={
                "workflow_variant_ref": {
                    "id": workflow_variant_id,
                },
                "workflow_variant": {
                    "slug": f"workflow-variant-{workflow_variant_slug}-fork",
                    "name": f"Workflow Variant {workflow_variant_slug}",
                    "description": "Workflow Variant Description",
                    "flags": {
                        "is_custom": False,
                        "is_evaluator": False,
                        "is_feedback": False,
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
                "workflow_revision_ref": {
                    "id": mock_data["workflow_revisions"][1]["id"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == 1

        workflow_variant = response_data["workflow_variant"]

        # Pinning an earlier revision forks only the lineage up to that revision.
        expected = _log_count(
            authed_api,
            workflow_revision_id=mock_data["workflow_revisions"][1]["id"],
        )

        response = authed_api(
            "POST",
            "/workflows/revisions/log",
            json={
                "workflow_revisions": {
                    "workflow_variant_id": workflow_variant["id"],
                },
            },
        )

        assert response.status_code == 200
        response_data = response.json()
        assert response_data["count"] == expected
        # ----------------------------------------------------------------------

    def test_fork_workflow_variant_without_revision(self, authed_api, mock_data):
        # Forking a variant without supplying a new tip revision should succeed
        # and copy the source revisions without appending a new commit.
        # ACT ------------------------------------------------------------------
        workflow_variant_id = mock_data["workflow_variants"][0]["id"]

        workflow_variant_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/variants/fork",
            json={
                "workflow_variant_ref": {
                    "id": workflow_variant_id,
                },
                "workflow_variant": {
                    "slug": f"workflow-variant-{workflow_variant_slug}-norev-fork",
                    "name": f"Workflow Variant {workflow_variant_slug}",
                },
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
            "/workflows/revisions/log",
            json={
                "workflow_revisions": {
                    "workflow_variant_id": workflow_variant["id"],
                },
            },
        )

        assert response.status_code == 200
        response_data = response.json()
        # 3 copied from source, no extra tip commit appended
        assert response_data["count"] == 3
        # ----------------------------------------------------------------------

    def test_fork_workflow_variant_missing_variant_payload(self, authed_api, mock_data):
        # The request model requires 'workflow_variant', so FastAPI rejects the
        # payload before the route handler runs.
        # ACT ------------------------------------------------------------------
        workflow_variant_id = mock_data["workflow_variants"][0]["id"]

        response = authed_api(
            "POST",
            "/workflows/variants/fork",
            json={"workflow_variant_ref": {"id": workflow_variant_id}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 422
        # ----------------------------------------------------------------------

    def test_fork_workflow_variant_missing_source_ref(self, authed_api, mock_data):
        # The request model requires 'workflow_variant_ref', so FastAPI rejects
        # the payload before the route handler runs.
        # ACT ------------------------------------------------------------------
        workflow_variant_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/variants/fork",
            json={
                "workflow_variant": {
                    "slug": f"workflow-variant-{workflow_variant_slug}-nosrc-fork",
                    "name": f"Workflow Variant {workflow_variant_slug}",
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 422
        # ----------------------------------------------------------------------

    def test_fork_workflow_variant_unknown_source(self, authed_api, mock_data):
        # Unknown source variants should fail as a fork-domain error.
        # ACT ------------------------------------------------------------------
        bogus_variant_id = str(uuid4())

        workflow_variant_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/variants/fork",
            json={
                "workflow_variant_ref": {
                    "id": bogus_variant_id,
                },
                "workflow_variant": {
                    "slug": f"workflow-variant-{workflow_variant_slug}-bogus-fork",
                    "name": f"Workflow Variant {workflow_variant_slug}",
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 400
        assert "variant" in response.json()["detail"].lower()
        # ----------------------------------------------------------------------
