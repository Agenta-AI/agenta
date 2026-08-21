"""SDK behavior when the vault redacts a write-only secret for this caller.

The platform runtime reads write-only secrets in plaintext through its granted credential,
so in-platform runs never see the redacted shape. A standalone run (ApiKey credential)
does — and must fail loud with instructions, never pass an empty key to a provider.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents.connections import (
    MissingCredentialError,
    ModelRef,
    WriteOnlySecretError,
)
from agenta.sdk.agents.platform import connections
from agenta.sdk.agents.platform.secrets import _is_write_only_redacted
from agenta.sdk.middlewares.running.vault import _split_write_only_redacted


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
        "has_key": True,
        "key_preview": "sk-****abc",
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
    assert "environment variable" in message
    # Never the misleading "add your key" error: the key exists, it is just unreadable here.
    assert not isinstance(raised.value, MissingCredentialError)


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
        "has_key": True,
    }

    with pytest.raises(WriteOnlySecretError):
        connections._resolve_from_secrets(
            secrets=[redacted],
            model=ModelRef(
                provider="openai",
                model="gpt-5.5",
                connection={"mode": "agenta", "slug": "my-gateway"},
            ),
            harness="pi_core",
        )


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
                "has_key": True,
            }
        ]
    )

    assert usable == []
    assert redacted_names == ["gh-token"]


# --- named-secret redaction detection --------------------------------------------------


def test_named_secret_redaction_is_detected():
    assert _is_write_only_redacted(
        {"kind": "custom_secret", "write_only": True, "has_key": True}
    )
    assert not _is_write_only_redacted(
        {"kind": "custom_secret", "write_only": True, "has_key": False}
    )
    assert not _is_write_only_redacted({"kind": "custom_secret"})
    assert not _is_write_only_redacted(None)
