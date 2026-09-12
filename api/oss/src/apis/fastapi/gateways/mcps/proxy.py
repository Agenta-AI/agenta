"""Protocol-shaped MCP gateway proxy responses."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, Optional

from fastapi import APIRouter, Request, Response, status

from oss.src.apis.fastapi.gateways.mcps.utils import (
    parse_mcp_call_context,
    split_builtin_path,
)
from oss.src.apis.fastapi.gateways.utils import response_headers, with_code_marker
from oss.src.core.gateways.dtos import (
    GatewayConnectAffordance,
    GatewayEndpointNamespace,
)
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

# JSON-RPC invalid-request and server-error codes.
_JSONRPC_INVALID_REQUEST = -32600
_JSONRPC_SERVER_ERROR = -32000

# Exceptions represented as JSON-RPC gateway errors.
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
    """The caller's headers, stripped of Agenta's own gateway credential —
    an upstream `custom` server must never see the platform secret that authenticated
    the caller to us (§7.1's pass-through rule stops at the body and status, not our
    own credentials). A caller-provided ``Authorization`` header belongs to the
    configured upstream and is intentionally preserved."""
    return {
        key: value
        for key, value in request.headers.items()
        if key.lower() != "x-ag-credentials"
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
    """A JSON-RPC error result. `id` is always `null`: malformed or conflicting
    request metadata is rejected before a trustworthy request id is available.

    `message` carries the code marker for every cause except `upstream_error`, as does the LLM
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
        scope_data: Dict[str, Any] = {"target": e.target, "scopes": e.scopes}
        if e.endpoint_id is not None:
            # Reopen scope discovery so the client can request the required scopes.
            scope_data["connect"] = GatewayConnectAffordance(
                endpoint=f"/gateways/mcps/endpoints/{e.endpoint_id}/connect",
                body={},
            ).model_dump(mode="json")
        return _protocol_error(
            status_code=status.HTTP_409_CONFLICT,
            code=_JSONRPC_SERVER_ERROR,
            message=e.message,
            cause="scope_insufficient",
            data=scope_data,
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
            "/standard/{provider}",
            self.relay_standard,
            methods=["POST"],
            operation_id="mcp_gateway_relay_standard",
        )
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
            "/standard/{provider}",
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
            body = await request.body()
            context = parse_mcp_call_context(headers=headers, body=body)

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
                request=request,
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
        # Built-in providers define the path below their provider segment.
        integration, name = split_builtin_path(provider=provider, rest=rest)
        return await self._relay(
            request=request,
            namespace=GatewayEndpointNamespace.BUILTIN,
            name=name,
            provider=provider,
            integration=integration,
        )

    @intercept_exceptions()
    async def relay_standard(self, request: Request, provider: str) -> Response:
        return await self._relay(
            request=request,
            namespace=GatewayEndpointNamespace.STANDARD,
            name=provider,
            provider=provider,
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
