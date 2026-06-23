"""Agenta HTTP adapter for server-bound gateway tools.

Resolves gateway (Composio) tool declarations into runnable callback specs by asking the
Agenta platform (`POST /tools/resolve`), and points their calls back at `/tools/call`. This
is the connected path: gateway tools are platform-executed, so any backend that runs them
calls the platform. Lives in the SDK so the service and a connected standalone SDK user
resolve gateway tools the same way.

The returned `ToolCallback(endpoint, auth)` stays assembled here on purpose: the gateway
endpoint is intrinsic to a gateway tool (there is only one transport), so it is a transport
hint the backend forwards, not a choice the backend makes.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

import httpx

from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    GatewayToolConfig,
    GatewayToolResolution,
    GatewayToolResolutionError,
    ToolCallback,
    UnsupportedToolProviderError,
)
from agenta.sdk.utils.logging import get_module_logger

from .connection import PlatformConnection

log = get_module_logger(__name__)


def _normalize_reference(reference: str) -> str:
    return reference.replace("__", ".")


def _to_gateway_reference(tool_config: GatewayToolConfig) -> Dict[str, Any]:
    reference: Dict[str, Any] = {
        "type": "gateway",
        "provider": tool_config.provider,
        "integration": tool_config.integration,
        "action": tool_config.action,
        "connection": tool_config.connection,
    }
    if tool_config.name:
        reference["name"] = tool_config.name
    return reference


class AgentaGatewayToolResolver:
    """`GatewayToolResolver` backed by the Agenta platform's `/tools/resolve` endpoint."""

    def __init__(self, connection: Optional[PlatformConnection] = None) -> None:
        self._connection = connection or PlatformConnection()

    async def resolve(
        self,
        tools: Sequence[GatewayToolConfig],
    ) -> GatewayToolResolution:
        for tool_config in tools:
            if tool_config.provider != "composio":
                raise UnsupportedToolProviderError(tool_config.provider)

        api_base = self._connection.base_url()
        if not api_base:
            error = GatewayToolResolutionError(
                "Agent has gateway tools configured but the Agenta API base URL "
                "is unknown. Set AGENTA_AGENT_TOOLS_API_URL or AGENTA_API_URL."
            )
            log.warning("agent: gateway tool resolution failed: %s", error)
            raise error

        # Resolve the credential once and reuse it for both the request header and the
        # ToolCallback, so they cannot diverge across the two reads.
        authorization = self._connection.authorization()
        headers = self._connection.headers(authorization=authorization)

        references = [_to_gateway_reference(tool_config) for tool_config in tools]
        configs_by_reference: dict[str, GatewayToolConfig] = {}
        for tool_config in tools:
            reference = _normalize_reference(tool_config.reference)
            if reference in configs_by_reference:
                error = GatewayToolResolutionError(
                    f"Duplicate gateway reference: {reference}",
                    reference=reference,
                )
                log.warning("agent: %s", error)
                raise error
            configs_by_reference[reference] = tool_config

        try:
            async with httpx.AsyncClient(timeout=self._connection.timeout) as client:
                response = await client.post(
                    f"{api_base}/tools/resolve",
                    json={"tools": references},
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            log.warning(
                "agent: gateway tool resolution request failed for %d tool(s)",
                len(tools),
                exc_info=True,
            )
            raise GatewayToolResolutionError(
                "Gateway tool resolution request failed",
                ref_count=len(tools),
            ) from exc

        if response.status_code >= 400:
            error = GatewayToolResolutionError(
                f"Gateway tool resolution failed (HTTP {response.status_code})",
                status=response.status_code,
                ref_count=len(tools),
            )
            log.warning("agent: %s", error)
            raise error

        try:
            payload = response.json() or {}
        except ValueError as exc:
            log.warning(
                "agent: gateway tool resolution returned invalid JSON",
                exc_info=True,
            )
            raise GatewayToolResolutionError(
                "Gateway tool resolution returned invalid JSON",
                ref_count=len(tools),
            ) from exc

        raw_specs = payload.get("custom") if isinstance(payload, dict) else None
        if not isinstance(raw_specs, list):
            raw_specs = []
        if len(raw_specs) != len(tools):
            error = GatewayToolResolutionError(
                f"Gateway tool resolution returned {len(raw_specs)} spec(s) for "
                f"{len(tools)} ref(s); expected one per ref.",
                ref_count=len(tools),
                spec_count=len(raw_specs),
            )
            log.warning("agent: %s", error)
            raise error

        specs_by_reference: dict[str, dict[str, Any]] = {}
        for raw_spec in raw_specs:
            if not isinstance(raw_spec, dict):
                error = GatewayToolResolutionError(
                    "Gateway tool resolution returned a non-object spec"
                )
                log.warning("agent: %s", error)
                raise error
            call_ref = raw_spec.get("call_ref")
            if not call_ref:
                error = GatewayToolResolutionError(
                    "Gateway tool resolution returned an incomplete spec "
                    f"(name={raw_spec.get('name')!r}, call_ref={call_ref!r})"
                )
                log.warning("agent: %s", error)
                raise error
            reference = _normalize_reference(str(call_ref))
            if reference in specs_by_reference:
                error = GatewayToolResolutionError(
                    f"Gateway tool resolution returned duplicate ref: {reference}",
                    reference=reference,
                )
                log.warning("agent: %s", error)
                raise error
            specs_by_reference[reference] = raw_spec

        tool_specs: list[CallbackToolSpec] = []
        for reference, tool_config in configs_by_reference.items():
            raw_spec = specs_by_reference.get(reference)
            if raw_spec is None:
                error = GatewayToolResolutionError(
                    f"Gateway tool resolution did not return ref: {reference}",
                    reference=reference,
                )
                log.warning("agent: %s", error)
                raise error
            name = raw_spec.get("name")
            if not name:
                error = GatewayToolResolutionError(
                    f"Gateway tool resolution returned an incomplete spec for {reference}",
                    reference=reference,
                )
                log.warning("agent: %s", error)
                raise error
            tool_specs.append(
                CallbackToolSpec(
                    name=str(name),
                    description=raw_spec.get("description") or str(name),
                    input_schema=raw_spec.get("input_schema")
                    or {"type": "object", "properties": {}},
                    call_ref=str(raw_spec["call_ref"]),
                    needs_approval=tool_config.needs_approval,
                    render=tool_config.render,
                )
            )

        return GatewayToolResolution(
            tool_specs=tool_specs,
            tool_callback=ToolCallback(
                endpoint=f"{api_base}/tools/call",
                authorization=authorization,
            ),
        )
