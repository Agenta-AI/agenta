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
    *,
    name: str,
    kind: str,
    key: str = None,
    url: str = None,
    version: str = None,
    extras=None,
) -> SecretResponseDTO:
    return SecretResponseDTO.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000000",
            "header": {"name": name},
            "kind": "custom_provider",
            "data": {
                "kind": kind,
                "provider": {
                    "url": url,
                    "version": version,
                    "key": key,
                    "extras": extras,
                },
                "models": [{"slug": "my-model"}],
                "provider_slug": name,
            },
        }
    )


def _resolve(secrets, **kwargs):
    # The vault resolve is harness-agnostic: no harness argument. Default = the project default
    # (agenta mode, no slug).
    base = dict(
        model_provider="openai",
        model_id="gpt-5.5",
        connection_mode="agenta",
        connection_slug=None,
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


# --- project default (agenta mode, no slug) -------------------------------------------------


def test_default_exactly_one():
    secrets = [_provider_key(name="my-openai", kind="openai", key="sk-1")]
    result = _resolve(secrets)  # agenta + no slug = the project default
    assert result.env == {"OPENAI_API_KEY": "sk-1"}


def test_default_two_unnamed_raises_ambiguous():
    secrets = [
        _provider_key(name="openai-a", kind="openai", key="sk-a"),
        _provider_key(name="openai-b", kind="openai", key="sk-b"),
    ]
    with pytest.raises(AmbiguousConnection):
        _resolve(secrets)


def test_default_with_uniquely_named_default():
    secrets = [
        _provider_key(name="default", kind="openai", key="sk-default"),
        _provider_key(name="openai-b", kind="openai", key="sk-b"),
    ]
    result = _resolve(secrets)
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


# --- harness-agnostic: no capability reject in the vault resolve ----------------------------


def test_resolve_is_harness_agnostic_no_provider_reject():
    # The vault resolve never rejects on harness capability (that check lives in the agent
    # layer). An openai connection resolves fine here regardless of any harness.
    secrets = [_provider_key(name="my-openai", kind="openai", key="sk-1")]
    result = _resolve(secrets)
    assert result.env == {"OPENAI_API_KEY": "sk-1"}


def test_bogus_mode_rejected():
    # Two modes only; anything else is malformed.
    with pytest.raises(UnsupportedConnectionMode):
        _resolve([], connection_mode="bogus")


def test_default_mode_string_rejected():
    # The removed "default" mode string is no longer a valid resolve mode.
    with pytest.raises(UnsupportedConnectionMode):
        _resolve([], connection_mode="default")


# --- custom_provider: cloud deployments emit the FULL credential set ------------------------


def test_azure_custom_provider_emits_full_creds_not_fail_loud():
    # v1: the vault resolve EMITS the full cloud credential set and reports the deployment; it
    # does NOT fail loud (the unconsumable-deployment reject lives in the agent layer now).
    secrets = [
        _custom_provider(
            name="my-azure",
            kind="azure",
            key="az-key",
            url="https://my.azure.example/v1",
            version="2024-02-01",
        ),
    ]
    result = _resolve(
        secrets,
        model_provider="azure",
        connection_slug="my-azure",
    )
    assert result.deployment == "azure"
    # Azure key surfaces under its env var; the base_url/version ride the (non-secret) endpoint.
    assert result.env == {"AZURE_OPENAI_API_KEY": "az-key"}
    assert result.endpoint.base_url == "https://my.azure.example/v1"
    assert result.endpoint.api_version == "2024-02-01"


def test_bedrock_custom_provider_emits_full_aws_group():
    # The complete AWS group rides env; region is non-secret config on endpoint.
    secrets = [
        _custom_provider(
            name="my-bedrock",
            kind="bedrock",
            extras={
                "AWS_ACCESS_KEY_ID": "AKIA...",
                "AWS_SECRET_ACCESS_KEY": "secret",
                "AWS_SESSION_TOKEN": "token",
                "region": "us-east-1",
            },
        ),
    ]
    result = _resolve(
        secrets,
        model_provider="bedrock",
        connection_slug="my-bedrock",
    )
    assert result.deployment == "bedrock"
    assert result.env == {
        "AWS_ACCESS_KEY_ID": "AKIA...",
        "AWS_SECRET_ACCESS_KEY": "secret",
        "AWS_SESSION_TOKEN": "token",
    }
    assert result.endpoint.region == "us-east-1"
    # The non-secret region must NOT leak into env.
    assert "region" not in result.env


def test_vertex_custom_provider_emits_gcp_group():
    secrets = [
        _custom_provider(
            name="my-vertex",
            kind="vertex_ai",
            extras={"GOOGLE_APPLICATION_CREDENTIALS": "/adc.json"},
        ),
    ]
    result = _resolve(
        secrets,
        model_provider="vertex_ai",
        connection_slug="my-vertex",
    )
    assert result.deployment == "vertex"
    assert result.env == {"GOOGLE_APPLICATION_CREDENTIALS": "/adc.json"}


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
