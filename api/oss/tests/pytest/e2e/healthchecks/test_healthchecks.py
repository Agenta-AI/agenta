class TestHealthCheck:
    def test_unauthenticated(self, unauthed_api):
        # ACT ------------------------------------------------------------------
        response = unauthed_api("GET", "/health")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["status"] == "ok"
        # ----------------------------------------------------------------------

    def test_authenticated(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api("GET", "/profile")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["email"].endswith("@test.agenta.ai")
        # ----------------------------------------------------------------------
