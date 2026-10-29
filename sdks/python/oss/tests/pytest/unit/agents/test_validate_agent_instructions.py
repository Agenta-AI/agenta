"""The agent-template rule for `instructions`: absent, or an object with a string `agents_md`.

The runtime reads the prompt only from `instructions.agents_md`, so any other present shape
made the agent run with no prompt. The API refuses such commits with this rule.
"""

import pytest

from agenta.sdk.agents import (
    AGENT_INSTRUCTIONS_SHAPE_HINT,
    InvalidAgentInstructionsError,
    validate_agent_instructions,
)


@pytest.mark.parametrize(
    "instructions,described",
    [
        pytest.param("You are a bot.", "a str", id="string"),
        pytest.param(3.5, "a float", id="number"),
        pytest.param(["a", "b"], "a list", id="list"),
        pytest.param({}, "an object without agents_md", id="empty-object"),
        pytest.param({"system": "x"}, "an object without agents_md", id="no-agents_md"),
        pytest.param({"agents_md": None}, "agents_md of type NoneType", id="null"),
        pytest.param({"agents_md": 7}, "agents_md of type int", id="int"),
        pytest.param({"agents_md": {"text": "x"}}, "agents_md of type dict", id="dict"),
    ],
)
def test_refuses_any_shape_without_a_string_agents_md(instructions, described):
    with pytest.raises(InvalidAgentInstructionsError) as caught:
        validate_agent_instructions(instructions)

    error = caught.value
    assert error.code == 400
    assert error.message.startswith(AGENT_INSTRUCTIONS_SHAPE_HINT)
    assert described in error.message
    # Still a ValueError, like the other agent-template refusals.
    assert isinstance(error, ValueError)


def test_the_message_tells_the_caller_how_to_write_it():
    assert AGENT_INSTRUCTIONS_SHAPE_HINT == (
        'instructions must be an object with an agents_md string, e.g. {"agents_md": "..."}. '
        "Write the full AGENTS.md text in instructions.agents_md."
    )


@pytest.mark.parametrize(
    "instructions",
    [
        None,
        {"agents_md": "# Agent\n\nAnswer briefly."},
        {"agents_md": ""},
        {"agents_md": "x", "other": 1},
    ],
)
def test_accepts_absent_or_a_string_agents_md(instructions):
    validate_agent_instructions(instructions)
