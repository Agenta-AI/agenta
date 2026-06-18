"""EE acceptance tests for the triggers events catalog.

Mirrors the OSS suite (oss/tests/pytest/acceptance/triggers/test_triggers_catalog.py)
but exercises /triggers/catalog/* as a business-plan, developer-role account.
Under EE the catalog is gated on the VIEW_TRIGGERS permission; a developer role
carries VIEW_TRIGGERS, so this verifies the endpoint behaves once the gate is
satisfied.

Provider-catalog reads need no Composio credentials (empty catalog is valid).
Event browse / config-schema fetch make real Composio calls and are gated on
COMPOSIO_API_KEY being present in the runner's environment.

Requires a running API.
"""

import os
from uuid import uuid4

import pytest
import requests

from utils.constants import BASE_TIMEOUT


_COMPOSIO_ENABLED = bool(os.getenv("COMPOSIO_API_KEY"))
_requires_composio = pytest.mark.skipif(
    not _COMPOSIO_ENABLED,
    reason="needs live Composio credentials (COMPOSIO_API_KEY)",
)


def _create_developer_business_account(admin_api):
    uid = uuid4().hex[:12]
    email = f"triggers-dev-{uid}@test.agenta.ai"
    resp = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={
            "accounts": {
                "u": {
                    "user": {"email": email},
                    "options": {
                        "create_api_keys": True,
                        "return_api_keys": True,
                        "seed_defaults": False,
                    },
                    "subscription": {"plan": "cloud_v0_business"},
                    "organization_memberships": [
                        {
                            "organization_ref": {"ref": "org"},
                            "user_ref": {"ref": "user"},
                            "role": "developer",
                        }
                    ],
                    "workspace_memberships": [
                        {
                            "workspace_ref": {"ref": "wrk"},
                            "user_ref": {"ref": "user"},
                            "role": "developer",
                        }
                    ],
                    "project_memberships": [
                        {
                            "project_ref": {"ref": "prj"},
                            "user_ref": {"ref": "user"},
                            "role": "developer",
                        }
                    ],
                }
            }
        },
    )
    assert resp.status_code == 200, resp.text
    account = resp.json()["accounts"]["u"]
    return {
        "email": email,
        "credentials": f"ApiKey {account['api_keys']['key']}",
    }


def _delete_account_by_email(admin_api, *, email):
    resp = admin_api(
        "DELETE",
        "/admin/simple/accounts/",
        json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
    )
    assert resp.status_code == 204, resp.text


@pytest.fixture(scope="class")
def triggers_api(admin_api, ag_env):
    account = _create_developer_business_account(admin_api)

    def _request(method: str, endpoint: str, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", account["credentials"])
        return requests.request(
            method=method,
            url=f"{ag_env['api_url']}{endpoint}",
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    yield _request

    _delete_account_by_email(admin_api, email=account["email"])


class TestTriggersCatalogProviders:
    def test_list_providers_returns_200(self, triggers_api):
        response = triggers_api("GET", "/triggers/catalog/providers/")
        assert response.status_code == 200

    def test_list_providers_response_shape(self, triggers_api):
        body = triggers_api("GET", "/triggers/catalog/providers/").json()
        assert "count" in body
        assert "providers" in body
        assert isinstance(body["providers"], list)
        assert body["count"] == len(body["providers"])

    @pytest.mark.skipif(
        _COMPOSIO_ENABLED,
        reason="catalog is non-empty when Composio is enabled",
    )
    def test_list_providers_empty_when_composio_disabled(self, triggers_api):
        body = triggers_api("GET", "/triggers/catalog/providers/").json()
        assert body["count"] == 0
        assert body["providers"] == []


@_requires_composio
class TestTriggersCatalogEvents:
    def test_browse_events_returns_200(self, triggers_api):
        response = triggers_api(
            "GET",
            "/triggers/catalog/providers/composio/integrations/github/events/",
        )
        assert response.status_code == 200
        body = response.json()
        assert "events" in body
        assert isinstance(body["events"], list)

    def test_fetch_event_config_schema(self, triggers_api):
        listing = triggers_api(
            "GET",
            "/triggers/catalog/providers/composio/integrations/github/events/",
        ).json()
        if not listing["events"]:
            pytest.skip("no github events available from Composio")

        event_key = listing["events"][0]["key"]
        response = triggers_api(
            "GET",
            f"/triggers/catalog/providers/composio/integrations/github/events/{event_key}",
        )
        assert response.status_code == 200
        event = response.json()["event"]
        assert event["key"] == event_key
        assert "trigger_config" in event
