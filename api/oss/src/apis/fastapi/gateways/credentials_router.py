"""The exchange that gives the agent sandbox a credential confined to the gateway.

The runtime's own credential authenticates workflows, tools and vault reads alike, and it
carries the grant that projects write-only vault values in plaintext. Handing that value to
a sandbox would invert the gateway's premise: the gateway exists so the provider key never
enters the sandbox, and a sandbox holding the runtime credential can simply ask for the key.

So the resolver exchanges it here for a second value — same project, same run, no grants,
and an audience the auth middleware refuses anywhere but the gateway data plane. The
exchange itself is not a data-plane route, which is what stops the confined credential from
minting another one.
"""

from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from oss.src.apis.fastapi.gateways.flags import (
    require_llm_gateway_enabled,
    require_mcp_gateway_enabled,
)
from oss.src.core.gateways.policy.dtos import GatewayPlane
from oss.src.core.gateways.run_claims import gateway_run_id, gateway_tools
from oss.src.middlewares.auth import GATEWAY_TOKEN_AUDIENCE, sign_secret_token
from oss.src.utils.context import get_auth_scope
from oss.src.utils.exceptions import intercept_exceptions


class GatewayCredentialsRequest(BaseModel):
    """Optionally, which plane the caller is about to use the credential on.

    The exchange itself is plane-agnostic — one credential reaches both data planes — so
    this field exists for one reason: it is the only moment a caller that is about to use
    the MCP gateway talks to the API before it dials. Without it, an SDK asking for a
    credential cannot learn that the MCP plane is switched off until a tool call fails
    mid-run, which is far too late to fall back to dialling the server directly.

    Optional, so an older SDK that sends `{}` still gets a credential. That caller then
    meets the refusal on the data plane instead, which is a worse error but not a wrong one.
    """

    plane: Optional[GatewayPlane] = None


class GatewayCredentialsResponse(BaseModel):
    """The scheme-tagged credential value, used verbatim as ``X-AG-Credentials``."""

    credentials: str


class GatewayCredentialsRouter:
    def __init__(self) -> None:
        self.router = APIRouter()

        self.router.add_api_route(
            "/credentials",
            self.issue_gateway_credentials,
            methods=["POST"],
            operation_id="issue_gateway_credentials",
            response_model=GatewayCredentialsResponse,
        )

    @intercept_exceptions()
    async def issue_gateway_credentials(
        self,
        request: Request,
        *,
        body: Optional[GatewayCredentialsRequest] = None,
    ) -> GatewayCredentialsResponse:
        """Exchange the caller's credential for one that only the gateway accepts.

        No permission check of its own: the result is strictly weaker than the credential
        that bought it — same tenant scope, same run, fewer routes — so a caller can reach
        nothing here it could not already reach with what it presented.

        It does check the switch for the plane the caller named, because minting a credential
        for a plane that will refuse every request is worse than refusing here: the caller
        still has a pre-gateway path at this point and none once the run is under way.
        """
        plane = body.plane if body else None
        if plane is GatewayPlane.LLM:
            require_llm_gateway_enabled()
        elif plane is GatewayPlane.MCP:
            require_mcp_gateway_enabled()

        scope = get_auth_scope()

        # Carried over rather than re-derived, so the confined credential names the same
        # run as the caller's. The Agenta builtin MCP route reads this run id to decide
        # which callback tools exist, and refuses a credential that names no run at all.
        token = await sign_secret_token(
            user_id=str(scope.user_id),
            project_id=str(scope.project_id),
            workspace_id=str(scope.workspace_id),
            organization_id=str(scope.organization_id),
            gateway_run_id=gateway_run_id(request),
            gateway_tools=gateway_tools(request),
            audience=GATEWAY_TOKEN_AUDIENCE,
        )

        return GatewayCredentialsResponse(credentials=f"Secret {token}")
