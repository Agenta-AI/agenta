"""Agenta adapter for kept ``@ag.reference`` workflow tools.

Turns a kept ``@ag.reference`` workflow declaration into a runnable ``callback`` spec and points
its calls back at ``/tools/call``, exactly like the gateway adapter does for Composio actions.
The difference from gateway is intrinsic, not transport: a workflow reference is already concrete
in the config (the model-facing ``name`` / ``description`` / ``input_schema`` are authored), so
there is no enrichment round-trip — the adapter builds the spec directly and only needs the
backend base URL + per-request auth to assemble the shared ``ToolCallback``.

When the model calls the tool the runner POSTs ``{data:{function:{name: call_ref, arguments}}}``
to ``{api}/tools/call``; the server parses the ``workflow.{slug}[.{version}]`` ``call_ref``,
invokes that workflow revision with the model's arguments, and returns the result. Any
connections/secrets the workflow needs stay server-side — the gateway tool's safety shape.

Lives in the SDK so the service and a connected standalone SDK user resolve workflow tools the
same way.
"""

from __future__ import annotations

from typing import Optional, Sequence

from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    GatewayToolResolution,
    GatewayToolResolutionError,
    ReferenceToolConfig,
    ToolCallback,
)
from agenta.sdk.utils.logging import get_module_logger

from .connection import PlatformConnection

log = get_module_logger(__name__)


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
                "Agent has workflow (@ag.reference) tools configured but the Agenta API "
                "base URL is unknown. Set AGENTA_AGENT_TOOLS_API_URL or AGENTA_API_URL."
            )
            log.warning("agent: workflow tool resolution failed: %s", error)
            raise error

        # Resolve the credential once and reuse it for the ToolCallback so the resolved
        # endpoint and its auth cannot diverge.
        authorization = self._connection.authorization()

        seen: set[str] = set()
        tool_specs: list[CallbackToolSpec] = []
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
            tool_specs.append(
                CallbackToolSpec(
                    name=tool_config.tool_name,
                    description=tool_config.description or tool_config.tool_name,
                    input_schema=tool_config.input_schema,
                    call_ref=call_ref,
                    needs_approval=tool_config.needs_approval,
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
