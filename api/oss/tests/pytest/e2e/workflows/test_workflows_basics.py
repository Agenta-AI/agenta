from uuid import uuid4


class TestWorkflowsBasics:
    def test_create_workflow(
        self,
        authed_api,
    ):
        # ACT ------------------------------------------------------------------
        workflow_slug = uuid4()

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
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
            "/preview/workflows/",
            json={
                "workflow": {
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
            f"/preview/workflows/{workflow_id}",
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
            "/preview/workflows/",
            json={
                "workflow": {
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
            f"/preview/workflows/{workflow_id}",
            json={
                "workflow": {
                    "id": workflow_id,
                    "name": "Another Workflow Name",
                    "description": "Another Workflow Description",
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

    def test_archive_workflow(
        self,
        authed_api,
    ):
        # ARRANGE --------------------------------------------------------------
        workflow_slug = uuid4()

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
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
            f"/preview/workflows/{workflow_id}/archive",
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
            "/preview/workflows/",
            json={
                "workflow": {
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
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        workflow_id = response["workflow"]["id"]

        # Archive the workflow first
        response = authed_api(
            "POST",
            f"/preview/workflows/{workflow_id}/archive",
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow"].get("deleted_at") is not None
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/workflows/{workflow_id}/unarchive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["workflow"].get("deleted_at") is None
        # ----------------------------------------------------------------------
