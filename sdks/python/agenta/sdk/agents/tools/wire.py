"""Serialization of resolved tool specifications to the runner contract."""

from __future__ import annotations

from typing import Any, Dict, Sequence

from .models import ToolSpec


def tool_spec_to_wire(tool_spec: ToolSpec) -> Dict[str, Any]:
    return tool_spec.to_wire()


def tool_specs_to_wire(tool_specs: Sequence[ToolSpec]) -> list[Dict[str, Any]]:
    return [tool_spec_to_wire(tool_spec) for tool_spec in tool_specs]
