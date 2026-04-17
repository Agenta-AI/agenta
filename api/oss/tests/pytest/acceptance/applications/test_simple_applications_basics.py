from uuid import uuid4


def _create_simple_application(authed_api, *, slug: str, marker: str):
    response = authed_api(
        "POST",
        "/simple/applications/",
        json={
            "application": {
                "slug": slug,
                "name": slug,
                "tags": {"marker": marker},
            }
        },
    )
    assert response.status_code == 200
    return response.json()["application"]


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

    def test_query_applications_filters_by_application_refs(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        marker = uuid4().hex
        first = _create_simple_application(
            authed_api,
            slug=f"app-{uuid4().hex[:8]}",
            marker=marker,
        )
        second = _create_simple_application(
            authed_api,
            slug=f"app-{uuid4().hex[:8]}",
            marker=marker,
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/applications/query",
            json={
                "application_refs": [{"slug": first["slug"]}],
                "application": {"tags": {"marker": marker}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1

        application_ids = {application["id"] for application in body["applications"]}
        assert first["id"] in application_ids
        assert second["id"] not in application_ids
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/applications/query",
            json={
                "application_refs": [{"id": first["id"]}],
                "application": {"tags": {"marker": marker}},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["applications"][0]["id"] == first["id"]
        # ----------------------------------------------------------------------
