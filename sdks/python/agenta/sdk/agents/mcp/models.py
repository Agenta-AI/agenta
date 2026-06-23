"""Canonical MCP server declarations and resolved runner configuration."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


# Layer-3 per-server permission disposition (same value set as a tool's): ``allow`` runs with
# no prompt, ``ask`` raises a human-in-the-loop request, ``deny`` never runs. Absent means the
# runner falls back to the global ``permissionPolicy`` default. An MCP server carries no
# ``read_only`` hint, so there is no default to compute: an explicit author value or nothing.
Disposition = Literal["allow", "ask", "deny"]


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
    disposition: Optional[Disposition] = Field(
        default=None,
        validation_alias=AliasChoices(
            "disposition", "permission_mode", "permissionMode"
        ),
    )

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
    disposition: Optional[Disposition] = None

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
        if self.disposition is not None:
            wire["disposition"] = self.disposition
        return wire
