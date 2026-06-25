"""``AgentConfig.from_params`` (the three request shapes), including the run-selection fields.

The handler parses whatever the playground or a stored config sends into one ``AgentConfig``.
This file locks the three accepted shapes, the defaults fall-through, the ``harness_kwargs``
escape hatch, and the run-selection parsing (``harness`` / ``sandbox`` / ``permission_policy``,
which now live on ``AgentConfig`` rather than a separate ``RunSelection``).
"""

from __future__ import annotations

from agenta.sdk.agents import (
    AgentConfig,
    BuiltinToolConfig,
)

_DEFAULTS = AgentConfig(instructions="default-md", model="default-model", tools=["d"])


# ----------------------------------------------------------- AgentConfig shapes


def test_from_params_agent_element_shape():
    config = AgentConfig.from_params(
        {
            "agent": {
                "instructions": "I",
                "model": "M",
                "tools": [{"type": "builtin", "name": "read"}],
                "harness_kwargs": {"pi_core": {"system": "S"}},
            }
        },
        defaults=_DEFAULTS,
    )
    assert config.instructions == "I"
    assert config.model == "M"
    assert config.tools == [BuiltinToolConfig(name="read")]
    assert config.harness_kwargs == {"pi_core": {"system": "S"}}


def test_from_params_prompt_template_shape():
    config = AgentConfig.from_params(
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
    config = AgentConfig.from_params(
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


def test_from_params_flat_shape():
    config = AgentConfig.from_params(
        {"model": "M", "agents_md": "A", "tools": [{"name": "x"}]},
        defaults=_DEFAULTS,
    )
    assert config.instructions == "A"
    assert config.model == "M"
    assert config.tools == [BuiltinToolConfig(name="x")]


def test_from_params_falls_back_to_defaults():
    config = AgentConfig.from_params({}, defaults=_DEFAULTS)
    assert config.instructions == "default-md"
    assert config.model == "default-model"
    assert config.tools == [BuiltinToolConfig(name="d")]


def test_from_params_agent_element_preserves_default_tools_when_absent():
    config = AgentConfig.from_params(
        {"agent": {"instructions": "I", "model": "M"}},
        defaults=_DEFAULTS,
    )

    assert config.instructions == "I"
    assert config.model == "M"
    assert config.tools == [BuiltinToolConfig(name="d")]


def test_from_params_agent_element_empty_tools_clears_defaults():
    config = AgentConfig.from_params(
        {"agent": {"tools": []}},
        defaults=_DEFAULTS,
    )

    assert config.tools == []


def test_from_params_coerces_single_tool_dict_to_list():
    config = AgentConfig.from_params({"agent": {"tools": {"name": "solo"}}})
    assert config.tools == [BuiltinToolConfig(name="solo")]


# ------------------------------------------------------------------- skills


_SKILL = {
    "name": "release-notes",
    "description": "Draft release notes.",
    "body": "Read the changelog.",
}


def test_from_params_parses_skills_from_agent_element():
    config = AgentConfig.from_params({"agent": {"skills": [dict(_SKILL)]}})
    assert [s.name for s in config.skills] == ["release-notes"]


def test_from_params_parses_skills_from_flat_request():
    config = AgentConfig.from_params({"skills": [dict(_SKILL)]})
    assert [s.name for s in config.skills] == ["release-notes"]


def test_from_params_skills_default_empty():
    # An absent `skills` is not silently dropped into a default it never had; it is just empty.
    config = AgentConfig.from_params({"agent": {"instructions": "I"}})
    assert config.skills == []


def test_from_params_skills_falls_back_to_defaults_when_absent():
    defaults = AgentConfig(skills=[dict(_SKILL)])
    config = AgentConfig.from_params(
        {"agent": {"instructions": "I"}}, defaults=defaults
    )
    assert [s.name for s in config.skills] == ["release-notes"]


def test_harness_kwargs_drops_malformed_and_lowercases_keys():
    config = AgentConfig.from_params(
        {
            "agent": {
                "harness_kwargs": {
                    "PI_CORE": {"system": "S"},  # key lower-cased
                    "claude": "not a dict",  # dropped
                }
            }
        }
    )
    assert config.harness_kwargs == {"pi_core": {"system": "S"}}


def test_harness_kwargs_falls_back_to_defaults_when_absent():
    defaults = AgentConfig(harness_kwargs={"pi_core": {"system": "D"}})
    config = AgentConfig.from_params(
        {"agent": {"instructions": "I"}}, defaults=defaults
    )
    assert config.harness_kwargs == {"pi_core": {"system": "D"}}


def test_harness_kwargs_explicit_empty_clears_defaults():
    # An explicit empty dict clears inherited per-harness options; only an absent
    # key falls back to defaults.
    defaults = AgentConfig(harness_kwargs={"pi_core": {"system": "D"}})
    config = AgentConfig.from_params(
        {"agent": {"harness_kwargs": {}}}, defaults=defaults
    )
    assert config.harness_kwargs == {}


# ---------------------------------------------------- run-selection fields


def test_run_selection_defaults():
    config = AgentConfig.from_params({})
    assert (config.harness, config.sandbox, config.permission_policy) == (
        "pi_core",
        "local",
        "auto",
    )


def test_run_selection_reads_agent_subdict_and_lowercases():
    config = AgentConfig.from_params(
        {
            "agent": {
                "harness": "Claude",
                "sandbox": "Daytona",
                "permission_policy": "Deny",
            }
        }
    )
    assert (config.harness, config.sandbox, config.permission_policy) == (
        "claude",
        "daytona",
        "deny",
    )


def test_run_selection_honors_defaults():
    defaults = AgentConfig(harness="claude", sandbox="daytona")
    config = AgentConfig.from_params({}, defaults=defaults)
    assert config.harness == "claude"
    assert config.sandbox == "daytona"


def test_run_selection_reads_flat_request():
    config = AgentConfig.from_params({"harness": "claude"})
    assert config.harness == "claude"
