"""``ModelRef`` wiring into the config DTOs (no behavior change for string-only configs).

The Slice-1 contract: a structured ``model`` (dict / ``ModelRef``) populates ``model_ref`` and
projects ``model`` to its plain string; a plain-string ``model`` leaves ``model_ref`` unset so
the wire is byte-identical. ``wire_model_ref`` emits the non-secret provider/connection fields
only for a structured ref.
"""

from __future__ import annotations

from agenta.sdk.agents import (
    AgentConfig,
    Connection,
    HarnessType,
    Message,
    ModelRef,
    PiAgentConfig,
)
from agenta.sdk.agents.utils.wire import request_to_wire


# --------------------------------------------------------------- AgentConfig.model_ref


def test_plain_string_model_leaves_model_ref_unset():
    config = AgentConfig(model="openai-codex/gpt-5.5")
    assert config.model == "openai-codex/gpt-5.5"
    assert config.model_ref is None


def test_dict_model_populates_model_ref_and_projects_string():
    config = AgentConfig(
        model={
            "provider": "openai",
            "model": "gpt-5.5",
            "connection": {"mode": "agenta", "slug": "openai-prod"},
        }
    )
    assert config.model == "openai/gpt-5.5"  # projected back-compat string
    assert config.model_ref is not None
    assert config.model_ref.provider == "openai"
    assert config.model_ref.connection.slug == "openai-prod"


def test_model_ref_instance_populates_and_projects():
    ref = ModelRef(provider="anthropic", model="claude-opus-4-8")
    config = AgentConfig(model=ref)
    assert config.model == "anthropic/claude-opus-4-8"
    assert config.model_ref is ref or config.model_ref == ref


def test_explicit_model_ref_is_respected():
    config = AgentConfig(
        model="gpt-5.5",
        model_ref=ModelRef(provider="openai", model="gpt-5.5"),
    )
    assert config.model == "gpt-5.5"
    assert config.model_ref.provider == "openai"


# ------------------------------------------------------------- wire_model_ref / wire


def test_wire_model_ref_empty_for_string_only_config():
    config = PiAgentConfig(model="openai-codex/gpt-5.5")
    assert config.wire_model_ref() == {}


def test_wire_model_ref_emits_provider_and_connection_for_structured():
    config = PiAgentConfig(
        model={
            "provider": "openai",
            "model": "gpt-5.5",
            "connection": {"mode": "agenta", "slug": "openai-prod"},
        }
    )
    assert config.wire_model_ref() == {
        "provider": "openai",
        "connection": {"mode": "agenta", "slug": "openai-prod"},
    }


def test_wire_model_ref_omits_default_connection():
    config = PiAgentConfig(
        model={"provider": "openai", "model": "gpt-5.5"},
    )
    # Default connection carries no non-default info, so only the provider rides the wire.
    assert config.wire_model_ref() == {"provider": "openai"}


def test_wire_model_ref_emits_self_managed_connection_without_slug():
    config = PiAgentConfig(
        model={
            "provider": "openai",
            "model": "gpt-5.5",
            "connection": {"mode": "self_managed"},
        }
    )
    assert config.wire_model_ref() == {
        "provider": "openai",
        "connection": {"mode": "self_managed"},
    }


def test_string_only_config_wire_has_no_new_keys():
    # The whole point of Slice 1: a string-only config's payload gains no new keys.
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentConfig(model="openai-codex/gpt-5.5"),
        messages=[Message(role="user", content="hi")],
    )
    assert "provider" not in payload
    assert "connection" not in payload
    assert payload["model"] == "openai-codex/gpt-5.5"


def test_structured_config_wire_carries_provider_and_connection():
    payload = request_to_wire(
        engine="pi",
        harness=HarnessType.PI,
        sandbox="local",
        config=PiAgentConfig(
            model={
                "provider": "openai",
                "model": "gpt-5.5",
                "connection": {"mode": "agenta", "slug": "openai-prod"},
            }
        ),
        messages=[Message(role="user", content="hi")],
    )
    assert payload["model"] == "openai/gpt-5.5"
    assert payload["provider"] == "openai"
    assert payload["connection"] == {"mode": "agenta", "slug": "openai-prod"}


def test_default_connection_equality():
    assert Connection() == Connection(mode="default", slug=None)
