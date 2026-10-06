"""A refused skill, MCP server or tool entry names its index and the fields to correct.

The API runs the runtime's parse on every agent revision it stores and reports these as
field paths (``parameters.agent.skills[0].body is required``), so the location must survive
every re-raise between the model and ``AgentTemplate.from_params``.
"""

import pytest

from agenta.sdk.agents import (
    AgentTemplate,
    MCPConfigurationError,
    SkillValidationError,
    ToolConfigurationError,
)
from agenta.sdk.agents.config_errors import ConfigEntryError, ConfigIssue
from agenta.sdk.agents.tools.compat import coerce_tool_configs

SKILL = {"name": "invoice-lookup", "description": "Find invoices.", "body": "Look."}


def _refusal(agent):
    with pytest.raises(ConfigEntryError) as caught:
        AgentTemplate.from_params({"agent": agent})
    return caught.value


class TestTheParseLocatesTheProblem:
    def test_a_skill_without_body(self):
        error = _refusal({"skills": [SKILL, {"name": "x", "description": "d"}]})

        assert isinstance(error, SkillValidationError)
        assert error.index == 1
        assert error.describe("skills[1]") == ["skills[1].body is required"]

    def test_a_tool_is_located_without_its_union_tag(self):
        error = _refusal({"tools": [{"type": "builtin"}]})

        assert isinstance(error, ToolConfigurationError)
        assert error.index == 0
        assert error.describe("tools[0]") == ["tools[0].name is required"]

    def test_an_mcp_server(self):
        error = _refusal({"mcps": [{"name": "files"}]})

        assert isinstance(error, MCPConfigurationError)
        assert error.describe("mcps[0]") == ["mcps[0].connection is required"]

    def test_a_refusal_pydantic_did_not_locate_carries_the_message(self):
        error = _refusal({"tools": [42]})

        assert error.issues == ()
        assert error.describe("tools[0]") == [
            "tools[0] is invalid: Tool configuration must be a string or mapping"
        ]

    def test_a_collected_tool_diagnostic_keeps_the_location(self):
        result = coerce_tool_configs([{"type": "builtin"}], on_error="collect")

        (diagnostic,) = result.diagnostics
        assert diagnostic.issues == (
            ConfigIssue(loc=("name",), missing=True, message="Field required"),
        )


class TestTheIssueText:
    def test_a_list_position_inside_the_entry(self):
        issue = ConfigIssue(loc=("files", 0, "path"), missing=False, message="bad")

        assert issue.describe("skills[2]") == "skills[2].files[0].path is invalid: bad"
