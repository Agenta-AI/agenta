"""MCP author configuration and resolved runner delivery models."""

from __future__ import annotations

from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)


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

    @model_validator(mode="after")
    def _validate_header_roles(self) -> "MCPConnection":
        secret_refs = (
            self.credentials.headers
            if isinstance(self.credentials, MCPHeaderSecretRefs)
            else {}
        )
        for name, value in {**self.headers, **secret_refs}.items():
            if not name.strip() or not value:
                raise ValueError("MCP bindings require non-empty names and values")
        if {name.lower() for name in self.headers} & {
            name.lower() for name in secret_refs
        }:
            raise ValueError("HTTP MCP public and credential headers must be unique")
        return self


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


class HeaderCredentialBinding(BaseModel):
    kind: Literal["header"] = "header"
    name: str = Field(min_length=1)


class ResolvedMCPCredential(BaseModel):
    binding: HeaderCredentialBinding
    value: str = Field(min_length=1, repr=False)
    usage: Literal["opaque_http"] = "opaque_http"

    @field_serializer("value", when_used="always")
    def _mask_value(self, value: str) -> str:
        """Structural guard (F-SDK-DUMP): a dump can never carry the credential value.

        Attribute access stays plain for the legitimate consumer (:meth:`to_wire`), which
        reads ``self.value`` directly. Mirrors ``ResolvedCredential`` in
        ``connections/models.py``.
        """
        return "**********"

    def to_wire(self) -> Dict[str, Any]:
        return {
            "binding": self.binding.model_dump(),
            "value": self.value,
            "usage": self.usage,
        }


class ResolvedMCPServer(BaseModel):
    """Per-run delivery config.

    Public HTTP headers and secret header credentials stay separate by protocol role:
    ``headers`` carries only public values; each resolved secret rides ``credentials`` as a
    typed header binding whose value must never be logged.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)  # public headers only
    credentials: List[ResolvedMCPCredential] = Field(default_factory=list, repr=False)
    policy: MCPPolicy = Field(default_factory=MCPPolicy)

    @model_validator(mode="after")
    def _validate_header_roles(self) -> "ResolvedMCPServer":
        for name, value in self.headers.items():
            if not name.strip() or not value:
                raise ValueError("MCP bindings require non-empty names and values")
        names = [credential.binding.name.lower() for credential in self.credentials]
        public_names = {name.lower() for name in self.headers}
        if len(names) != len(set(names)) or any(name in public_names for name in names):
            raise ValueError("http MCP header bindings must be unique")
        return self

    def to_wire(self) -> Dict[str, Any]:
        connection: Dict[str, Any] = {
            "type": "http",
            "url": self.url,
        }
        if self.headers:
            connection["headers"] = dict(self.headers)
        if self.credentials:
            connection["credentials"] = [item.to_wire() for item in self.credentials]

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
