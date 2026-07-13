"""Canonical MCP server declarations and resolved runner configuration."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, model_validator


# Layer-3 per-server permission (same value set as a tool's): ``allow`` runs with
# no prompt, ``ask`` raises a human-in-the-loop request, ``deny`` never runs. Absent means the
# server inherits the runner policy.
Permission = Literal["allow", "ask", "deny"]

# The deleted pre-redesign vocabulary, still present in old dev-DB drafts. Literal on
# purpose so the legacy spelling stays greppable.
_LEGACY_PERMISSION_KEYS = frozenset({"permission_mode", "permissionMode"})


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
    env: Dict[str, str] = Field(default_factory=dict)
    url: Optional[str] = None
    headers: Dict[str, str] = Field(default_factory=dict)
    # HTTP header name -> named secret reference. References never cross the runner wire.
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
        for name, value in {**self.env, **self.headers, **self.secrets}.items():
            if not name.strip() or not value:
                raise ValueError("MCP bindings require non-empty names and values")
        if {name.lower() for name in self.headers} & {
            name.lower() for name in self.secrets
        }:
            raise ValueError("HTTP MCP public and credential headers must be unique")
        if self.transport == "http":
            if not self.url:
                raise ValueError("http MCP server requires url")
            parsed = urlparse(self.url)
            if parsed.scheme.lower() != "https" or not parsed.hostname:
                raise ValueError("http MCP server requires an absolute HTTPS url")
            if self.env:
                raise ValueError(
                    "http MCP server environment is invalid; use headers for public values"
                )
        elif self.headers or self.secrets:
            raise ValueError(
                "stdio MCP header credentials are unsupported; use an HTTP MCP server"
            )
        return self


class HeaderCredentialBinding(BaseModel):
    kind: Literal["header"] = "header"
    name: str = Field(min_length=1)


class ResolvedMCPCredential(BaseModel):
    binding: HeaderCredentialBinding
    value: str = Field(min_length=1, repr=False)
    usage: Literal["opaque_http"] = "opaque_http"

    def to_wire(self) -> Dict[str, Any]:
        return {
            "binding": self.binding.model_dump(),
            "value": self.value,
            "usage": self.usage,
        }


class ResolvedMCPServer(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    transport: Literal["stdio", "http"] = "stdio"
    command: Optional[str] = None
    args: List[str] = Field(default_factory=list)
    environment: Dict[str, str] = Field(default_factory=dict)
    url: Optional[str] = None
    headers: Dict[str, str] = Field(default_factory=dict)
    credentials: List[ResolvedMCPCredential] = Field(default_factory=list, repr=False)
    tools: List[str] = Field(default_factory=list)
    permission: Optional[Permission] = None

    @model_validator(mode="after")
    def _validate_transport(self) -> "ResolvedMCPServer":
        if self.transport == "stdio" and not self.command:
            raise ValueError("stdio MCP server requires command")
        for name, value in {**self.environment, **self.headers}.items():
            if not name.strip() or not value:
                raise ValueError("MCP bindings require non-empty names and values")
        if self.transport == "http":
            if not self.url:
                raise ValueError("http MCP server requires url")
            parsed = urlparse(self.url)
            if parsed.scheme.lower() != "https" or not parsed.hostname:
                raise ValueError("http MCP server requires an absolute HTTPS url")
            if self.environment:
                raise ValueError("http MCP server cannot carry process environment")
            names = [credential.binding.name.lower() for credential in self.credentials]
            public_names = {name.lower() for name in self.headers}
            if len(names) != len(set(names)) or any(
                name in public_names for name in names
            ):
                raise ValueError("http MCP header bindings must be unique")
        elif self.headers or self.credentials:
            raise ValueError("stdio MCP server cannot carry HTTP headers")
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
        if self.environment:
            wire["environment"] = dict(self.environment)
        if self.headers:
            wire["headers"] = dict(self.headers)
        if self.credentials:
            wire["credentials"] = [item.to_wire() for item in self.credentials]
        if self.url:
            wire["url"] = self.url
        if self.tools:
            wire["tools"] = list(self.tools)
        if self.permission is not None:
            wire["permission"] = self.permission
        return wire
