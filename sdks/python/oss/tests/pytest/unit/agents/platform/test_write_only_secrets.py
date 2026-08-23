"""SDK behavior when the vault redacts a write-only secret for this caller.

The platform runtime reads write-only secrets in plaintext through its granted credential,
so in-platform runs never see the redacted shape. A standalone run (ApiKey credential)
does — and then falls back to this run's own provider key from the environment, failing
loud with instructions when there is none. It never passes an empty key to a provider.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents.connections import (
    MissingCredentialError,
    ModelRef,
    WriteOnlySecretError,
)
from agenta.sdk.agents.capabilities import PROVIDER_ENV_VARS
from agenta.sdk.agents.platform import connections
from agenta.sdk.agents.platform.secrets import _is_write_only_redacted
from agenta.sdk.middlewares.running.vault import _split_write_only_redacted


@pytest.fixture(autouse=True)
def _no_ambient_provider_keys(monkeypatch):
    """A developer machine exports provider keys; the fallback must not read them here.

    Every case below states its own environment, so the ambient one is cleared first.
    """
    for name in set(PROVIDER_ENV_VARS.values()) | {
        "AWS_BEARER_TOKEN_BEDROCK",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AZURE_OPENAI_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
    }:
        monkeypatch.delenv(name, raising=False)


def _model(model: str = "gpt-5.5", provider: str = "openai") -> ModelRef:
    return ModelRef(provider=provider, model=model, connection={"mode": "agenta"})


def _redacted_provider_key(name: str = "OpenAI", provider: str = "openai") -> dict:
    """The list-response shape a non-granted caller receives for a write-only secret."""
    return {
        "kind": "provider_key",
        "slug": f"{provider}-abc123",
        "header": {"name": name},
        "data": {"kind": provider, "provider": {}},
        "write_only": True,
        "value_status": {"configured": True, "preview": "sk-****abc"},
    }


def _plaintext_provider_key(provider: str = "openai", key: str = "sk-live-123") -> dict:
    """The same secret as the granted runtime sees it: write-only, value present."""
    return {
        "kind": "provider_key",
        "slug": f"{provider}-abc123",
        "header": {"name": "OpenAI"},
        "data": {"kind": provider, "provider": {"key": key}},
        "write_only": True,
    }


def test_redacted_write_only_key_fails_loud_with_instructions():
    with pytest.raises(WriteOnlySecretError) as raised:
        connections._resolve_from_secrets(
            secrets=[_redacted_provider_key()], model=_model(), harness="pi_core"
        )

    message = str(raised.value)
    assert "write-only" in message
    assert "OPENAI_API_KEY" in message
    assert "this run's environment" in message
    # Never the misleading "add your key" error: the key exists, it is just unreadable here.
    assert not isinstance(raised.value, MissingCredentialError)


def test_redacted_write_only_key_uses_this_runs_own_provider_key(monkeypatch):
    # What the error text instructs, made true: the run's own key resolves the connection.
    monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")

    resolved = connections._resolve_from_secrets(
        secrets=[_redacted_provider_key()], model=_model(), harness="pi_core"
    )

    env = {item.binding.name: item.value for item in resolved.credentials}
    assert env["OPENAI_API_KEY"] == "sk-from-env"


def test_a_key_for_another_provider_family_is_not_a_fallback(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-env")

    with pytest.raises(WriteOnlySecretError):
        connections._resolve_from_secrets(
            secrets=[_redacted_provider_key()], model=_model(), harness="pi_core"
        )


def test_granted_plaintext_write_only_key_resolves_normally():
    resolved = connections._resolve_from_secrets(
        secrets=[_plaintext_provider_key()], model=_model(), harness="pi_core"
    )

    env = {item.binding.name: item.value for item in resolved.credentials}
    assert env["OPENAI_API_KEY"] == "sk-live-123"


def test_ordinary_keyless_secret_still_reports_missing_credential():
    keyless = {
        "kind": "provider_key",
        "slug": "openai-abc123",
        "header": {"name": "OpenAI"},
        "data": {"kind": "openai", "provider": {}},
    }

    with pytest.raises(MissingCredentialError):
        connections._resolve_from_secrets(
            secrets=[keyless], model=_model(), harness="pi_core"
        )


def test_redacted_aws_only_secret_fails_loud_despite_surviving_config_extras():
    # After redaction an AWS-credentialed secret keeps only config extras (region). The
    # resulting env is NON-empty, so an env-emptiness check alone would let the run
    # proceed mis-credentialed; the write-only check must fire first.
    redacted = {
        "kind": "custom_provider",
        "slug": "bedrock-conn",
        "header": {"name": "bedrock-conn"},
        "data": {
            "kind": "bedrock",
            "provider": {"extras": {"aws_region_name": "eu-west-1"}},
            "models": [{"slug": "claude-opus-5"}],
            "provider_slug": "bedrock-conn",
        },
        "write_only": True,
        "value_status": {"configured": True},
    }

    with pytest.raises(WriteOnlySecretError):
        connections._resolve_from_secrets(
            secrets=[redacted],
            model=ModelRef(
                provider="anthropic",
                model="claude-opus-5",
                connection={"mode": "agenta", "slug": "bedrock-conn"},
            ),
            harness="claude_code",
        )


def test_a_bedrock_connection_never_falls_back_to_the_family_api_key(monkeypatch):
    # Bedrock authenticates with a bearer token of its own; an Anthropic API key in the
    # environment is a credential for a different service and must not be sent instead.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-env")
    redacted = {
        "kind": "custom_provider",
        "slug": "bedrock-conn",
        "header": {"name": "bedrock-conn"},
        "data": {
            "kind": "bedrock",
            "provider": {"extras": {"aws_region_name": "eu-west-1"}},
            "models": [{"slug": "claude-opus-5"}],
            "provider_slug": "bedrock-conn",
        },
        "write_only": True,
        "value_status": {"configured": True},
    }
    model = ModelRef(
        provider="anthropic",
        model="claude-opus-5",
        connection={"mode": "agenta", "slug": "bedrock-conn"},
    )

    with pytest.raises(WriteOnlySecretError):
        connections._resolve_from_secrets(
            secrets=[redacted], model=model, harness="claude_code"
        )

    # Its own channel does resolve it.
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "aws-bearer-env")
    resolved = connections._resolve_from_secrets(
        secrets=[redacted], model=model, harness="claude_code"
    )
    env = {item.binding.name: item.value for item in resolved.credentials}
    assert env["AWS_BEARER_TOKEN_BEDROCK"] == "aws-bearer-env"


def _redacted_custom(kind: str, slug: str, extras: dict | None = None) -> dict:
    return {
        "kind": "custom_provider",
        "slug": slug,
        "header": {"name": slug},
        "data": {
            "kind": kind,
            "provider": {"extras": extras or {}},
            "models": [{"slug": "claude-opus-5"}],
            "provider_slug": slug,
        },
        "write_only": True,
        "value_status": {"configured": True},
    }


def _claude_model(slug: str) -> ModelRef:
    return ModelRef(
        provider="anthropic",
        model="claude-opus-5",
        connection={"mode": "agenta", "slug": slug},
    )


def test_a_bedrock_connection_accepts_an_aws_key_pair_from_the_environment(monkeypatch):
    # The same credential material the plaintext path takes from the vault's extras.
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "aws-secret-from-env")
    redacted = _redacted_custom(
        "bedrock", "bedrock-conn", {"aws_region_name": "eu-west-1"}
    )

    resolved = connections._resolve_from_secrets(
        secrets=[redacted], model=_claude_model("bedrock-conn"), harness="claude_code"
    )

    env = {item.binding.name: item.value for item in resolved.credentials}
    assert env["AWS_ACCESS_KEY_ID"] == "AKIAEXAMPLE"
    assert env["AWS_SECRET_ACCESS_KEY"] == "aws-secret-from-env"


def test_half_an_aws_key_pair_is_not_a_credential(monkeypatch):
    # An access key id with no secret authenticates nothing; failing here names the
    # problem, where passing it on would fail at the provider with an auth error.
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLE")
    redacted = _redacted_custom("bedrock", "bedrock-conn")

    with pytest.raises(WriteOnlySecretError):
        connections._resolve_from_secrets(
            secrets=[redacted],
            model=_claude_model("bedrock-conn"),
            harness="claude_code",
        )


def test_a_vertex_connection_accepts_google_application_credentials(monkeypatch):
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "/run/secrets/service-account")
    redacted = _redacted_custom(
        "vertex_ai", "vertex-conn", {"vertex_ai_location": "europe-west1"}
    )

    resolved = connections._resolve_from_secrets(
        secrets=[redacted], model=_claude_model("vertex-conn"), harness="claude_code"
    )

    env = {item.binding.name: item.value for item in resolved.credentials}
    assert env["GOOGLE_APPLICATION_CREDENTIALS"] == "/run/secrets/service-account"


def test_plaintext_aws_only_secret_is_not_treated_as_redacted():
    plaintext = {
        "kind": "custom_provider",
        "slug": "bedrock-conn",
        "header": {"name": "bedrock-conn"},
        "data": {
            "kind": "bedrock",
            "provider": {
                "extras": {
                    "aws_access_key_id": "AKIA123",
                    "aws_secret_access_key": "shhh",
                    "aws_region_name": "eu-west-1",
                }
            },
            "models": [{"slug": "claude-opus-5"}],
            "provider_slug": "bedrock-conn",
        },
        "write_only": True,
    }

    candidates = connections._catalog([plaintext])
    assert candidates[0].write_only_redacted is False


def test_redacted_custom_provider_fails_loud_too():
    redacted = {
        "kind": "custom_provider",
        "slug": "my-gateway",
        "header": {"name": "my-gateway"},
        "data": {
            "kind": "openai",
            "provider": {"url": "https://gateway.example.com/v1"},
            "models": [{"slug": "gpt-5.5"}],
            "provider_slug": "my-gateway",
        },
        "write_only": True,
        "value_status": {"configured": True},
    }

    model = ModelRef(
        provider="openai",
        model="gpt-5.5",
        connection={"mode": "agenta", "slug": "my-gateway"},
    )

    with pytest.raises(WriteOnlySecretError):
        connections._resolve_from_secrets(
            secrets=[redacted], model=model, harness="pi_core"
        )


def test_a_redacted_gateway_resolves_with_this_runs_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-gateway-env")
    redacted = {
        "kind": "custom_provider",
        "slug": "my-gateway",
        "header": {"name": "my-gateway"},
        "data": {
            "kind": "openai",
            "provider": {"url": "https://gateway.example.com/v1"},
            "models": [{"slug": "gpt-5.5"}],
            "provider_slug": "my-gateway",
        },
        "write_only": True,
        "value_status": {"configured": True},
    }

    resolved = connections._resolve_from_secrets(
        secrets=[redacted],
        model=ModelRef(
            provider="openai",
            model="gpt-5.5",
            connection={"mode": "agenta", "slug": "my-gateway"},
        ),
        harness="pi_core",
    )

    env = {item.binding.name: item.value for item in resolved.credentials}
    assert env["OPENAI_API_KEY"] == "sk-gateway-env"


# --- the vault middleware's list partition ---------------------------------------------


def test_partition_drops_redacted_entries_and_names_them():
    usable, redacted_names = _split_write_only_redacted(
        [
            _redacted_provider_key(name="Prod OpenAI"),
            _plaintext_provider_key(provider="anthropic"),
            {
                "kind": "provider_key",
                "header": {"name": "Legacy"},
                "data": {"kind": "mistral", "provider": {"key": "m-key"}},
            },
        ]
    )

    assert redacted_names == ["Prod OpenAI"]
    assert [s["data"]["kind"] for s in usable] == ["anthropic", "mistral"]


def test_partition_keeps_write_only_entries_whose_value_came_through():
    usable, redacted_names = _split_write_only_redacted([_plaintext_provider_key()])

    assert redacted_names == []
    assert len(usable) == 1


def test_partition_drops_redacted_custom_secret_content():
    usable, redacted_names = _split_write_only_redacted(
        [
            {
                "kind": "custom_secret",
                "slug": "gh-token",
                "header": {"name": "gh-token"},
                "data": {"secret": {"format": "text"}},
                "write_only": True,
                "value_status": {"configured": True},
            }
        ]
    )

    assert usable == []
    assert redacted_names == ["gh-token"]


# --- named-secret redaction detection --------------------------------------------------


def test_named_secret_redaction_is_detected():
    assert _is_write_only_redacted(
        {
            "kind": "custom_secret",
            "write_only": True,
            "value_status": {"configured": True},
        }
    )
    assert not _is_write_only_redacted(
        {
            "kind": "custom_secret",
            "write_only": True,
            "value_status": {"configured": False},
        }
    )
    assert not _is_write_only_redacted({"kind": "custom_secret"})
    assert not _is_write_only_redacted(None)


def test_legacy_has_key_is_not_a_supported_response_contract():
    assert not _is_write_only_redacted(
        {"kind": "custom_secret", "write_only": True, "has_key": True}
    )
