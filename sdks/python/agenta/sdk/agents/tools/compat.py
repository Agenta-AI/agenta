"""Compatibility conversion for legacy playground and persisted tool shapes."""

from __future__ import annotations

from typing import Any, Literal, Optional, Sequence

from pydantic import BaseModel, ConfigDict, Field

from .errors import ToolConfigurationError
from .models import (
    AG_REFERENCE_MARKER,
    BuiltinToolConfig,
    ClientToolConfig,
    CodeToolConfig,
    GatewayToolConfig,
    ReferenceToolConfig,
    ToolConfig,
)
from .parsing import parse_tool_config

_AG_REFERENCES_KEY = "@ag.references"


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
    # Layer-3 permission: accept any of the keys the FE may write (the playground used
    # ``permission_mode``); the config model's ``Permission`` field validates the value.
    for key in ("permission", "permission_mode", "permissionMode"):
        if key in source:
            result["permission"] = source[key]
            break
    return result


def _parse_workflow_reference(refs: Any) -> Optional[dict[str, Any]]:
    """Pull a ``{slug, version}`` from an ``@ag.references`` block keyed by ``workflow``.

    Mirrors the ``@ag.embed`` target-naming: an artifact-level ``workflow`` reference resolves to
    the latest revision. A ``workflow_revision`` slug matches the revision's hash slug, not the
    author-facing artifact slug, so the artifact ``workflow`` key is the supported shape (same
    gotcha skills have). Returns ``None`` when no workflow reference is present."""
    if not isinstance(refs, dict):
        return None
    workflow = refs.get("workflow")
    if not isinstance(workflow, dict):
        return None
    slug = workflow.get("slug")
    if not isinstance(slug, str) or not slug:
        return None
    parsed: dict[str, Any] = {"slug": slug}
    version = workflow.get("version")
    if version is not None:
        parsed["version"] = str(version)
    return parsed


def _coerce_reference_tool(data: dict[str, Any]) -> Optional[ToolConfig]:
    """Build a :class:`ReferenceToolConfig` from a kept ``@ag.reference`` marker dict.

    The author commits ``{"@ag.reference": {"@ag.references": {"workflow": {"slug": ...}}}, ...}``
    (the same inner target-naming as ``@ag.embed``, differing only in leave-vs-inline). The
    model-facing surface (``name`` / ``description`` / ``input_schema``) rides as sibling keys of
    the marker. Returns ``None`` when the marker is absent so other shapes fall through."""
    marker = data.get(AG_REFERENCE_MARKER)
    if not isinstance(marker, dict):
        return None
    workflow_ref = _parse_workflow_reference(marker.get(_AG_REFERENCES_KEY))
    if workflow_ref is None:
        raise ToolConfigurationError(
            f"{AG_REFERENCE_MARKER} tool requires a workflow reference "
            f"({_AG_REFERENCES_KEY}.workflow.slug)",
            value=data,
        )
    config: dict[str, Any] = {"type": "reference", **workflow_ref}
    for key in ("name", "description", "input_schema"):
        if data.get(key) is not None:
            config[key] = data[key]
    return parse_tool_config(_copy_tool_metadata(data, config))


def coerce_tool_config(value: Any) -> ToolConfig:
    """Convert one supported legacy shape into canonical tool configuration."""
    if isinstance(
        value,
        (
            BuiltinToolConfig,
            GatewayToolConfig,
            CodeToolConfig,
            ClientToolConfig,
            ReferenceToolConfig,
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

    reference_config = _coerce_reference_tool(data)
    if reference_config is not None:
        return reference_config

    if data.get("type") in {"builtin", "gateway", "code", "client", "reference"}:
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
