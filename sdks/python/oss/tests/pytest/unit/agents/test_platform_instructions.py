"""The SDK-owned platform text: what every run gets, and what only a config-editing run gets."""

from agenta.sdk.agents.platform_instructions import (
    AGENTA_CONFIG_SECTIONS,
    AGENTA_PLATFORM_BASE,
    CONFIG_COMMIT_TOOL,
    compose_platform_instructions,
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
