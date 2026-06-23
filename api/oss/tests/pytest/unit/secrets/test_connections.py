"""Deterministic connection-resolution rules (pure, no DB).

Exercises ``core.secrets.connections.resolve_connection`` and ``project_connection_view`` over
real ``SecretResponseDTO`` instances. The resolution helper is a pure function over a list of
decrypted secrets, so these run without a database (design Concern 3, "Resolution rules").
"""

import pytest

from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.connections import (
    AmbiguousConnection,
    ConnectionNotFound,
    ProviderMismatch,
    UnsupportedConnectionMode,
    UnsupportedDeployment,
    UnsupportedProvider,
    project_connection_view,
    resolve_connection,
)


def _provider_key(*, name: str, kind: str, key: str) -> SecretResponseDTO:
    return SecretResponseDTO.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000000",
            "header": {"name": name},
            "kind": "provider_key",
            "data": {"kind": kind, "provider": {"key": key}},
        }
    )


def _custom_provider(
    *, name: str, kind: str, key: str, url: str, version: str = None
) -> SecretResponseDTO:
    return SecretResponseDTO.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000000",
            "header": {"name": name},
            "kind": "custom_provider",
            "data": {
                "kind": kind,
                "provider": {"url": url, "version": version, "key": key},
                "models": [{"slug": "my-model"}],
                "provider_slug": name,
            },
        }
    )


def _resolve(secrets, **kwargs):
    base = dict(
        model_provider="openai",
        model_id="gpt-5.5",
        connection_mode="default",
        connection_slug=None,
        harness="pi",
    )
    base.update(kwargs)
    return resolve_connection(secrets=secrets, **base)


# --- self_managed ---------------------------------------------------------------------------


def test_self_managed_injects_nothing():
    result = _resolve([], connection_mode="self_managed")
    assert result.credential_mode == "runtime_provided"
    assert result.env == {}
    assert result.model == "gpt-5.5"


# --- named slug (mode == agenta) ------------------------------------------------------------


def test_named_slug_present_resolves_one_key():
    secrets = [
        _provider_key(name="openai-prod", kind="openai", key="sk-prod"),
        _provider_key(name="openai-dev", kind="openai", key="sk-dev"),
    ]
    result = _resolve(secrets, connection_mode="agenta", connection_slug="openai-prod")
    assert result.credential_mode == "env"
    # Least-privilege: only the selected provider's one var.
    assert result.env == {"OPENAI_API_KEY": "sk-prod"}


def test_named_slug_absent_raises_not_found():
    secrets = [_provider_key(name="openai-prod", kind="openai", key="sk-prod")]
    with pytest.raises(ConnectionNotFound):
        _resolve(secrets, connection_mode="agenta", connection_slug="missing")


def test_ambiguous_duplicate_slug_raises():
    secrets = [
        _provider_key(name="openai-prod", kind="openai", key="sk-a"),
        _provider_key(name="openai-prod", kind="openai", key="sk-b"),
    ]
    with pytest.raises(AmbiguousConnection):
        _resolve(secrets, connection_mode="agenta", connection_slug="openai-prod")


# --- default --------------------------------------------------------------------------------


def test_default_exactly_one():
    secrets = [_provider_key(name="my-openai", kind="openai", key="sk-1")]
    result = _resolve(secrets, connection_mode="default")
    assert result.env == {"OPENAI_API_KEY": "sk-1"}


def test_default_two_unnamed_raises_ambiguous():
    secrets = [
        _provider_key(name="openai-a", kind="openai", key="sk-a"),
        _provider_key(name="openai-b", kind="openai", key="sk-b"),
    ]
    with pytest.raises(AmbiguousConnection):
        _resolve(secrets, connection_mode="default")


def test_default_with_uniquely_named_default():
    secrets = [
        _provider_key(name="default", kind="openai", key="sk-default"),
        _provider_key(name="openai-b", kind="openai", key="sk-b"),
    ]
    result = _resolve(secrets, connection_mode="default")
    assert result.env == {"OPENAI_API_KEY": "sk-default"}


# --- provider match -------------------------------------------------------------------------


def test_provider_mismatch_raises():
    # A uniquely-named slug that resolves to an anthropic connection while the model asks for
    # openai -> ProviderMismatch (clearer than a bare not-found).
    secrets = [
        _provider_key(name="my-conn", kind="anthropic", key="sk-ant"),
    ]
    with pytest.raises(ProviderMismatch):
        _resolve(
            secrets,
            model_provider="openai",
            connection_mode="agenta",
            connection_slug="my-conn",
        )


# --- capability reject ----------------------------------------------------------------------


def test_unsupported_provider_for_claude():
    secrets = [_provider_key(name="my-openai", kind="openai", key="sk-1")]
    with pytest.raises(UnsupportedProvider):
        _resolve(secrets, harness="claude", model_provider="openai")


def test_unsupported_mode_for_unknown_harness_is_permissive():
    # Unknown harness -> permissive: it must NOT reject a known mode.
    secrets = [_provider_key(name="my-openai", kind="openai", key="sk-1")]
    result = _resolve(secrets, harness="some-future-harness")
    assert result.env == {"OPENAI_API_KEY": "sk-1"}


def test_bogus_mode_rejected():
    with pytest.raises(UnsupportedConnectionMode):
        _resolve([], connection_mode="bogus")


# --- custom_provider ------------------------------------------------------------------------


def test_azure_custom_provider_fails_loud():
    # v1 does not wire cloud (azure/bedrock/vertex) credential delivery; it must fail loud
    # rather than silently drop the key and run with no credential.
    secrets = [
        _custom_provider(
            name="my-azure",
            kind="azure",
            key="az-key",
            url="https://my.azure.example/v1",
            version="2024-02-01",
        ),
    ]
    with pytest.raises(UnsupportedDeployment):
        _resolve(
            secrets,
            model_provider="azure",
            connection_mode="agenta",
            connection_slug="my-azure",
        )


def test_custom_openai_compatible_resolves_openai_key():
    secrets = [
        _custom_provider(
            name="my-gw",
            kind="openai",
            key="sk-gw",
            url="https://gw.example/v1",
        ),
    ]
    result = _resolve(
        secrets,
        model_provider="openai",
        connection_mode="agenta",
        connection_slug="my-gw",
    )
    assert result.deployment == "custom"
    assert result.env == {"OPENAI_API_KEY": "sk-gw"}
    assert result.endpoint.base_url == "https://gw.example/v1"


# --- projection (non-secret view) -----------------------------------------------------------


def test_connection_view_never_carries_key():
    secret = _provider_key(name="openai-prod", kind="openai", key="sk-secret")
    view = project_connection_view(secret)
    assert view is not None
    assert view.slug == "openai-prod"
    assert view.provider == "openai"
    assert view.deployment == "direct"
    assert "sk-secret" not in view.model_dump_json()


def test_sso_secret_is_not_a_connection():
    secret = SecretResponseDTO.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000000",
            "header": {"name": "my-sso"},
            "kind": "sso_provider",
            "data": {
                "provider": {
                    "client_id": "c",
                    "client_secret": "s",
                    "issuer_url": "https://issuer.example",
                    "scopes": ["openid"],
                }
            },
        }
    )
    assert project_connection_view(secret) is None
