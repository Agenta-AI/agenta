from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE --------------------------------------------------------------
    workflow_0_slug = uuid4()

    workflow_0 = {
        "slug": f"workflow-{workflow_0_slug}",
    }

    response = authed_api(
        "POST",
        "/preview/workflows/",
        json={"workflow": workflow_0},
    )

    assert response.status_code == 200

    workflow_0 = response.json()["workflow"]

    workflow_1_slug = uuid4()

    workflow_1 = {
        "slug": f"workflow-{workflow_1_slug}",
    }

    response = authed_api(
        "POST",
        "/preview/workflows/",
        json={"workflow": workflow_1},
    )

    assert response.status_code == 200

    workflow_1 = response.json()["workflow"]

    workflow_0_variant_0_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"workflow-variant-{workflow_0_variant_0_slug}",
                "workflow_id": workflow_0["id"],
            }
        },
    )

    assert response.status_code == 200

    workflow_0_variant_0 = response.json()["workflow_variant"]

    workflow_0_variant_0_revision_0_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_0_variant_0_revision_0_slug}",
                "workflow_variant_id": workflow_0_variant_0["id"],
                "workflow_id": workflow_0["id"],
            }
        },
    )

    assert response.status_code == 200

    workflow_0_variant_0_revision_0 = response.json()["workflow_revision"]

    workflow_1_variant_0_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"workflow-variant-{workflow_1_variant_0_slug}",
                "workflow_id": workflow_1["id"],
            }
        },
    )

    assert response.status_code == 200

    workflow_1_variant_0 = response.json()["workflow_variant"]

    workflow_1_variant_0_revision_0_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_1_variant_0_revision_0_slug}",
                "workflow_variant_id": workflow_1_variant_0["id"],
                "workflow_id": workflow_1["id"],
            }
        },
    )

    workflow_1_variant_0_revision_0 = response.json()["workflow_revision"]

    workflow_1_variant_1_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"workflow-variant-{workflow_1_variant_1_slug}",
                "workflow_id": workflow_1["id"],
            },
        },
    )

    workflow_1_variant_1 = response.json()["workflow_variant"]

    workflow_1_variant_1_revision_0_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_1_variant_1_revision_0_slug}",
                "workflow_variant_id": workflow_1_variant_1["id"],
                "workflow_id": workflow_1["id"],
            }
        },
    )

    assert response.status_code == 200

    workflow_1_variant_1_revision_0 = response.json()["workflow_revision"]

    workflow_1_variant_1_revision_1_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{workflow_1_variant_1_revision_1_slug}",
                "workflow_variant_id": workflow_1_variant_1["id"],
                "workflow_id": workflow_1["id"],
            }
        },
    )

    assert response.status_code == 200

    workflow_1_variant_1_revision_1 = response.json()["workflow_revision"]
    # --------------------------------------------------------------------------

    workflow_1_variant_0["revisions"] = [
        workflow_1_variant_0_revision_0,
    ]

    workflow_1_variant_1["revisions"] = [
        workflow_1_variant_1_revision_0,
        workflow_1_variant_1_revision_1,
    ]

    workflow_1["variants"] = [
        workflow_1_variant_0,
        workflow_1_variant_1,
    ]

    workflow_0_variant_0["revisions"] = [
        workflow_0_variant_0_revision_0,
    ]

    workflow_0["variants"] = [
        workflow_0_variant_0,
    ]

    workflows = [
        workflow_0,
        workflow_1,
    ]

    _mock_data = {
        "workflows": workflows,
    }

    return _mock_data


class TestWorkflowVariantsQueries:
    def test_retrieve_by_revision_id(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        revision_id = mock_data["workflows"][1]["variants"][1]["revisions"][1]["id"]

        response = authed_api(
            "GET",
            "/preview/workflows/revisions/retrieve",
            json={
                "workflow_revision_ref": {"id": revision_id},
            },
        )

        assert response.status_code == 200

        response = response.json()
        assert response["count"] == 1
        assert "workflow_revision" in response
        revision = response["workflow_revision"]
        assert revision["id"] == revision_id
        # ----------------------------------------------------------------------

    def test_retrieve_by_revision_slug(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        revision_id = mock_data["workflows"][1]["variants"][1]["revisions"][1]["id"]
        revision_slug = mock_data["workflows"][1]["variants"][1]["revisions"][1]["slug"]

        response = authed_api(
            "GET",
            "/preview/workflows/revisions/retrieve",
            json={
                "workflow_revision_ref": {"slug": revision_slug},
            },
        )

        assert response.status_code == 200

        response = response.json()
        assert response["count"] == 1
        assert "workflow_revision" in response
        revision = response["workflow_revision"]
        assert revision["id"] == revision_id
        # ----------------------------------------------------------------------

    def test_retrieve_by_variant_id_revision_version(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        variant_id = mock_data["workflows"][1]["variants"][1]["id"]
        revision_id = mock_data["workflows"][1]["variants"][1]["revisions"][1]["id"]
        revision_version = mock_data["workflows"][1]["variants"][1]["revisions"][1][
            "version"
        ]

        response = authed_api(
            "GET",
            "/preview/workflows/revisions/retrieve",
            json={
                "workflow_variant_ref": {"id": variant_id},
                "workflow_revision_ref": {"version": revision_version},
            },
        )

        assert response.status_code == 200

        response = response.json()
        assert response["count"] == 1
        assert "workflow_revision" in response
        revision = response["workflow_revision"]
        assert revision["id"] == revision_id
        # ----------------------------------------------------------------------

    def test_retrieve_by_variant_slug_revision_version(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        variant_slug = mock_data["workflows"][1]["variants"][1]["slug"]
        revision_id = mock_data["workflows"][1]["variants"][1]["revisions"][1]["id"]
        revision_version = mock_data["workflows"][1]["variants"][1]["revisions"][1][
            "version"
        ]

        response = authed_api(
            "GET",
            "/preview/workflows/revisions/retrieve",
            json={
                "workflow_variant_ref": {"slug": variant_slug},
                "workflow_revision_ref": {"version": revision_version},
            },
        )

        assert response.status_code == 200

        response = response.json()
        assert response["count"] == 1
        assert "workflow_revision" in response
        revision = response["workflow_revision"]
        assert revision["id"] == revision_id
        # ----------------------------------------------------------------------

    def test_retrieve_by_variant_id(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        variant_id = mock_data["workflows"][1]["variants"][1]["id"]
        revision_id = mock_data["workflows"][1]["variants"][1]["revisions"][1]["id"]

        response = authed_api(
            "GET",
            "/preview/workflows/revisions/retrieve",
            json={
                "workflow_variant_ref": {"id": variant_id},
            },
        )

        assert response.status_code == 200

        response = response.json()
        assert response["count"] == 1
        assert "workflow_revision" in response
        revision = response["workflow_revision"]
        assert revision["id"] == revision_id
        # ----------------------------------------------------------------------

    def test_retrieve_by_variant_slug(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        variant_slug = mock_data["workflows"][1]["variants"][1]["slug"]
        revision_id = mock_data["workflows"][1]["variants"][1]["revisions"][1]["id"]

        response = authed_api(
            "GET",
            "/preview/workflows/revisions/retrieve",
            json={
                "workflow_variant_ref": {"slug": variant_slug},
            },
        )

        assert response.status_code == 200

        response = response.json()
        assert response["count"] == 1
        assert "workflow_revision" in response
        revision = response["workflow_revision"]
        assert revision["id"] == revision_id
        # ----------------------------------------------------------------------
