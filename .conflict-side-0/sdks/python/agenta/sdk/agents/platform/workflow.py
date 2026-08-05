"""Agenta adapter for ``type:"reference"`` workflow tools.

Turns a ``type:"reference"`` workflow declaration into a runnable ``callback`` spec and points
its calls back at ``/tools/call``, exactly like the gateway adapter does for Composio actions.
The difference from gateway is intrinsic, not transport: a workflow reference is already concrete
in the config (the model-facing ``name`` / ``description`` / ``input_schema`` are authored), so
there is no enrichment round-trip — the adapter builds the spec directly and only needs the
backend base URL + per-request auth to assemble the shared ``ToolCallback``.

When the model calls the tool the runner POSTs ``{data:{function:{name: call_ref, arguments}}}``
to ``{api}/tools/call``; the server parses the ``workflow.{axis}.*`` ``call_ref``, invokes that
workflow revision with the model's arguments, and returns the result. Any connections/secrets the
workflow needs stay server-side — the gateway tool's safety shape.

Lives in the SDK so the service and a connected standalone SDK user resolve workflow tools the
same way.
"""

from __future__ import annotations

from typing import Optional, Sequence

from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    ClientToolSpec,
    GatewayToolResolution,
    GatewayToolResolutionError,
    ReferenceToolConfig,
    ToolCallback,
)
from agenta.sdk.utils.logging import get_module_logger

from ._schema import expand_type_refs
from .connection import PlatformConnection

log = get_module_logger(__name__)

REQUEST_CONNECTION_WORKFLOW_SLUG = "__ag__request_connection"
REQUEST_CONNECTION_TOOL_NAME = "request_connection"


class AgentaWorkflowToolResolver:
    """:class:`WorkflowToolResolver` backed by the Agenta backend's ``/tools/call`` endpoint."""

    def __init__(self, connection: Optional[PlatformConnection] = None) -> None:
        self._connection = connection or PlatformConnection()

    async def resolve(
        self,
        tools: Sequence[ReferenceToolConfig],
    ) -> GatewayToolResolution:
        api_base = self._connection.base_url()
        if not api_base:
            error = GatewayToolResolutionError(
                "Agent has workflow (type:'reference') tools configured but the Agenta API "
                "base URL is unknown. Set AGENTA_AGENT_TOOLS_API_URL or AGENTA_API_URL."
            )
            log.warning("agent: workflow tool resolution failed: %s", error)
            raise error

        # Resolve the credential once and reuse it for the ToolCallback so the resolved
        # endpoint and its auth cannot diverge.
        authorization = self._connection.authorization()

        seen: set[str] = set()
        tool_specs: list[CallbackToolSpec | ClientToolSpec] = []
        for tool_config in tools:
            call_ref = tool_config.call_ref
            if call_ref in seen:
                error = GatewayToolResolutionError(
                    f"Duplicate workflow reference: {call_ref}",
                    reference=call_ref,
                )
                log.warning("agent: %s", error)
                raise error
            seen.add(call_ref)
            if _is_request_connection_workflow(tool_config):
                tool_specs.append(
                    ClientToolSpec(
                        kind="client",
                        name=REQUEST_CONNECTION_TOOL_NAME,
                        description=tool_config.description
                        or "Request a connection from the user.",
                        input_schema=expand_type_refs(tool_config.input_schema),
                        render={"kind": "connect"},
                    )
                )
                continue
            tool_specs.append(
                CallbackToolSpec(
                    name=tool_config.tool_name,
                    description=tool_config.description or tool_config.tool_name,
                    # Expand Agenta catalog pointers (``x-ag-type-ref``, e.g. ``messages``) into
                    # concrete JSON Schema so the harness sees a real shape (an array WITH items,
                    # not a bare ``x-ag-type-ref``) and can construct the call. Reference tools are
                    # the only tool kind whose schema comes from a workflow's inputs and so can
                    # carry these pointers; code/client tools author plain JSON Schema.
                    input_schema=expand_type_refs(tool_config.input_schema),
                    call_ref=call_ref,
                    render=tool_config.render,
                    permission=tool_config.permission,
                )
            )

        return GatewayToolResolution(
            tool_specs=tool_specs,
            tool_callback=ToolCallback(
                endpoint=f"{api_base}/tools/call",
                authorization=authorization,
            ),
        )


def _is_request_connection_workflow(tool_config: ReferenceToolConfig) -> bool:
    workflow = getattr(tool_config, "workflow", None)
    if getattr(workflow, "slug", None) == REQUEST_CONNECTION_WORKFLOW_SLUG:
        return True

    call_ref = tool_config.call_ref
    return (
        call_ref == f"workflow.variant.{REQUEST_CONNECTION_WORKFLOW_SLUG}"
        or call_ref.startswith(f"workflow.variant.{REQUEST_CONNECTION_WORKFLOW_SLUG}.")
    )
