"""Agenta adapter for ``type:"platform"`` tools (the platform-op catalog).

Turns each ``type:"platform"`` declaration into a runnable ``callback`` spec that carries a direct
``call`` descriptor — the runner calls the existing Agenta endpoint directly, with no ``/tools/call``
hop. Like the workflow (reference) adapter it makes NO HTTP call here: the op is fully described by
the code-defined catalog (``op_catalog.py``), so the adapter only needs the backend base URL +
per-request auth to assemble the shared :class:`ToolCallback` (which gives the runner the origin to
resolve the relative ``call.path`` against, and the caller credential to reuse).

The catalog owns the description, endpoint, input schema, run-context bindings, and per-op default
permission/approval. The config's ``needs_approval`` / ``permission`` override the catalog default
when set; otherwise the catalog default applies (a mutating op defaults to approval, a read to
auto-allow).

Lives in the SDK so the service and a connected standalone SDK user resolve platform tools the
same way.
"""

from __future__ import annotations

from typing import Optional, Sequence

from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    GatewayToolResolution,
    GatewayToolResolutionError,
    PlatformToolConfig,
    ToolCallback,
)
from agenta.sdk.utils.logging import get_module_logger

from .connection import PlatformConnection
from .op_catalog import get_platform_op

log = get_module_logger(__name__)


class AgentaPlatformToolResolver:
    """:class:`PlatformToolResolver` backed by the platform-op catalog + ``PlatformConnection``."""

    def __init__(self, connection: Optional[PlatformConnection] = None) -> None:
        self._connection = connection or PlatformConnection()

    async def resolve(
        self,
        tools: Sequence[PlatformToolConfig],
    ) -> GatewayToolResolution:
        api_base = self._connection.base_url()
        if not api_base:
            error = GatewayToolResolutionError(
                "Agent has platform (type:'platform') tools configured but the Agenta API "
                "base URL is unknown. Set AGENTA_AGENT_TOOLS_API_URL or AGENTA_API_URL."
            )
            log.warning("agent: platform tool resolution failed: %s", error)
            raise error

        # Resolve the credential once and reuse it for the ToolCallback so the resolved endpoint
        # and its auth cannot diverge (mirrors the gateway/workflow resolvers).
        authorization = self._connection.authorization()

        seen: set[str] = set()
        tool_specs: list[CallbackToolSpec] = []
        for tool_config in tools:
            op = get_platform_op(tool_config.op)
            if op.op in seen:
                error = GatewayToolResolutionError(
                    f"Duplicate platform tool: {op.op}",
                    reference=op.reserved_id,
                )
                log.warning("agent: %s", error)
                raise error
            seen.add(op.op)

            # Catalog default unless the author overrode it. ``needs_approval`` is optional on the
            # config (None = unset), so a mutating op stays gated by default.
            needs_approval = (
                tool_config.needs_approval
                if tool_config.needs_approval is not None
                else op.default_needs_approval
            )
            permission = tool_config.permission or op.default_permission

            tool_specs.append(
                CallbackToolSpec(
                    name=op.op,
                    description=op.description,
                    input_schema=op.resolved_input_schema(),
                    call=op.to_call(),
                    needs_approval=needs_approval,
                    render=tool_config.render,
                    permission=permission,
                )
            )

        return GatewayToolResolution(
            tool_specs=tool_specs,
            tool_callback=ToolCallback(
                endpoint=f"{api_base}/tools/call",
                authorization=authorization,
            ),
        )
