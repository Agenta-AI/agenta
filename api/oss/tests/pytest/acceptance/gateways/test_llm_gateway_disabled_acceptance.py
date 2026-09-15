"""The legacy vault-key model path, end to end, against a deployment with the LLM plane off.

This is the release's central claim: `AGENTA_LLM_GATEWAY_ENABLED=false` leaves a project's
model runs working exactly as they did before the gateway existed. The claim spans two
codebases — the API refuses, the agent SDK reads the refusal and resolves from the vault
instead — and neither half proves it alone, so this drives the real SDK resolver against a
real deployment over a real socket.

WRITTEN, NOT RUN by the branch that added it: the stack it must run against is the one the
release is integrated on, and that stack has the LLM plane on. Run it after integration, on a
deployment with the plane off:

    load-env hosting/docker-compose/ee/.env.ee.dev      # AGENTA_LLM_GATEWAY_ENABLED unset
    bash hosting/docker-compose/run.sh --ee --dev --build
    cd api && pytest oss/tests/pytest/acceptance/gateways -m acceptance -k llm_gateway_disabled

It skips itself on a deployment that has the plane on, so it is safe in any suite run.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator
from uuid import uuid4

import pytest

from agenta.sdk.agents.connections import ModelRef, RuntimeAuthContext
from agenta.sdk.agents.platform import PlatformConnection, VaultConnectionResolver

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.usefixtures("requires_llm_gateway_off"),
]

# Never a real provider key. Nothing here dials a provider: the assertion is about which
# value the resolver selects and how it travels, not about a completion coming back.
FAKE_PROVIDER_KEY = "sk-acceptance-not-a-real-key"


def _assert_ok(response):
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def vault_provider_key(authed_api) -> Iterator[Dict[str, Any]]:
    """One ordinary OpenAI provider key in the project's vault, cleaned up afterwards."""
    slug = f"legacy-openai-{uuid4().hex[:8]}"
    created = _assert_ok(
        authed_api(
            "POST",
            "/secrets/",
            json={
                "header": {"name": slug},
                "secret": {
                    "kind": "provider_key",
                    "data": {
                        "kind": "openai",
                        "provider": {"key": FAKE_PROVIDER_KEY},
                    },
                },
            },
        )
    )
    try:
        yield {"id": created["id"], "slug": created.get("slug") or slug}
    finally:
        authed_api("DELETE", f"/secrets/{created['id']}")


def _resolver(cls_account) -> VaultConnectionResolver:
    return VaultConnectionResolver(
        PlatformConnection(
            base_url=cls_account["api_url"],
            authorization=cls_account["credentials"],
        )
    )


async def test_a_model_resolves_from_the_vault_key_when_the_plane_is_off(
    cls_account, vault_provider_key
):
    resolved = await _resolver(cls_account).resolve(
        model=ModelRef(
            provider="openai",
            model="gpt-4o",
            connection={"mode": "agenta", "slug": vault_provider_key["slug"]},
        ),
        context=RuntimeAuthContext(harness="pi_core", backend="local"),
    )

    # The pre-gateway contract, in full: the provider key itself is what the sandbox is given,
    # it is injected as the provider's own environment variable, and no gateway route or
    # gateway credential is built for the run.
    assert resolved.provider == "openai"
    assert resolved.credential_mode == "env"
    assert resolved.gateway_credentials is None
    injected = {item.binding.name: item.value for item in resolved.credentials}
    assert injected == {"OPENAI_API_KEY": FAKE_PROVIDER_KEY}


async def test_the_resolve_route_refuses_with_the_code_the_sdk_acts_on(cls_account):
    """The seam itself, asserted directly rather than only through its consequence.

    If this code ever changed, the test above would keep passing for the wrong reason: the
    SDK also falls back on an unrouted 404, so a route that vanished would look identical.
    """
    import requests

    response = requests.post(
        f"{cls_account['api_url']}/gateways/llms/resolve",
        headers={"Authorization": cls_account["credentials"]},
        json={"model": "gpt-4o", "provider_key": "openai"},
        timeout=60,
    )

    assert response.status_code == 403, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "llm_gateway_disabled"
    assert detail["details"] == {"flag": "AGENTA_LLM_GATEWAY_ENABLED"}


def test_the_mcp_plane_still_serves_while_the_llm_plane_is_off(authed_api):
    """The other half of the release shape: MCP ships, the new LLM routing does not."""
    response = authed_api("GET", "/gateways/mcps/endpoints/")

    assert response.status_code == 200, response.text
