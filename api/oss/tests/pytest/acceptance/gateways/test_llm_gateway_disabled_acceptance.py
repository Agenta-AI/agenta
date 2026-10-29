"""The legacy vault-key model path, end to end, against a deployment with the LLM plane off.

This is the release's central claim: `AGENTA_LLM_GATEWAY_ENABLED=false` leaves a project's
model runs working exactly as they did before the gateway existed. The claim spans two
codebases — the API refuses, the agent SDK reads the refusal and resolves from the vault
instead — and neither half proves it alone, so this drives the real SDK resolver against a
real deployment over a real socket.

RUN AND PASSING. Four of four against the integrated EE dev stack on 2026-09-15, while that
deployment still had `AGENTA_LLM_GATEWAY_ENABLED` unset and therefore the plane off by
default. The same run of the whole gateway acceptance directory reported 23 passed and 20
skipped, the skips being exactly the LLM-plane suites and the LLM rows of the mock matrix,
with every MCP suite still passing. That pair is the release's central claim demonstrated
rather than argued: model runs keep working with the plane off, and the MCP gateway serves
regardless.

To run it again, point it at a deployment with the plane off:

    cd api && AGENTA_API_URL=<api> AGENTA_AUTH_KEY=<key> \
        pytest oss/tests/pytest/acceptance/gateways -m acceptance -k llm_gateway_disabled

It skips itself on a deployment that has the plane on, so it is safe in any suite run.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator
from uuid import uuid4

import pytest

from agenta.sdk.agents.connections import (
    ModelRef,
    RuntimeAuthContext,
    WriteOnlySecretError,
)
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


def _create_provider_key(authed_api, *, write_only: bool) -> Dict[str, Any]:
    slug = f"legacy-openai-{uuid4().hex[:8]}"
    created = _assert_ok(
        authed_api(
            "POST",
            "/secrets/",
            json={
                "header": {"name": slug},
                "write_only": write_only,
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
    return {"id": created["id"], "slug": created.get("slug") or slug}


@pytest.fixture
def readable_provider_key(authed_api) -> Iterator[Dict[str, Any]]:
    """A provider key this caller may read back, so the resolved value can be asserted.

    `write_only` is selected at creation and defaults to `True`, in which case the vault
    hands back a preview and never the value. That default is not a gateway behaviour and
    predates this branch; see the write-only test below, which covers it.
    """
    created = _create_provider_key(authed_api, write_only=False)
    try:
        yield created
    finally:
        authed_api("DELETE", f"/secrets/{created['id']}")


@pytest.fixture
def write_only_provider_key(authed_api) -> Iterator[Dict[str, Any]]:
    created = _create_provider_key(authed_api, write_only=True)
    try:
        yield created
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
    cls_account, readable_provider_key
):
    resolved = await _resolver(cls_account).resolve(
        model=ModelRef(
            provider="openai",
            model="gpt-4o",
            connection={"mode": "agenta", "slug": readable_provider_key["slug"]},
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


async def test_a_write_only_key_refuses_on_the_vault_path_rather_than_the_gateway_one(
    cls_account, write_only_provider_key, monkeypatch
):
    """The default case, and the one that proves which path ran.

    A write-only secret is never handed to this caller in plaintext — the vault reveals it
    only to a credential carrying the run's resolve grant, which the API mints per invocation
    and no external caller can present. That rule predates the gateway and is unchanged here.

    What matters for this release is WHICH refusal arrives. `WriteOnlySecretError` naming this
    secret's slug can only be reached by reading `GET /secrets/`, building the catalog and
    selecting this connection, so it is positive evidence that the gateway refusal sent the
    resolver down the vault path rather than failing the run.
    """
    # The SDK prefers a key in the run's own environment over failing; clear it so the
    # write-only refusal is what surfaces.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(WriteOnlySecretError) as raised:
        await _resolver(cls_account).resolve(
            model=ModelRef(
                provider="openai",
                model="gpt-4o",
                connection={"mode": "agenta", "slug": write_only_provider_key["slug"]},
            ),
            context=RuntimeAuthContext(harness="pi_core", backend="local"),
        )

    assert raised.value.slug == write_only_provider_key["slug"]


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
