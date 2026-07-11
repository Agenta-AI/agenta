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
            "extras": {"reasoning_effort": "high"},
            "connection": {"mode": "agenta", "slug": "openai-prod"},
        }
    )
    assert ref.provider == "openai"
    assert ref.model == "gpt-5.5"
    assert ref.extras == {"reasoning_effort": "high"}
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


def test_default_connection_is_agenta_with_no_slug():
    # The default connection is `agenta` with no slug (the project default); there is no
    # separate `default` mode.
    conn = Connection()
    assert conn.mode == "agenta"
    assert conn.slug is None


def test_self_managed_connection_is_valid():
    conn = Connection(mode="self_managed")
    assert conn.mode == "self_managed"
    assert conn.slug is None


def test_agenta_mode_without_a_slug_is_the_project_default():
    # An `agenta` connection with no slug is valid: it resolves to the project default.
    conn = Connection(mode="agenta")
    assert conn.mode == "agenta"
    assert conn.slug is None


def test_self_managed_rejects_a_slug():
    # A self-managed connection injects nothing, so a slug has nothing to resolve against.
    with pytest.raises(ValidationError):
        Connection(mode="self_managed", slug="openai-prod")


def test_agenta_mode_with_slug_is_valid():
    conn = Connection(mode="agenta", slug="openai-prod")
    assert conn.mode == "agenta"
    assert conn.slug == "openai-prod"


def test_no_default_mode():
    # The removed `default` mode is no longer a valid literal.
    with pytest.raises(ValidationError):
        Connection(mode="default")


# --------------------------------------------------- ResolvedConnection / Endpoint shape


def test_resolved_connection_to_wire_nests_typed_credentials():
    resolved = ResolvedConnection(
        provider="openai",
        model="gpt-5.5",
        credential_mode="env",
        credentials=[
            {
                "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
                "value": "sk-secret",
                "usage": "opaque_http",
            }
        ],
        endpoint=Endpoint(base_url="https://gw.example/v1"),
    )
    assert resolved.to_wire() == {
        "provider": "openai",
        "deployment": "direct",
        "credentialMode": "env",
        "credentials": [
            {
                "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
                "value": "sk-secret",
                "usage": "opaque_http",
            }
        ],
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
    assert wire["credentials"] == []
    assert wire["credentialMode"] == "runtime_provided"


def test_resolved_connection_credential_is_hidden_from_repr():
    resolved = ResolvedConnection(
        provider="openai",
        model="gpt-5.5",
        credential_mode="env",
        credentials=[
            {
                "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
                "value": "do-not-print",
                "usage": "opaque_http",
            }
        ],
        endpoint=Endpoint(base_url="https://api.openai.com/v1"),
    )
    assert "do-not-print" not in repr(resolved)


@pytest.mark.parametrize(
    "credentials, endpoint, mode",
    [
        (
            [
                {
                    "binding": {"kind": "environment", "name": ""},
                    "value": "key",
                    "usage": "opaque_http",
                }
            ],
            Endpoint(base_url="https://api.example"),
            "env",
        ),
        (
            [
                {
                    "binding": {"kind": "environment", "name": "KEY"},
                    "value": "",
                    "usage": "opaque_http",
                }
            ],
            Endpoint(base_url="https://api.example"),
            "env",
        ),
        (
            [
                {
                    "binding": {"kind": "environment", "name": "KEY"},
                    "value": "key",
                    "usage": "opaque_http",
                }
            ],
            None,
            "env",
        ),
        (
            [
                {
                    "binding": {"kind": "environment", "name": "KEY"},
                    "value": "key",
                    "usage": "opaque_http",
                }
            ],
            Endpoint(base_url="http://api.example"),
            "env",
        ),
        ([], Endpoint(base_url="https://api.example"), "env"),
        (
            [
                {
                    "binding": {"kind": "environment", "name": "KEY"},
                    "value": "key",
                    "usage": "local_use",
                }
            ],
            Endpoint(base_url="https://api.example"),
            "runtime_provided",
        ),
    ],
)
def test_resolved_connection_rejects_invalid_credential_combinations(
    credentials, endpoint, mode
):
    with pytest.raises(ValidationError):
        ResolvedConnection(
            provider="test",
            model="m",
            credential_mode=mode,
            credentials=credentials,
            endpoint=endpoint,
        )


def test_plaintext_environment_materializes_only_at_local_boundary():
    resolved = ResolvedConnection(
        provider="anthropic",
        model="claude",
        deployment="bedrock",
        credential_mode="env",
        environment={"AWS_REGION": "us-east-1"},
        credentials=[
            {
                "binding": {"kind": "environment", "name": "AWS_ACCESS_KEY_ID"},
                "value": "AKIA",
                "usage": "local_use",
            }
        ],
        endpoint=Endpoint(base_url="https://bedrock-runtime.us-east-1.amazonaws.com"),
    )
    assert resolved.plaintext_environment() == {
        "AWS_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "AKIA",
    }
