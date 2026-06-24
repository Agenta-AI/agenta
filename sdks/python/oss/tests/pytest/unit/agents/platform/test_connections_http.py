"""``VaultConnectionResolver`` over the existing ``GET /secrets/`` response."""

from __future__ import annotations

import pytest

from agenta.sdk.agents.connections import (
    AmbiguousConnectionError,
    ConnectionNotFoundError,
    ConnectionResolutionError,
    ModelRef,
    ProviderMismatchError,
    RuntimeAuthContext,
)
from agenta.sdk.agents.platform import PlatformConnection, VaultConnectionResolver
from agenta.sdk.agents.platform import connections


def _model(
    slug: str | None = "openai-prod", provider: str = "openai", model: str = "gpt-5.5"
) -> ModelRef:
    connection = {"mode": "agenta"}
    if slug is not None:
        connection["slug"] = slug
    return ModelRef(provider=provider, model=model, connection=connection)


def _context() -> RuntimeAuthContext:
    return RuntimeAuthContext(harness="pi", backend="local")


def _provider_key(name: str, provider: str, key: str) -> dict:
    return {
        "kind": "provider_key",
        "header": {"name": name},
        "data": {"kind": provider, "provider": {"key": key}},
    }


def _custom_provider(
    name: str,
    kind: str,
    *,
    key: str | None = None,
    url: str | None = None,
    version: str | None = None,
    extras: dict | None = None,
    models: list[str] | None = None,
) -> dict:
    return {
        "kind": "custom_provider",
        "header": {"name": name},
        "data": {
            "kind": kind,
            "provider_slug": name,
            "provider": {
                "url": url,
                "version": version,
                "key": key,
                "extras": extras or {},
            },
            "models": [{"slug": m} for m in (models or ["my-model"])],
            "model_keys": [f"{name}/{kind}/{m}" for m in (models or ["my-model"])],
        },
    }


async def test_resolve_fetches_secrets_and_selects_one_key(fake_http, connection):
    capture = fake_http(
        connections,
        payload=[
            _provider_key("openai-prod", "openai", "sk-prod"),
            _provider_key("openai-dev", "openai", "sk-dev"),
            _provider_key("anthropic-prod", "anthropic", "sk-ant"),
        ],
    )

    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("openai-prod"), context=_context()
    )

    assert resolved.provider == "openai"
    assert resolved.model == "gpt-5.5"
    assert resolved.deployment == "direct"
    assert resolved.credential_mode == "env"
    assert resolved.env == {"OPENAI_API_KEY": "sk-prod"}
    assert capture["method"] == "GET"
    assert capture["url"] == "https://api.x/api/secrets/"
    assert capture["headers"]["Authorization"] == "Access tok"
    assert "json" not in capture


async def test_self_managed_short_circuits_without_api_base(fake_http):
    resolved = await VaultConnectionResolver(PlatformConnection()).resolve(
        model=ModelRef(
            provider="openai", model="gpt-5.5", connection={"mode": "self_managed"}
        ),
        context=_context(),
    )
    assert resolved.credential_mode == "runtime_provided"
    assert resolved.env == {}


async def test_default_connection_requires_unique_provider_match(fake_http, connection):
    fake_http(connections, payload=[_provider_key("default", "openai", "sk-default")])
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model(slug=None), context=_context()
    )
    assert resolved.env == {"OPENAI_API_KEY": "sk-default"}


async def test_default_connection_ambiguous(fake_http, connection):
    fake_http(
        connections,
        payload=[
            _provider_key("openai-a", "openai", "sk-a"),
            _provider_key("openai-b", "openai", "sk-b"),
        ],
    )
    with pytest.raises(AmbiguousConnectionError):
        await VaultConnectionResolver(connection).resolve(
            model=_model(slug=None), context=_context()
        )


async def test_missing_named_connection_fails_loud(fake_http, connection):
    fake_http(connections, payload=[_provider_key("openai-prod", "openai", "sk-prod")])
    with pytest.raises(ConnectionNotFoundError):
        await VaultConnectionResolver(connection).resolve(
            model=_model("missing"), context=_context()
        )


async def test_provider_mismatch_fails_loud(fake_http, connection):
    fake_http(
        connections, payload=[_provider_key("anthropic-prod", "anthropic", "sk-ant")]
    )
    with pytest.raises(ProviderMismatchError):
        await VaultConnectionResolver(connection).resolve(
            model=_model("anthropic-prod", provider="openai"), context=_context()
        )


async def test_custom_provider_snake_case_extras_normalize_for_bedrock(
    fake_http, connection
):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "my-bedrock",
                "bedrock",
                extras={
                    "aws_region_name": "us-east-1",
                    "aws_access_key_id": "AKIA",
                    "aws_secret_access_key": "secret",
                    "aws_session_token": "token",
                },
                models=["anthropic.claude-3-5-sonnet"],
            )
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model(
            "my-bedrock", provider="anthropic", model="anthropic.claude-3-5-sonnet"
        ),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.provider == "anthropic"
    assert resolved.model == "anthropic.claude-3-5-sonnet"
    assert resolved.deployment == "bedrock"
    assert resolved.env == {
        "AWS_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "AKIA",
        "AWS_SECRET_ACCESS_KEY": "secret",
        "AWS_SESSION_TOKEN": "token",
    }
    assert resolved.endpoint.region == "us-east-1"


async def test_custom_provider_vertex_snake_case_extras(fake_http, connection):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "my-vertex",
                "vertex_ai",
                extras={
                    "vertex_ai_project": "proj",
                    "vertex_ai_location": "us-central1",
                    "vertex_ai_credentials": "/adc.json",
                },
                models=["claude-sonnet-4"],
            )
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("my-vertex", provider="anthropic", model="claude-sonnet-4"),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.deployment == "vertex_ai"
    assert resolved.env == {
        "GOOGLE_CLOUD_PROJECT": "proj",
        "GOOGLE_CLOUD_LOCATION": "us-central1",
        "GOOGLE_APPLICATION_CREDENTIALS": "/adc.json",
    }


async def test_custom_gateway_api_key_from_extras_and_endpoint(fake_http, connection):
    fake_http(
        connections,
        payload=[
            _custom_provider(
                "anthropic-gw",
                "custom",
                url="https://gw.example/v1",
                extras={"api_key": "sk-gw"},
                models=["gpt-5.5"],
            )
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model("anthropic-gw", provider="anthropic", model="gpt-5.5"),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.deployment == "custom"
    assert resolved.env == {"ANTHROPIC_API_KEY": "sk-gw"}
    assert resolved.endpoint.base_url == "https://gw.example/v1"


async def test_full_custom_model_key_selects_and_strips_to_backend_model(
    fake_http, connection
):
    fake_http(
        connections,
        payload=[
            _custom_provider("my-bedrock", "bedrock", models=["anthropic.claude-x"])
        ],
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=ModelRef.coerce("my-bedrock/bedrock/anthropic.claude-x"),
        context=RuntimeAuthContext(harness="claude"),
    )
    assert resolved.model == "anthropic.claude-x"
    assert resolved.deployment == "bedrock"


async def test_resolve_fails_loud_on_http_error(fake_http, connection):
    fake_http(connections, status=404)
    with pytest.raises(ConnectionResolutionError):
        await VaultConnectionResolver(connection).resolve(
            model=_model("missing"), context=_context()
        )


async def test_resolve_fails_loud_on_network_exception(fake_http, connection):
    fake_http(connections, raises=RuntimeError("network down"))
    with pytest.raises(ConnectionResolutionError):
        await VaultConnectionResolver(connection).resolve(
            model=_model(), context=_context()
        )


async def test_resolve_without_api_base_fails_loud(fake_http):
    with pytest.raises(ConnectionResolutionError):
        await VaultConnectionResolver(PlatformConnection()).resolve(
            model=_model(), context=_context()
        )
