"""``AgentConfig.from_params`` (the three request shapes) and ``RunSelection.from_params``.

The handler parses whatever the playground or a stored config sends into a neutral
``AgentConfig`` plus a ``RunSelection``. This file locks the three accepted shapes, the
defaults fall-through, the ``harness_options`` escape hatch, and the run-selection parsing.
"""

from __future__ import annotations

from agenta.sdk.agents import (
    AgentConfig,
    BuiltinToolConfig,
    RunSelection,
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
                "harness_options": {"pi": {"system": "S"}},
            }
        },
        defaults=_DEFAULTS,
    )
    assert config.instructions == "I"
    assert config.model == "M"
    assert config.tools == [BuiltinToolConfig(name="read")]
    assert config.harness_options == {"pi": {"system": "S"}}


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


def test_from_params_coerces_single_tool_dict_to_list():
    config = AgentConfig.from_params({"agent": {"tools": {"name": "solo"}}})
    assert config.tools == [BuiltinToolConfig(name="solo")]


def test_harness_options_drops_malformed_and_lowercases_keys():
    config = AgentConfig.from_params(
        {
            "agent": {
                "harness_options": {
                    "PI": {"system": "S"},  # key lower-cased
                    "claude": "not a dict",  # dropped
                }
            }
        }
    )
    assert config.harness_options == {"pi": {"system": "S"}}


def test_harness_options_falls_back_to_defaults_when_absent():
    defaults = AgentConfig(harness_options={"pi": {"system": "D"}})
    config = AgentConfig.from_params(
        {"agent": {"instructions": "I"}}, defaults=defaults
    )
    assert config.harness_options == {"pi": {"system": "D"}}


# -------------------------------------------------------------- RunSelection


def test_run_selection_defaults():
    sel = RunSelection.from_params({})
    assert (sel.harness, sel.sandbox, sel.permission_policy) == ("pi", "local", "auto")


def test_run_selection_reads_agent_subdict_and_lowercases():
    sel = RunSelection.from_params(
        {
            "agent": {
                "harness": "Claude",
                "sandbox": "Daytona",
                "permission_policy": "Deny",
            }
        }
    )
    assert (sel.harness, sel.sandbox, sel.permission_policy) == (
        "claude",
        "daytona",
        "deny",
    )


def test_run_selection_honors_custom_defaults():
    sel = RunSelection.from_params(
        {}, default_harness="claude", default_sandbox="daytona"
    )
    assert sel.harness == "claude"
    assert sel.sandbox == "daytona"


def test_run_selection_reads_flat_request():
    sel = RunSelection.from_params({"harness": "claude"})
    assert sel.harness == "claude"
