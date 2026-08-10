from uuid import uuid4


def _create_workflow(authed_api, *, flags):
    workflow_slug = uuid4()
    response = authed_api(
        "POST",
        "/workflows/",
        json={
            "workflow": {
                "slug": f"workflow-{workflow_slug}",
                "name": f"Workflow {workflow_slug}",
                "description": "Workflow Description",
                "flags": flags,
            }
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    return body["workflow"]


class TestWorkflowsBasics:
    def test_create_workflow(
        self,
        authed_api,
    ):
        # ACT ------------------------------------------------------------------
        workflow_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/",
            json={
                "workflow": {
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
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_fetch_workflow(
        self,
        authed_api,
    ):
        # ARRANGE --------------------------------------------------------------
        workflow_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/",
            json={
                "workflow": {
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
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_id = response["workflow"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/workflows/{workflow_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_edit_workflow(
        self,
        authed_api,
    ):
        # ARRANGE --------------------------------------------------------------
        workflow_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/",
            json={
                "workflow": {
                    "slug": f"workflow-{workflow_slug}",
                    "name": f"Workflow {workflow_slug}",
                    "description": "Workflow Description",
                    "flags": {
                        "is_application": True,
                        "is_evaluator": False,
                        "is_snippet": False,
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
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_id = response["workflow"]["id"]
        workflow_slug = response["workflow"]["slug"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "PUT",
            f"/workflows/{workflow_id}",
            json={
                "workflow": {
                    "id": workflow_id,
                    "name": "Another Workflow Name",
                    "description": "Another Workflow Description",
                    "flags": {
                        "is_application": False,
                        "is_evaluator": True,
                        "is_snippet": False,
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
        assert response["workflow"]["flags"] == {
            "is_application": False,
            "is_evaluator": True,
            "is_snippet": False,
        }
        # ----------------------------------------------------------------------

    def test_edit_workflow_preserves_omitted_flags(
        self,
        authed_api,
    ):
        workflow = _create_workflow(
            authed_api,
            flags={
                "is_application": True,
                "is_evaluator": False,
                "is_snippet": False,
            },
        )
        original_flags = workflow["flags"]
        workflow_id = workflow["id"]

        response = authed_api(
            "PUT",
            f"/workflows/{workflow_id}",
            json={
                "workflow": {
                    "id": workflow_id,
                    "name": "Renamed Workflow",
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["workflow"]["flags"] == original_flags

    def test_edit_workflow_rejects_id_mismatch(
        self,
        authed_api,
    ):
        workflow = _create_workflow(authed_api, flags={"is_application": True})
        workflow_id = workflow["id"]

        response = authed_api(
            "PUT",
            f"/workflows/{workflow_id}",
            json={
                "workflow": {
                    "id": str(uuid4()),
                    "name": "Renamed Workflow",
                }
            },
        )

        assert response.status_code == 400

    def test_edit_workflow_returns_not_found_for_missing_workflow(
        self,
        authed_api,
    ):
        workflow_id = str(uuid4())

        response = authed_api(
            "PUT",
            f"/workflows/{workflow_id}",
            json={
                "workflow": {
                    "id": workflow_id,
                    "name": "Renamed Workflow",
                }
            },
        )

        assert response.status_code == 404

    def test_edit_workflow_returns_not_found_for_archived_workflow(
        self,
        authed_api,
    ):
        workflow = _create_workflow(authed_api, flags={"is_application": True})
        workflow_id = workflow["id"]
        archive_response = authed_api(
            "POST",
            f"/workflows/{workflow_id}/archive",
        )
        assert archive_response.status_code == 200

        response = authed_api(
            "PUT",
            f"/workflows/{workflow_id}",
            json={
                "workflow": {
                    "id": workflow_id,
                    "name": "Renamed Workflow",
                }
            },
        )

        assert response.status_code == 404

    def test_archive_workflow(
        self,
        authed_api,
    ):
        # ARRANGE --------------------------------------------------------------
        workflow_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/",
            json={
                "workflow": {
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
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_id = response["workflow"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/workflows/{workflow_id}/archive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow"].get("deleted_at") is not None
        # ----------------------------------------------------------------------

    def test_unarchive_workflow(
        self,
        authed_api,
    ):
        # ARRANGE --------------------------------------------------------------
        workflow_slug = uuid4()

        response = authed_api(
            "POST",
            "/workflows/",
            json={
                "workflow": {
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
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_id = response["workflow"]["id"]

        # Archive the workflow first
        response = authed_api(
            "POST",
            f"/workflows/{workflow_id}/archive",
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow"].get("deleted_at") is not None
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/workflows/{workflow_id}/unarchive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow"].get("deleted_at") is None
        # ----------------------------------------------------------------------
