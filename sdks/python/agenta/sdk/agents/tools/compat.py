"""Compatibility conversion for legacy playground and persisted tool shapes."""

from __future__ import annotations

from typing import Any, Literal, Optional, Sequence

from pydantic import BaseModel, ConfigDict, Field

from .errors import ToolConfigurationError
from .models import (
    BuiltinToolConfig,
    ClientToolConfig,
    CodeToolConfig,
    GatewayToolConfig,
    ToolConfig,
)
from .parsing import parse_tool_config


class ToolConfigDiagnostic(BaseModel):
    model_config = ConfigDict(frozen=True)

    index: int
    message: str


class ToolConfigParseResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    tool_configs: list[ToolConfig] = Field(default_factory=list)
    diagnostics: list[ToolConfigDiagnostic] = Field(default_factory=list)


def _parse_gateway_slug(slug: Any) -> Optional[dict[str, Any]]:
    if not isinstance(slug, str):
        return None
    parts = slug.replace("__", ".").split(".")
    if len(parts) != 5 or parts[0] != "tools":
        return None
    return {
        "type": "gateway",
        "provider": parts[1],
        "integration": parts[2],
        "action": parts[3],
        "connection": parts[4],
    }


def _copy_tool_metadata(
    source: dict[str, Any], target: dict[str, Any]
) -> dict[str, Any]:
    result = dict(target)
    if "needs_approval" in source:
        # Pass the raw value through; the model's bool field coerces it correctly. Using
        # ``bool(...)`` here would flip legacy string payloads (``"false"`` -> ``True``).
        result["needs_approval"] = source["needs_approval"]
    if isinstance(source.get("render"), dict):
        result["render"] = dict(source["render"])
    return result


def coerce_tool_config(value: Any) -> ToolConfig:
    """Convert one supported legacy shape into canonical tool configuration."""
    if isinstance(
        value,
        (
            BuiltinToolConfig,
            GatewayToolConfig,
            CodeToolConfig,
            ClientToolConfig,
        ),
    ):
        return value
    if isinstance(value, str):
        return BuiltinToolConfig(name=value)
    if not isinstance(value, dict):
        raise ToolConfigurationError(
            "Tool configuration must be a string or mapping",
            value=value,
        )

    data = dict(value)
    if data.get("type") == "composio":
        data["type"] = "gateway"
        data.setdefault("provider", "composio")

    if data.get("type") in {"builtin", "gateway", "code", "client"}:
        return parse_tool_config(data)

    function = data.get("function") if isinstance(data.get("function"), dict) else {}
    gateway = _parse_gateway_slug(function.get("name") or data.get("name"))
    if gateway:
        return parse_tool_config(_copy_tool_metadata(data, gateway))

    if isinstance(data.get("name"), str) and "type" not in data:
        return BuiltinToolConfig(name=data["name"])

    raise ToolConfigurationError("Unsupported tool configuration shape", value=value)


def coerce_tool_configs(
    values: Optional[Sequence[Any]],
    *,
    on_error: Literal["raise", "collect"] = "raise",
) -> ToolConfigParseResult:
    """Convert legacy values, either raising or returning structured diagnostics."""
    if on_error not in {"raise", "collect"}:
        raise ValueError("on_error must be 'raise' or 'collect'")

    tool_configs: list[ToolConfig] = []
    diagnostics: list[ToolConfigDiagnostic] = []
    for index, value in enumerate(values or []):
        if value is None:
            error = ToolConfigurationError(
                "Tool configuration cannot be null",
                index=index,
                value=value,
            )
        else:
            try:
                tool_configs.append(coerce_tool_config(value))
                continue
            except ToolConfigurationError as exc:
                error = ToolConfigurationError(
                    str(exc),
                    index=index,
                    value=value,
                )

        if on_error == "raise":
            raise error
        diagnostics.append(ToolConfigDiagnostic(index=index, message=str(error)))

    return ToolConfigParseResult(
        tool_configs=tool_configs,
        diagnostics=diagnostics,
    )
