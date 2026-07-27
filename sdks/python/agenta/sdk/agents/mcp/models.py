"""MCP author configuration and resolved runner delivery models."""

from __future__ import annotations

from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Permission = Literal["allow", "ask", "deny"]


class NoMCPCredentials(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["none"] = "none"


class MCPHeaderSecretRefs(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["header_secret_refs"] = "header_secret_refs"
    headers: Dict[str, str] = Field(default_factory=dict)


MCPCredentials = Annotated[
    Union[NoMCPCredentials, MCPHeaderSecretRefs],
    Field(discriminator="type"),
]


class MCPConnection(BaseModel):
    """How Agenta reaches one external MCP server."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["http"] = "http"
    url: str = Field(min_length=1)
    headers: Dict[str, str] = Field(default_factory=dict)
    credentials: MCPCredentials = Field(default_factory=NoMCPCredentials)


class MCPToolPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["all", "include"] = "all"
    names: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_names(self) -> "MCPToolPolicy":
        if self.mode == "all" and self.names:
            raise ValueError("MCP tool policy mode 'all' must not declare names")
        if self.mode == "include" and not self.names:
            raise ValueError("MCP tool policy mode 'include' requires names")
        return self


class MCPPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tools: MCPToolPolicy = Field(default_factory=MCPToolPolicy)
    permission: Optional[Permission] = None


class MCPServerConfig(BaseModel):
    """Saved author intent. This model never contains resolved secret values."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    connection: MCPConnection
    policy: MCPPolicy = Field(default_factory=MCPPolicy)

    @field_validator("name")
    @classmethod
    def _reject_reserved_name(cls, value: str) -> str:
        if value == "agenta-tools":
            raise ValueError("MCP server name 'agenta-tools' is reserved")
        return value


class ResolvedMCPServer(BaseModel):
    """Per-run delivery config. Headers may contain resolved secret values."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    url: str
    headers: Dict[str, str] = Field(default_factory=dict, repr=False)
    policy: MCPPolicy = Field(default_factory=MCPPolicy)

    def to_wire(self) -> Dict[str, Any]:
        connection: Dict[str, Any] = {
            "type": "http",
            "url": self.url,
        }
        if self.headers:
            connection["headers"] = dict(self.headers)

        wire: Dict[str, Any] = {
            "name": self.name,
            "connection": connection,
            "policy": {
                "tools": self.policy.tools.model_dump(exclude_defaults=True)
                or {"mode": "all"},
            },
        }
        if self.policy.permission is not None:
            wire["policy"]["permission"] = self.policy.permission
        return wire
