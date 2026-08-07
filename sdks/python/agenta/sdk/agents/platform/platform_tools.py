"""Agenta adapter for ``type:"platform"`` tools (the platform-op catalog).

Turns each ``type:"platform"`` declaration into a runnable ``callback`` spec that carries a direct
``call`` descriptor — the runner calls the existing Agenta endpoint directly, with no ``/tools/call``
hop. Like the workflow (reference) adapter it makes NO HTTP call here: the op is fully described by
the code-defined catalog (``op_catalog.py``), so the adapter only needs the backend base URL +
per-request auth to assemble the shared :class:`ToolCallback` (which gives the runner the origin to
resolve the relative ``call.path`` against, and the caller credential to reuse).

The catalog owns the description, endpoint, input schema, run-context bindings, and read-only
hint. The config contributes only an explicit per-tool permission when authored.

Lives in the SDK so the service and a connected standalone SDK user resolve platform tools the
same way.
"""

from __future__ import annotations

import os
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

_ENABLE_PLATFORM_HANDLERS_ENV = "AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS"
_DISABLED_ENV_VALUES = {"0", "false", "f", "n", "no", "off", "disable", "disabled"}
# Empty string intentionally follows the default-on behavior. Unset now means enabled.

# Ops whose ONLY transport is handler mode, so disabling handler dispatch does not degrade
# them, it removes them. Skipping an optional op is a degradation; skipping the only
# transport for a core capability is an outage wearing a warning's clothes.
_HANDLER_REQUIRED_OPS = frozenset({"read_config", "commit_revision"})


def _platform_handlers_enabled() -> bool:
    value = os.getenv(_ENABLE_PLATFORM_HANDLERS_ENV)
    if value is None:
        return True
    return value.strip().lower() not in _DISABLED_ENV_VALUES


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
            if op.handler is not None and not _platform_handlers_enabled():
                if op.op in _HANDLER_REQUIRED_OPS:
                    # Loud, not silent. Dropping this tool would leave the model with no
                    # way to read or change its own configuration and no error to report,
                    # so it improvises: it writes workspace files and says it succeeded.
                    # A failed resolution tells the operator what they turned off.
                    error = GatewayToolResolutionError(
                        f"{_ENABLE_PLATFORM_HANDLERS_ENV} is disabled, which removes "
                        f"{op.op!r}: this agent cannot read or change its own "
                        "configuration without it. Unset that variable, or remove the "
                        "config tools from this agent.",
                        reference=op.reserved_id,
                    )
                    log.error("agent: %s", error)
                    raise error
                log.warning(
                    "agent: skipping platform handler-mode op %r because "
                    "%s is explicitly disabled",
                    op.op,
                    _ENABLE_PLATFORM_HANDLERS_ENV,
                )
                continue

            if op.op in seen:
                error = GatewayToolResolutionError(
                    f"Duplicate platform tool: {op.op}",
                    reference=op.reserved_id,
                )
                log.warning("agent: %s", error)
                raise error
            seen.add(op.op)

            # Both modes share the whole spec except the target: handler-mode ops carry a
            # gateway ``call_ref`` (with spec-level bindings the relay injects); endpoint-mode
            # ops carry a direct ``call`` descriptor (bindings ride inside ``call.context``).
            if op.handler is not None:
                target: dict = {
                    "call_ref": op.to_call_ref(),
                    "context_bindings": dict(op.context_bindings) or None,
                }
            else:
                target = {"call": op.to_call()}

            tool_specs.append(
                CallbackToolSpec(
                    name=op.op,
                    description=op.description,
                    input_schema=op.resolved_input_schema(),
                    timeout_ms=op.timeout_ms,
                    render=tool_config.render,
                    permission=tool_config.permission,
                    read_only=op.read_only,
                    # Model-authored arguments the runner deletes before it builds the request
                    # (today: the ephemeral per-call ``description``). Both dispatch modes carry
                    # it, because both must strip before they send.
                    ephemeral_args=op.ephemeral_args,
                    **target,
                )
            )

        return GatewayToolResolution(
            tool_specs=tool_specs,
            tool_callback=ToolCallback(
                endpoint=f"{api_base}/tools/call",
                authorization=authorization,
            ),
        )
