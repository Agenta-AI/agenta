"""Canonical tool configuration and resolved runtime specifications."""

from __future__ import annotations

import re
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
# human-in-the-loop request, ``deny`` never runs. Absent means "inherit the runner policy".
Permission = Literal["allow", "ask", "deny"]
PermissionMode = Literal["allow", "ask", "deny", "allow_reads"]

# The deleted pre-redesign vocabulary, still present in old dev-DB drafts. These literals
# are the only place the SDK may spell them.
_LEGACY_PERMISSION_KEYS = frozenset(
    {
        "needs_approval",
        "needsApproval",
        "permission_mode",
        "permissionMode",
    }
)


def _drop_legacy_permission_keys(data: Any) -> Any:
    # Old POC drafts can still be present in dev DBs; tolerate and ignore them.
    if isinstance(data, dict):
        return {
            key: value
            for key, value in data.items()
            if key not in _LEGACY_PERMISSION_KEYS
        }
    return data


def effective_permission(
    spec_permission: Optional[Permission],
    read_only: Optional[bool],
    mode: PermissionMode,
) -> Permission:
    """Resolve the runner permission semantics for one tool gate."""
    if spec_permission is not None:
        return spec_permission
    if mode == "allow_reads":
        return "allow" if read_only is True else "ask"
    return mode


class ToolConfigBase(BaseModel):
    """Fields shared by every persisted tool declaration."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    render: Optional[Dict[str, Any]] = None
    permission: Optional[Permission] = None

    @model_validator(mode="before")
    @classmethod
    def _ignore_legacy_permission_keys(cls, data: Any) -> Any:
        return _drop_legacy_permission_keys(data)


class BuiltinToolConfig(ToolConfigBase):
    """Legacy entry, accepted so revisions written before the rework still parse.

    Built-in tools are always active and are no longer configured here; the resolver drops
    every entry with a warning. Keep this arm until the dual-read window closes.
    """

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


# A per-connection tool config resolves into TWO runtime tools — a search tool and a
# run tool — instead of one tool per action. The old per-action ``gateway`` type above
# stays for backward compatibility; this type uses a distinct ``gateway_toolkit``
# discriminator so old configs keep parsing. See
# docs/design/composio-tools-rework/{design,api-design}.md.

# A connection slug or integration key. It must stay dot-free so it can ride a
# dot-separated ``call_ref`` without ambiguity (the run/search call_ref splits on ``.``).
_SLUG_FIELD_RE = r"^[A-Za-z0-9_-]+$"
# A provider action slug (e.g. ``GITHUB_CREATE_AN_ISSUE``). Dot-free for the same reason.
_ACTION_SLUG_RE = r"^[A-Za-z0-9_]+$"


class ToolkitPolicy(BaseModel):
    """Which actions of a connection the agent may run.

    ``all`` allows every action of the toolkit. ``include`` allows only the listed
    action slugs; the server rejects any other slug at run time.
    """

    model_config = ConfigDict(extra="forbid")

    mode: Literal["all", "include"] = "all"
    actions: Optional[List[str]] = None

    @field_validator("actions")
    @classmethod
    def _check_action_slugs(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return value
        for action in value:
            if not re.fullmatch(_ACTION_SLUG_RE, action):
                raise ValueError(
                    f"invalid action slug {action!r}; expected characters [A-Za-z0-9_]"
                )
        return value

    @model_validator(mode="after")
    def _check_include_has_actions(self) -> "ToolkitPolicy":
        if self.mode == "include" and not self.actions:
            raise ValueError("a toolkit policy with mode='include' needs `actions`")
        if self.mode == "all" and self.actions:
            raise ValueError("a toolkit policy with mode='all' must not set `actions`")
        return self


class GatewayToolkitConfig(ToolConfigBase):
    """A whole gateway connection exposed to the agent as a search tool and a run tool.

    One entry names the integration and the connection and says which actions are
    allowed. At resolve time it becomes two callback tools (``search`` and ``run``); the
    per-action Composio calls happen only when the model calls ``run``. The connection's
    secret stays server-side; only the connection slug is stored here.
    """

    type: Literal["gateway_toolkit"] = "gateway_toolkit"
    provider: str = Field(default="composio", min_length=1, pattern=_SLUG_FIELD_RE)
    integration: str = Field(min_length=1, pattern=_SLUG_FIELD_RE)
    connection: str = Field(min_length=1, pattern=_SLUG_FIELD_RE)
    tools: ToolkitPolicy = Field(default_factory=ToolkitPolicy)

    @property
    def search_call_ref(self) -> str:
        """The opaque ``toolkit.{provider}.{integration}.{connection}.search`` callback the
        server-side ``/tools/call`` parser routes by the ``toolkit.`` prefix."""
        return f"toolkit.{self.provider}.{self.integration}.{self.connection}.search"

    @property
    def run_call_ref(self) -> str:
        """The opaque run callback. It carries the policy so the server can enforce it
        without the config: ``...run.all`` allows every slug; ``...run.include.<SLUG>...``
        allows only the listed slugs."""
        base = f"toolkit.{self.provider}.{self.integration}.{self.connection}.run"
        if self.tools.mode == "include" and self.tools.actions:
            return base + ".include." + ".".join(self.tools.actions)
        return base + ".all"


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


class PlatformToolConfig(ToolConfigBase):
    """An existing Agenta endpoint exposed to the agent as a tool (the ``type:"platform"`` config).

    A platform tool is a thin wrapper over an EXISTING Agenta endpoint. The author names which
    endpoint to expose via ``op``; the catalog owns the description, endpoint, request schema,
    self-targeting context bindings, and the ``read_only`` hint.

    ``resolve_tools`` turns it into a ``CallbackToolSpec`` carrying a direct ``call`` descriptor
    (not a ``call_ref``): the runner calls the existing endpoint directly with the run's caller
    credential, no ``/tools/call`` hop."""

    type: Literal["platform"] = "platform"
    op: str = Field(
        min_length=1,
        description="Which catalog op (existing endpoint) to expose, e.g. 'discover_tools'.",
    )


ToolConfig = Annotated[
    Union[
        BuiltinToolConfig,
        GatewayToolConfig,
        GatewayToolkitConfig,
        CodeToolConfig,
        ClientToolConfig,
        ReferenceToolConfig,
        PlatformToolConfig,
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
    render: Optional[Dict[str, Any]] = None
    read_only: Optional[bool] = Field(
        default=None,
        validation_alias=AliasChoices("read_only", "readOnly"),
        serialization_alias="readOnly",
    )
    permission: Optional[Permission] = None

    @model_validator(mode="before")
    @classmethod
    def _ignore_legacy_permission_keys(cls, data: Any) -> Any:
        return _drop_legacy_permission_keys(data)

    def effective_permission(self) -> Optional[Permission]:
        """Return only the author's explicit permission, if one was set."""
        return self.permission

    def to_wire(self) -> Dict[str, Any]:
        wire = self.model_dump(
            mode="json",
            by_alias=True,
            exclude_none=True,
        )
        if not wire.get("env"):
            wire.pop("env", None)
        return wire


class ToolCall(BaseModel):
    """The direct-call descriptor on a resolved callback tool (direct-call tools, Phase 1).

    When a resolved :class:`CallbackToolSpec` carries ``call`` the runner dispatches the tool by
    calling this Agenta endpoint DIRECTLY (reusing the run's single ``toolCallback.authorization``)
    instead of routing through the shared ``/tools/call`` gateway. A spec carries ``call`` (direct)
    XOR ``call_ref`` (gateway), never both.

    - ``method`` is restricted to ``GET`` / ``POST`` / ``PUT`` / ``DELETE`` (the runner is a
      constrained dispatcher, never an arbitrary HTTP client).
    - ``path`` is an absolute path from the Agenta ORIGIN; the runner derives that origin from the
      run's ``toolCallback.endpoint``, so a tool can never reach a non-Agenta host.
    - ``body`` holds static, server-fixed fields baked at resolve time (e.g. a reference tool's
      resolved ``workflow_revision`` id).
    - ``context`` maps a dotted body path to a ``"$ctx.<run-context-key>"`` token the runner fills
      from the run's context at dispatch (e.g. a self-targeting variant/trace id).
    - ``args_into`` is the dotted path where the model's arguments are placed (absent = the body
      root).

    Plumbing only in this phase: the field rides the wire and round-trips, but no resolver emits it
    and no dispatch reads it yet (see the direct-call-tools project plan, Phase 1). The body-merge
    rules (args -> ``body`` -> ``context``, context last) and SSRF guardrails land in later phases.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    method: Literal["GET", "POST", "PUT", "DELETE"]
    path: str = Field(min_length=1)
    body: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, str]] = None
    args_into: Optional[str] = None


class CallbackToolSpec(ToolSpecBase):
    kind: Literal["callback"] = "callback"
    # Gateway target (the slug the runner sends back to ``/tools/call``). Optional now that a
    # callback spec can instead carry a direct ``call`` descriptor; a spec carries ``call_ref``
    # (gateway) XOR ``call`` (direct). Every producer today still sets ``call_ref``, so existing
    # specs and the golden wire are unchanged.
    call_ref: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("call_ref", "callRef"),
        serialization_alias="callRef",
    )
    # Direct-call descriptor (direct-call tools, Phase 1). When set the runner calls the endpoint
    # directly instead of the gateway. Plumbing only: nothing emits or dispatches it yet.
    call: Optional[ToolCall] = None
    # Handler-mode callback specs use the same gateway executor as `call_ref`, but carry run-context
    # bindings at the spec level so the relay can inject them before posting to `/tools/call`.
    context_bindings: Optional[Dict[str, str]] = Field(
        default=None,
        validation_alias=AliasChoices("context_bindings", "contextBindings"),
        serialization_alias="contextBindings",
    )
    timeout_ms: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("timeout_ms", "timeoutMs"),
        serialization_alias="timeoutMs",
    )
    # Top-level argument names the model may write but the request must NOT carry. The runner
    # deletes them from the model's arguments before it builds either request, so the field
    # reaches the human (the recorded call keeps it) and never reaches the API. This is how the
    # ephemeral per-call ``description`` rides a builder tool call without any endpoint schema
    # change. Executor-private, like ``context_bindings``: the child harness never sees it.
    ephemeral_args: Optional[List[str]] = Field(
        default=None,
        validation_alias=AliasChoices("ephemeral_args", "ephemeralArgs"),
        serialization_alias="ephemeralArgs",
    )

    @model_validator(mode="after")
    def _check_call_target(self) -> "CallbackToolSpec":
        # A callback tool must have exactly one place to call: the gateway slug (``call_ref``) or
        # the direct descriptor (``call``). This encodes the design's ``call`` XOR ``call_ref``
        # rule and preserves the prior invariant that a callback spec always has a target (back
        # when ``call_ref`` was required).
        if (self.call_ref is None) == (self.call is None):
            raise ValueError(
                "a callback tool spec must carry exactly one of `call_ref` (gateway) "
                "or `call` (direct)"
            )
        # Spec-level bindings are applied by the gateway relay before it posts to
        # ``/tools/call``; a direct call has no relay, so the combination is invalid
        # (direct-call bindings belong inside ``call.context``).
        if self.context_bindings is not None and self.call_ref is None:
            raise ValueError(
                "`context_bindings` is only valid with `call_ref` (gateway dispatch)"
            )
        return self


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
        if data.get("callRef") or data.get("call_ref") or data.get("call"):
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

    tool_specs: List[ToolSpec] = Field(
        default_factory=list,
        validation_alias=AliasChoices("tool_specs", "custom_tools"),
    )
    tool_callback: Optional[ToolCallback] = None
    # Human-facing warnings raised during resolution that did not fail the run — e.g. a
    # gateway tool dropped because its action 404s. Each names the affected tool. Surfaced so
    # a degraded resolution is never silent; empty on a fully clean resolve.
    warnings: List[str] = Field(default_factory=list)

    @field_validator("tool_specs", mode="before")
    @classmethod
    def _coerce_specs(cls, value: Any) -> List[ToolSpec]:
        return [coerce_tool_spec(item) for item in value or []]

    @property
    def custom_tools(self) -> List[Dict[str, Any]]:
        """Compatibility wire dictionaries for callers not yet using typed specs."""
        return [spec.to_wire() for spec in self.tool_specs]


class GatewayToolResolution(BaseModel):
    """Result returned by an injected gateway adapter."""

    model_config = ConfigDict(frozen=True)

    tool_specs: List[CallbackToolSpec] = Field(default_factory=list)
    tool_callback: ToolCallback
