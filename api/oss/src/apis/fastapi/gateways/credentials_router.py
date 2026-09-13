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

from fastapi import APIRouter, Request
from pydantic import BaseModel

from oss.src.middlewares.auth import GATEWAY_TOKEN_AUDIENCE, sign_secret_token
from oss.src.utils.context import get_auth_scope
from oss.src.utils.exceptions import intercept_exceptions


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
    ) -> GatewayCredentialsResponse:
        """Exchange the caller's credential for one that only the gateway accepts.

        No permission check of its own: the result is strictly weaker than the credential
        that bought it — same tenant scope, same run, fewer routes — so a caller can reach
        nothing here it could not already reach with what it presented.
        """
        scope = get_auth_scope()

        # Carried over rather than re-derived, so the confined credential names the same
        # run as the caller's. The Agenta builtin MCP route reads this run id to decide
        # which callback tools exist, and refuses a credential that names no run at all.
        run_id = getattr(request.state, "gateway_run_id", None)
        tools = getattr(request.state, "gateway_tools", None)

        token = await sign_secret_token(
            user_id=str(scope.user_id),
            project_id=str(scope.project_id),
            workspace_id=str(scope.workspace_id),
            organization_id=str(scope.organization_id),
            gateway_run_id=run_id if isinstance(run_id, str) and run_id else None,
            gateway_tools=tools if isinstance(tools, list) else None,
            audience=GATEWAY_TOKEN_AUDIENCE,
        )

        return GatewayCredentialsResponse(credentials=f"Secret {token}")
