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
    assert with_tool.index(AGENTA_PLATFORM_BASE) < with_tool.index(
        AGENTA_CONFIG_SECTIONS
    )


def test_per_run_guidance_follows_the_static_text():
    text = compose_platform_instructions(
        ["github", "slack"], ["GITHUB_TOKEN"], [CONFIG_COMMIT_TOOL]
    )
    assert text.index("## Task, or a change to you?") < text.index(
        "## Configured credential variables"
    )
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


def test_the_base_tells_the_agent_to_finish_authorized_work():
    # Literal-minded models (GPT-6) stopped after a diagnosis, asked before reversible edits, and
    # treated "why did you stop?" as a new question. These rules close those exits.
    assert "**Finish the job in this turn.**" in AGENTA_PLATFORM_BASE
    assert "**A new message steers the current task.**" in AGENTA_PLATFORM_BASE
    assert "**Work first, ask last.**" in AGENTA_PLATFORM_BASE
    assert "explicit instruction beats a skill." in AGENTA_PLATFORM_BASE
    assert "a rendered screenshot for anything visual" in AGENTA_PLATFORM_BASE
    assert "outside your working directory, or is hard to" not in AGENTA_PLATFORM_BASE


def test_the_base_never_names_a_config_tool_it_cannot_promise():
    # `request_secret` is named with an availability hedge, because it ships through the build
    # kit and a plain run may lack it. The config-only tools are confined to the gated half.
    for tool in ("commit_revision", "read_config", "rename_agent", "create_schedule"):
        assert tool not in AGENTA_PLATFORM_BASE, tool
    assert "`request_secret` is available" in AGENTA_PLATFORM_BASE


# The agent-level app layout --------------------------------------------------------------


def _section(text: str, header: str, next_header: str) -> str:
    return text[text.index(header) : text.index(next_header)]


def test_the_apps_folder_is_introduced_beside_the_tools_folder():
    # `.apps/` is the agent's own app records. It lives next to `.tools/`, so the paragraph
    # sits inside "Installing tools", after the `.tools/` material and before the section ends.
    installing = _section(AGENTA_PLATFORM_BASE, "## Installing tools", "## Credentials")
    assert "`agent-files/.apps/`" in installing
    assert installing.index("`agent-files/.tools/`") < installing.index(
        "`agent-files/.apps/`"
    )
    assert installing.index("`agent-files/.apps/`") < installing.index(
        "Never keep the only copy of anything"
    )
    assert "`agent-files/.apps/`" not in _section(
        AGENTA_PLATFORM_BASE, "## Files and storage", "## Installing tools"
    )


def test_the_apps_paragraph_names_the_records_and_the_data_rule():
    installing = _section(AGENTA_PLATFORM_BASE, "## Installing tools", "## Credentials")
    for record in (
        "`layout.json`",
        "`registry/<session-id>.json`",
        "`notes/<date>-<slug>.md`",
    ):
        assert record in installing, record
    assert "dimmed in the Files pane, not hidden" in installing
    assert "Never store app data files there" in installing
    assert "`apps/<slug>/`" in installing
    assert "`agent-files/apps/<slug>/`" in installing
    # The skill owns the exact write rules; the base only points at it.
    assert "The agenta-apps skill says exactly what to write" in installing
    assert "leave `.apps/` alone" in installing


def test_the_base_section_order_is_unchanged_by_the_apps_paragraph():
    # The paragraph is an insertion, not a reflow: no header added, removed, or moved.
    headers = [
        line for line in AGENTA_PLATFORM_BASE.splitlines() if line.startswith("## ")
    ]
    assert headers == [
        "## Agenta platform",
        "## Who you are, underneath the configuration",
        "## How you work",
        "## How you talk",
        "## Files and storage",
        "## Installing tools",
        "## Credentials",
        "## GitHub and other code work",
        "## What does not work here",
    ]


# The session block ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "New agent",
        "new agent",
        "  New   agent  ",
        "New agent 2",
        "NEW AGENT 17",
        "Untitled",
        "Untitled agent",
    ],
)
def test_placeholder_names_are_recognized(name):
    assert is_placeholder_agent_name(name) is True


@pytest.mark.parametrize(
    "name",
    [
        "Changelog writer",
        "Newsletter agent",
        "Agent Smith",
        "Untitled sonata",
        "new",
        # The prefix test read every one of these as a placeholder and told an agent its
        # author's chosen name was not real.
        "New Agent Research",
        "New agent for the support queue",
        "Untitled agent runner",
    ],
)
def test_a_real_name_is_never_read_as_a_placeholder(name):
    # A placeholder is the whole name, not a prefix of one and not a fragment of one.
    assert is_placeholder_agent_name(name) is False


@pytest.mark.parametrize("name", [None, "", "   "])
def test_an_unknown_agent_name_renders_no_agent_line(name):
    block = session_context_guidance(
        SessionContext(agent_name=name, session_name="Q3 notes", first_turn=False)
    )
    assert "Your name is" not in block
    assert 'This session is named "Q3 notes".' in block


def test_current_facts_are_present_and_ask_for_no_naming():
    block = session_context_guidance(
        SessionContext(agent_name="New agent", session_name=None, first_turn=True)
    )
    assert block.startswith("## This session")
    assert 'Your name is "New agent".' in block
    assert "This session has no name yet." in block
    assert "This is the first turn of the session." in block
    # The agent service names the session and the agent; the model is never asked to.
    assert "rename" not in block.lower()
    assert "placeholder" not in block


@pytest.mark.parametrize("agent_name", ["New agent", "Changelog writer"])
@pytest.mark.parametrize("session_name", [None, "Q3 notes"])
def test_later_turns_state_the_names_and_ask_for_no_naming(agent_name, session_name):
    block = session_context_guidance(
        SessionContext(
            agent_name=agent_name, session_name=session_name, first_turn=False
        )
    )
    assert f'Your name is "{agent_name}".' in block
    assert "rename" not in block.lower()
    assert "This is not the first turn of the session." in block
    if session_name:
        assert 'This session is named "Q3 notes".' in block


def test_an_unknown_turn_position_renders_no_turn_line():
    block = session_context_guidance(
        SessionContext(agent_name="Changelog writer", session_name=None)
    )
    assert "first turn" not in block


def test_an_unread_session_renders_neither_a_session_line_nor_a_turn_line():
    # This is what a composition with no resolver stamps: the agent name is known, the session
    # was never read. Saying "no name yet" here would state a fact nobody read.
    block = session_context_guidance(
        SessionContext(
            agent_name="Changelog writer", session_name=None, first_turn=None
        )
    )
    assert "This session has no name yet." not in block
    assert "first turn" not in block
    assert 'Your name is "Changelog writer".' in block


def test_a_block_with_nothing_known_is_dropped():
    assert session_context_guidance(SessionContext()) is None


def test_no_context_renders_no_block():
    assert session_context_guidance(None) is None


def test_static_instructions_do_not_duplicate_session_facts_or_naming_actions():
    text = compose_platform_instructions([], [], [CONFIG_COMMIT_TOOL])
    assert "## This session" not in text
    assert "rename_agent" not in text
    assert "rename_session" not in text


def test_channel_guidance_appears_only_when_the_run_can_list_channels():
    # Staging QA: Claude defers MCP tools behind a name-only list, so without a line in the
    # prompt, Haiku answered "where can you post in Slack?" from memory instead of listing.
    without = compose_platform_instructions([], [], ["bash"])
    assert "list_channel_destinations" not in without

    text = compose_platform_instructions(
        [], [], ["list_channel_destinations", "send_channel_message"]
    )
    section = text[text.index("## Slack and Telegram") :]
    assert "call `list_channel_destinations`" in section
    assert "where you can post" in section
    # a tool the run does not have is never named
    assert "read_channel_messages" not in section
    assert "search_channel_messages" not in section
