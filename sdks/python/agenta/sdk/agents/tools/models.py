"""Canonical tool configuration and resolved runtime specifications."""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    field_validator,
    model_validator,
)


def _empty_object_schema() -> Dict[str, Any]:
    return {"type": "object", "properties": {}}


# Layer-3 per-tool permission: ``allow`` runs with no prompt, ``ask`` raises a
# human-in-the-loop request, ``deny`` never runs. Absent means "fall back to the global
# ``permissionPolicy`` default" (the runner resolves that, in a later slice).
Permission = Literal["allow", "ask", "deny"]


class ToolConfigBase(BaseModel):
    """Fields shared by every persisted tool declaration."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    needs_approval: bool = False
    render: Optional[Dict[str, Any]] = None
    # Layer-3 permission the author set on this tool. Mirrors
    # ``ToolSpecBase.permission``: accepts ``permission_mode``/``permissionMode`` too (the keys
    # the playground writes), so an FE-set value deserializes onto the ``extra="forbid"`` config
    # without a breaking change. ``_apply_tool_metadata`` then carries it onto the resolved spec.
    permission: Optional[Permission] = Field(
        default=None,
        validation_alias=AliasChoices(
            "permission", "permission_mode", "permissionMode"
        ),
        serialization_alias="permission",
    )


class BuiltinToolConfig(ToolConfigBase):
    type: Literal["builtin"] = "builtin"
    name: str = Field(min_length=1)


class GatewayToolConfig(ToolConfigBase):
    type: Literal["gateway"] = "gateway"
    provider: str = Field(default="composio", min_length=1)
    integration: str = Field(min_length=1)
    action: str = Field(min_length=1)
    connection: str = Field(min_length=1)
    name: Optional[str] = Field(default=None, min_length=1)

    @property
    def reference(self) -> str:
        return (
            f"tools.{self.provider}.{self.integration}.{self.action}.{self.connection}"
        )


class CodeToolConfig(ToolConfigBase):
    type: Literal["code"] = "code"
    name: str = Field(min_length=1)
    description: Optional[str] = None
    runtime: Literal["python", "node"] = "python"
    script: str = Field(min_length=1)
    input_schema: Dict[str, Any] = Field(default_factory=_empty_object_schema)
    secrets: List[str] = Field(default_factory=list)


class ClientToolConfig(ToolConfigBase):
    type: Literal["client"] = "client"
    name: str = Field(min_length=1)
    description: Optional[str] = None
    input_schema: Dict[str, Any] = Field(default_factory=_empty_object_schema)


# Which axis selects the referenced workflow revision. ``variant`` resolves the workflow by slug
# (latest revision, or a pinned ``version``); ``environment`` resolves whatever revision is
# deployed in a named environment.
ReferenceAxis = Literal["variant", "environment"]


class ReferenceToolConfig(ToolConfigBase):
    """A workflow referenced as a tool (the ``type:"reference"`` config).

    ``type`` is the synthetic discriminator ``"reference"`` so this arm lives in the canonical
    ``ToolConfig`` union; it is NOT a Composio-style declared variant (no provider/integration/
    action). The author points at a workflow on one of two axes:

    - ``ref_by="variant"`` — by workflow ``slug``; takes the latest revision, or pins one via
      ``version``.
    - ``ref_by="environment"`` — by ``environment`` slug; takes whatever revision is deployed in
      that environment for the workflow ``slug`` (``version`` is not allowed, the environment is
      the pin).

    The model-facing surface (``name`` / ``description`` / ``input_schema``) is authored.
    ``resolve_tools`` turns it into a ``CallbackToolSpec`` whose ``call_ref`` encodes the axis +
    identity; the runner dispatches the call through the existing ``callback`` executor and the
    Agenta service runs the workflow revision server-side. Connections/secrets the workflow needs
    stay server-side."""

    type: Literal["reference"] = "reference"
    ref_by: ReferenceAxis = Field(
        default="variant",
        description=(
            "Which axis selects the workflow revision: 'variant' (by workflow slug; latest or a "
            "pinned version) or 'environment' (whatever is deployed in `environment`)."
        ),
    )
    slug: str = Field(
        min_length=1,
        description="The workflow slug to reference.",
    )
    environment: Optional[str] = Field(
        default=None,
        min_length=1,
        description="Environment slug; required when ref_by == 'environment'.",
    )
    version: Optional[str] = Field(
        default=None,
        description="Pin a workflow revision (ref_by='variant' only); absent = latest.",
    )
    name: Optional[str] = Field(default=None, min_length=1)
    description: Optional[str] = None
    input_schema: Dict[str, Any] = Field(default_factory=_empty_object_schema)

    @model_validator(mode="after")
    def _check_axis(self) -> "ReferenceToolConfig":
        if self.ref_by == "environment":
            if not self.environment:
                raise ValueError(
                    "reference tool with ref_by='environment' requires `environment` "
                    "(the environment slug)"
                )
            if self.version is not None:
                raise ValueError(
                    "reference tool with ref_by='environment' must not set `version`; the "
                    "environment selects the deployed revision"
                )
        elif self.environment is not None:
            raise ValueError(
                "reference tool with ref_by='variant' must not set `environment`"
            )
        return self

    @property
    def tool_name(self) -> str:
        """The model-visible name; defaults to the workflow slug when none is authored."""
        return self.name or self.slug

    @property
    def call_ref(self) -> str:
        """The opaque ``workflow.{axis}.*`` callback identity the server-side ``/tools/call``
        parser routes by the ``workflow.`` prefix:

        - variant:     ``workflow.variant.{slug}`` or ``workflow.variant.{slug}.{version}``
        - environment: ``workflow.environment.{environment}.{slug}``

        Distinct from the Composio 5-segment grammar (``tools.{provider}.{integration}.
        {action}.{connection}``). The runner treats this as opaque."""
        if self.ref_by == "environment":
            return f"workflow.environment.{self.environment}.{self.slug}"
        if self.version:
            return f"workflow.variant.{self.slug}.{self.version}"
        return f"workflow.variant.{self.slug}"


ToolConfig = Annotated[
    Union[
        BuiltinToolConfig,
        GatewayToolConfig,
        CodeToolConfig,
        ClientToolConfig,
        ReferenceToolConfig,
    ],
    Field(discriminator="type"),
]
TOOL_CONFIG_ADAPTER: TypeAdapter[ToolConfig] = TypeAdapter(ToolConfig)


class ToolCallback(BaseModel):
    """Where callback tool calls are sent."""

    model_config = ConfigDict(frozen=True)

    endpoint: str
    authorization: Optional[str] = Field(default=None, repr=False)

    def to_wire(self) -> Dict[str, Any]:
        return {
            "endpoint": self.endpoint,
            "authorization": self.authorization,
        }


class ToolSpecBase(BaseModel):
    """Fields shared by every resolved, runner-ready tool specification."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )

    name: str
    description: str
    input_schema: Dict[str, Any] = Field(
        default_factory=_empty_object_schema,
        validation_alias=AliasChoices("input_schema", "inputSchema"),
        serialization_alias="inputSchema",
    )
    needs_approval: bool = Field(
        default=False,
        validation_alias=AliasChoices("needs_approval", "needsApproval"),
        serialization_alias="needsApproval",
    )
    render: Optional[Dict[str, Any]] = None
    read_only: Optional[bool] = Field(
        default=None,
        validation_alias=AliasChoices("read_only", "readOnly"),
        serialization_alias="readOnly",
    )
    # Layer-3 permission the author set on this tool. Accepts ``permission_mode``
    # too, the key the playground writes into ``agenta_metadata``, so an FE-set value
    # deserializes without a later breaking change. Unset means "no explicit author choice";
    # ``effective_permission`` then derives a default from ``read_only`` / ``needs_approval``.
    permission: Optional[Permission] = Field(
        default=None,
        validation_alias=AliasChoices(
            "permission", "permission_mode", "permissionMode"
        ),
        serialization_alias="permission",
    )

    def effective_permission(self) -> Optional[Permission]:
        """Resolve the permission that rides the wire, by this precedence:

        1. An explicit author ``permission`` wins outright.
        2. Else, when ``needs_approval`` is set, the default is ``"ask"`` (approval beats the
           read-only auto-allow: an author who asked to be prompted still gets prompted).
        3. Else, default from ``read_only``: ``True`` -> ``"allow"`` (read-only tools are safe to
           auto-run), ``False`` -> ``"ask"`` (mutating tools prompt).
        4. Else (``read_only`` is ``None`` and nothing explicit) -> ``None`` (unset), so the runner
           falls back to the global ``permissionPolicy`` default in a later slice.
        """
        if self.permission is not None:
            return self.permission
        if self.needs_approval:
            return "ask"
        if self.read_only is True:
            return "allow"
        if self.read_only is False:
            return "ask"
        return None

    def to_wire(self) -> Dict[str, Any]:
        wire = self.model_dump(
            mode="json",
            by_alias=True,
            exclude_none=True,
        )
        if not self.needs_approval:
            wire.pop("needsApproval", None)
        if not wire.get("env"):
            wire.pop("env", None)
        permission = self.effective_permission()
        if permission is not None:
            wire["permission"] = permission
        else:
            wire.pop("permission", None)
        return wire


class CallbackToolSpec(ToolSpecBase):
    kind: Literal["callback"] = "callback"
    call_ref: str = Field(
        validation_alias=AliasChoices("call_ref", "callRef"),
        serialization_alias="callRef",
    )


class CodeToolSpec(ToolSpecBase):
    kind: Literal["code"] = "code"
    runtime: Literal["python", "node"] = "python"
    code: str
    env: Dict[str, str] = Field(default_factory=dict, repr=False)


class ClientToolSpec(ToolSpecBase):
    kind: Literal["client"] = "client"


ToolSpec = Annotated[
    Union[CallbackToolSpec, CodeToolSpec, ClientToolSpec],
    Field(discriminator="kind"),
]
TOOL_SPEC_ADAPTER: TypeAdapter[ToolSpec] = TypeAdapter(ToolSpec)


def coerce_tool_spec(value: Any) -> ToolSpec:
    if isinstance(value, (CallbackToolSpec, CodeToolSpec, ClientToolSpec)):
        return value
    if not isinstance(value, dict):
        raise TypeError("tool spec must be a mapping")
    data = dict(value)
    if not data.get("kind"):
        if data.get("callRef") or data.get("call_ref"):
            data["kind"] = "callback"
        elif data.get("code") is not None:
            data["kind"] = "code"
        else:
            data["kind"] = "client"
    name = data.get("name")
    data.setdefault("description", name)
    data.setdefault("inputSchema", _empty_object_schema())
    return TOOL_SPEC_ADAPTER.validate_python(data)


class MissingSecretPolicy(str, Enum):
    ERROR = "error"
    OMIT = "omit"


class ResolvedToolSet(BaseModel):
    """Resolved tools ready to attach to a session."""

    model_config = ConfigDict(
        frozen=True,
        populate_by_name=True,
    )

    builtin_names: List[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("builtin_names", "builtin_tools"),
    )
    tool_specs: List[ToolSpec] = Field(
        default_factory=list,
        validation_alias=AliasChoices("tool_specs", "custom_tools"),
    )
    tool_callback: Optional[ToolCallback] = None

    @field_validator("tool_specs", mode="before")
    @classmethod
    def _coerce_specs(cls, value: Any) -> List[ToolSpec]:
        return [coerce_tool_spec(item) for item in value or []]

    @property
    def builtin_tools(self) -> List[str]:
        """Compatibility alias for the previous field name."""
        return list(self.builtin_names)

    @property
    def custom_tools(self) -> List[Dict[str, Any]]:
        """Compatibility wire dictionaries for callers not yet using typed specs."""
        return [spec.to_wire() for spec in self.tool_specs]


class GatewayToolResolution(BaseModel):
    """Result returned by an injected gateway adapter."""

    model_config = ConfigDict(frozen=True)

    tool_specs: List[CallbackToolSpec] = Field(default_factory=list)
    tool_callback: ToolCallback
