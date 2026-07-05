"""The platform-op catalog: existing Agenta endpoints exposed to the agent as tools.

A platform tool (``type:"platform"``) is a thin wrapper over an EXISTING Agenta endpoint. The
agent config names which endpoint to expose (``op``); this catalog owns everything else — the
model-facing description, which endpoint to call (method + relative path), the request input
schema, any self-targeting fields bound from run context, and the default permission/approval.

It mirrors two patterns already in the codebase:

- the reserved ``tools.agenta.*`` namespace: a reserved op id
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
from agenta.sdk.agents.tools.models import ToolCall
from agenta.sdk.utils.types import CATALOG_TYPES

from ._schema import expand_type_refs

__all__ = [
    "PLATFORM_OP_NAMESPACE",
    "PlatformOp",
    "PLATFORM_OPS",
    "get_platform_op",
]

# Reserved namespace for a platform op's stable id.
# The model-visible tool name is the bare ``op``; ``reserved_id`` is the stable namespaced id.
PLATFORM_OP_NAMESPACE = "tools.agenta."

# Every ``context_bindings`` value addresses the run-context namespace through this token prefix
# (e.g. ``$ctx.workflow.variant.id``); the runner resolves it at dispatch (see ``RunContext``).
_CTX_TOKEN_PREFIX = "$ctx."

# Exact allowlist of handler call-refs a handler-mode op may target. Must match the
# server's registered handlers (``PLATFORM_TOOL_HANDLERS`` in the API's
# ``core/tools/platform_handlers.py``); an op naming anything else fails at import.
_HANDLER_CALL_REFS = frozenset({f"{PLATFORM_OP_NAMESPACE}test_run"})


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
    method: Optional[Literal["GET", "POST", "DELETE"]] = None
    # An EXISTING Agenta endpoint, as a path relative to the API origin (e.g. ``/api/tools/discover``).
    # The runner binds the origin to the run's own Agenta and confines the path to the API mount.
    path: Optional[str] = Field(default=None, min_length=1)
    # A server-side handler call-ref in the reserved Agenta namespace. Handler-mode ops still go
    # through `/tools/call`, but the business logic lives behind the registered Python handler.
    handler: Optional[str] = Field(default=None, min_length=1)
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
    # Catalog hint for the runner's ``allow_reads`` policy; no hint counts as a write.
    read_only: bool = False
    # Per-op execution budget for long-running server-side handlers. Emitted as `timeoutMs`.
    timeout_ms: Optional[int] = Field(default=None, gt=0)

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

        has_direct_target = self.method is not None or self.path is not None
        has_handler_target = self.handler is not None
        if has_direct_target == has_handler_target:
            raise ValueError(
                f"platform op '{self.op}' must set exactly one of "
                "`method` + `path` or `handler`"
            )
        if has_direct_target and (self.method is None or self.path is None):
            raise ValueError(
                f"platform op '{self.op}' must set both `method` and `path` "
                "for endpoint mode"
            )
        if self.path is not None and (
            not self.path.startswith("/") or self.path.startswith("//")
        ):
            raise ValueError(
                f"platform op '{self.op}' path '{self.path}' must be a relative path "
                "starting with a single '/'"
            )
        if self.handler is not None and self.handler not in _HANDLER_CALL_REFS:
            raise ValueError(
                f"platform op '{self.op}' handler '{self.handler}' is not allowlisted"
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
        """The stable reserved id, ``tools.agenta.<op>``."""
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
        """The direct ``call`` descriptor for endpoint-mode ops."""
        if self.method is None or self.path is None or self.handler is not None:
            raise ValueError(f"platform op '{self.op}' is not an endpoint-mode op")
        return ToolCall(
            method=self.method,
            path=self.path,
            context=dict(self.context_bindings) or None,
            args_into=self.args_into,
        )

    def to_call_ref(self) -> str:
        """The reserved ``callRef`` for handler-mode ops."""
        if self.handler is None:
            raise ValueError(f"platform op '{self.op}' is not a handler-mode op")
        return self.handler


def _strip_field(schema: Dict[str, Any], dotted_path: str) -> None:
    """Delete the property at ``dotted_path`` from a JSON Schema's ``properties`` tree, in place,
    and drop it from the enclosing ``required`` list. Ancestor objects left empty by the removal
    are pruned too, so the model never sees a hollow required container (e.g. ``target`` once its
    only field is context-bound). A path that does not resolve is a no-op."""
    parts = dotted_path.split(".")
    node: Any = schema
    stack: list[tuple[Dict[str, Any], str]] = []
    for part in parts[:-1]:
        properties = node.get("properties") if isinstance(node, dict) else None
        if not isinstance(properties, dict) or part not in properties:
            return
        stack.append((node, part))
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

    while stack and _is_empty_object_schema(node):
        parent, part = stack.pop()
        parent_props = parent.get("properties")
        if isinstance(parent_props, dict):
            parent_props.pop(part, None)
        parent_required = parent.get("required")
        if isinstance(parent_required, list) and part in parent_required:
            parent_required.remove(part)
            if not parent_required:
                parent.pop("required", None)
        node = parent


def _is_empty_object_schema(node: Any) -> bool:
    if not isinstance(node, dict):
        return False
    properties = node.get("properties")
    return isinstance(properties, dict) and not properties and not node.get("required")


# ---------------------------------------------------------------------------
# The catalog — the first, minimal-useful set of ops (more are a data add).
# ---------------------------------------------------------------------------

# Discovery (read). Direct call to ``POST /api/tools/discover``. Description + input schema
# mirror ``api/oss/src/core/tools/discovery.py`` (copied here because the SDK must not import
# from the API).
_DISCOVER_TOOLS_DESCRIPTION = (
    "Discover the Agenta tools that fit a set of plain-language use cases. Returns the "
    "best-match tool per use case (with its input schema), companion/alternative tools, "
    "each integration's connection state and how to connect it, and operating guidance. "
    "Use it while wiring tools for an agent you are building."
)
_DISCOVER_TOOLS_INPUT_SCHEMA: Dict[str, Any] = {
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

# Spans query (read): inspect trace/span records for this project. Project scope comes from the
# caller credential on the existing endpoint; there is no model-supplied project id and no $ctx
# target field to bind.
_QUERY_SPANS_DESCRIPTION = (
    "Query span records in this project. Use it to verify a past run or scheduled trigger fire "
    "actually executed its tools. Returns `{count, spans}` with flat spans, including span names, "
    "status, attributes, events, and Agenta metrics. Filter by `trace_id` when you know it, or "
    "bracket the test with `windowing.oldest`/`windowing.newest`; then read the tool-call spans "
    "in order and confirm the terminal span completed without an error status."
)
_QUERY_SPANS_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "$defs": {
        "ComparisonOperator": {
            "type": "string",
            "enum": ["is", "is_not"],
        },
        "NumericOperator": {
            "type": "string",
            "enum": ["eq", "neq", "gt", "lt", "gte", "lte", "btwn"],
        },
        "StringOperator": {
            "type": "string",
            "enum": ["startswith", "endswith", "contains", "matches", "like"],
        },
        "DictOperator": {
            "type": "string",
            "enum": ["has", "has_not"],
        },
        "ListOperator": {
            "type": "string",
            "enum": ["in", "not_in"],
        },
        "ExistenceOperator": {
            "type": "string",
            "enum": ["exists", "not_exists"],
        },
        "LogicalOperator": {
            "type": "string",
            "enum": ["and", "or", "not", "nand", "nor"],
        },
        "TextOptions": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "case_sensitive": {
                    "anyOf": [{"type": "boolean"}, {"type": "null"}],
                    "default": False,
                },
                "exact_match": {
                    "anyOf": [{"type": "boolean"}, {"type": "null"}],
                    "default": False,
                },
            },
        },
        "ListOptions": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "all": {
                    "anyOf": [{"type": "boolean"}, {"type": "null"}],
                    "default": False,
                }
            },
        },
        "Condition": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "field": {
                    "type": "string",
                    "description": (
                        "Span field to filter, such as `trace_id`, `span_name`, "
                        "`span_type`, `status_code`, `attributes`, or `content`."
                    ),
                },
                "key": {
                    "anyOf": [{"type": "string"}, {"type": "null"}],
                    "default": None,
                    "description": (
                        "Optional nested key when filtering dictionary fields like "
                        "`attributes`."
                    ),
                },
                "value": {
                    "anyOf": [
                        {"type": "string"},
                        {"type": "integer"},
                        {"type": "number"},
                        {"type": "boolean"},
                        {"type": "array", "items": {}},
                        {"type": "object", "additionalProperties": True},
                        {"type": "null"},
                    ],
                    "default": None,
                    "description": "Comparison value for the condition.",
                },
                "operator": {
                    "anyOf": [
                        {"$ref": "#/$defs/ComparisonOperator"},
                        {"$ref": "#/$defs/NumericOperator"},
                        {"$ref": "#/$defs/StringOperator"},
                        {"$ref": "#/$defs/ListOperator"},
                        {"$ref": "#/$defs/DictOperator"},
                        {"$ref": "#/$defs/ExistenceOperator"},
                        {"type": "null"},
                    ],
                    "default": "is",
                },
                "options": {
                    "anyOf": [
                        {"$ref": "#/$defs/TextOptions"},
                        {"$ref": "#/$defs/ListOptions"},
                        {"type": "null"},
                    ],
                    "default": None,
                },
            },
            "required": ["field"],
        },
        "Filtering": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "operator": {
                    "$ref": "#/$defs/LogicalOperator",
                    "default": "and",
                    "description": "How to combine conditions.",
                },
                "conditions": {
                    "type": "array",
                    "items": {
                        "anyOf": [
                            {"$ref": "#/$defs/Condition"},
                            {"$ref": "#/$defs/Filtering"},
                        ]
                    },
                    "default": [],
                    "description": (
                        "Filter objects, for example "
                        '`[{"field": "trace_id", "operator": "is", "value": "..."}]`.'
                    ),
                },
            },
        },
        "Windowing": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "newest": {
                    "anyOf": [
                        {"type": "string", "format": "date-time"},
                        {"type": "null"},
                    ],
                    "default": None,
                    "description": "Window end time as an ISO timestamp.",
                },
                "oldest": {
                    "anyOf": [
                        {"type": "string", "format": "date-time"},
                        {"type": "null"},
                    ],
                    "default": None,
                    "description": "Window start time as an ISO timestamp.",
                },
                "next": {
                    "anyOf": [
                        {"type": "string", "format": "uuid"},
                        {"type": "null"},
                    ],
                    "default": None,
                    "description": "Cursor token returned by a prior query page.",
                },
                "limit": {
                    "anyOf": [{"type": "integer"}, {"type": "null"}],
                    "default": None,
                    "description": "Maximum spans to return.",
                },
                "order": {
                    "anyOf": [
                        {"type": "string", "enum": ["ascending", "descending"]},
                        {"type": "null"},
                    ],
                    "default": None,
                    "description": "Sort order for the window.",
                },
                "interval": {
                    "anyOf": [{"type": "integer"}, {"type": "null"}],
                    "default": None,
                    "description": "Positive bucket interval for aggregate query windows.",
                },
                "rate": {
                    "anyOf": [{"type": "number"}, {"type": "null"}],
                    "default": None,
                    "description": "Optional sampling rate between 0.0 and 1.0.",
                },
            },
        },
        "Reference": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "version": {
                    "anyOf": [{"type": "string"}, {"type": "null"}],
                    "default": None,
                },
                "slug": {
                    "anyOf": [{"type": "string"}, {"type": "null"}],
                    "default": None,
                },
                "id": {
                    "anyOf": [
                        {"type": "string", "format": "uuid"},
                        {"type": "null"},
                    ],
                    "default": None,
                },
            },
        },
    },
    "properties": {
        "filtering": {
            "anyOf": [{"$ref": "#/$defs/Filtering"}, {"type": "null"}],
            "default": None,
            "description": (
                "Span-level conditions. For verification, filter on "
                '`{"field": "trace_id", "operator": "is", "value": "<trace_id>"}` '
                "when the trace id is known."
            ),
        },
        "windowing": {
            "anyOf": [{"$ref": "#/$defs/Windowing"}, {"type": "null"}],
            "default": None,
            "description": (
                "Cursor pagination and time range. Bracket manual verification with "
                "`oldest`/`newest` and set a sensible `limit`."
            ),
        },
        "query_ref": {
            "anyOf": [{"$ref": "#/$defs/Reference"}, {"type": "null"}],
            "default": None,
            "description": "Resolve filtering/windowing from a saved query.",
        },
        "query_variant_ref": {
            "anyOf": [{"$ref": "#/$defs/Reference"}, {"type": "null"}],
            "default": None,
            "description": "Resolve from the latest revision of a specific query variant.",
        },
        "query_revision_ref": {
            "anyOf": [{"$ref": "#/$defs/Reference"}, {"type": "null"}],
            "default": None,
            "description": (
                "Resolve from a specific query revision. Returns `409` when the stored query "
                "has `formatting.focus=trace`."
            ),
        },
    },
}

# Commit revision (mutating, self-targeting): commit a new revision to the agent's OWN workflow
# variant — "update myself". ``workflow_revision.workflow_variant_id`` is bound from run context
# and stripped from the model-visible schema, so the agent can only ever target itself, never a
# different variant in the project. Defaults to approval.
_COMMIT_REVISION_DESCRIPTION = (
    "Commit a new revision to your own workflow variant (update yourself). Send only the "
    "fields you are changing under `workflow_revision.delta.set` (deep-merged onto your "
    "current config) and any field paths to drop under `delta.remove`. Put agent-template "
    "edits under `delta.set.parameters.agent`. The variant you are running is targeted "
    "automatically. This changes the agent and requires approval."
)
_COMMIT_REVISION_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "workflow_revision": {
            "type": "object",
            "additionalProperties": False,
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
                "delta": {
                    "type": "object",
                    "additionalProperties": False,
                    "description": (
                        "Change set applied to your current revision. `set` is deep-merged "
                        "(omitted fields preserved); `remove` deletes the listed paths."
                    ),
                    "properties": {
                        "set": {
                            "type": "object",
                            "additionalProperties": True,
                            "description": (
                                "Partial workflow revision data to merge. For agent-template "
                                "updates, include parameters.agent with instructions, llm, tools, "
                                "mcps, skills, harness, runner, or sandbox fields as needed."
                            ),
                        },
                        "remove": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Dotted field paths to delete, e.g. parameters.agent.tools."
                            ),
                        },
                    },
                },
            },
            "required": ["workflow_variant_id", "delta"],
        },
    },
    "required": ["workflow_revision"],
}

# Annotate trace (mutating, self-targeting): record an annotation (evaluation feedback) on the
# agent's OWN current run trace — "grade myself". ``annotation.links.invocation.trace_id`` /
# ``.span_id`` are bound from run context ($ctx.trace.*) so the agent always annotates its own run
# and can never retarget another trace (the same self-targeting guarantee ``commit_revision`` gives
# via $ctx.workflow.variant.id). Unlike ``commit_revision``, this is additive self-metadata (it does
# not mutate the agent's config) — but it IS a write (``read_only=False``), so under the default
# ``allow_reads`` policy it prompts unless the author sets an explicit ``allow``.
_ANNOTATE_TRACE_DESCRIPTION = (
    "Record an annotation (evaluation feedback) on your own current run's trace — grade "
    "yourself. Supply `references.evaluator.slug` naming the annotation category (e.g. "
    "'self_reflection', 'quality') and the `data.outputs` you are recording (scores, "
    "labels, notes). Reuse a stable slug across runs: a new slug auto-creates a simple "
    "evaluator in your project. The trace and span you annotate are your own current run, "
    "filled automatically — you cannot annotate a different trace."
)
_ANNOTATE_TRACE_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    # Closed so the model cannot smuggle `links` past the self-target binding
    # ($ctx.trace.trace_id / .span_id); only the cataloged fields are accepted.
    "additionalProperties": False,
    "properties": {
        "references": {
            "type": "object",
            "additionalProperties": False,
            "description": "What this annotation evaluates against.",
            "properties": {
                "evaluator": {
                    "type": "object",
                    "additionalProperties": False,
                    "description": (
                        "Names the annotation category. Auto-created as a simple "
                        "evaluator if the slug is new, so reuse a stable slug."
                    ),
                    "properties": {
                        "slug": {
                            "type": "string",
                            "description": "Stable evaluator slug, e.g. 'self_reflection'.",
                        }
                    },
                    "required": ["slug"],
                }
            },
            "required": ["evaluator"],
        },
        "data": {
            "type": "object",
            "additionalProperties": False,
            "description": "The annotation payload.",
            "properties": {
                "outputs": {
                    "type": "object",
                    "additionalProperties": True,
                    "description": (
                        "The annotation content you are recording (scores, labels, notes)."
                    ),
                }
            },
            "required": ["outputs"],
        },
        # links.invocation.{trace_id,span_id} are bound from run context ($ctx.trace.*) and
        # never model-supplied; see context_bindings on the op below.
    },
    "required": ["references", "data"],
}

_DISCOVER_TRIGGERS_DESCRIPTION = (
    "Discover trigger events that fit plain-language use cases. Returns the best-match "
    "event per use case with event_key, trigger_config schema, sample payload, connection "
    "state and connection instructions, alternatives, and setup guidance."
)
_DISCOVER_TRIGGERS_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "use_cases": {
            "type": "array",
            "items": {"type": "string"},
            "description": "One short fragment per trigger the agent needs "
            "(e.g. 'new github issue opened').",
        },
        "provider": {
            "type": "string",
            "default": "composio",
            "description": "Trigger provider to search.",
        },
        "limit_alternatives": {
            "type": "integer",
            "default": 3,
            "minimum": 0,
            "description": "Max alternative events to return per use case.",
        },
    },
    "required": ["use_cases"],
}

_TRIGGER_INPUTS_FIELDS_SCHEMA: Dict[str, Any] = {
    "description": "Template that maps schedule or event context into run inputs.",
    "anyOf": [
        {"type": "object", "additionalProperties": True},
        {"type": "string"},
    ],
}

_CREATE_SCHEDULE_DESCRIPTION = (
    "Create a cron schedule that runs this agent. The destination workflow is bound "
    "from the current run context, so only this agent can be scheduled. Requires approval."
)
_CREATE_SCHEDULE_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    # Closed so the model cannot smuggle `references` / `selector` past the self-target
    # binding ($ctx.workflow.variant.id); only the cataloged fields are accepted.
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string", "description": "Human label for the schedule."},
        "description": {"type": "string"},
        "data": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "event_key": {
                    "type": "string",
                    "description": "Label recorded on each schedule delivery.",
                },
                "schedule": {
                    "type": "string",
                    "description": "Five-field cron expression in UTC.",
                },
                "start_time": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Optional UTC start of the active window.",
                },
                "end_time": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Optional UTC end of the active window.",
                },
                "inputs_fields": _TRIGGER_INPUTS_FIELDS_SCHEMA,
            },
            "required": ["event_key", "schedule"],
        },
    },
    "required": ["data"],
}

_CREATE_SUBSCRIPTION_DESCRIPTION = (
    "Create an event subscription that runs this agent when a provider event occurs. "
    "The destination workflow is bound from the current run context. Requires approval."
)
_CREATE_SUBSCRIPTION_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    # Closed so the model cannot smuggle `references` / `selector` past the self-target
    # binding ($ctx.workflow.variant.id); only the cataloged fields are accepted.
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string", "description": "Human label for the subscription."},
        "description": {"type": "string"},
        "connection_id": {
            "type": "string",
            "description": "Ready trigger connection id for the event source.",
        },
        "data": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "event_key": {
                    "type": "string",
                    "description": "Provider event key returned by discover_triggers.",
                },
                "trigger_config": {
                    "type": "object",
                    "description": "Event parameters shaped by the event trigger_config schema.",
                },
                "inputs_fields": _TRIGGER_INPUTS_FIELDS_SCHEMA,
            },
            "required": ["event_key"],
        },
    },
    "required": ["connection_id", "data"],
}

_TEST_SUBSCRIPTION_DESCRIPTION = (
    "Open a temporary provider watch, wait for one real matching event, record it as a "
    "test delivery, and tear the watch down. It does not run the workflow. Requires approval."
)
_TEST_SUBSCRIPTION_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "Optional label for the test watch."},
        "connection_id": {
            "type": "string",
            "description": "Ready trigger connection id for the event source.",
        },
        "data": {
            "type": "object",
            "properties": {
                "event_key": {
                    "type": "string",
                    "description": "Provider event key returned by discover_triggers.",
                },
                "trigger_config": {
                    "type": "object",
                    "description": "Event parameters shaped by the event trigger_config schema.",
                },
            },
            "required": ["event_key"],
        },
    },
    "required": ["connection_id", "data"],
}

_TEST_RUN_DESCRIPTION = (
    "Run this agent headlessly once against test messages and return its output, tools, "
    "approval gates, resolved execution metadata, trace id, and verdict. The target workflow "
    "variant is filled automatically from the current run context and cannot be retargeted. "
    "This is a real run: external write tools may perform their action if approved."
)
_TEST_RUN_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "target": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "workflow_variant_id": {
                    "type": "string",
                    "description": "Server-bound current workflow variant id.",
                }
            },
            "required": ["workflow_variant_id"],
        },
        "inputs": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "messages": {
                    "x-ag-type-ref": "messages",
                    "description": "Test conversation messages for the headless run.",
                }
            },
            "required": ["messages"],
        },
        "delta": {
            "type": "object",
            "additionalProperties": False,
            "description": "Optional uncommitted revision delta to apply in memory before the test.",
            "properties": {
                "set": {
                    "type": "object",
                    "additionalProperties": True,
                    "description": "Partial revision data tree deep-merged onto the committed revision.",
                },
                "remove": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Dotted paths to delete from the revision data tree.",
                },
            },
        },
        "expectations": {
            "type": "object",
            "additionalProperties": False,
            "description": "Optional checks that define a passing test run.",
            "properties": {
                "terminal_tool": {
                    "type": "string",
                    "description": "Expected final/terminal tool name that must run and return.",
                }
            },
        },
    },
    "required": ["target", "inputs"],
}

_EMPTY_INPUT_SCHEMA: Dict[str, Any] = {"type": "object", "properties": {}}
_TRIGGER_ID_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "id": {
            "type": "string",
            "description": "The schedule or subscription id returned by the list tools.",
        }
    },
    "required": ["id"],
}


PLATFORM_OPS: Dict[str, PlatformOp] = {
    op.op: op
    for op in (
        PlatformOp(
            op="discover_tools",
            description=_DISCOVER_TOOLS_DESCRIPTION,
            method="POST",
            path="/api/tools/discover",
            input_schema=_DISCOVER_TOOLS_INPUT_SCHEMA,
            read_only=True,
        ),
        PlatformOp(
            op="query_workflows",
            description=_QUERY_WORKFLOWS_DESCRIPTION,
            method="POST",
            path="/api/workflows/query",
            input_schema=_QUERY_WORKFLOWS_INPUT_SCHEMA,
            read_only=True,
        ),
        PlatformOp(
            op="query_spans",
            description=_QUERY_SPANS_DESCRIPTION,
            method="POST",
            path="/api/spans/query",
            input_schema=_QUERY_SPANS_INPUT_SCHEMA,
            read_only=True,
        ),
        PlatformOp(
            op="test_run",
            description=_TEST_RUN_DESCRIPTION,
            handler="tools.agenta.test_run",
            input_schema=_TEST_RUN_INPUT_SCHEMA,
            context_bindings={"target.workflow_variant_id": "$ctx.workflow.variant.id"},
            read_only=False,
            timeout_ms=120000,
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
            read_only=False,
        ),
        PlatformOp(
            op="annotate_trace",
            description=_ANNOTATE_TRACE_DESCRIPTION,
            method="POST",
            path="/api/annotations/",
            input_schema=_ANNOTATE_TRACE_INPUT_SCHEMA,
            context_bindings={
                "annotation.links.invocation.trace_id": "$ctx.trace.trace_id",
                "annotation.links.invocation.span_id": "$ctx.trace.span_id",
            },
            args_into="annotation",
            read_only=False,
        ),
        PlatformOp(
            op="discover_triggers",
            description=_DISCOVER_TRIGGERS_DESCRIPTION,
            method="POST",
            path="/api/triggers/discover",
            input_schema=_DISCOVER_TRIGGERS_INPUT_SCHEMA,
            read_only=True,
        ),
        PlatformOp(
            op="create_schedule",
            description=_CREATE_SCHEDULE_DESCRIPTION,
            method="POST",
            path="/api/triggers/schedules/",
            input_schema=_CREATE_SCHEDULE_INPUT_SCHEMA,
            context_bindings={
                "schedule.data.references.workflow_variant.id": "$ctx.workflow.variant.id"
            },
            args_into="schedule",
            read_only=False,
        ),
        PlatformOp(
            op="create_subscription",
            description=_CREATE_SUBSCRIPTION_DESCRIPTION,
            method="POST",
            path="/api/triggers/subscriptions/",
            input_schema=_CREATE_SUBSCRIPTION_INPUT_SCHEMA,
            context_bindings={
                "subscription.data.references.workflow_variant.id": "$ctx.workflow.variant.id"
            },
            args_into="subscription",
            read_only=False,
        ),
        PlatformOp(
            op="list_schedules",
            description="List this project's trigger schedules.",
            method="GET",
            path="/api/triggers/schedules/",
            input_schema=_EMPTY_INPUT_SCHEMA,
            read_only=True,
        ),
        PlatformOp(
            op="list_subscriptions",
            description="List this project's trigger subscriptions.",
            method="GET",
            path="/api/triggers/subscriptions/",
            input_schema=_EMPTY_INPUT_SCHEMA,
            read_only=True,
        ),
        PlatformOp(
            op="list_deliveries",
            description="List trigger delivery logs so the agent can inspect recent fires and tests.",
            method="GET",
            path="/api/triggers/deliveries",
            input_schema=_EMPTY_INPUT_SCHEMA,
            read_only=True,
        ),
        PlatformOp(
            op="list_connections",
            description="List trigger connections visible to this project.",
            method="POST",
            path="/api/triggers/connections/query",
            input_schema=_EMPTY_INPUT_SCHEMA,
            read_only=True,
        ),
        PlatformOp(
            op="test_subscription",
            description=_TEST_SUBSCRIPTION_DESCRIPTION,
            method="POST",
            path="/api/triggers/subscriptions/test",
            input_schema=_TEST_SUBSCRIPTION_INPUT_SCHEMA,
            args_into="subscription",
            read_only=False,
        ),
        PlatformOp(
            op="remove_schedule",
            description="Delete a trigger schedule by id. Requires approval.",
            method="DELETE",
            path="/api/triggers/schedules/{id}",
            input_schema=_TRIGGER_ID_INPUT_SCHEMA,
            read_only=False,
        ),
        PlatformOp(
            op="remove_subscription",
            description="Delete a trigger subscription by id. Requires approval.",
            method="DELETE",
            path="/api/triggers/subscriptions/{id}",
            input_schema=_TRIGGER_ID_INPUT_SCHEMA,
            read_only=False,
        ),
        PlatformOp(
            op="pause_schedule",
            description="Pause a trigger schedule without deleting it. Requires approval.",
            method="POST",
            path="/api/triggers/schedules/{id}/stop",
            input_schema=_TRIGGER_ID_INPUT_SCHEMA,
            read_only=False,
        ),
        PlatformOp(
            op="resume_schedule",
            description="Resume a paused trigger schedule. Requires approval.",
            method="POST",
            path="/api/triggers/schedules/{id}/start",
            input_schema=_TRIGGER_ID_INPUT_SCHEMA,
            read_only=False,
        ),
        PlatformOp(
            op="pause_subscription",
            description="Pause a trigger subscription without deleting it. Requires approval.",
            method="POST",
            path="/api/triggers/subscriptions/{id}/stop",
            input_schema=_TRIGGER_ID_INPUT_SCHEMA,
            read_only=False,
        ),
        PlatformOp(
            op="resume_subscription",
            description="Resume a paused trigger subscription. Requires approval.",
            method="POST",
            path="/api/triggers/subscriptions/{id}/start",
            input_schema=_TRIGGER_ID_INPUT_SCHEMA,
            read_only=False,
        ),
    )
}


def get_platform_op(op: str) -> PlatformOp:
    """Look up a catalog op by key, raising :class:`UnknownPlatformOpError` if it is not defined."""
    try:
        return PLATFORM_OPS[op]
    except KeyError:
        raise UnknownPlatformOpError(op=op, available=sorted(PLATFORM_OPS)) from None
