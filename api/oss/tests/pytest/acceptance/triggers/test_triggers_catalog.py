"""Acceptance tests for GET /triggers/catalog/* endpoints (events catalog).

The provider-catalog endpoints are reachable without any external API key: an
empty catalog is a valid response (no Composio adapter is registered when
``env.composio`` is unset). The event-browse / config-schema fetch make real
Composio calls, so those tests are gated on COMPOSIO_API_KEY being present in
the runner's environment (the same env the API reads).
"""

import os

import pytest


_COMPOSIO_ENABLED = bool(os.getenv("COMPOSIO_API_KEY"))
_requires_composio = pytest.mark.skipif(
    not _COMPOSIO_ENABLED,
    reason="needs live Composio credentials (COMPOSIO_API_KEY)",
)


class TestTriggersCatalogProviders:
    def test_list_providers_returns_200(self, authed_api):
        response = authed_api("GET", "/triggers/catalog/providers/")
        assert response.status_code == 200

    def test_list_providers_response_shape(self, authed_api):
        body = authed_api("GET", "/triggers/catalog/providers/").json()
        assert "count" in body
        assert "providers" in body
        assert isinstance(body["providers"], list)

    def test_list_providers_count_matches_list(self, authed_api):
        body = authed_api("GET", "/triggers/catalog/providers/").json()
        assert body["count"] == len(body["providers"])

    def test_list_providers_empty_when_composio_disabled(self, authed_api):
        """With no adapter registered (``env.composio`` unset on the API), the
        catalog is empty. Gate on what the *server* reports, not a local env
        var — the test runner's env need not match the API process's."""
        body = authed_api("GET", "/triggers/catalog/providers/").json()
        if body["count"] != 0:
            pytest.skip("Composio is enabled on the API — catalog is non-empty")
        assert body["providers"] == []


@_requires_composio
class TestTriggersCatalogEvents:
    def test_browse_events_returns_200(self, authed_api):
        response = authed_api(
            "GET",
            "/triggers/catalog/providers/composio/integrations/github/events/",
        )
        assert response.status_code == 200
        body = response.json()
        assert "events" in body
        assert isinstance(body["events"], list)

    def test_fetch_event_config_schema(self, authed_api):
        """A single event carries its trigger_config JSON Schema."""
        listing = authed_api(
            "GET",
            "/triggers/catalog/providers/composio/integrations/github/events/",
        ).json()
        if not listing["events"]:
            pytest.skip("no github events available from Composio")

        event_key = listing["events"][0]["key"]
        response = authed_api(
            "GET",
            f"/triggers/catalog/providers/composio/integrations/github/events/{event_key}",
        )
        assert response.status_code == 200
        event = response.json()["event"]
        assert event["key"] == event_key
        # trigger_config is the inbound analogue of an action's input_parameters
        assert "trigger_config" in event
