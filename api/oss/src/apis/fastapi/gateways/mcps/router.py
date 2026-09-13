"""MCP gateway management and OAuth connection router."""

import html as html_lib
import json
from typing import TYPE_CHECKING, Any, Dict, Optional
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse

from oss.src.apis.fastapi.gateways.exceptions import handle_gateway_exceptions
from oss.src.apis.fastapi.gateways.mcps.models import (
    MCPAgentaCredentialRequest,
    MCPAgentaCredentialResponse,
    MCPConnectRequest,
    MCPConnectResponse,
    MCPEndpointCreateRequest,
    MCPEndpointEditRequest,
    MCPEndpointQueryRequest,
    MCPEndpointResponse,
    MCPEndpointsResponse,
)
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.dtos import GatewayAuthScheme, GatewayEndpointNamespace
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointEdit,
    MCPEndpointFlags,
    MCPOAuthData,
)
from oss.src.core.gateways.mcps.types import MCPEndpointNotFoundError
from oss.src.core.gateways.types import GatewaysError
from oss.src.core.webhooks.utils import validate_url_format_and_literal_ip
from oss.src.utils.context import AuthScope, get_auth_scope
from oss.src.middlewares.auth import resolve_session_user_id, sign_secret_token
from oss.src.utils.env import env
from oss.src.utils.exceptions import intercept_exceptions

if TYPE_CHECKING:
    from oss.src.core.gateways.mcps.service import MCPGatewayService
    from oss.src.core.gateways.mcps.oauth.service import MCPOAuthConnectService


def _guard_custom_endpoint_url(*, url: Optional[str]) -> None:
    """Validate a custom MCP endpoint URL before saving it."""
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="endpoint.data.route.base_url is required",
        )
    try:
        validate_url_format_and_literal_ip(url)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"endpoint.data.route.base_url is invalid: {e}",
        ) from e


def _as_edit(
    endpoint: MCPEndpoint, *, secret_id: Optional[UUID] = None
) -> MCPEndpointEdit:
    """Create an editable copy of an endpoint.

    A new grant revalidates the endpoint. The data plane marks one invalid when its
    stored authorization expires and cannot be renewed (OR55); reconnecting is the cure,
    and carrying that flag forward would leave the endpoint refusing calls it can now
    serve.
    """
    flags = (
        MCPEndpointFlags(is_active=endpoint.flags.is_active, is_valid=True)
        if secret_id is not None
        else endpoint.flags
    )
    return MCPEndpointEdit(
        id=endpoint.id,
        name=endpoint.name,
        description=endpoint.description,
        auth_mode=endpoint.auth_mode,
        secret_id=secret_id if secret_id is not None else endpoint.secret_id,
        data=endpoint.data,
        flags=flags,
    )


class MCPGatewayRouter:
    def __init__(
        self,
        *,
        mcp_gateway_service: "MCPGatewayService",
        oauth_connect_service: "MCPOAuthConnectService",
    ):
        self.service = mcp_gateway_service
        self.oauth_connect_service = oauth_connect_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/credentials/agenta",
            self.issue_agenta_credential,
            methods=["POST"],
            operation_id="issue_agenta_mcp_credential",
            response_model=MCPAgentaCredentialResponse,
        )
        self.router.add_api_route(
            "/endpoints/",
            self.create_endpoint,
            methods=["POST"],
            operation_id="create_mcp_endpoint",
            response_model=MCPEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/",
            self.list_endpoints,
            methods=["GET"],
            operation_id="list_mcp_endpoints",
            response_model=MCPEndpointsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/query",
            self.query_endpoints,
            methods=["POST"],
            operation_id="query_mcp_endpoints",
            response_model=MCPEndpointsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}",
            self.fetch_endpoint,
            methods=["GET"],
            operation_id="fetch_mcp_endpoint",
            response_model=MCPEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}",
            self.edit_endpoint,
            methods=["PUT"],
            operation_id="edit_mcp_endpoint",
            response_model=MCPEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}",
            self.delete_endpoint,
            methods=["DELETE"],
            operation_id="delete_mcp_endpoint",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}/connect",
            self.connect_endpoint,
            methods=["POST"],
            operation_id="connect_mcp_endpoint",
            response_model=MCPConnectResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connect/callback",
            self.connect_callback,
            methods=["GET"],
            operation_id="mcp_connect_callback",
            include_in_schema=False,
        )

        # --- OAuth attempt expiry (admin) ---
        # The cron service POSTs to /admin/gateways/mcps/oauth/attempts/sweep, mounted
        # in entrypoints/routers.py under prefix /admin/gateways, the same shape as
        # /admin/triggers/schedules/refresh.
        self.admin_router = APIRouter()
        self.admin_router.add_api_route(
            "/mcps/oauth/attempts/sweep",
            self.sweep_oauth_attempts,
            methods=["POST"],
            operation_id="sweep_mcp_oauth_attempts",
        )

    async def _check(self, scope: AuthScope, permission: Permission) -> None:
        has_permission = await check_action_access(
            user_uid=str(scope.user_id),
            project_id=str(scope.project_id),
            permission=permission,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

    @intercept_exceptions()
    async def issue_agenta_credential(
        self,
        request: Request,
        *,
        body: MCPAgentaCredentialRequest,
    ) -> MCPAgentaCredentialResponse:
        """Narrow an invocation credential to its resolved callback tools.

        Only the API-created service token contains ``gateway_run_id``.  Browser
        and API-key callers therefore cannot mint a credential for arbitrary
        Agenta tools, and the runner receives no credential capable of listing
        tools outside the invoking run.
        """
        run_id = getattr(request.state, "gateway_run_id", None)
        if not isinstance(run_id, str) or not run_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Agenta MCP credentials require an invocation credential",
            )

        scope = get_auth_scope()
        tools = [tool.model_dump(mode="json") for tool in body.tools]
        token = await sign_secret_token(
            user_id=str(scope.user_id),
            project_id=str(scope.project_id),
            workspace_id=str(scope.workspace_id),
            organization_id=str(scope.organization_id),
            gateway_run_id=run_id,
            gateway_tools=tools,
        )
        return MCPAgentaCredentialResponse(credentials=f"Secret {token}")

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def create_endpoint(
        self,
        request: Request,
        *,
        body: MCPEndpointCreateRequest,
    ) -> MCPEndpointResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        _guard_custom_endpoint_url(url=body.endpoint.data.route.base_url)

        endpoint = await self.service.create_endpoint(
            project_id=scope.project_id,
            user_id=scope.user_id,
            #
            endpoint=body.endpoint,
        )

        return MCPEndpointResponse(count=1 if endpoint else 0, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def list_endpoints(
        self,
        request: Request,
    ) -> MCPEndpointsResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.VIEW_MCP_ENDPOINTS)

        endpoints = await self.service.list_endpoints(scope=scope)

        return MCPEndpointsResponse(count=len(endpoints), endpoints=endpoints)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def query_endpoints(
        self,
        request: Request,
        *,
        body: MCPEndpointQueryRequest,
    ) -> MCPEndpointsResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.VIEW_MCP_ENDPOINTS)

        endpoints = await self.service.query_endpoints(
            project_id=scope.project_id,
            #
            endpoint=body.endpoint,
            #
            windowing=body.windowing,
        )

        return MCPEndpointsResponse(count=len(endpoints), endpoints=endpoints)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def fetch_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
    ) -> MCPEndpointResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.VIEW_MCP_ENDPOINTS)

        endpoint = await self.service.fetch_endpoint(
            project_id=scope.project_id,
            #
            endpoint_id=endpoint_id,
        )
        if not endpoint:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )

        return MCPEndpointResponse(count=1, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def edit_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
        body: MCPEndpointEditRequest,
    ) -> MCPEndpointResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        if str(endpoint_id) != str(body.endpoint.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path endpoint_id does not match body id",
            )

        _guard_custom_endpoint_url(url=body.endpoint.data.route.base_url)

        endpoint = await self.service.edit_endpoint(
            project_id=scope.project_id,
            user_id=scope.user_id,
            #
            endpoint=body.endpoint,
        )
        if not endpoint:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )

        return MCPEndpointResponse(count=1, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def delete_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
    ) -> None:
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        deleted = await self.service.delete_endpoint(
            project_id=scope.project_id,
            #
            endpoint_id=endpoint_id,
        )
        if not deleted:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )

    # OAuth consent

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def connect_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
        body: MCPConnectRequest,
    ) -> MCPConnectResponse:
        """One route, two steps. `body.scopes is None` -> discover and cache the
        checklist onto the row; a list (possibly empty) -> begin and return the
        authorization redirect."""
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        endpoint = await self.service.fetch_endpoint(
            project_id=scope.project_id,
            #
            endpoint_id=endpoint_id,
        )
        if not endpoint:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )
        if (
            endpoint.namespace != GatewayEndpointNamespace.CUSTOM
            or endpoint.auth_mode != GatewayAuthScheme.OAUTH
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="endpoint is not a custom OAuth target",
            )

        server_url = endpoint.data.route.base_url
        if not server_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="endpoint.data.route.base_url is required",
            )

        if body.scopes is None:
            discovery = await self.oauth_connect_service.discover(server_url=server_url)

            endpoint.data.oauth = MCPOAuthData(
                resource=discovery.resource,
                authorization_server=discovery.authorization_server,
                scopes_offered=discovery.scopes_offered,
            )
            await self.service.edit_endpoint(
                project_id=scope.project_id,
                user_id=scope.user_id,
                #
                endpoint=_as_edit(endpoint),
            )

            return MCPConnectResponse(count=1, scopes_offered=discovery.scopes_offered)

        start = await self.oauth_connect_service.begin(
            project_id=scope.project_id,
            user_id=scope.user_id,
            endpoint_id=endpoint_id,
            server_url=server_url,
            scopes=body.scopes,
        )

        return MCPConnectResponse(count=1, redirect_url=start.authorization_url)

    async def connect_callback(
        self,
        request: Request,
        *,
        code: Optional[str] = Query(default=None),
        state: Optional[str] = Query(default=None),
        error: Optional[str] = Query(default=None),
        error_description: Optional[str] = Query(default=None),
    ) -> HTMLResponse:
        """Exempt from `auth_middleware`: the browser lands here straight from the
        authorization server, not from an authenticated Agenta API call. Every fact the
        handler acts on comes from the server-side authorization attempt record that
        the opaque `state` names, and the handler resolves the browser's own session to
        check it against that record's user."""
        if error:
            return HTMLResponse(
                status_code=400,
                content=_connect_card(
                    success=False,
                    error=error_description or error,
                    agenta_url=env.agenta.web_url,
                ),
            )
        if not state:
            return HTMLResponse(
                status_code=400,
                content=_connect_card(
                    success=False,
                    error="Missing state parameter.",
                    agenta_url=env.agenta.web_url,
                ),
            )
        if not code:
            return HTMLResponse(
                status_code=400,
                content=_connect_card(
                    success=False,
                    error="Missing authorization code.",
                    agenta_url=env.agenta.web_url,
                ),
            )

        # The principal the callback is checked against. `None` means the browser has
        # no live Agenta session, which is a refusal: the authorization server holds
        # this `state` too, and the session is the only evidence that the browser
        # presenting the code is the browser that started the flow.
        caller_user_id = await resolve_session_user_id(request)

        try:
            completion = await self.oauth_connect_service.complete(
                code=code,
                state=state,
                caller_user_id=caller_user_id,
            )
        except GatewaysError as e:
            return HTMLResponse(
                status_code=400,
                content=_connect_card(
                    success=False, error=e.message, agenta_url=env.agenta.web_url
                ),
            )

        # The attempt named the user; the user must still be allowed to edit endpoints
        # in the attempt's project, which they can have lost while consenting.
        allowed = await check_action_access(
            user_uid=str(completion.user_id),
            project_id=str(completion.project_id),
            permission=Permission.EDIT_MCP_ENDPOINTS,
        )
        if not allowed:
            return HTMLResponse(
                status_code=403,
                content=_connect_card(
                    success=False,
                    error="You are no longer allowed to edit MCP endpoints in this project.",
                    agenta_url=env.agenta.web_url,
                ),
            )

        # The endpoint comes from the attempt's bound id, not from a lookup by server
        # URL: two endpoints in one project can name the same server, and the grant
        # belongs to the one the user pressed connect on.
        target = await self.service.fetch_endpoint(
            project_id=completion.project_id,
            #
            endpoint_id=completion.endpoint_id,
        )
        if target is None or target.auth_mode != GatewayAuthScheme.OAUTH:
            return HTMLResponse(
                status_code=400,
                content=_connect_card(
                    success=False,
                    error="No matching MCP endpoint found for this server.",
                    agenta_url=env.agenta.web_url,
                ),
            )

        await self.service.edit_endpoint(
            project_id=completion.project_id,
            user_id=completion.user_id,
            #
            endpoint=_as_edit(target, secret_id=completion.secret_id),
        )

        return HTMLResponse(
            status_code=200,
            content=_connect_card(
                success=True,
                agenta_url=env.agenta.web_url,
                endpoint_id=str(target.id),
            ),
        )

    # OAuth attempt expiry

    @intercept_exceptions()
    async def sweep_oauth_attempts(self, request: Request) -> Dict[str, int]:
        """Delete authorization attempts nobody came back for.

        Admin-only by mount point (`/admin/...`), which the auth middleware gates on
        the platform `Access` key. An abandoned attempt is inert — single-use and
        already past its expiry — so this is hygiene, not a security control; it keeps
        unreturned PKCE verifiers from accumulating."""
        count = await self.oauth_connect_service.sweep_expired_attempts()

        return {"count": count}


def _json_for_inline_script(value: Any) -> str:
    # `</script>` inside a JSON string would terminate the block early — escape it,
    # same precaution as `tools/router.py::_json_for_inline_script`.
    return json.dumps(value).replace("<", "\\u003c")


def _connect_card(
    *,
    success: bool,
    error: Optional[str] = None,
    agenta_url: Optional[str] = None,
    endpoint_id: Optional[str] = None,
) -> str:
    """A small self-contained HTML page for the browser landing on the callback
    directly. Posts `mcp:oauth:connected` to
    `window.opener` so a popup-driven dashboard reacts without polling."""
    safe_error = html_lib.escape(error) if error else None
    agenta_origin = None
    if agenta_url:
        parsed = urlsplit(agenta_url)
        if parsed.scheme and parsed.netloc:
            agenta_origin = f"{parsed.scheme}://{parsed.netloc}"
    agenta_post_message_origin_js = _json_for_inline_script(agenta_origin)

    payload: Dict[str, Any] = {"type": "mcp:oauth:connected", "success": success}
    if error:
        payload["error"] = error
    if endpoint_id:
        payload["endpoint_id"] = endpoint_id
    oauth_complete_message_js = _json_for_inline_script(payload)

    accent = "#16a34a" if success else "#dc2626"
    icon = "✓" if success else "✕"
    if success:
        heading_html = '<p class="h-line">The MCP server is connected.</p>'
    else:
        heading_html = f'<p class="h-error">{safe_error or "Something went wrong."}</p>'
    auto_return_html = (
        '<p id="auto-return-text" class="auto-return">This tab will close automatically in 3 seconds...</p>'  # noqa: E501
        if success
        else ""
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agenta ↔ MCP server</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f4f4f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }}
    .card {{
      background: #fff;
      border-radius: 16px;
      padding: 48px 40px 40px;
      max-width: 420px;
      width: 90%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }}
    .status-icon {{
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: {accent}18;
      color: {accent};
      font-size: 26px;
      line-height: 56px;
      margin: 0 auto 32px;
    }}
    .h-line {{ font-size: 15px; color: #71717a; line-height: 1.7; }}
    .h-error {{ font-size: 15px; color: {accent}; line-height: 1.6; }}
    .auto-return {{ margin-top: 10px; font-size: 12px; color: #a1a1aa; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="status-icon">{icon}</div>
    {heading_html}
    {auto_return_html}
  </div>
  <script>
    const AGENTA_POST_MESSAGE_ORIGIN = {agenta_post_message_origin_js};
    const AGENTA_OAUTH_COMPLETE = {oauth_complete_message_js};

    if (window.opener && AGENTA_POST_MESSAGE_ORIGIN) {{
      window.opener.postMessage(AGENTA_OAUTH_COMPLETE, AGENTA_POST_MESSAGE_ORIGIN);
    }}
    if ({str(success).lower()}) {{
      setTimeout(function () {{ window.close(); }}, 3000);
    }}
  </script>
</body>
</html>"""
