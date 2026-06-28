"""The platform-op catalog: existing Agenta endpoints exposed to the agent as tools.

A platform tool (``type:"platform"``) is a thin wrapper over an EXISTING Agenta endpoint. The
agent config names which endpoint to expose (``op``); this catalog owns everything else — the
model-facing description, which endpoint to call (method + relative path), the request input
schema, any self-targeting fields bound from run context, and the default permission/approval.

It mirrors two patterns already in the codebase:

- the reserved ``tools.agenta.*`` namespace (PR #4884, ``find_capabilities``): a reserved op id
  under ``tools.agenta.<op>`` with a code-defined description + input schema;
- the evaluators catalog (``api/oss/src/resources/evaluators/evaluators.py``): a code-defined
  table of named ops with metadata, validated at import.

Execution reuses the ``call`` descriptor (direct-call tools): a platform tool resolves to a
:class:`~agenta.sdk.agents.tools.CallbackToolSpec` whose ``call`` points the runner straight at
the existing endpoint, with no ``/tools/call`` hop. The ``PlatformConnection`` (see
``platform/connection.py``) supplies the origin the runner resolves the relative path against and
the caller credential. Input schemas reuse the in-process ``CATALOG_TYPES`` mechanism via
``x-ag-type-ref`` (resolved by :func:`expand_type_refs`); descriptions live here, in the SDK.

Lives under ``platform/`` (not ``tools/``) for the same reason as ``_schema.py``: it imports
``CATALOG_TYPES``, which would be circular from a ``tools`` module but is fine from the lazily
imported platform package.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from agenta.sdk.agents.tools.errors import UnknownPlatformOpError
from agenta.sdk.agents.tools.models import Permission, ToolCall
from agenta.sdk.utils.types import CATALOG_TYPES

from ._schema import expand_type_refs

__all__ = [
    "PLATFORM_OP_NAMESPACE",
    "PlatformOp",
    "PLATFORM_OPS",
    "get_platform_op",
]

# Reserved namespace for a platform op's stable id (mirrors ``tools.agenta.find_capabilities``).
# The model-visible tool name is the bare ``op``; ``reserved_id`` is the stable namespaced id.
PLATFORM_OP_NAMESPACE = "tools.agenta."

# Every ``context_bindings`` value addresses the run-context namespace through this token prefix
# (e.g. ``$ctx.workflow.variant.id``); the runner resolves it at dispatch (see ``RunContext``).
_CTX_TOKEN_PREFIX = "$ctx."


class PlatformOp(BaseModel):
    """One catalog entry: an existing Agenta endpoint exposed to the agent as a tool.

    Typed (not a loose dict) so each entry is validated at import: exactly one schema source, a
    relative path, and well-formed ``$ctx`` context-binding tokens.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    op: str = Field(
        min_length=1, description="Stable op key; the model-visible tool name."
    )
    description: str = Field(
        min_length=1, description="Model-facing description (SDK-owned)."
    )
    method: Literal["GET", "POST"]
    # An EXISTING Agenta endpoint, as a path relative to the API origin (e.g. ``/api/tools/discover``).
    # The runner binds the origin to the run's own Agenta and confines the path to the API mount.
    path: str = Field(min_length=1)
    # Exactly one of the two below. ``input_schema`` is an inline JSON Schema (SDK-owned); it MAY
    # carry ``x-ag-type-ref`` markers, expanded against ``CATALOG_TYPES`` at resolve time.
    # ``input_schema_ref`` names a whole catalog type by key (the endpoint's request schema).
    input_schema: Optional[Dict[str, Any]] = None
    input_schema_ref: Optional[str] = None
    # Self-targeting fields the runner fills server-side from run context: a dotted body path on the
    # endpoint's request -> a ``$ctx.<key>`` token. These are stripped from the model-visible schema
    # and emitted as ``call.context`` so the model supplies only the payload and can never retarget.
    context_bindings: Dict[str, str] = Field(default_factory=dict)
    # Where the model's args land in the request body (a dotted deep-set path; absent = the root).
    args_into: Optional[str] = None
    # Per-op defaults; the config's ``needs_approval`` / ``permission`` override these when set.
    # Mutating ops default to approval (``ask``); reads default to auto-allow (``allow``).
    default_permission: Optional[Permission] = None
    default_needs_approval: bool = False

    @model_validator(mode="after")
    def _check(self) -> "PlatformOp":
        if (self.input_schema is None) == (self.input_schema_ref is None):
            raise ValueError(
                f"platform op '{self.op}' must set exactly one of "
                "`input_schema` or `input_schema_ref`"
            )
        if (
            self.input_schema_ref is not None
            and self.input_schema_ref not in CATALOG_TYPES
        ):
            raise ValueError(
                f"platform op '{self.op}' input_schema_ref '{self.input_schema_ref}' "
                "is not a known CATALOG_TYPES key"
            )
        if not self.path.startswith("/") or self.path.startswith("//"):
            raise ValueError(
                f"platform op '{self.op}' path '{self.path}' must be a relative path "
                "starting with a single '/'"
            )
        for field, token in self.context_bindings.items():
            if not field:
                raise ValueError(
                    f"platform op '{self.op}' has an empty context-binding field"
                )
            if not token.startswith(_CTX_TOKEN_PREFIX):
                raise ValueError(
                    f"platform op '{self.op}' context binding '{field}' must map to a "
                    f"'$ctx.<key>' token, got '{token}'"
                )
        return self

    @property
    def reserved_id(self) -> str:
        """The stable reserved id, ``tools.agenta.<op>`` (the ``find_capabilities`` precedent)."""
        return f"{PLATFORM_OP_NAMESPACE}{self.op}"

    def resolved_input_schema(self) -> Dict[str, Any]:
        """The concrete, model-visible input schema.

        Catalog schema with every ``x-ag-type-ref`` expanded to concrete JSON Schema, then with the
        server-bound ``context_bindings`` fields stripped (path-aware, including their ``required``
        entries) so the model never sees a field the runner fills from run context.
        """
        if self.input_schema_ref is not None:
            schema = expand_type_refs({"x-ag-type-ref": self.input_schema_ref})
        else:
            schema = expand_type_refs(deepcopy(self.input_schema))
        if not isinstance(
            schema, dict
        ):  # defensive; catalog schemas are always objects
            return schema
        for field in self.context_bindings:
            _strip_field(schema, field)
        return schema

    def to_call(self) -> ToolCall:
        """The direct ``call`` descriptor: the endpoint to hit, where args land, and the
        context bindings (emitted as ``context`` so the runner fills bound fields from run
        context at dispatch)."""
        return ToolCall(
            method=self.method,
            path=self.path,
            context=dict(self.context_bindings) or None,
            args_into=self.args_into,
        )


def _strip_field(schema: Dict[str, Any], dotted_path: str) -> None:
    """Delete the property at ``dotted_path`` from a JSON Schema's ``properties`` tree, in place,
    and drop it from the enclosing ``required`` list. A path that does not resolve is a no-op."""
    parts = dotted_path.split(".")
    node: Any = schema
    for part in parts[:-1]:
        properties = node.get("properties") if isinstance(node, dict) else None
        if not isinstance(properties, dict) or part not in properties:
            return
        node = properties[part]
    if not isinstance(node, dict):
        return
    leaf = parts[-1]
    properties = node.get("properties")
    if isinstance(properties, dict):
        properties.pop(leaf, None)
    required = node.get("required")
    if isinstance(required, list) and leaf in required:
        required.remove(leaf)
        if not required:
            node.pop("required", None)


# ---------------------------------------------------------------------------
# The catalog — the first, minimal-useful set of ops (more are a data add).
# ---------------------------------------------------------------------------

# Discovery (read). Migrates ``find_capabilities`` off the server-side ``/tools/call``
# ``tools.agenta.*`` dispatch onto a direct call to ``POST /api/tools/discover`` (PR #4884 built
# the server side). Description + input schema mirror ``api/oss/src/core/tools/discovery.py``
# (copied here because the SDK must not import from the API).
_FIND_CAPABILITIES_DESCRIPTION = (
    "Discover the Agenta tools that fit a set of plain-language use cases. Returns the "
    "best-match tool per use case (with its input schema), companion/alternative tools, "
    "each integration's connection state and how to connect it, and operating guidance. "
    "Use it while wiring tools for an agent you are building."
)
_FIND_CAPABILITIES_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "use_cases": {
            "type": "array",
            "items": {"type": "string"},
            "description": "One short fragment per capability the agent needs "
            "(e.g. 'create a github issue').",
        },
        "provider": {
            "type": "string",
            "default": "composio",
            "description": "Tool provider to search.",
        },
        "limit_alternatives": {
            "type": "integer",
            "default": 3,
            "minimum": 0,
            "description": "Max alternative tools to return per use case.",
        },
    },
    "required": ["use_cases"],
}

# Workflows query (read): list the project's workflow artifacts, so an agent building or improving
# agents can find what already exists. Filters mirror ``WorkflowQueryRequest`` (all optional).
_QUERY_WORKFLOWS_DESCRIPTION = (
    "Query the project's workflow artifacts (agents, prompts) with optional filters and "
    "pagination. Use it to find existing workflows before creating or referencing one."
)
_QUERY_WORKFLOWS_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "workflow": {
            "type": "object",
            "description": "Attribute filter on workflow artifacts "
            "(flags, tags, meta, name, description).",
        },
        "workflow_refs": {
            "type": "array",
            "items": {"type": "object"},
            "description": "Restrict results to workflows matching these references (id or slug).",
        },
        "include_archived": {
            "type": "boolean",
            "description": "When true, include archived workflows.",
        },
        "windowing": {
            "type": "object",
            "description": "Cursor-based pagination controls (pass `next` back for the next page).",
        },
    },
}

# Commit revision (mutating, self-targeting): commit a new revision to the agent's OWN workflow
# variant — "update myself". ``workflow_revision.workflow_variant_id`` is bound from run context
# and stripped from the model-visible schema, so the agent can only ever target itself, never a
# different variant in the project. Defaults to approval.
_COMMIT_REVISION_DESCRIPTION = (
    "Commit a new revision to your own workflow variant (update yourself). Supply the new "
    "configuration under `workflow_revision.data` and an optional commit message; the variant "
    "you are running is targeted automatically. This changes the agent and requires approval."
)
_COMMIT_REVISION_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "workflow_revision": {
            "type": "object",
            "description": "The revision to append to your variant's history.",
            "properties": {
                # Bound from $ctx.workflow.variant.id and stripped before the model sees it.
                "workflow_variant_id": {
                    "type": "string",
                    "description": "Server-bound to the running variant; do not set.",
                },
                "message": {
                    "type": "string",
                    "description": "Commit message describing the change.",
                },
                "data": {
                    "type": "object",
                    "description": "The new configuration (parameters, inputs) for the revision.",
                },
            },
            "required": ["workflow_variant_id"],
        },
    },
    "required": ["workflow_revision"],
}


PLATFORM_OPS: Dict[str, PlatformOp] = {
    op.op: op
    for op in (
        PlatformOp(
            op="find_capabilities",
            description=_FIND_CAPABILITIES_DESCRIPTION,
            method="POST",
            path="/api/tools/discover",
            input_schema=_FIND_CAPABILITIES_INPUT_SCHEMA,
            default_permission="allow",
            default_needs_approval=False,
        ),
        PlatformOp(
            op="query_workflows",
            description=_QUERY_WORKFLOWS_DESCRIPTION,
            method="POST",
            path="/api/workflows/query",
            input_schema=_QUERY_WORKFLOWS_INPUT_SCHEMA,
            default_permission="allow",
            default_needs_approval=False,
        ),
        PlatformOp(
            op="commit_revision",
            description=_COMMIT_REVISION_DESCRIPTION,
            method="POST",
            path="/api/workflows/revisions/commit",
            input_schema=_COMMIT_REVISION_INPUT_SCHEMA,
            context_bindings={
                "workflow_revision.workflow_variant_id": "$ctx.workflow.variant.id"
            },
            default_permission="ask",
            default_needs_approval=True,
        ),
    )
}


def get_platform_op(op: str) -> PlatformOp:
    """Look up a catalog op by key, raising :class:`UnknownPlatformOpError` if it is not defined."""
    try:
        return PLATFORM_OPS[op]
    except KeyError:
        raise UnknownPlatformOpError(op=op, available=sorted(PLATFORM_OPS)) from None
