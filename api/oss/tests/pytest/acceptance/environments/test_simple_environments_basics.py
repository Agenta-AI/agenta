from uuid import uuid4


class TestSimpleEnvironmentsBasics:
    def test_create_environment(self, authed_api):
        # ACT ------------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/environments/",
            json={
                "environment": {
                    "slug": f"env-{slug}",
                    "name": f"Environment {slug}",
                    "description": "Test environment",
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["environment"]["slug"] == f"env-{slug}"
        assert body["environment"]["name"] == f"Environment {slug}"
        # ----------------------------------------------------------------------

    def test_fetch_environment(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/environments/",
            json={
                "environment": {
                    "slug": f"env-{slug}",
                    "name": f"Environment {slug}",
                }
            },
        )
        assert response.status_code == 200
        environment_id = response.json()["environment"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api("GET", f"/simple/environments/{environment_id}")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["environment"]["id"] == environment_id
        assert body["environment"]["slug"] == f"env-{slug}"
        # ----------------------------------------------------------------------

    def test_edit_environment(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/environments/",
            json={
                "environment": {
                    "slug": f"env-{slug}",
                    "name": f"Environment {slug}",
                }
            },
        )
        assert response.status_code == 200
        environment_id = response.json()["environment"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        new_slug = uuid4()

        response = authed_api(
            "PUT",
            f"/simple/environments/{environment_id}",
            json={
                "environment": {
                    "id": environment_id,
                    "slug": f"env-{new_slug}",
                    "name": f"Environment {new_slug}",
                    "description": "Updated description",
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["environment"]["slug"] == f"env-{new_slug}"
        assert body["environment"]["description"] == "Updated description"
        # ----------------------------------------------------------------------

    def test_archive_environment(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/environments/",
            json={
                "environment": {
                    "slug": f"env-{slug}",
                    "name": f"Environment {slug}",
                }
            },
        )
        assert response.status_code == 200
        environment_id = response.json()["environment"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api("POST", f"/simple/environments/{environment_id}/archive")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["environment"]["deleted_at"] is not None
        # ----------------------------------------------------------------------

    def test_unarchive_environment(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/environments/",
            json={
                "environment": {
                    "slug": f"env-{slug}",
                    "name": f"Environment {slug}",
                }
            },
        )
        assert response.status_code == 200
        environment_id = response.json()["environment"]["id"]

        authed_api("POST", f"/simple/environments/{environment_id}/archive")
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST", f"/simple/environments/{environment_id}/unarchive"
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["environment"].get("deleted_at") is None
        # ----------------------------------------------------------------------

    def test_guard_environment(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/environments/",
            json={
                "environment": {
                    "slug": f"env-{slug}",
                    "name": f"Environment {slug}",
                }
            },
        )
        assert response.status_code == 200
        environment_id = response.json()["environment"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api("POST", f"/simple/environments/{environment_id}/guard")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["environment"]["flags"]["is_guarded"] is True
        # ----------------------------------------------------------------------

    def test_unguard_environment(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        response = authed_api(
            "POST",
            "/simple/environments/",
            json={
                "environment": {
                    "slug": f"env-{slug}",
                    "name": f"Environment {slug}",
                }
            },
        )
        assert response.status_code == 200
        environment_id = response.json()["environment"]["id"]

        authed_api("POST", f"/simple/environments/{environment_id}/guard")
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST", f"/simple/environments/{environment_id}/unguard"
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["environment"]["flags"]["is_guarded"] is False
        # ----------------------------------------------------------------------

    def test_query_environments(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4()

        authed_api(
            "POST",
            "/simple/environments/",
            json={
                "environment": {
                    "slug": f"env-{slug}",
                    "name": f"Environment {slug}",
                }
            },
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api("POST", "/simple/environments/query", json={})
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert "count" in body
        assert "environments" in body
        assert isinstance(body["environments"], list)
        assert body["count"] == len(body["environments"])
        # ----------------------------------------------------------------------
