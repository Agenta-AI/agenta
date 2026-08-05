"""Acceptance tests for GET /tools/catalog/* endpoints.

These tests verify the router is reachable and responds correctly without
requiring any external API key or provider credentials. An empty catalog
is a valid response.
"""


class TestToolsCatalogProviders:
    def test_list_providers_returns_200(self, authed_api):
        response = authed_api("GET", "/tools/catalog/providers/")
        assert response.status_code == 200

    def test_list_providers_response_shape(self, authed_api):
        body = authed_api("GET", "/tools/catalog/providers/").json()
        assert "count" in body
        assert "providers" in body
        assert isinstance(body["providers"], list)

    def test_list_providers_count_matches_list(self, authed_api):
        body = authed_api("GET", "/tools/catalog/providers/").json()
        assert body["count"] == len(body["providers"])
