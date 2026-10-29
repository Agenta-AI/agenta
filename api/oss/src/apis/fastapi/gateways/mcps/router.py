"""MCP gateway management and OAuth connection router."""

import html as html_lib
import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse

from oss.src.apis.fastapi.gateways.exceptions import handle_gateway_exceptions
from oss.src.apis.fastapi.gateways.flags import MCP_GATEWAY_ENABLED
from oss.src.apis.fastapi.gateways.mcps.models import (
    MCPAgentaCredentialRequest,
    MCPAgentaCredentialResponse,
    MCPConnectAttemptResponse,
    MCPConnectRequest,
    MCPConnectResponse,
    MCPEndpointCheckRequest,
    MCPEndpointCreateRequest,
    MCPEndpointEditRequest,
    MCPEndpointProbeRequest,
    MCPEndpointProbeResponse,
    MCPEndpointQueryRequest,
    MCPEndpointResponse,
    MCPEndpointsResponse,
)
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.apis.fastapi.vault.router import SecretSafeRoute
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import get_access_service
from oss.src.core.gateways.dtos import GatewayAuthScheme, GatewayEndpointNamespace
from oss.src.core.gateways.egress import validate_egress_url_format
from oss.src.core.gateways.mcps.dtos import (
    MCPCredentialBinding,
    MCPOAuthData,
    check_url_secret_placeholder,
)
from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttemptStatus,
)
from oss.src.core.gateways.mcps.providers.agenta.entitlement import (
    entitled_agenta_tools,
)
from oss.src.core.gateways.mcps.types import MCPEndpointNotFoundError
from oss.src.core.gateways.run_claims import gateway_run_id, gateway_tools
from oss.src.core.gateways.types import GatewaysError
from oss.src.utils.context import AuthScope, get_auth_scope
from oss.src.middlewares.auth import (
    GATEWAY_TOKEN_AUDIENCE,
    resolve_session_user_id,
    request_run_envelope,
    sign_secret_token,
)
from oss.src.utils.env import env
from oss.src.utils.exceptions import intercept_exceptions

if TYPE_CHECKING:
    from oss.src.core.gateways.mcps.service import MCPGatewayService
    from oss.src.core.gateways.mcps.oauth.service import MCPOAuthConnectService
    from oss.src.core.gateways.mcps.probe import MCPServerProbe


def _guard_custom_endpoint_url(*, url: Optional[str], probe: bool = False) -> None:
    """Validate a custom MCP endpoint URL before saving it.

    Under the gateway's own egress policy, not the webhook one: whatever this accepts here
    is what the relay will dial later, so the two cannot be allowed to disagree (see
    `core/gateways/egress.py::validate_egress_url_format`).

    The probe's body has no `endpoint.data.route.base_url`, and the connect sheet shows its
    refusal to a person as is, so the probe names the field by the sheet's label instead.
    """
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Server URL is required."
            if probe
            else "endpoint.data.route.base_url is required",
        )
    try:
        validate_egress_url_format(url, label="Server URL" if probe else "URL")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e) if probe else f"endpoint.data.route.base_url is invalid: {e}",
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
        # `SecretSafeRoute` drops the submitted value from validation errors. A body here
        # can carry a key: a base_url that still holds the bound query parameter is refused,
        # and FastAPI's default 422 would echo that URL, key included, back to the caller.
        self.router = APIRouter(
            dependencies=[MCP_GATEWAY_ENABLED], route_class=SecretSafeRoute
        )

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
            responses={
                status.HTTP_409_CONFLICT: {
                    "description": "The row no longer matches `pending_auth_mode`, "
                    "has a credential bound, or has a sign-in in flight."
                }
            },
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}/check",
            self.record_endpoint_check,
            methods=["POST"],
            operation_id="record_mcp_endpoint_check",
            response_model=MCPEndpointResponse,
            response_model_exclude_none=True,
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
            "/endpoints/{endpoint_id}/connect/attempts/{attempt_id}",
            self.fetch_connect_attempt,
            methods=["GET"],
            operation_id="fetch_mcp_connect_attempt",
            response_model=MCPConnectAttemptResponse,
            response_model_exclude_none=True,
            responses={
                status.HTTP_404_NOT_FOUND: {"description": "The attempt is not found."}
            },
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}/connect/attempts/{attempt_id}",
            self.cancel_connect_attempt,
            methods=["DELETE"],
            operation_id="cancel_mcp_connect_attempt",
            status_code=status.HTTP_204_NO_CONTENT,
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

        envelope = request_run_envelope(request)
        if envelope is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Agenta MCP credentials require an invocation credential",
            )

        tools = entitled_agenta_tools(
            requested=[tool.model_dump(mode="json") for tool in body.tools],
            carried=gateway_tools(request),
        )
        token = await sign_secret_token(
            user_id=str(scope.user_id),
            project_id=str(scope.project_id),
            organization_id=str(scope.organization_id),
            gateway_run_id=run_id,
            gateway_tools=tools,
            audience=GATEWAY_TOKEN_AUDIENCE,
            envelope=envelope,
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
        pending_auth_mode: Optional[GatewayAuthScheme] = Query(default=None),
    ) -> None:
        """Delete a connection.

        A connect sheet abandoning the row it made sends `pending_auth_mode`, the mode it
        made the row in, after it cancelled its own sign-in. The row is then deleted only
        while it is still in that mode with no credential bound and no sign-in in flight,
        decided under the connection's lock. The answer is 409 only when the row's
        `auth_mode` no longer matches `pending_auth_mode`, a credential is bound, or a
        sign-in is in flight. A change to another field, such as the name or URL, does not
        by itself keep the row.
        """
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        deleted = await self.service.delete_endpoint(
            project_id=scope.project_id,
            #
            endpoint_id=endpoint_id,
            pending_auth_mode=pending_auth_mode,
        )
        if not deleted:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
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
        _guard_custom_endpoint_url(url=body.url, probe=True)
        # A `{secret}` address is checked with the key it needs, and only a url binding
        # fills one: the rule a create applies to `base_url` and its binding.
        binding = None
        if body.secret_id:
            binding = body.credential_binding or MCPCredentialBinding(kind="url")
        try:
            check_url_secret_placeholder(body.url, binding)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
            ) from e
        secret = None
        if body.secret_id:
            secret = await self.service.probe_secret_value(
                scope=scope, secret_id=body.secret_id
            )
            if not secret:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="The secret holds no single value to send.",
                )

        result = await self.server_probe.probe(
            server_url=body.url, secret=secret, binding=binding
        )

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
            oauth_config=endpoint.data.oauth_config,
        )

        return MCPConnectResponse(
            count=1,
            redirect_url=start.authorization_url,
            attempt_id=str(start.attempt_id),
            expires_in=start.expires_in,
        )

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

        # Decided by the service on the connection as it stands under its OAuth lock, so a
        # connection an edit just moved to an API key keeps its key.
        disconnected = await self.oauth_connect_service.disconnect(
            project_id=scope.project_id,
            user_id=scope.user_id,
            endpoint_id=endpoint_id,
        )
        if disconnected is None:
            # A write that produced no row is not a disconnect. Reporting one would say
            # the authorization is gone while the connection still names it (D20).
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )
        if (
            disconnected.namespace != GatewayEndpointNamespace.CUSTOM
            or disconnected.auth_mode != GatewayAuthScheme.OAUTH
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="endpoint is not a custom OAuth target",
            )

        return MCPEndpointResponse(count=1, endpoint=disconnected)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def fetch_connect_attempt(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
        attempt_id: UUID,
    ) -> MCPConnectAttemptResponse:
        """How one consent attempt stands.

        The sheet asks when the popup closes or the wait runs out without a message from
        the callback page, which is how a result posted to an opener that is gone, or to
        an origin the app is not on, still reaches the person.
        """
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        outcome = await self.oauth_connect_service.outcome(
            project_id=scope.project_id,
            endpoint_id=endpoint_id,
            attempt_id=attempt_id,
        )
        if outcome is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="attempt not found",
            )

        return MCPConnectAttemptResponse(count=1, attempt=outcome)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def record_endpoint_check(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
        body: MCPEndpointCheckRequest,
    ) -> MCPEndpointResponse:
        """Record the result of a check the connect sheet ran.

        The connection's row can then say when it was last checked and how that went. The
        check itself is the sheet's handshake through the relay; agent calls never write
        this."""
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        endpoint = await self.service.record_endpoint_check(
            project_id=scope.project_id,
            user_id=scope.user_id,
            #
            endpoint_id=endpoint_id,
            ok=body.ok,
            reason=body.reason,
        )
        if endpoint is None:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )

        return MCPEndpointResponse(count=1, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def cancel_connect_attempt(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
        attempt_id: UUID,
    ) -> None:
        """Cancel one pending consent attempt. Its callback then writes nothing.

        Idempotent: an attempt already settled, cancelled or swept is left as it is.
        """
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        await self.oauth_connect_service.cancel(
            project_id=scope.project_id,
            endpoint_id=endpoint_id,
            attempt_id=attempt_id,
        )

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
        # Every page names the connection and the attempt it answers for, success or
        # failure alike, so the sheet that started this attempt can tell its own result
        # from another's and show the provider's own words. The ids come from the
        # record `state` names; a page with no record behind it names nothing.
        known = await self.oauth_connect_service.lookup(state=state) if state else None

        def page(status_code: int, *, error: Optional[str] = None) -> HTMLResponse:
            return HTMLResponse(
                status_code=status_code,
                content=_connect_card(
                    success=error is None,
                    error=error,
                    agenta_url=env.agenta.web_url,
                    endpoint_id=str(known.endpoint_id) if known else None,
                    attempt_id=str(known.id) if known else None,
                ),
            )

        if not state:
            return page(
                400, error=error_description or error or "Missing state parameter."
            )

        # The principal the callback is checked against. `None` means the browser has
        # no live Agenta session, which is a refusal: the authorization server holds
        # this `state` too, and the session is the only evidence that the browser
        # presenting the code is the browser that started the flow.
        caller_user_id = await resolve_session_user_id(request)

        # Claim the attempt first, on every path, a failure included: only the browser
        # that started it may end it, and a caller refused here changes nothing. Then
        # authorise against it, and only then exchange the code. The permission check
        # needs the project, and the project is a fact of the attempt record.
        try:
            attempt = await self.oauth_connect_service.claim(
                state=state,
                caller_user_id=caller_user_id,
            )
        except GatewaysError as e:
            # Nothing is recorded for a caller who cannot claim the attempt. The
            # provider's own words still show when it sent any.
            return page(400, error=error_description or error or e.message)

        async def fail(status_code: int, message: str) -> HTMLResponse:
            # Recorded for the sheet, which asks when this page's message never reaches it.
            await self.oauth_connect_service.settle(
                attempt=attempt, status=MCPOAuthAttemptStatus.FAILED, error=message
            )
            return page(status_code, error=message)

        if error:
            return await fail(400, error_description or error)
        if not code:
            return await fail(400, "Missing authorization code.")

        # The attempt named the user; the user must still be allowed to edit endpoints
        # in the attempt's project, which they can have lost while consenting. Nothing
        # has been exchanged or written at this point, and nothing will be: the attempt
        # is spent, as any presented handle is, so the person reconnects from Agenta.
        # The callback runs without the auth middleware, so there is no request
        # principal: check the attempt's user explicitly.
        decision = await get_access_service().check_human(
            user_id=UUID(str(attempt.user_id)),
            project_id=UUID(str(attempt.project_id)),
            action=Permission.EDIT_MCP_ENDPOINTS,
        )
        if not decision.allowed:
            return await fail(
                403,
                "You are no longer allowed to edit MCP endpoints in this project. "
                "Nothing was connected; start again from Agenta if this is wrong.",
            )

        # The service owns the rest: the exchange, and the check, write, bind and
        # outcome that follow it under the attempt's lock. It records its own refusals.
        try:
            await self.oauth_connect_service.complete(attempt=attempt, code=code)
        except GatewaysError as e:
            return page(400, error=e.message)

        return page(200)

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


def _origin_of(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    parsed = urlsplit(url)
    if not (parsed.scheme and parsed.netloc):
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _app_origins(agenta_url: Optional[str]) -> List[str]:
    """Every origin this deployment's app is served from, best first.

    The consent result is posted to the opener with an exact target origin, which is what
    keeps it from reaching a window that merely happens to be open. One configured value
    therefore decided that a deployment reachable at a second address delivered the result
    nowhere at all: the dialog waited out its timeout while the connection sat authorized
    behind it. So every origin the deployment declares is offered, and the page names each
    in turn — a post whose target does not match the opener is simply not delivered, so
    this widens which of the deployment's own windows can be reached without widening who
    can read the message (D71).

    Declared, never inferred from the request: the address the browser used to reach this
    page comes from the Host header, and a page that trusted it would post to whatever a
    caller wrote there. The API's own origin is not offered either — it is where this page
    is served from, not where the app is — so a deployment that publishes no app address
    still sends nobody anywhere.
    """
    candidates = [agenta_url, *env.agenta.app_origins]
    origins: List[str] = []
    for candidate in candidates:
        origin = _origin_of(candidate)
        if origin and origin not in origins:
            origins.append(origin)
    return origins


def _connect_card(
    *,
    success: bool,
    error: Optional[str] = None,
    agenta_url: Optional[str] = None,
    endpoint_id: Optional[str] = None,
    attempt_id: Optional[str] = None,
) -> str:
    """A small self-contained HTML page for the browser landing on the callback
    directly. Posts `mcp:oauth:connected` to
    `window.opener` so a popup-driven dashboard reacts without polling."""
    safe_error = html_lib.escape(error) if error else None
    origins = _app_origins(agenta_url)
    agenta_origin = origins[0] if origins else None
    agenta_post_message_origin_js = _json_for_inline_script(agenta_origin)
    agenta_app_origins_js = _json_for_inline_script(origins)

    payload: Dict[str, Any] = {"type": "mcp:oauth:connected", "success": success}
    if error:
        payload["error"] = error
    if endpoint_id:
        payload["endpoint_id"] = endpoint_id
    if attempt_id:
        payload["attempt_id"] = attempt_id
    oauth_complete_message_js = _json_for_inline_script(payload)
    # Where a stranded tab goes back to when its own page left no path behind: the app, which
    # opens the person's last project. Its MCP settings live under a workspace and a project
    # this page does not know, and `/settings` is the older app.
    agenta_return_path_js = _json_for_inline_script("/m/")
    # Where the tab that is about to be navigated away writes down its own scoped path. The
    # same key as `web/packages/agenta-entities/src/mcpEndpoint/core/returnPath.ts`; the two
    # halves only meet in the browser, so the string is repeated rather than shared.
    agenta_return_path_key_js = _json_for_inline_script("agenta:mcp:return-path")

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
    const AGENTA_APP_ORIGINS = {agenta_app_origins_js};
    const AGENTA_OAUTH_COMPLETE = {oauth_complete_message_js};
    const AGENTA_RETURN_PATH = {agenta_return_path_js};
    const AGENTA_RETURN_PATH_KEY = {agenta_return_path_key_js};

    const AGENTA_SUCCESS = {str(success).lower()};
    const opened = Boolean(window.opener) && Boolean(AGENTA_POST_MESSAGE_ORIGIN);

    if (opened) {{
      // The popup path: the dashboard is listening, and a window a script opened may close
      // itself.
      // Once per origin this deployment serves its app from. A post whose target origin
      // does not match the opener is discarded by the browser without being delivered, so
      // naming several reaches the window the person is actually in without letting any
      // other window read the result.
      AGENTA_APP_ORIGINS.forEach(function (origin) {{
        window.opener.postMessage(AGENTA_OAUTH_COMPLETE, origin);
      }});
      const autoReturn = document.getElementById("auto-return-text");
      if (AGENTA_SUCCESS && autoReturn) {{ autoReturn.hidden = false; }}
      if (AGENTA_SUCCESS) {{ setTimeout(function () {{ window.close(); }}, 3000); }}
    }} else if (AGENTA_POST_MESSAGE_ORIGIN) {{
      // No opener, so the app navigated this tab because the popup was blocked. `window.close`
      // is ignored for a tab a script did not open, so without this the person is stranded on
      // the API's origin with the app gone. Send them back to it.
      const manualReturn = document.getElementById("manual-return-text");
      if (manualReturn) {{ manualReturn.hidden = false; }}
      // The page the tab was on wrote down where it stood before it navigated away, because
      // this page knows the deployment's origin and not which surface, workspace or project
      // the person came from. Same-origin deployments hand it back here; anywhere else the
      // storage is simply empty and the settings path below still lands them in the app.
      // A backslash by its character code: this whole script is a Python template, and a
      // literal one written here arrives as an escape that swallows the closing quote. It did:
      // the script stopped parsing, nothing in it ran, and the popup sat on a success card
      // while the dialog behind it waited for a message that was never posted.
      const BACKSLASH = String.fromCharCode(92);
      let target = AGENTA_RETURN_PATH;
      try {{
        const remembered = window.sessionStorage.getItem(AGENTA_RETURN_PATH_KEY);
        // Path-only and one slash: this value is joined to an origin, and "//evil.test" is a
        // URL to another one. The page that stored it checks the same thing; so does this.
        if (
          remembered &&
          remembered.length > 1 &&
          remembered.length <= 2048 &&
          remembered.charAt(0) === "/" &&
          remembered.charAt(1) !== "/" &&
          remembered.indexOf(BACKSLASH) === -1
        ) {{
          target = remembered;
        }}
        window.sessionStorage.removeItem(AGENTA_RETURN_PATH_KEY);
      }} catch (error) {{
        // Storage refused. The fallback path is still a page in the app.
      }}
      setTimeout(function () {{
        window.location.replace(AGENTA_POST_MESSAGE_ORIGIN + target);
      }}, 1500);
    }}
  </script>
</body>
</html>"""
