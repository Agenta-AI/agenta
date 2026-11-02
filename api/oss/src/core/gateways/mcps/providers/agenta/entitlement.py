"""Which callback tools a builtin Agenta MCP credential may name.

`POST /gateways/mcps/credentials/agenta` signs a tool list into a credential the sandbox
then holds, so that list — and nothing else — decides what the sandbox may reach through
the builtin bridge. The endpoint exists to narrow, and a list its own caller chooses
freely narrows nothing.

Two bounds apply, in this order:

- **Never widen.** A credential that already carries `gateway_tools` carries a set some
  earlier mint already bounded, so a request presenting one may only ask for a subset of
  it, matched on the whole ``(name, call_ref)`` pair. Renaming a carried `call_ref` is a
  widening too: the name is what the model reads when it picks a tool.
- **Stay inside the callback catalog.** A credential carrying no tool list is the run
  credential the API minted at invoke time, and the run's own resolved set is not knowable
  here: `gateway_run_id` is a signed claim, not a row, and the tools are resolved by the
  SDK inside the workflow service, which is the party asking. The bound that remains is
  the catalog of call_refs `POST /tools/call` will dispatch at all — a registered reserved
  handler, one of the two runtime gateway tools, a workflow reference, or a connection
  slug. Each of those four still resolves against the caller's own project, and re-checks
  its own permission, when the credential is finally spent.

The grammar below mirrors the dispatcher in `apis/fastapi/tools/router.py::call_tool`:
anything that route would refuse to route is refused here rather than signed into a
credential.
"""

import re
from typing import Any, Dict, FrozenSet, List, Optional, Sequence, Tuple

from oss.src.core.gateways.mcps.types import MCPAgentaToolNotEntitledError

# Reserved handler-mode platform ops (`tools.agenta.{op}`). Membership, not just the
# prefix, is the check: an unregistered reserved call_ref is a 404 at call time, so
# signing one only defers the refusal.
_RESERVED_CALL_REF_PREFIX = "tools.agenta."

# The two runtime gateway tools. They route on a stable name and read their identity from
# the run's private context, so there is nothing else to validate about them.
_RUNTIME_GATEWAY_CALL_REFS = frozenset({"gateway.search", "gateway.run"})

# `workflow.variant.{slug}[.{version}]` and `workflow.environment.{environment}.{slug}`.
_WORKFLOW_CALL_REF_PREFIX = "workflow."

# `tools.{provider}.{integration}.{action}.{connection}`.
_CONNECTION_CALL_REF_SEGMENTS = 5

_SLUG_SEGMENT_RE = re.compile(r"[a-zA-Z0-9_-]+")


def _registered_reserved_call_refs() -> FrozenSet[str]:
    """The reserved call_refs that have a registered handler.

    Imported inside the function: the handler registry pulls in the workflows and tracing
    services, and this module is imported by the gateway router at application startup.
    """
    from oss.src.core.tools.platform_handlers import (  # pylint: disable=import-outside-toplevel
        PLATFORM_TOOL_HANDLERS,
    )

    return frozenset(PLATFORM_TOOL_HANDLERS)


def _segments_are_slugs(segments: Sequence[str]) -> bool:
    return all(
        bool(segment) and _SLUG_SEGMENT_RE.fullmatch(segment) for segment in segments
    )


def _is_workflow_call_ref(call_ref: str) -> bool:
    parts = call_ref[len(_WORKFLOW_CALL_REF_PREFIX) :].split(".")
    axis, operands = parts[0], parts[1:]
    if axis == "variant":
        # `variant.{slug}` (the mutable alias) or `variant.{slug}.{version}` (pinned).
        return len(operands) in (1, 2) and _segments_are_slugs(operands)
    if axis == "environment":
        # `environment.{environment}.{slug}`.
        return len(operands) == 2 and _segments_are_slugs(operands)
    return False


def is_callback_catalog_call_ref(call_ref: str) -> bool:
    """Whether `POST /tools/call` would dispatch this call_ref at all."""
    if call_ref.startswith(_RESERVED_CALL_REF_PREFIX):
        return call_ref in _registered_reserved_call_refs()
    if call_ref in _RUNTIME_GATEWAY_CALL_REFS:
        return True
    if call_ref.startswith(_WORKFLOW_CALL_REF_PREFIX):
        return _is_workflow_call_ref(call_ref)
    segments = call_ref.split(".")
    return (
        len(segments) == _CONNECTION_CALL_REF_SEGMENTS
        and segments[0] == "tools"
        and _segments_are_slugs(segments[1:])
    )


def _identity(tool: Dict[str, Any]) -> Tuple[Optional[Any], Optional[Any]]:
    return tool.get("name"), tool.get("call_ref")


def _label(tool: Dict[str, Any]) -> str:
    name, call_ref = _identity(tool)
    return f"{name}:{call_ref}"


def entitled_agenta_tools(
    *,
    requested: Sequence[Dict[str, Any]],
    carried: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """The tool list to sign, or a refusal naming every entry outside the bound.

    `carried` is the presenting credential's own `gateway_tools` claim, taken from the
    request state. A list — even an empty one — is a bound; anything else (the usual
    ``None``) means the presenter carries no tool set of its own.
    """
    if isinstance(carried, list):
        allowed = {_identity(tool) for tool in carried if isinstance(tool, dict)}
        refused = [tool for tool in requested if _identity(tool) not in allowed]
    else:
        refused = [
            tool
            for tool in requested
            if not is_callback_catalog_call_ref(str(tool.get("call_ref") or ""))
        ]

    if refused:
        raise MCPAgentaToolNotEntitledError(tools=[_label(tool) for tool in refused])

    return list(requested)
