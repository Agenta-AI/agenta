"""Canonical tool configuration and resolved runtime specifications."""

from __future__ import annotations

import re
from enum import Enum
from hashlib import sha1
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


#: The character class every major provider accepts for a tool name (`^[a-zA-Z0-9_.-]+$`).
#: OpenAI rejects the whole request when any tool violates it — not the one tool, the whole
#: `tools` array — so a single bad name breaks every run of the agent that owns it.
_TOOL_NAME_ALLOWED = re.compile(r"[^a-zA-Z0-9_.-]+")


def sanitize_tool_name(raw: Optional[str], *, fallback: str) -> str:
    """Coerce an authored name into the provider's tool-name pattern.

    A subagent's model-visible name is a DISPLAY name the user typed, so it can carry spaces,
    slashes, or anything else a person writes. Sending it unchanged made the provider refuse the
    entire tool list with `Invalid 'tools[N].name'`, which bricks every run of the parent agent
    until the child is renamed. Names like "Support Router" are an ordinary thing to type.

    The mapping is deterministic and stable, because the model sees this name and a name that
    changed between turns would strand a conversation mid-tool-call: every disallowed run of
    characters becomes one `_`, leading and trailing separators are trimmed, and an input that
    survives none of that falls back to `fallback` (itself sanitized). Only the WIRE name is
    touched; the display name is never rewritten.
    """
    collapsed = _TOOL_NAME_ALLOWED.sub("_", (raw or "").strip())
    # Trim separators the collapse may have produced at either end. `.` and `-` are legal
    # characters but a leading or trailing one reads as debris rather than a name.
    trimmed = collapsed.strip("_.-")
    if trimmed:
        return trimmed
    if raw is not None or fallback:
        cleaned_fallback = _TOOL_NAME_ALLOWED.sub("_", fallback.strip()).strip("_.-")
        if cleaned_fallback:
            return cleaned_fallback
    return "tool"


def disambiguate_tool_names(pairs: List[tuple]) -> Dict[str, str]:
    """Map each `(identity, sanitized_name)` to a name unique across the list.

    Sanitizing can merge two distinct children onto one name — "Support Router" and
    "Support/Router" both become `Support_Router` — and a duplicate tool name silently shadows
    the earlier tool rather than erroring, so the second subagent would simply never be callable.

    Only colliding names are decorated, so the common case keeps the name the user recognizes.
    The discriminator is a digest of the tool's own stable identity (its `call_ref`), NOT its
    position: an ordinal would renumber when the author reorders or removes a tool, changing a
    name the model may already have used earlier in the conversation.

    The digest starts short for readability and LENGTHENS until every name in the colliding group
    is distinct. Six hex characters is only 24 bits, so two `call_ref` values can share a prefix;
    if their base names also matched, the function would hand back one name for both entries and
    the final uniqueness check would reject a configuration this helper promises is unique. Growing
    the digest keeps the guarantee without reintroducing an ordinal: the length depends on the set
    of colliding identities, never on their order, so the same configuration always yields the same
    names. Two distinct identities cannot share the FULL digest, so the loop always terminates.
    """
    counts: Dict[str, int] = {}
    for _identity, name in pairs:
        counts[name] = counts.get(name, 0) + 1

    resolved: Dict[str, str] = {}
    for name, count in counts.items():
        group = [identity for identity, item_name in pairs if item_name == name]
        if count == 1:
            resolved[group[0]] = name
            continue
        digests = {identity: _identity_digest(identity) for identity in group}
        # Sorting makes the width a property of the SET, not of iteration order.
        width = _shortest_distinct_prefix(sorted(digests.values()))
        for identity in group:
            resolved[identity] = f"{name}_{digests[identity][:width]}"
    return resolved


def _identity_digest(identity: str) -> str:
    return sha1(identity.encode("utf-8")).hexdigest()


def _shortest_distinct_prefix(digests: List[str], start: int = 6) -> int:
    """The smallest prefix length (from `start`) at which every digest differs."""
    longest = max((len(digest) for digest in digests), default=start)
    for width in range(start, longest + 1):
        if len({digest[:width] for digest in digests}) == len(digests):
            return width
    return longest


# Layer-3 per-tool permission: ``allow`` runs with no prompt, ``ask`` raises a
# human-in-the-loop request, ``deny`` never runs. Absent means "inherit the runner policy".
Permission = Literal["allow", "ask", "deny"]
PermissionMode = Literal["allow", "ask", "deny", "allow_reads"]

# The four values a gateway connection policy saves. ``inherit`` is explicit here: an absent
# tool key uses the connection default, while ``inherit`` skips that default and defers to
# the agent-wide mode. The compiler applies it, so ``inherit`` never reaches the runner.
GatewayPermission = Literal["inherit", "allow", "ask", "deny"]

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
    """Fields shared by every persisted declaration of a single tool."""

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


class GatewayConnectionRef(BaseModel):
    """The shared project connection a gateway entry points at.

    A resource reference, never a credential: the project owns the connection and several
    agents can reuse it, each with its own policy.
    """

    model_config = ConfigDict(extra="forbid")

    # Only `composio` is supported, per contracts section 1, so an unsupported provider is
    # refused when the revision is parsed rather than at run start.
    provider: Literal["composio"] = "composio"
    integration: str = Field(min_length=1)
    slug: str = Field(min_length=1)


class GatewayPermissions(BaseModel):
    """What the agent may do through one connection, per tool key."""

    model_config = ConfigDict(extra="forbid")

    default: GatewayPermission
    tools: Dict[Annotated[str, Field(min_length=1)], GatewayPermission] = Field(
        default_factory=dict
    )


class GatewayConnectionPolicy(BaseModel):
    """The ``policy`` node of the saved entry. It mirrors the saved nesting and holds one
    field on purpose, so a later policy of a different kind has a place to go."""

    model_config = ConfigDict(extra="forbid")

    permissions: GatewayPermissions


class GatewayConnectionToolConfig(BaseModel):
    """One whole integration, with a policy the SDK compiles into per-tool decisions.

    Replaces the one-entry-per-tool :class:`GatewayToolConfig`, which stays readable while
    saved revisions migrate. The entry carries no credentials, provider account IDs, tool
    schemas, or read-only hints: those are resolved data, not authored configuration.

    It does not extend :class:`ToolConfigBase`. That base carries a per-tool ``render`` and
    ``permission``, and an entry that covers a whole integration has no single tool to apply
    either to. Every permission here lives in ``policy``, so a top-level one is refused
    instead of accepted and then ignored, which would let an author believe a `deny` applies
    when nothing reads it. The deleted legacy permission spellings are refused here for the
    same reason, rather than dropped in silence as they are on the other arms.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["gateway_connection"] = "gateway_connection"
    connection: GatewayConnectionRef
    policy: GatewayConnectionPolicy


class CompiledTool(BaseModel):
    """One tool key after the compiler has applied the policy and the agent-wide mode.

    Lives here rather than beside the compiler because two readers share it: the compiler
    produces it, and :class:`ResolvedGatewayIntegration` carries it to the runner.
    """

    model_config = ConfigDict(frozen=True, populate_by_name=True)

    permission: Permission
    # Tri-state, and unknown must survive to the runner: the catalog hint is absent for some
    # provider tools, and absent is not the same as a write for a reader.
    read_only: Optional[bool] = Field(
        default=None,
        validation_alias=AliasChoices("read_only", "readOnly"),
        serialization_alias="readOnly",
    )


class ResolvedGatewayIntegration(BaseModel):
    """One configured integration, compiled. Private to the runner; never model-facing."""

    model_config = ConfigDict(frozen=True)

    provider: str = Field(min_length=1)
    connection: str = Field(min_length=1)
    toolkit_version: str = Field(
        min_length=1,
        validation_alias=AliasChoices("toolkit_version", "toolkitVersion"),
        serialization_alias="toolkitVersion",
    )
    tools: Dict[str, CompiledTool] = Field(default_factory=dict)

    @field_validator("toolkit_version")
    @classmethod
    def _require_concrete_toolkit_version(cls, value: str) -> str:
        version = value.strip()
        # ``min_length`` accepts a whitespace-only string, so blank is rejected here.
        if not version or version.lower() == "latest":
            raise ValueError("resolved gateway toolkit version must be concrete")
        return version


class ResolvedGatewayPolicy(BaseModel):
    """The compiled per-tool decisions for every configured integration.

    Rides the run request as the single top-level ``gatewayPolicy`` field. It never reaches
    the harness or the sandbox: the runner reads it to gate ``gateway.run`` and to filter
    ``gateway.search`` results.
    """

    model_config = ConfigDict(frozen=True)

    integrations: Dict[str, ResolvedGatewayIntegration] = Field(default_factory=dict)

    def to_wire(self) -> Dict[str, Any]:
        """Serialize to the camelCase wire shape.

        No ``exclude_none`` here, unlike :meth:`ToolSpecBase.to_wire`: ``readOnly`` must be
        PRESENT and null when the catalog hint is unknown, because a dropped key and a null
        value would mean different things to the runner.
        """
        return self.model_dump(mode="json", by_alias=True)


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
    name: Optional[str] = Field(
        default=None,
        min_length=1,
        description=(
            "Legacy: a copy of the target's display name, taken when the subagent was added. "
            "Renaming the target never reached it, so no wire value derives from it any more "
            "(#6444); the browser still reads it as a placeholder on a reference saved before "
            "then. Kept so those configurations still parse."
        ),
    )
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
        """The model-visible name: the workflow SLUG, never the stored display name.

        The slug is the reference's only identity and a rename never touches it, so this is
        stable inside a conversation AND correct after the target is renamed — the stored `name`
        was neither, because it was a copy taken at add time (#6444).

        Still sanitized to the provider's tool-name pattern: a slug authored through the API
        rather than the UI need not match it, and a name the provider refuses fails the whole
        tool list. Collisions between two slugs that sanitize alike are resolved by the caller
        building the tool list, which is the only place that can see siblings.
        """
        return sanitize_tool_name(self.slug, fallback=self.slug)

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
        GatewayConnectionToolConfig,
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
    # The compiled per-tool decisions for the agent's ``gateway_connection`` entries. ``None``
    # when the agent has none, which keeps that run's wire payload byte-identical.
    gateway_policy: Optional[ResolvedGatewayPolicy] = None

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


class GatewayConnectionResolution(BaseModel):
    """Result returned by an injected gateway adapter for ``gateway_connection`` entries.

    Deliberately NOT a subclass of :class:`GatewayToolResolution`. The two are never used
    interchangeably — the resolver reads each arm in its own branch, and the protocol
    declares a separate method per arm — and the meaning of ``tool_specs`` differs: there it
    is one specification per configured entry, here it is the fixed derived pair.

    ``gateway_policy`` is required rather than defaulted, so "no policy" has exactly one
    spelling: a ``None`` on :class:`ResolvedToolSet`. An empty policy that reached the wire
    would emit ``{"integrations": {}}`` and break the byte-identical payload rule for a run
    with no connection.
    """

    model_config = ConfigDict(frozen=True)

    tool_specs: List[CallbackToolSpec] = Field(default_factory=list)
    tool_callback: ToolCallback
    gateway_policy: ResolvedGatewayPolicy
    # Configured keys the catalog no longer carries, ready for the resolver's warning list.
    warnings: List[str] = Field(default_factory=list)
