"""``AgentTemplate.from_params`` (the accepted request shapes), including the execution selectors.

The handler parses whatever the playground or a stored template sends into one ``AgentTemplate``.
This file locks the nested agent-template envelope (``{agent, harness, runner, sandbox}``), the
``prompt`` prompt-template shape for a bare chat run, the defaults fall-through, the selected
harness's ``permissions`` / ``extras`` slice, and the execution selectors (``harness.kind`` /
``sandbox.kind`` / ``runner.interactions.headless``, which live on ``AgentTemplate`` rather than a
separate ``RunSelection``).
"""

from __future__ import annotations

from agenta.sdk.agents import (
    AgentTemplate,
    BuiltinToolConfig,
)

_DEFAULTS = AgentTemplate(instructions="default-md", model="default-model", tools=["d"])


# ----------------------------------------------------------- AgentTemplate shapes


def test_from_params_agent_template_at_parameters_agent():
    # The template sits at `parameters.agent` (like the prompt template at `parameters.prompt`):
    # the definition flat, the execution parts nested inside the same template object.
    config = AgentTemplate.from_params(
        {
            "agent": {
                "instructions": {"agents_md": "I"},
                "llm": {"model": "M"},
                "tools": [{"type": "builtin", "name": "read"}],
                "harness": {"kind": "claude", "extras": {"system": "S"}},
                "runner": {"interactions": {"headless": "deny"}},
                "sandbox": {"kind": "daytona"},
            },
        },
        defaults=_DEFAULTS,
    )
    assert config.instructions == "I"
    assert config.model == "M"
    assert config.tools == [BuiltinToolConfig(name="read")]
    assert config.harness == "claude"
    assert config.harness_extras == {"system": "S"}
    assert config.sandbox == "daytona"
    assert config.permission_policy == "deny"


def test_from_params_bare_template():
    # A caller may pass the template directly (no `parameters.agent` wrapper) — SDK use / resolved
    # params. The definition fields read straight off the top level.
    config = AgentTemplate.from_params(
        {
            "instructions": {"agents_md": "I"},
            "llm": {"model": "M"},
            "harness": {"kind": "claude"},
        },
        defaults=_DEFAULTS,
    )
    assert config.instructions == "I"
    assert config.model == "M"
    assert config.harness == "claude"


def test_from_params_prompt_template_shape():
    config = AgentTemplate.from_params(
        {
            "prompt": {
                "messages": [
                    {"role": "system", "content": "You are helpful."},
                    {"role": "user", "content": "ignored for instructions"},
                ],
                "llm_config": {"model": "M", "tools": ["t"]},
            }
        },
        defaults=_DEFAULTS,
    )
    assert config.instructions == "You are helpful."  # system message -> instructions
    assert config.model == "M"
    assert config.tools == [BuiltinToolConfig(name="t")]


def test_from_params_prompt_template_joins_multiple_system_messages():
    config = AgentTemplate.from_params(
        {
            "prompt": {
                "messages": [
                    {"role": "system", "content": "First."},
                    {
                        "role": "system",
                        "content": [{"type": "text", "text": "Second."}],
                    },
                ],
                "llm_config": {"model": "M"},
            }
        }
    )
    assert config.instructions == "First.\n\nSecond."


def test_from_params_structured_llm_builds_model_ref():
    # A structured `agent.llm` (provider / connection / extras) builds the typed model_ref;
    # `extras` is the neutral knobs bag (was ModelRef.params).
    config = AgentTemplate.from_params(
        {
            "agent": {
                "llm": {
                    "model": "gpt-5.5",
                    "provider": "openai",
                    "connection": {"mode": "agenta", "slug": "openai-prod"},
                    "extras": {"reasoning_effort": "high"},
                }
            }
        }
    )
    assert config.model == "openai/gpt-5.5"
    assert config.model_ref is not None
    assert config.model_ref.provider == "openai"
    assert config.model_ref.connection.slug == "openai-prod"
    assert config.model_ref.extras == {"reasoning_effort": "high"}


def test_from_params_plain_string_model_leaves_model_ref_none():
    # A plain `agent.llm.model` string leaves model_ref None so the wire stays byte-identical.
    config = AgentTemplate.from_params({"agent": {"llm": {"model": "gpt-5.5"}}})
    assert config.model == "gpt-5.5"
    assert config.model_ref is None


def test_from_params_falls_back_to_defaults():
    config = AgentTemplate.from_params({}, defaults=_DEFAULTS)
    assert config.instructions == "default-md"
    assert config.model == "default-model"
    assert config.tools == [BuiltinToolConfig(name="d")]


def test_from_params_agent_element_preserves_default_tools_when_absent():
    config = AgentTemplate.from_params(
        {"agent": {"instructions": {"agents_md": "I"}, "llm": {"model": "M"}}},
        defaults=_DEFAULTS,
    )

    assert config.instructions == "I"
    assert config.model == "M"
    assert config.tools == [BuiltinToolConfig(name="d")]


def test_from_params_agent_element_empty_tools_clears_defaults():
    config = AgentTemplate.from_params(
        {"agent": {"tools": []}},
        defaults=_DEFAULTS,
    )

    assert config.tools == []


def test_from_params_coerces_single_tool_dict_to_list():
    config = AgentTemplate.from_params({"agent": {"tools": {"name": "solo"}}})
    assert config.tools == [BuiltinToolConfig(name="solo")]


# ------------------------------------------------------------------- skills


_SKILL = {
    "name": "release-notes",
    "description": "Draft release notes.",
    "body": "Read the changelog.",
}


def test_from_params_parses_skills_from_agent_element():
    config = AgentTemplate.from_params({"agent": {"skills": [dict(_SKILL)]}})
    assert [s.name for s in config.skills] == ["release-notes"]


def test_from_params_skills_default_empty():
    # An absent `skills` is not silently dropped into a default it never had; it is just empty.
    config = AgentTemplate.from_params({"agent": {"instructions": {"agents_md": "I"}}})
    assert config.skills == []


def test_from_params_skills_falls_back_to_defaults_when_absent():
    defaults = AgentTemplate(skills=[dict(_SKILL)])
    config = AgentTemplate.from_params(
        {"agent": {"instructions": {"agents_md": "I"}}}, defaults=defaults
    )
    assert [s.name for s in config.skills] == ["release-notes"]


# ------------------------------------------------- harness permissions / extras


def test_harness_slice_reads_permissions_and_extras():
    config = AgentTemplate.from_params(
        {
            "harness": {
                "kind": "claude",
                "permissions": {"default_mode": "plan", "allow": ["Read"]},
                "extras": {"system": "S"},
            }
        }
    )
    assert config.harness_permissions == {"default_mode": "plan", "allow": ["Read"]}
    assert config.harness_extras == {"system": "S"}


def test_harness_slice_falls_back_to_defaults_when_absent():
    defaults = AgentTemplate(
        harness_permissions={"default_mode": "plan"}, harness_extras={"system": "D"}
    )
    config = AgentTemplate.from_params(
        {"agent": {"instructions": {"agents_md": "I"}}}, defaults=defaults
    )
    assert config.harness_permissions == {"default_mode": "plan"}
    assert config.harness_extras == {"system": "D"}


def test_harness_slice_explicit_empty_clears_defaults():
    # An explicit empty dict clears the inherited slice; only an absent section falls back.
    defaults = AgentTemplate(harness_extras={"system": "D"})
    config = AgentTemplate.from_params(
        {"harness": {"kind": "pi_core", "extras": {}}}, defaults=defaults
    )
    assert config.harness_extras == {}


# ---------------------------------------------------- execution selectors


def test_run_selection_defaults():
    config = AgentTemplate.from_params({})
    assert (config.harness, config.sandbox, config.permission_policy) == (
        "pi_core",
        "local",
        "auto",
    )


def test_run_selection_reads_envelope_sections_and_lowercases():
    config = AgentTemplate.from_params(
        {
            "harness": {"kind": "Claude"},
            "sandbox": {"kind": "Daytona"},
            "runner": {"interactions": {"headless": "Deny"}},
        }
    )
    assert (config.harness, config.sandbox, config.permission_policy) == (
        "claude",
        "daytona",
        "deny",
    )


def test_run_selection_honors_defaults():
    defaults = AgentTemplate(harness="claude", sandbox="daytona")
    config = AgentTemplate.from_params({}, defaults=defaults)
    assert config.harness == "claude"
    assert config.sandbox == "daytona"
