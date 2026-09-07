"""The SDK-owned platform text: what every run gets, and what only a config-editing run gets."""

import pytest

from agenta.sdk.agents.dtos import SessionContext
from agenta.sdk.agents.platform_instructions import (
    AGENTA_CONFIG_SECTIONS,
    AGENTA_PLATFORM_BASE,
    CONFIG_COMMIT_TOOL,
    compose_platform_instructions,
    is_placeholder_agent_name,
    session_context_guidance,
)


def test_base_comes_first_and_applies_to_every_run():
    text = compose_platform_instructions([], [], [])
    assert text.startswith("## Agenta platform")
    assert "## How you work" in text
    assert "## Files and storage" in text
    assert "## What does not work here" in text


def test_config_sections_appear_only_when_the_run_can_commit():
    # A trigger fire or an embedded run has no commit tool, so a page about `commit_revision`,
    # `read_config`, and the rename tools would name capabilities it does not have.
    without = compose_platform_instructions([], [], ["bash", "read_config"])
    assert "## Your configuration" not in without
    assert "rename_session" not in without

    with_tool = compose_platform_instructions([], [], ["bash", CONFIG_COMMIT_TOOL])
    assert "## Your configuration" in with_tool
    assert "## Task, or a change to you?" in with_tool
    assert "## Names" in with_tool
    assert with_tool.index(AGENTA_PLATFORM_BASE) < with_tool.index(
        AGENTA_CONFIG_SECTIONS
    )


def test_per_run_guidance_follows_the_static_text():
    text = compose_platform_instructions(
        ["github", "slack"], ["GITHUB_TOKEN"], [CONFIG_COMMIT_TOOL]
    )
    assert text.index("## Names") < text.index("## Configured credential variables")
    assert text.index("## Configured credential variables") < text.index(
        "## Connected integrations"
    )
    assert "`GITHUB_TOKEN`" in text
    assert "github, slack" in text


def test_file_links_are_relative_and_never_absolute():
    # The chat's link gate resolves a path relative to the working directory and renders an
    # absolute sandbox path as inert text. The prompt must teach the shape that opens.
    assert "[report.md](agent-files/report.md)" in AGENTA_PLATFORM_BASE
    assert "A bare basename for a nested file does not open" in AGENTA_PLATFORM_BASE
    assert "/home/sandbox/" not in AGENTA_PLATFORM_BASE


def test_the_base_never_names_a_config_tool_it_cannot_promise():
    # `request_secret` is named with an availability hedge, because it ships through the build
    # kit and a plain run may lack it. The config-only tools are confined to the gated half.
    for tool in ("commit_revision", "read_config", "rename_agent", "create_schedule"):
        assert tool not in AGENTA_PLATFORM_BASE, tool
    assert "`request_secret` is available" in AGENTA_PLATFORM_BASE


# The session block ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        None,
        "",
        "   ",
        "New agent",
        "new agent",
        "New agent 2",
        "Untitled",
        "Untitled agent",
    ],
)
def test_placeholder_names_are_recognized(name):
    assert is_placeholder_agent_name(name) is True


@pytest.mark.parametrize(
    "name",
    ["Changelog writer", "Newsletter agent", "Agent Smith", "Untitled sonata", "new"],
)
def test_a_real_name_is_never_read_as_a_placeholder(name):
    # "Newsletter agent" and "Untitled sonata" are the near-misses that a substring test would
    # get wrong: a placeholder is the whole name, not a fragment of one.
    assert is_placeholder_agent_name(name) is False


def test_placeholder_and_unnamed_session_asks_for_both_renames():
    block = session_context_guidance(
        SessionContext(agent_name="New agent", session_name=None, first_turn=True)
    )
    assert block.startswith("## This session")
    assert 'Your name is "New agent". That is a placeholder' in block
    assert "rename yourself with `rename_agent` in this turn" in block
    assert "This session has no name yet" in block
    assert "Name it with `rename_session`" in block
    assert "This is the first turn of the session." in block


def test_real_name_and_unnamed_session_asks_only_for_the_session_name():
    block = session_context_guidance(
        SessionContext(
            agent_name="Changelog writer", session_name=None, first_turn=True
        )
    )
    assert 'Your name is "Changelog writer". Keep it.' in block
    assert "rename_agent" not in block
    assert "Name it with `rename_session`" in block


def test_placeholder_and_named_session_asks_only_for_the_agent_name():
    block = session_context_guidance(
        SessionContext(
            agent_name="Untitled agent", session_name="Q3 notes", first_turn=False
        )
    )
    assert "rename yourself with `rename_agent`" in block
    assert 'This session is named "Q3 notes". Do not rename it.' in block
    assert "rename_session" not in block
    assert "This is not the first turn" in block


def test_real_name_and_named_session_asks_for_nothing():
    block = session_context_guidance(
        SessionContext(
            agent_name="Changelog writer", session_name="Q3 notes", first_turn=False
        )
    )
    assert "rename_agent" not in block
    assert "rename_session" not in block
    assert "Keep it." in block
    assert "Do not rename it." in block


def test_an_unknown_turn_position_renders_no_turn_line():
    # Guessing here is worse than silence: claiming "not the first turn" on a first turn would
    # suppress the session name for the whole conversation.
    block = session_context_guidance(
        SessionContext(agent_name="Changelog writer", session_name=None)
    )
    assert "first turn" not in block
    assert "Keep it." in block


def test_no_context_renders_no_block():
    assert session_context_guidance(None) is None


def test_the_session_block_comes_last_and_only_with_a_rename_tool():
    context = SessionContext(agent_name="New agent", session_name=None, first_turn=True)

    # A trigger fire has neither rename tool, so the facts would be unusable.
    without = compose_platform_instructions(
        ["github"], [], ["bash"], session_context=context
    )
    assert "## This session" not in without

    with_tools = compose_platform_instructions(
        ["github"],
        ["GITHUB_TOKEN"],
        [CONFIG_COMMIT_TOOL, "rename_session", "rename_agent"],
        session_context=context,
    )
    assert "## This session" in with_tools
    assert with_tools.index("## Connected integrations") < with_tools.index(
        "## This session"
    )
    assert with_tools.rstrip().endswith("This is the first turn of the session.")


def test_the_names_rule_points_at_the_session_block():
    # The rule must read the facts rather than tell the model to guess at a placeholder.
    text = compose_platform_instructions([], [], [CONFIG_COMMIT_TOOL])
    assert "The session block at the end of these instructions" in text
    assert "placeholder" in text
    assert "when the block says it has no name" in text
