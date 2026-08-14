"""`MCPGatewayProxy`: the MCP data plane's protocol surface (entities.md §9).

Three thin routes, one per namespace (D27); they exist because the routes carry different
path parameters, not because the behaviour differs. Each parses the caller's routing
headers, reads the raw body, and delegates to `MCPGatewayService.relay` (WP9), which owns
target resolution, the allowlist check, secret resolution and the outbound guard. No
wire models here — the data plane relays bytes (§6).

**Error mapping is NOT `apis/fastapi/gateways/exceptions.py::handle_gateway_exceptions()`.**
That decorator (seed, R1) raises a plain `HTTPException(status_code, detail=str)`, which is
right for WP10's CRUD routers (they speak the house wire) and wrong here: it collapses every
cause that shares a status into one indistinguishable message — `MCPEndpointNotFoundError`
and `SecretNotFoundError` both become an opaque `HTTPException` a caller cannot tell
apart. §9 requires the opposite of a proxy: "the MCP proxy answers protocol-shaped errors at
the transport status the relay produced, and gateway-authored refusals as the protocol's
error result with the same stable causes in the error data." So this module keeps its own
exception -> response mapping, `_map_gateway_exception`, producing a JSON-RPC error result
carrying a stable `cause` string in `error.data` — never the house `{code,message,
retryable,...}` envelope, which must not leak onto this surface. The HTTP status each cause
takes is still exactly what `handle_gateway_exceptions()`'s table assigns; only the body
shape and the added cause differ. The upstream's own protocol-level error is untouched by
any of this: `HttpMCPAdapter` never raises for a non-2xx status or a JSON-RPC `error` body
(D16), so it reaches the caller as `MCPRelayResult` pass-through, not through this mapping.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, Optional

from fastapi import APIRouter, Request, Response, status

from oss.src.apis.fastapi.gateways.mcps.utils import (
    parse_mcp_call_context,
    split_builtin_path,
)
from oss.src.apis.fastapi.gateways.utils import response_headers, with_code_marker
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.types import GatewayEndpointInactiveError
from oss.src.core.gateways.mcps.types import (
    MCPAuthRequiredError,
    MCPEndpointNotFoundError,
    MCPScopeInsufficientError,
    MCPToolNotAllowedError,
    MCPUpstreamError,
)
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    SecretInvalidError,
    SecretNotFoundError,
    EntitlementDeniedError,
    PolicyDeniedError,
)
from oss.src.utils.context import get_auth_scope
from oss.src.utils.exceptions import intercept_exceptions

if TYPE_CHECKING:
    from oss.src.core.gateways.mcps.service import MCPGatewayService

# JSON-RPC 2.0 reserved codes: -32600 is "Invalid Request" (our own pre-relay header
# validation); -32000 is the start of the implementation-defined "Server error" range,
# used for every gateway-authored refusal below (the numeric code carries no further
# meaning — the stable `cause` string in `error.data` is what a caller branches on).
_JSONRPC_INVALID_REQUEST = -32600
_JSONRPC_SERVER_ERROR = -32000

# Every exception `_map_gateway_exception` knows how to translate. `_relay` catches
# exactly this tuple; anything else is a bug, not a gateway refusal, and is left to
# `intercept_exceptions()`'s generic path.
_MAPPED_EXCEPTIONS = (
    GatewayEndpointInactiveError,
    ValueError,
    MCPEndpointNotFoundError,
    PolicyDeniedError,
    EntitlementDeniedError,
    MCPToolNotAllowedError,
    CeilingExceededError,
    MCPAuthRequiredError,
    MCPScopeInsufficientError,
    SecretNotFoundError,
    SecretInvalidError,
    MCPUpstreamError,
)


def _forwarded_headers(request: Request) -> Dict[str, str]:
    """The caller's headers, stripped of Agenta's own gateway-token authorization —
    an upstream `custom` server must never see the platform secret that authenticated
    the caller to us (§7.1's pass-through rule stops at the body and status, not our
    own credentials)."""
    return {
        key: value
        for key, value in request.headers.items()
        if key.lower() != "authorization"
    }


def _protocol_error(
    *,
    status_code: int,
    code: int,
    message: str,
    cause: str,
    data: Optional[Dict[str, Any]] = None,
    marked: bool = True,
) -> Response:
    """A JSON-RPC error result. `id` is always `null`: this proxy never parses the
    caller's body, only its headers (§9), so the request id a spec-faithful echo would
    need is simply unavailable — the same situation JSON-RPC 2.0 reserves a null id
    for (an error raised before the id could be read).

    `message` carries the code marker (WP25, OD18; `gateways/utils.py::with_code_marker`)
    for every cause except `upstream_error` — same reasoning and same exclusion as the LLM
    plane's `_openai_error`: `cause` already rides structured in `error.data`, so the marker
    is redundant here whenever a harness's SDK keeps that structure, and load-bearing only
    for one that keeps `message` alone and discards everything else (Codex)."""
    rendered = with_code_marker(message, cause) if marked else message
    error_data = {"cause": cause, **(data or {})}
    payload = {
        "jsonrpc": "2.0",
        "id": None,
        "error": {"code": code, "message": rendered, "data": error_data},
    }
    return Response(
        content=json.dumps(payload).encode(),
        status_code=status_code,
        media_type="application/json",
    )


def _map_gateway_exception(e: BaseException) -> Response:
    if isinstance(e, ValueError):
        return _protocol_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=_JSONRPC_INVALID_REQUEST,
            message=str(e),
            cause="invalid_request",
        )
    if isinstance(e, MCPEndpointNotFoundError):
        return _protocol_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="endpoint_not_found",
            data={"namespace": e.namespace.value, "name": e.name},
        )
    if isinstance(e, PolicyDeniedError):
        return _protocol_error(
            status_code=status.HTTP_403_FORBIDDEN,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="policy_denied",
        )
    if isinstance(e, EntitlementDeniedError):
        return _protocol_error(
            status_code=status.HTTP_403_FORBIDDEN,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="entitlement_denied",
        )
    if isinstance(e, MCPToolNotAllowedError):
        return _protocol_error(
            status_code=status.HTTP_403_FORBIDDEN,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="tool_not_allowed",
            data={"tool": e.tool},
        )
    if isinstance(e, CeilingExceededError):
        return _protocol_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="ceiling_exceeded",
            data={
                "ceiling": e.ceiling,
                "requested": e.requested,
                "allowed": e.allowed,
            },
        )
    if isinstance(e, MCPAuthRequiredError):
        return _protocol_error(
            status_code=status.HTTP_409_CONFLICT,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="auth_required",
            data={"requirement": e.requirement.model_dump(mode="json")},
        )
    if isinstance(e, MCPScopeInsufficientError):
        return _protocol_error(
            status_code=status.HTTP_409_CONFLICT,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="scope_insufficient",
            data={"target": e.target, "scopes": e.scopes},
        )
    if isinstance(e, GatewayEndpointInactiveError):
        return _protocol_error(
            status_code=status.HTTP_403_FORBIDDEN,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="endpoint_inactive",
        )
    if isinstance(e, SecretNotFoundError):
        return _protocol_error(
            status_code=status.HTTP_409_CONFLICT,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="secret_missing",
        )
    if isinstance(e, SecretInvalidError):
        return _protocol_error(
            status_code=status.HTTP_409_CONFLICT,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="secret_invalid",
        )
    if isinstance(e, MCPUpstreamError):
        upstream_status = e.status_code
        return _protocol_error(
            status_code=(
                status.HTTP_502_BAD_GATEWAY
                if upstream_status is not None and upstream_status >= 500
                else status.HTTP_424_FAILED_DEPENDENCY
            ),
            code=_JSONRPC_SERVER_ERROR,
            message=e.detail or e.message,
            cause="upstream_error",
            data={"target": e.target},
            marked=False,
        )
    raise e  # pragma: no cover - unreachable: _MAPPED_EXCEPTIONS stays exhaustive with this


class MCPGatewayProxy:
    def __init__(self, *, mcp_gateway_service: "MCPGatewayService") -> None:
        self.service = mcp_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/builtin/{provider}/{rest:path}",
            self.relay_builtin,
            methods=["POST"],
            operation_id="mcp_gateway_relay_builtin",
        )
        self.router.add_api_route(
            "/custom/{slug}",
            self.relay_custom,
            methods=["POST"],
            operation_id="mcp_gateway_relay_custom",
        )

        for path in (
            "/builtin/{provider}/{rest:path}",
            "/custom/{slug}",
        ):
            self.router.add_api_route(
                path,
                self.reject_stream_verbs,
                methods=["GET", "DELETE"],
                include_in_schema=False,
            )

    async def _relay(
        self,
        *,
        request: Request,
        namespace: GatewayEndpointNamespace,
        name: str,
        provider: Optional[str] = None,
        integration: Optional[str] = None,
    ) -> Response:
        scope = get_auth_scope()
        headers = _forwarded_headers(request)

        try:
            context = parse_mcp_call_context(headers=headers)
            body = await request.body()

            result = await self.service.relay(
                scope=scope,
                namespace=namespace,
                name=name,
                provider=provider,
                integration=integration,
                #
                context=context,
                body=body,
                headers=headers,
            )
        except _MAPPED_EXCEPTIONS as e:
            return _map_gateway_exception(e)

        return Response(
            content=result.body,
            status_code=result.status_code,
            headers=response_headers(result.headers),
        )

    @intercept_exceptions()
    async def relay_builtin(
        self, request: Request, provider: str, rest: str
    ) -> Response:
        # Each builtin provider owns the grammar under its own segment (D30): composio
        # addresses a connection as {integration}/{connection}, agenta a bare slug.
        integration, name = split_builtin_path(provider=provider, rest=rest)
        return await self._relay(
            request=request,
            namespace=GatewayEndpointNamespace.BUILTIN,
            name=name,
            provider=provider,
            integration=integration,
        )

    @intercept_exceptions()
    async def relay_custom(self, request: Request, slug: str) -> Response:
        return await self._relay(
            request=request,
            namespace=GatewayEndpointNamespace.CUSTOM,
            name=slug,
        )

    async def reject_stream_verbs(self) -> Response:
        return Response(status_code=status.HTTP_405_METHOD_NOT_ALLOWED)
