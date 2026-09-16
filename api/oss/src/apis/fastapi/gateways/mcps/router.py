"""MCP gateway management and OAuth connection router."""

import html as html_lib
import json
from typing import TYPE_CHECKING, Any, Dict, Optional
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse

from oss.src.apis.fastapi.gateways.exceptions import handle_gateway_exceptions
from oss.src.apis.fastapi.gateways.flags import MCP_GATEWAY_ENABLED
from oss.src.apis.fastapi.gateways.mcps.models import (
    MCPAgentaCredentialRequest,
    MCPAgentaCredentialResponse,
    MCPConnectRequest,
    MCPConnectResponse,
    MCPEndpointCreateRequest,
    MCPEndpointEditRequest,
    MCPEndpointProbeRequest,
    MCPEndpointProbeResponse,
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
    MCPOAuthData,
)
from oss.src.core.gateways.mcps.providers.agenta.entitlement import (
    entitled_agenta_tools,
)
from oss.src.core.gateways.mcps.types import MCPEndpointNotFoundError
from oss.src.core.gateways.run_claims import gateway_run_id, gateway_tools
from oss.src.core.gateways.types import GatewaysError
from oss.src.core.webhooks.utils import validate_url_format_and_literal_ip
from oss.src.utils.context import AuthScope, get_auth_scope
from oss.src.middlewares.auth import (
    GATEWAY_TOKEN_AUDIENCE,
    resolve_session_user_id,
    sign_secret_token,
)
from oss.src.utils.env import env
from oss.src.utils.exceptions import intercept_exceptions

if TYPE_CHECKING:
    from oss.src.core.gateways.mcps.service import MCPGatewayService
    from oss.src.core.gateways.mcps.oauth.service import MCPOAuthConnectService
    from oss.src.core.gateways.mcps.probe import MCPServerProbe


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


class MCPGatewayRouter:
    def __init__(
        self,
        *,
        mcp_gateway_service: "MCPGatewayService",
        oauth_connect_service: "MCPOAuthConnectService",
        server_probe: "MCPServerProbe",
    ):
        self.service = mcp_gateway_service
        self.oauth_connect_service = oauth_connect_service
        self.server_probe = server_probe
        # The kill switch covers the connect flow as well as endpoint management: a browser
        # returning to `/connect/callback` after an operator turned the plane off is holding
        # an authorization code for a gateway that no longer serves, and storing the grant it
        # buys would leave a connection nobody can use. The probe is on the same router and
        # so behind the same switch, which is right: checking a URL is the first step of that
        # same flow.
        self.router = APIRouter(dependencies=[MCP_GATEWAY_ENABLED])

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
        # Before `/endpoints/{endpoint_id}`: `probe` would otherwise be read as a UUID
        # path parameter and answer 422.
        self.router.add_api_route(
            "/endpoints/probe",
            self.probe_endpoint,
            methods=["POST"],
            operation_id="probe_mcp_endpoint",
            response_model=MCPEndpointProbeResponse,
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
            "/endpoints/{endpoint_id}/connect",
            self.disconnect_endpoint,
            methods=["DELETE"],
            operation_id="disconnect_mcp_endpoint",
            response_model=MCPEndpointResponse,
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
        #
        # Deliberately NOT gated on AGENTA_MCP_GATEWAY_ENABLED. Expiring abandoned OAuth
        # attempts is table maintenance, not a product surface, and a deployment that turns
        # the plane off still wants the rows it already has swept rather than kept forever.
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
    @handle_gateway_exceptions()
    async def issue_agenta_credential(
        self,
        request: Request,
        *,
        body: MCPAgentaCredentialRequest,
    ) -> MCPAgentaCredentialResponse:
        """Narrow an invocation credential to its resolved callback tools.

        Three guards, because the value this hands back travels into a sandbox:

        - Only the API-created service token contains ``gateway_run_id``.  Browser
          and API-key callers therefore cannot mint a credential for Agenta tools
          at all.
        - The caller must hold the permission that governs SPENDING the MCP
          gateway, which is where the issued credential is spent
          (`MCPGatewayService.relay` authorizes the same one on every call). A
          credential can then never reach a plane its buyer could not reach.
        - The tool list is bounded rather than signed as given
          (:func:`entitled_agenta_tools`): a credential already carrying a tool set
          may only narrow it, and one carrying none may still only name call_refs
          `POST /tools/call` would dispatch.

        The issued value is confined to the gateway audience, like the one
        `POST /gateways/credentials` hands the sandbox for every other MCP server.
        That is what makes the bound hold: an audience-bound credential cannot reach
        this route (it is not a data-plane path), so the narrowed credential can
        never buy a wider one.
        """
        run_id = gateway_run_id(request)
        if run_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Agenta MCP credentials require an invocation credential",
            )

        scope = get_auth_scope()
        await self._check(scope, Permission.USE_MCP_ENDPOINTS)

        tools = entitled_agenta_tools(
            requested=[tool.model_dump(mode="json") for tool in body.tools],
            carried=gateway_tools(request),
        )
        token = await sign_secret_token(
            user_id=str(scope.user_id),
            project_id=str(scope.project_id),
            workspace_id=str(scope.workspace_id),
            organization_id=str(scope.organization_id),
            gateway_run_id=run_id,
            gateway_tools=tools,
            audience=GATEWAY_TOKEN_AUDIENCE,
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
        if endpoint is None:
            # A create that produced no record is not a success with a zero count. The
            # route used to answer `200 {"count": 0}` here, which reads as "done" to
            # every client and leaves nobody anything to act on.
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="the MCP endpoint could not be created",
            )

        return MCPEndpointResponse(count=1, endpoint=endpoint)

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

        # Take the connection's grant with it. Deleting the row alone left the grant in
        # the vault with nothing naming it: unreachable, unlistable as a connection, and
        # still holding a live token. Ordered before the row goes, because the row is
        # what says which grant this was.
        endpoint = await self.service.fetch_endpoint(
            project_id=scope.project_id,
            #
            endpoint_id=endpoint_id,
        )
        if endpoint is not None:
            await self._drop_grant(scope=scope, endpoint=endpoint)

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

    async def _drop_grant(self, *, scope: AuthScope, endpoint: MCPEndpoint) -> bool:
        """Delete the connection's stored grant, if it is the kind that has one."""
        if endpoint.auth_mode != GatewayAuthScheme.OAUTH:
            return False
        server_url = endpoint.data.route.base_url
        if not server_url:
            return False
        return await self.oauth_connect_service.disconnect(
            project_id=scope.project_id,
            endpoint_id=endpoint.id,
            server_url=server_url,
        )

    # URL inspection, before any row exists

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def probe_endpoint(
        self,
        *,
        body: MCPEndpointProbeRequest,
    ) -> MCPEndpointProbeResponse:
        """Report what a URL is, so the connect journey can ask for a URL first.

        Gated on EDIT_MCP_ENDPOINTS rather than VIEW: this makes the deployment fetch an
        address of the caller's choosing, so it is the permission to add a server, not the
        permission to look at one.
        """
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        # The same check a create runs, so a URL the probe accepts is one that can be
        # saved and a person is refused at the first step rather than the last.
        _guard_custom_endpoint_url(url=body.url)

        result = await self.server_probe.probe(server_url=body.url)

        return MCPEndpointProbeResponse(count=1, probe=result)

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

            await self.service.cache_endpoint_discovery(
                project_id=scope.project_id,
                user_id=scope.user_id,
                #
                endpoint_id=endpoint.id,
                oauth=MCPOAuthData(
                    resource=discovery.resource,
                    authorization_server=discovery.authorization_server,
                    scopes_offered=discovery.scopes_offered,
                ),
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

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def disconnect_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
    ) -> MCPEndpointResponse:
        """Drop one connection's authorization and keep the connection itself.

        The connection survives with its id, slug, name, URL and tool policy intact, so
        every agent configured against it stays configured and one Connect reconnects
        it. Deleting the endpoint is the other operation, and it is not this one.

        Only this connection's grant goes. Another account at the same server keeps its
        own, which is what the connection-keyed grant is for.

        Idempotent: disconnecting something already disconnected returns the endpoint
        and changes nothing, so a repeated click or a retried request is not an error.
        """
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

        await self._drop_grant(scope=scope, endpoint=endpoint)

        # The handle goes whether or not a row was there to delete: a `secret_id`
        # pointing at nothing is the state that made an endpoint report itself ready
        # and then fail every call.
        disconnected = await self.service.bind_endpoint_secret(
            project_id=scope.project_id,
            user_id=scope.user_id,
            #
            endpoint_id=endpoint.id,
            secret_id=None,
        )
        if disconnected is None:
            # A write that produced no row is not a disconnect. Reporting one would say
            # the authorization is gone while the connection still names it (D20).
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="endpoint not found",
            )

        return MCPEndpointResponse(count=1, endpoint=disconnected)

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

        # Consume the attempt first, authorise against it, and only then exchange the
        # code. The permission check needs the project, and the project is a fact of
        # the attempt record; running `complete()` first would have written the grant
        # into that project's vault before anyone asked whether this caller may still
        # write to it.
        try:
            attempt = await self.oauth_connect_service.claim(
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
        # in the attempt's project, which they can have lost while consenting. Nothing
        # has been exchanged or written at this point, and nothing will be: the attempt
        # is spent, as any presented handle is, so the person reconnects from Agenta.
        allowed = await check_action_access(
            user_uid=str(attempt.user_id),
            project_id=str(attempt.project_id),
            permission=Permission.EDIT_MCP_ENDPOINTS,
        )
        if not allowed:
            return HTMLResponse(
                status_code=403,
                content=_connect_card(
                    success=False,
                    error=(
                        "You are no longer allowed to edit MCP endpoints in this "
                        "project. Nothing was connected; start again from Agenta if "
                        "this is wrong."
                    ),
                    agenta_url=env.agenta.web_url,
                ),
            )

        try:
            completion = await self.oauth_connect_service.complete(
                attempt=attempt,
                code=code,
            )
        except GatewaysError as e:
            return HTMLResponse(
                status_code=400,
                content=_connect_card(
                    success=False, error=e.message, agenta_url=env.agenta.web_url
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

        bound = await self.service.bind_endpoint_secret(
            project_id=completion.project_id,
            user_id=completion.user_id,
            #
            endpoint_id=target.id,
            secret_id=completion.secret_id,
        )
        if bound is None:
            # The grant was written and the connection does not name it, so the person
            # would be told they were connected by a card over a connection that still
            # reads as needing authorization (D20).
            return HTMLResponse(
                status_code=400,
                content=_connect_card(
                    success=False,
                    error="The authorization could not be saved to this connection.",
                    agenta_url=env.agenta.web_url,
                ),
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
    # Where a stranded tab goes back to. The settings surface owns connections, and it is the
    # one place that is right whichever surface started the flow.
    agenta_return_path_js = _json_for_inline_script("/settings?tab=mcpEndpoints")

    accent = "#16a34a" if success else "#dc2626"
    icon = "✓" if success else "✕"
    if success:
        heading_html = '<p class="h-line">The MCP server is connected.</p>'
    else:
        heading_html = f'<p class="h-error">{safe_error or "Something went wrong."}</p>'
    # Two different situations, and the page cannot tell them apart until it runs: a popup,
    # which has an opener and can close itself, and a tab the app navigated because the popup
    # was blocked, which has neither. The script below picks the line that applies.
    auto_return_html = (
        '<p id="auto-return-text" class="auto-return" hidden>This tab will close automatically in 3 seconds...</p>'  # noqa: E501
        '<p id="manual-return-text" class="auto-return" hidden>Taking you back to Agenta...</p>'
        if success
        else '<p id="manual-return-text" class="auto-return" hidden>Taking you back to Agenta...</p>'
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
    const AGENTA_RETURN_PATH = {agenta_return_path_js};

    const AGENTA_SUCCESS = {str(success).lower()};
    const opened = Boolean(window.opener) && Boolean(AGENTA_POST_MESSAGE_ORIGIN);

    if (opened) {{
      // The popup path: the dashboard is listening, and a window a script opened may close
      // itself.
      window.opener.postMessage(AGENTA_OAUTH_COMPLETE, AGENTA_POST_MESSAGE_ORIGIN);
      const autoReturn = document.getElementById("auto-return-text");
      if (AGENTA_SUCCESS && autoReturn) {{ autoReturn.hidden = false; }}
      if (AGENTA_SUCCESS) {{ setTimeout(function () {{ window.close(); }}, 3000); }}
    }} else if (AGENTA_POST_MESSAGE_ORIGIN) {{
      // No opener, so the app navigated this tab because the popup was blocked. `window.close`
      // is ignored for a tab a script did not open, so without this the person is stranded on
      // the API's origin with the app gone. Send them back to it.
      const manualReturn = document.getElementById("manual-return-text");
      if (manualReturn) {{ manualReturn.hidden = false; }}
      setTimeout(function () {{
        window.location.replace(AGENTA_POST_MESSAGE_ORIGIN + AGENTA_RETURN_PATH);
      }}, 1500);
    }}
  </script>
</body>
</html>"""
