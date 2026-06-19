"""Strict parsing of canonical tool configuration."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from pydantic import ValidationError

from .errors import ToolConfigurationError
from .models import TOOL_CONFIG_ADAPTER, ToolConfig


def parse_tool_config(value: ToolConfig | Mapping[str, Any]) -> ToolConfig:
    """Parse one canonical tool mapping, rejecting legacy and unexpected fields."""
    try:
        return TOOL_CONFIG_ADAPTER.validate_python(value)
    except ValidationError as exc:
        raise ToolConfigurationError(
            "Invalid tool configuration: "
            f"{exc.errors(include_url=False, include_input=False)}",
            value=value,
        ) from exc


def parse_tool_configs(
    values: Sequence[ToolConfig | Mapping[str, Any]],
) -> list[ToolConfig]:
    """Parse canonical tool mappings and report the failing item index."""
    parsed: list[ToolConfig] = []
    for index, value in enumerate(values):
        try:
            parsed.append(parse_tool_config(value))
        except ToolConfigurationError as exc:
            raise ToolConfigurationError(
                str(exc),
                index=index,
                value=value,
            ) from exc
    return parsed
