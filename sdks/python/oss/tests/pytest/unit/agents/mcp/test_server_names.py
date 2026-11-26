from __future__ import annotations

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.mcp import MCPServerConfig


def _config(name: str) -> MCPServerConfig:
    return MCPServerConfig.model_validate(
        {"name": name, "connection": {"type": "http", "url": "https://example.com/mcp"}}
    )


@pytest.mark.parametrize(
    "name", ["agenta-tools", "__proto__", "constructor", "prototype"]
)
def test_reserved_server_names_are_rejected(name):
    with pytest.raises(ValidationError, match=f"MCP server name '{name}' is reserved"):
        _config(name)


@pytest.mark.parametrize("name", ["memory", "proto", "my.constructor", "_prototype"])
def test_ordinary_server_names_are_accepted(name):
    assert _config(name).name == name
