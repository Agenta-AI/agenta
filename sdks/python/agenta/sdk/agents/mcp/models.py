"""Canonical MCP server declarations and resolved runner configuration."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


# Layer-3 per-server permission (same value set as a tool's): ``allow`` runs with
# no prompt, ``ask`` raises a human-in-the-loop request, ``deny`` never runs. Absent means the
# server inherits the runner policy.
Permission = Literal["allow", "ask", "deny"]

_LEGACY_PERMISSION_KEYS = frozenset({"permission" + "_mode", "permission" + "Mode"})


def _drop_legacy_permission_keys(data: Any) -> Any:
    if isinstance(data, dict):
        return {
            key: value
            for key, value in data.items()
            if key not in _LEGACY_PERMISSION_KEYS
        }
    return data


class MCPServerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    transport: Literal["stdio", "http"] = "stdio"
    command: Optional[str] = None
    args: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict, repr=False)
    url: Optional[str] = None
    secrets: Dict[str, str] = Field(default_factory=dict)
    tools: List[str] = Field(default_factory=list)
    permission: Optional[Permission] = None

    @model_validator(mode="before")
    @classmethod
    def _ignore_legacy_permission_keys(cls, data: Any) -> Any:
        return _drop_legacy_permission_keys(data)

    @model_validator(mode="after")
    def _validate_transport(self) -> "MCPServerConfig":
        if self.transport == "stdio" and not self.command:
            raise ValueError("stdio MCP server requires command")
        if self.transport == "http" and not self.url:
            raise ValueError("http MCP server requires url")
        return self


class ResolvedMCPServer(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    transport: Literal["stdio", "http"] = "stdio"
    command: Optional[str] = None
    args: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict, repr=False)
    url: Optional[str] = None
    tools: List[str] = Field(default_factory=list)
    permission: Optional[Permission] = None

    @model_validator(mode="after")
    def _validate_transport(self) -> "ResolvedMCPServer":
        if self.transport == "stdio" and not self.command:
            raise ValueError("stdio MCP server requires command")
        if self.transport == "http" and not self.url:
            raise ValueError("http MCP server requires url")
        return self

    def to_wire(self) -> Dict[str, Any]:
        wire: Dict[str, Any] = {
            "name": self.name,
            "transport": self.transport,
        }
        if self.command:
            wire["command"] = self.command
        if self.args:
            wire["args"] = list(self.args)
        if self.env:
            wire["env"] = dict(self.env)
        if self.url:
            wire["url"] = self.url
        if self.tools:
            wire["tools"] = list(self.tools)
        if self.permission is not None:
            wire["permission"] = self.permission
        return wire
