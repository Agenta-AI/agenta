"""Strict parsing of MCP server configuration."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from pydantic import ValidationError

from .errors import MCPConfigurationError
from .models import MCPServerConfig


def parse_mcp_server_config(
    value: MCPServerConfig | Mapping[str, Any],
) -> MCPServerConfig:
    try:
        return MCPServerConfig.model_validate(value)
    except ValidationError as exc:
        raise MCPConfigurationError(
            "Invalid MCP server configuration: "
            f"{exc.errors(include_url=False, include_input=False)}",
            value=value,
        ) from exc


def parse_mcp_server_configs(
    values: Sequence[MCPServerConfig | Mapping[str, Any]],
) -> list[MCPServerConfig]:
    parsed: list[MCPServerConfig] = []
    for index, value in enumerate(values):
        try:
            parsed.append(parse_mcp_server_config(value))
        except MCPConfigurationError as exc:
            raise MCPConfigurationError(
                str(exc),
                index=index,
                value=value,
            ) from exc
    return parsed
