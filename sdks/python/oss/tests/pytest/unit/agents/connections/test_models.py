"""``ModelRef`` / ``Connection`` coercion and the ``ResolvedConnection`` / ``Endpoint`` shape.

Locks the three model-string shapes the design promises (``"openai/gpt-5.5"``, ``"gpt-5.5"``,
a full object with a connection), the first-slash split (so a custom ``my-gw/llama-3`` parses
correctly and a provider slug is never re-split), the ``Connection`` validity rules, and the
secret hygiene of ``ResolvedConnection.to_wire()`` (it never emits ``env``).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.connections import (
    Connection,
    Endpoint,
    ModelRef,
    ResolvedConnection,
)


# ----------------------------------------------------------------- ModelRef.coerce


def test_coerce_provider_slash_model():
    ref = ModelRef.coerce("openai/gpt-5.5")
    assert ref.provider == "openai"
    assert ref.model == "gpt-5.5"
    assert ref.connection == Connection()  # default connection


def test_coerce_bare_string_has_no_provider():
    ref = ModelRef.coerce("gpt-5.5")
    assert ref.provider is None
    assert ref.model == "gpt-5.5"


def test_coerce_custom_slug_splits_on_first_slash_only():
    # A custom gateway slug parses as the provider; only the FIRST slash is the boundary.
    ref = ModelRef.coerce("my-gw/llama-3")
    assert ref.provider == "my-gw"
    assert ref.model == "llama-3"


def test_coerce_splits_only_first_slash_when_model_has_a_slash():
    ref = ModelRef.coerce("openrouter/meta-llama/llama-3")
    assert ref.provider == "openrouter"
    assert ref.model == "meta-llama/llama-3"


def test_coerce_passes_through_a_model_ref():
    original = ModelRef(provider="anthropic", model="claude-opus-4-8")
    assert ModelRef.coerce(original) is original


def test_coerce_full_dict_with_a_connection():
    ref = ModelRef.coerce(
        {
            "provider": "openai",
            "model": "gpt-5.5",
            "params": {"reasoning_effort": "high"},
            "connection": {"mode": "agenta", "slug": "openai-prod"},
        }
    )
    assert ref.provider == "openai"
    assert ref.model == "gpt-5.5"
    assert ref.params == {"reasoning_effort": "high"}
    assert ref.connection.mode == "agenta"
    assert ref.connection.slug == "openai-prod"


def test_coerce_rejects_a_non_string_non_mapping():
    with pytest.raises(TypeError):
        ModelRef.coerce(42)


# --------------------------------------------------------------- to_model_string round-trip


def test_to_model_string_round_trips_provider_slash_model():
    assert ModelRef.coerce("openai/gpt-5.5").to_model_string() == "openai/gpt-5.5"


def test_to_model_string_round_trips_bare_string():
    assert ModelRef.coerce("gpt-5.5").to_model_string() == "gpt-5.5"


def test_to_model_string_round_trips_custom_slug():
    assert ModelRef.coerce("my-gw/llama-3").to_model_string() == "my-gw/llama-3"


# --------------------------------------------------------------------------- Connection


def test_default_connection_is_valid():
    conn = Connection()
    assert conn.mode == "default"
    assert conn.slug is None


def test_self_managed_connection_is_valid():
    conn = Connection(mode="self_managed")
    assert conn.mode == "self_managed"
    assert conn.slug is None


def test_agenta_mode_requires_a_slug():
    with pytest.raises(ValidationError):
        Connection(mode="agenta")


def test_agenta_mode_rejects_blank_slug():
    with pytest.raises(ValidationError):
        Connection(mode="agenta", slug="   ")


def test_agenta_mode_with_slug_is_valid():
    conn = Connection(mode="agenta", slug="openai-prod")
    assert conn.mode == "agenta"
    assert conn.slug == "openai-prod"


# --------------------------------------------------- ResolvedConnection / Endpoint shape


def test_resolved_connection_to_wire_excludes_env():
    resolved = ResolvedConnection(
        provider="openai",
        model="gpt-5.5",
        credential_mode="env",
        env={"OPENAI_API_KEY": "sk-secret"},
        endpoint=Endpoint(base_url="https://gw.example/v1"),
    )
    wire = resolved.to_wire()
    assert "env" not in wire
    assert "sk-secret" not in repr(wire)
    assert wire == {
        "provider": "openai",
        "model": "gpt-5.5",
        "deployment": "direct",
        "credentialMode": "env",
        "endpoint": {"baseUrl": "https://gw.example/v1"},
    }


def test_resolved_connection_to_wire_omits_endpoint_when_absent():
    resolved = ResolvedConnection(
        provider="openai",
        model="gpt-5.5",
        credential_mode="runtime_provided",
    )
    wire = resolved.to_wire()
    assert "endpoint" not in wire
    assert wire["credentialMode"] == "runtime_provided"


def test_resolved_connection_env_is_hidden_from_repr():
    resolved = ResolvedConnection(
        provider="openai",
        model="gpt-5.5",
        credential_mode="env",
        env={"OPENAI_API_KEY": "do-not-print"},
    )
    assert "do-not-print" not in repr(resolved)
