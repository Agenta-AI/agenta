"""``ModelRef`` wiring into the config DTOs (no behavior change for string-only configs).

A structured ``model`` populates resolver intent and projects to a plain model string. The
author's connection CHOICE crosses the runner boundary as a bare ``{mode, slug}`` reference,
because the runner routes on it; what that choice RESOLVED to (route plus credentials) crosses
only as ``modelConnection``. No credential and no flat provider field ride the wire.
"""

from __future__ import annotations

from agenta.sdk.agents import (
    AgentTemplate,
    Connection,
    HarnessKind,
    Message,
    ModelRef,
    PiAgentTemplate,
)
from agenta.sdk.agents.utils.wire import request_to_wire


# --------------------------------------------------------------- AgentTemplate.model_ref


def test_plain_string_model_leaves_model_ref_unset():
    config = AgentTemplate(model="openai-codex/gpt-5.5")
    assert config.model == "openai-codex/gpt-5.5"
    assert config.model_ref is None


def test_dict_model_populates_model_ref_and_projects_string():
    config = AgentTemplate(
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
    config = AgentTemplate(model=ref)
    assert config.model == "anthropic/claude-opus-4-8"
    assert config.model_ref is ref or config.model_ref == ref


def test_explicit_model_ref_is_respected():
    config = AgentTemplate(
        model="gpt-5.5",
        model_ref=ModelRef(provider="openai", model="gpt-5.5"),
    )
    assert config.model == "gpt-5.5"
    assert config.model_ref.provider == "openai"


# ------------------------------------------------------ resolved model connection wire


def test_wire_model_connection_empty_before_resolution():
    for model in (
        "openai-codex/gpt-5.5",
        {"provider": "openai", "model": "gpt-5.5"},
        {
            "provider": "openai",
            "model": "gpt-5.5",
            "connection": {"mode": "agenta", "slug": "openai-prod"},
        },
        {
            "provider": "openai",
            "model": "gpt-5.5",
            "connection": {"mode": "self_managed"},
        },
    ):
        config = PiAgentTemplate(model=model)
        assert config.wire_model_connection() == {}


def test_string_only_config_wire_has_no_model_connection():
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(model="openai-codex/gpt-5.5"),
        messages=[Message(role="user", content="hi")],
    )
    assert "modelConnection" not in payload
    assert payload["model"] == "openai-codex/gpt-5.5"


def test_named_connection_choice_crosses_the_boundary_without_credentials():
    """The named connection rides the wire; nothing resolved or secret does.

    The runner needs the author's choice to route a named OpenAI-compatible Pi run through its
    models.json path, so ``connection`` is part of the contract. The flat ``provider`` and
    ``secrets`` fields are retired: a provider is only meaningful once resolved, and credentials
    only ever travel inside ``modelConnection``.
    """
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(
            model={
                "provider": "openai",
                "model": "gpt-5.5",
                "connection": {"mode": "agenta", "slug": "openai-prod"},
            }
        ),
        messages=[Message(role="user", content="hi")],
    )
    assert payload["model"] == "openai/gpt-5.5"
    assert payload["connection"] == {"mode": "agenta", "slug": "openai-prod"}
    assert "modelConnection" not in payload
    for removed in ("provider", "secrets"):
        assert removed not in payload


def test_project_default_connection_is_omitted_from_the_wire():
    """The project default (``agenta``, no slug) says nothing beyond the model, so it is omitted.

    This keeps a plain run's payload byte-identical to a config that never named a connection.
    """
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(model={"provider": "openai", "model": "gpt-5.5"}),
        messages=[Message(role="user", content="hi")],
    )
    assert "connection" not in payload


def test_self_managed_connection_choice_crosses_the_boundary():
    """``self_managed`` is a real choice (the harness owns its own login), so it rides the wire."""
    payload = request_to_wire(
        harness=HarnessKind.PI,
        sandbox="local",
        config=PiAgentTemplate(
            model={
                "provider": "openai-codex",
                "model": "gpt-5.5",
                "connection": {"mode": "self_managed"},
            }
        ),
        messages=[Message(role="user", content="hi")],
    )
    assert payload["connection"] == {"mode": "self_managed"}


def test_default_connection_equality():
    # The default connection is `agenta` with no slug.
    assert Connection() == Connection(mode="agenta", slug=None)
