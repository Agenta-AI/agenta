"""Canonical MCP server declarations and resolved runner configuration."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
        return wire
