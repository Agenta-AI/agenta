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

from typing import Any, Dict, List, Optional, Sequence

import httpx
from pydantic import ValidationError

from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    CatalogToolInfo,
    GatewayConnectionResolution,
    GatewayConnectionToolConfig,
    GatewayToolConfig,
    GatewayToolResolution,
    GatewayToolResolutionError,
    PermissionMode,
    ResolvedGatewayIntegration,
    ResolvedGatewayPolicy,
    ToolCallback,
    UnsupportedToolProviderError,
    compile_gateway_permissions,
)
from agenta.sdk.utils.logging import get_module_logger

from .connection import PlatformConnection

log = get_module_logger(__name__)

# Cap the reason string so a stray HTML error page (or any oversized body) cannot flood
# the run error. The useful backend detail is a single short sentence; this is only a
# fallback bound for the non-JSON case.
_MAX_DETAIL_LENGTH = 500

# The backend raises ActionNotFoundError with this exact prefix when a committed config
# points at a Composio action that has left the catalog (the F-019 case). Detecting it
# lets us append an actionable remedy the bare "not found" message does not spell out.
_STALE_ACTION_PREFIX = "Action not found:"


def _normalize_reference(reference: str) -> str:
    return reference.replace("__", ".")


def _extract_resolution_detail(response: httpx.Response) -> Optional[str]:
    """Pull the human-facing reason out of a non-2xx ``/tools/resolve`` response.

    The backend puts the useful sentence in the FastAPI error envelope
    (``{"detail": "Action not found: ..."}``). Prefer that. Fall back to a bounded slice
    of the raw body so a non-JSON error page still yields something, without letting a
    large page through. Returns ``None`` when there is nothing usable to surface.
    """
    detail: Optional[str] = None

    try:
        payload = response.json()
    except (ValueError, TypeError):
        payload = None

    if isinstance(payload, dict):
        raw = payload.get("detail")
        if isinstance(raw, str) and raw.strip():
            detail = raw.strip()

    if detail is None:
        text = (response.text or "").strip()
        if text:
            detail = text

    if detail is None:
        return None

    if len(detail) > _MAX_DETAIL_LENGTH:
        detail = detail[:_MAX_DETAIL_LENGTH].rstrip() + " ... (truncated)"
    return detail


def _format_resolution_failure(status_code: int, detail: Optional[str]) -> str:
    """Build the run-error message from the status code and the extracted detail."""
    if not detail:
        return f"Gateway tool resolution failed (HTTP {status_code})"
    message = f"Gateway tool resolution failed: {detail} (HTTP {status_code})"
    if detail.startswith(_STALE_ACTION_PREFIX):
        message += ". Remove or re-resolve this tool; it is no longer in the catalog."
    return message


def _derived_tool_specs() -> List[CallbackToolSpec]:
    """The two runtime tools an agent with at least one connection entry gets.

    Fixed by contracts section 4 and built locally: the API never names them. One pair
    covers every configured integration, because the model selects the integration in the
    arguments rather than through the tool name.

    Both carry ``permission: "allow"``. That is not an authorization decision. It only opens
    the coarse harness gate so the call reaches the runner; the real boundary is the runner's
    semantic gate on ``gateway.run``, which reads the integration and the tool key from the
    arguments and looks them up in the resolved policy. Without the coarse ``allow`` the
    harness would resolve ``run_tool`` through the agent-wide mode and raise a second,
    meaningless approval card named ``run_tool`` before the runner saw the tool key at all.
    """
    return [
        CallbackToolSpec(
            name="search_tools",
            description=(
                "Find tools across the integrations connected to this agent. Describe the "
                "task you want to perform; the result carries the integration, the tool key, "
                "and the input schema to call it with. Returns at most 5 results, best "
                "matches first — a cap, not the whole catalog. If the search fails, retry it "
                "once and no more. If nothing matched, search again with a more specific "
                "description of the task, then stop. Never invent an integration name."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "integration": {"type": "string"},
                },
                "required": ["query"],
            },
            call_ref="gateway.search",
            permission="allow",
            read_only=True,
        ),
        CallbackToolSpec(
            name="run_tool",
            description=(
                "Run one integration tool returned by search_tools. Pass the integration and "
                "tool key exactly as they were returned — the bare tool key, NOT a prefixed "
                "provider action id such as GMAIL_FETCH_EMAILS — and arguments matching the "
                "returned input schema. A refused call will not succeed on a retry or with "
                "reshaped arguments; report the refusal to the user instead."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "integration": {"type": "string"},
                    "tool": {"type": "string"},
                    "arguments": {"type": "object"},
                },
                "required": ["integration", "tool", "arguments"],
            },
            call_ref="gateway.run",
            permission="allow",
        ),
    ]


def _stale_key_warning(integration: str, key: str) -> str:
    """Message for a configured tool key the integration's catalog no longer carries."""
    return (
        f"gateway connection '{integration}': configured tool '{key}' is not in the "
        "catalog and was ignored; remove it or pick a current tool"
    )


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
    """Gateway tool and connection resolvers backed by the Agenta platform."""

    def __init__(self, connection: Optional[PlatformConnection] = None) -> None:
        self._connection = connection or PlatformConnection()

    def _api_base(self) -> str:
        api_base = self._connection.base_url()
        if not api_base:
            error = GatewayToolResolutionError(
                "Agent has gateway tools configured but the Agenta API base URL "
                "is unknown. Set AGENTA_API_URL."
            )
            log.warning("agent: gateway tool resolution failed: %s", error)
            raise error
        return api_base

    async def _post_resolve(
        self,
        *,
        api_base: str,
        authorization: Optional[str],
        references: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """POST one ``/tools/resolve`` request and return its decoded body.

        Shared by both arms so the transport, the error envelope, and the JSON handling
        cannot diverge between them.
        """
        ref_count = len(references)
        headers = self._connection.headers(authorization=authorization)
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
                ref_count,
                exc_info=True,
            )
            raise GatewayToolResolutionError(
                "Gateway tool resolution request failed",
                ref_count=ref_count,
            ) from exc

        if response.status_code >= 400:
            # Read the body the backend already sent. It names the failing tool/action
            # and the real reason (F-019: the SDK used to drop it and surface only the
            # bare status code). Carry the reason on the exception, in both the message
            # and the structured ``detail`` field.
            detail = _extract_resolution_detail(response)
            error = GatewayToolResolutionError(
                _format_resolution_failure(response.status_code, detail),
                status=response.status_code,
                ref_count=ref_count,
                detail=detail,
            )
            log.warning("agent: %s", error)
            raise error

        try:
            return response.json() or {}
        except ValueError as exc:
            log.warning(
                "agent: gateway tool resolution returned invalid JSON",
                exc_info=True,
            )
            raise GatewayToolResolutionError(
                "Gateway tool resolution returned invalid JSON",
                ref_count=ref_count,
            ) from exc

    async def resolve(
        self,
        tools: Sequence[GatewayToolConfig],
    ) -> GatewayToolResolution:
        for tool_config in tools:
            if tool_config.provider != "composio":
                raise UnsupportedToolProviderError(tool_config.provider)

        api_base = self._api_base()

        # Resolve the credential once and reuse it for both the request header and the
        # ToolCallback, so they cannot diverge across the two reads.
        authorization = self._connection.authorization()

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

        payload = await self._post_resolve(
            api_base=api_base,
            authorization=authorization,
            references=references,
        )

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
                    render=tool_config.render,
                    permission=tool_config.permission,
                    read_only=raw_spec.get("read_only"),
                )
            )

        return GatewayToolResolution(
            tool_specs=tool_specs,
            tool_callback=ToolCallback(
                endpoint=f"{api_base}/tools/call",
                authorization=authorization,
            ),
        )

    @staticmethod
    def _catalog_entries(
        integration: str,
        raw_tools: Any,
    ) -> List[CatalogToolInfo]:
        """Parse one integration's catalog slice, as this resolver's typed error.

        A malformed entry would otherwise surface as a raw ``pydantic.ValidationError``,
        which names a field path and never the integration — so the caller cannot tell
        which connection is at fault, and it escapes the ``GatewayToolResolutionError``
        contract every other failure on this path honors.
        """
        try:
            return [CatalogToolInfo.model_validate(raw_tool) for raw_tool in raw_tools]
        except ValidationError as exc:
            error = GatewayToolResolutionError(
                "Gateway connection resolution returned a malformed catalog entry "
                f"for integration: {integration}"
            )
            log.warning("agent: %s (%s)", error, exc)
            raise error from exc

    async def resolve_connections(
        self,
        tools: Sequence[GatewayConnectionToolConfig],
        *,
        mode: PermissionMode,
    ) -> GatewayConnectionResolution:
        """Resolve ``gateway_connection`` entries into the two runtime tools and one policy.

        One request carries every connection entry, and the API answers each with the whole
        catalog slice for that integration (contracts section 3). The compiler then runs once
        per integration, locally, with the agent-wide ``mode``: the API never sees the policy
        and never decides a permission.

        The two derived tool specifications are the same pair whatever the agent configures,
        so they are built once here rather than once per connection.
        """
        for tool_config in tools:
            if tool_config.connection.provider != "composio":
                raise UnsupportedToolProviderError(tool_config.connection.provider)

        api_base = self._api_base()
        authorization = self._connection.authorization()

        # The reference carries `policy` because the API model requires it, but `/tools/resolve`
        # uses this call for ROUTING ONLY — it resolves the connection and returns the catalog,
        # and `ToolsService._resolve_gateway_connection` never reads the permissions. Compilation
        # happens below, in `compile_gateway_permissions`, on this side. Do not read the API's
        # acceptance of `policy` as enforcement, and do not drop the client-side compilation on
        # the assumption that the server applied it.
        payload = await self._post_resolve(
            api_base=api_base,
            authorization=authorization,
            references=[tool_config.model_dump(mode="json") for tool_config in tools],
        )

        raw_slices = (
            payload.get("gateway_connections") if isinstance(payload, dict) else None
        )
        if not isinstance(raw_slices, list):
            raw_slices = []
        # A malformed slice simply does not land here, which the per-entry check below then
        # reports by name. That message is the actionable one, so this loop stays silent
        # rather than raising a second, vaguer error for the same condition.
        catalogs: Dict[str, List[CatalogToolInfo]] = {
            str(raw_slice["integration"]): self._catalog_entries(
                str(raw_slice["integration"]),
                raw_slice.get("tools") or [],
            )
            for raw_slice in raw_slices
            if isinstance(raw_slice, dict) and raw_slice.get("integration")
        }

        integrations: Dict[str, ResolvedGatewayIntegration] = {}
        warnings: List[str] = []
        for tool_config in tools:
            integration = tool_config.connection.integration
            catalog = catalogs.get(integration)
            if catalog is None:
                # The API validates the connection, so a missing slice means the request and
                # the response disagree about what was asked for. Failing the run is right:
                # an integration with no catalog would silently compile to no permitted tool.
                error = GatewayToolResolutionError(
                    "Gateway connection resolution did not return integration: "
                    f"{integration}"
                )
                log.warning("agent: %s", error)
                raise error
            compiled = compile_gateway_permissions(
                tool_config.policy.permissions,
                catalog,
                mode,
            )
            integrations[integration] = ResolvedGatewayIntegration(
                provider=tool_config.connection.provider,
                connection=tool_config.connection.slug,
                tools=compiled.tools,
            )
            for key in compiled.stale_keys:
                warning = _stale_key_warning(integration, key)
                log.warning("agent: %s", warning)
                warnings.append(warning)

        return GatewayConnectionResolution(
            tool_specs=_derived_tool_specs(),
            tool_callback=ToolCallback(
                endpoint=f"{api_base}/tools/call",
                authorization=authorization,
            ),
            gateway_policy=ResolvedGatewayPolicy(integrations=integrations),
            warnings=warnings,
        )
