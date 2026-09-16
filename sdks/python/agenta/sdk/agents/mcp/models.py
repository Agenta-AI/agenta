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


class MCPGatewayConnection(BaseModel):
    """Select a platform-managed MCP gateway route.

    Gateway routes own their upstream configuration and credentials. The agent
    declares only the public route identity, so upstream URLs and secrets never
    enter the runner configuration.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["gateway"] = "gateway"
    namespace: Literal["builtin", "standard", "custom"]
    provider: Optional[str] = Field(default=None, min_length=1, max_length=128)
    slug: Optional[str] = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def _validate_route_identity(self) -> "MCPGatewayConnection":
        if self.namespace == "custom":
            if not self.slug or self.provider:
                raise ValueError("custom gateway MCP routes require slug only")
        elif not self.provider or self.slug:
            raise ValueError(
                f"{self.namespace} gateway MCP routes require provider only"
            )
        return self


MCPServerConnection = Annotated[
    Union[MCPConnection, MCPGatewayConnection], Field(discriminator="type")
]


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
    """What the agent may do with one connected MCP server.

    Three fields, three different questions, and they are deliberately not collapsed:

    - ``tools`` is a FILTER. It decides which of the server's tools are advertised to the model
      at all. A tool it hides is never offered and never called, so it needs no permission.
    - ``permission`` is the WHOLE-SERVER decision for every advertised tool. It is the field that
      shipped first and it stays the fallback, so a configuration that predates per-tool policy
      behaves exactly as it did.
    - ``tool_permissions`` is the PER-TOOL decision, keyed by the tool name the server itself
      advertises (``echo``), never the harness-rendered name (``mcp__acme-prod__echo``). The
      upstream name is the only spelling every harness agrees on; see OR80 for what happens when a
      lookup is built on a rendered one instead.

    ``new_tool_permission`` answers the question the other three cannot: an MCP server can start
    advertising a tool that did not exist when the agent was configured, and something has to
    decide for it before a human has seen it. Resolution for an advertised tool is
    ``tool_permissions[tool]``, then ``new_tool_permission``.

    Those two fields are an OPT-IN. With neither set, this model emits nothing new and the server
    permission (or, absent that, the run's own default permission ladder) governs exactly as
    before. With either set, the per-tool table is authoritative for this server and the ladder is
    not consulted for it, because a per-tool policy that a run default can widen is not a policy.
    """

    model_config = ConfigDict(extra="forbid")

    tools: MCPToolPolicy = Field(default_factory=MCPToolPolicy)
    permission: Optional[Permission] = None
    tool_permissions: Dict[str, Permission] = Field(default_factory=dict)
    new_tool_permission: Optional[Permission] = None

    def resolved_new_tool_permission(self) -> Optional[Permission]:
        """The decision an advertised tool gets when the table has no entry of its own.

        ``ask`` is the floor rather than "fall through to the run default": a tool nobody has
        looked at yet must reach a human, and a run default of ``allow`` must not silently widen a
        server whose author took the trouble to write a per-tool table. Returns ``None`` when the
        author opted out entirely, which is what keeps an existing configuration unchanged.
        """
        # Either field set is the opt-in; neither set leaves this server on the ladder.
        if not self.tool_permissions and self.new_tool_permission is None:
            return None
        return self.new_tool_permission or self.permission or "ask"

    @model_validator(mode="after")
    def _validate_tool_permissions(self) -> "MCPPolicy":
        for name in self.tool_permissions:
            if not name.strip():
                raise ValueError("MCP tool permissions require non-empty tool names")
        # A permission for a tool the filter hides is dead configuration, and dead permission
        # configuration is precisely the class of defect OR79 records. Refuse it rather than drop
        # it silently: the author either meant to list the tool or meant to permit a different one.
        if self.tools.mode == "include":
            hidden = sorted(set(self.tool_permissions) - set(self.tools.names))
            if hidden:
                raise ValueError(
                    "MCP tool permissions name tools the include filter hides: "
                    f"{', '.join(hidden)}"
                )
        return self


class MCPServerConfig(BaseModel):
    """Saved author intent. This model never contains resolved secret values.

    ``name`` is a LABEL, not an identity. A harness renders this server's tools as
    ``mcp__<name>__<tool>`` and the model chooses a tool by that string, so the name has
    to be stable for the life of the configuration and distinct from every other server
    on the same agent. It is frozen at save: renaming the connection in settings changes
    the settings row and the picker, and deliberately does not reach a saved agent, since
    it would otherwise rename every tool mid-flight and invalidate the permission rules
    rendered against the old names.

    Which connection this server IS lives in ``connection``: a gateway connection carries
    the slug the platform derived once and never changes. A configuration that carries no
    connection reference falls back to matching an endpoint by this name, which is
    deprecated and kept only for revisions already committed; see ``mcp/resolver.py``.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    connection: MCPServerConnection
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
        # camelCase, because the runner protocol is camelCase and the fields that shipped before
        # this one are single words that hid the difference. Emitted only when the author opted
        # into per-tool policy, so an existing configuration produces a byte-identical wire.
        new_tool_permission = self.policy.resolved_new_tool_permission()
        if new_tool_permission is not None:
            wire["policy"]["toolPermissions"] = dict(self.policy.tool_permissions)
            wire["policy"]["newToolPermission"] = new_tool_permission
        return wire
