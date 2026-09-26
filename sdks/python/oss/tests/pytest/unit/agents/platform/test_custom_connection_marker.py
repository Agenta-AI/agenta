"""The resolver states whether a route serves the user's own custom-provider record.

The runner marks model spans served through a custom connection so the platform does not price
them from the public price list. It cannot infer this from the route alone: a custom-provider
record that uses its family's registered base URL (with its own key) looks the same as a
provider key there. So the resolver, which knows the record kind, sends ``customConnection``.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents.connections import ModelRef, RuntimeAuthContext
from agenta.sdk.agents.connections.models import ResolvedConnection
from agenta.sdk.agents.platform import VaultConnectionResolver
from agenta.sdk.agents.platform import connections

_GATEWAY_BASE = "https://api.x/api"
_GATEWAY_CREDENTIALS = "Secret gateway-token"


def _model(slug: str, provider: str = "openai", model: str = "gpt-5.5") -> ModelRef:
    return ModelRef(
        provider=provider, model=model, connection={"mode": "agenta", "slug": slug}
    )


def _provider_key(slug: str = "openai") -> dict:
    return {
        "kind": "provider_key",
        "slug": slug,
        "header": {"name": "OpenAI"},
        "data": {"kind": "openai", "provider": {"key": "sk-provider"}},
    }


def _custom_provider(
    slug: str,
    kind: str = "openai",
    *,
    url: str | None = None,
    key: str | None = "sk-own",
    extras: dict | None = None,
    models: list[str] | None = None,
) -> dict:
    models = models or ["gpt-5.5"]
    return {
        "kind": "custom_provider",
        "slug": slug,
        "header": {"name": slug},
        "data": {
            "kind": kind,
            "provider_slug": slug,
            "provider": {"url": url, "key": key, "extras": extras or {}},
            "models": [{"slug": m} for m in models],
            "model_keys": [f"{slug}/{kind}/{m}" for m in models],
        },
    }


# Without the gateway (vault fallback)


def test_a_custom_record_at_the_registered_url_is_marked_custom():
    # The case the runner cannot tell apart by URL: same base URL as a provider key.
    resolved = connections._resolve_from_secrets(
        secrets=[_custom_provider("my-openai", url="https://api.openai.com/v1")],
        model=_model("my-openai"),
        harness="pi_core",
    )
    assert resolved.credential_mode == "env"
    assert resolved.gateway_credentials is None
    assert resolved.custom_connection is True
    assert resolved.to_wire()["customConnection"] is True


def test_a_provider_key_is_marked_not_custom():
    resolved = connections._resolve_from_secrets(
        secrets=[_provider_key()], model=_model("openai"), harness="pi_core"
    )
    assert resolved.gateway_credentials is None
    assert resolved.custom_connection is False
    assert resolved.to_wire()["customConnection"] is False


def test_the_agenta_managed_starter_credits_record_is_marked_not_custom():
    # A custom-provider record Agenta manages serves a public model at a public price.
    managed = _custom_provider(
        connections.STARTER_CREDITS_SLUG, url="https://credits.agenta.ai/v1"
    )
    managed["management"] = {"policy": "read_only"}
    for gateway in (
        {},
        {
            "gateway_base_url": _GATEWAY_BASE,
            "gateway_credentials_value": _GATEWAY_CREDENTIALS,
        },
    ):
        resolved = connections._resolve_from_secrets(
            secrets=[managed],
            model=_model(connections.STARTER_CREDITS_SLUG),
            harness="pi_core",
            **gateway,
        )
        assert resolved.custom_connection is False


def test_a_user_record_saved_under_the_starter_credits_slug_is_marked_custom():
    resolved = connections._resolve_from_secrets(
        secrets=[
            _custom_provider(
                connections.STARTER_CREDITS_SLUG, url="https://llm.example.com/v1"
            )
        ],
        model=_model(connections.STARTER_CREDITS_SLUG),
        harness="pi_core",
    )
    assert resolved.custom_connection is True


# Through the gateway, from the secrets list


def test_a_bedrock_custom_record_through_the_gateway_is_marked_custom():
    resolved = connections._resolve_from_secrets(
        secrets=[
            _custom_provider(
                "my-bedrock",
                "bedrock",
                key=None,
                extras={
                    "aws_region_name": "eu-west-1",
                    "aws_bearer_token_bedrock": "bearer-token",
                },
                models=["anthropic.claude-3-5-sonnet"],
            )
        ],
        model=_model(
            "my-bedrock", provider="anthropic", model="anthropic.claude-3-5-sonnet"
        ),
        harness="claude",
        gateway_base_url=_GATEWAY_BASE,
        gateway_credentials_value=_GATEWAY_CREDENTIALS,
    )
    assert resolved.deployment == "bedrock"
    assert "/gateways/llms/custom/my-bedrock" in resolved.endpoint.base_url
    assert resolved.to_wire()["customConnection"] is True


def test_a_provider_key_through_the_gateway_is_marked_not_custom():
    resolved = connections._resolve_from_secrets(
        secrets=[_provider_key()],
        model=_model("openai"),
        harness="pi_core",
        gateway_base_url=_GATEWAY_BASE,
        gateway_credentials_value=_GATEWAY_CREDENTIALS,
    )
    assert "/gateways/llms/standard/openai" in resolved.endpoint.base_url
    assert resolved.to_wire()["customConnection"] is False


# Through the gateway, from the live resolve response


@pytest.mark.parametrize(
    ("namespace", "name", "expected"),
    [
        ("custom", "my-openai", True),
        ("custom", "starter-credits", False),
        ("standard", "openai", False),
        ("builtin", "openai", False),
    ],
)
async def test_the_live_gateway_namespace_sets_the_marker(
    fake_http, connection, namespace, name, expected
):
    fake_http(
        connections,
        payload={
            "connection": {
                "namespace": namespace,
                "name": name,
                "provider_key": "openai",
                "deployment_kind": "direct",
                "model": "gpt-5.5",
            }
        },
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("openai"),
        context=RuntimeAuthContext(harness="pi_core", backend="local"),
    )
    assert resolved.custom_connection is expected
    assert resolved.to_wire()["customConnection"] is expected


# The wire


def test_an_unstated_marker_is_left_off_the_wire():
    # Resolvers that do not track provenance leave it unset; the runner then falls back to
    # its route heuristic, as it does for older SDKs.
    resolved = ResolvedConnection(
        provider="openai", model="gpt-5.5", credential_mode="none"
    )
    assert resolved.custom_connection is None
    assert "customConnection" not in resolved.to_wire()
