from uuid import uuid4


class TestSimpleApplicationsBasics:
    def test_create_application(self, authed_api):
        # ACT ------------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/applications/",
            json={
                "application": {
                    "slug": f"app-{slug}",
                    "name": f"Application {slug}",
                    "description": "Test application",
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["application"]["slug"] == f"app-{slug}"
        assert body["application"]["name"] == f"Application {slug}"
        # ----------------------------------------------------------------------

    def test_fetch_application(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/applications/",
            json={
                "application": {
                    "slug": f"app-{slug}",
                    "name": f"Application {slug}",
                }
            },
        )
        assert response.status_code == 200
        application_id = response.json()["application"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api("GET", f"/simple/applications/{application_id}")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["application"]["id"] == application_id
        assert body["application"]["slug"] == f"app-{slug}"
        # ----------------------------------------------------------------------

    def test_edit_application(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/applications/",
            json={
                "application": {
                    "slug": f"app-{slug}",
                    "name": f"Application {slug}",
                }
            },
        )
        assert response.status_code == 200
        application_id = response.json()["application"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "PUT",
            f"/simple/applications/{application_id}",
            json={
                "application": {
                    "id": application_id,
                    "name": f"Application {slug}",
                    "description": "Updated description",
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["application"]["description"] == "Updated description"
        # ----------------------------------------------------------------------

    def test_archive_application(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/applications/",
            json={
                "application": {
                    "slug": f"app-{slug}",
                    "name": f"Application {slug}",
                }
            },
        )
        assert response.status_code == 200
        application_id = response.json()["application"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api("POST", f"/simple/applications/{application_id}/archive")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["application"]["deleted_at"] is not None
        # ----------------------------------------------------------------------

    def test_unarchive_application(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/applications/",
            json={
                "application": {
                    "slug": f"app-{slug}",
                    "name": f"Application {slug}",
                }
            },
        )
        assert response.status_code == 200
        application_id = response.json()["application"]["id"]

        authed_api("POST", f"/simple/applications/{application_id}/archive")
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST", f"/simple/applications/{application_id}/unarchive"
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["application"].get("deleted_at") is None
        # ----------------------------------------------------------------------

    def test_query_applications(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        authed_api(
            "POST",
            "/simple/applications/",
            json={
                "application": {
                    "slug": f"app-{slug}",
                    "name": f"Application {slug}",
                }
            },
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api("POST", "/simple/applications/query", json={})
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert "count" in body
        assert "applications" in body
        assert isinstance(body["applications"], list)
        assert body["count"] == len(body["applications"])
        # ----------------------------------------------------------------------
