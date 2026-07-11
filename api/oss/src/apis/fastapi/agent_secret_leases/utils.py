from hmac import compare_digest

from fastapi import HTTPException, Request, status

from oss.src.core.agent_secret_leases.dtos import TenantScope
from oss.src.utils.context import get_auth_context
from oss.src.utils.env import env


CONTROL_HEADER = "X-Agenta-Runner-Control-Token"


def janitor_requested(request: Request) -> bool:
    return CONTROL_HEADER in request.headers


def require_janitor(request: Request) -> None:
    configured = env.runner.control_token
    supplied = request.headers.get(CONTROL_HEADER, "")
    if not configured or not supplied or not compare_digest(configured, supplied):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid workload identity"
        )


def tenant_scope_from_context() -> TenantScope:
    context = get_auth_context()
    if context.credentials.kind != "secret":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="invoke Secret credential required",
        )
    return TenantScope(**context.scope.model_dump())
