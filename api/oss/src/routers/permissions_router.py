from uuid import UUID
from typing import Optional

from fastapi.responses import JSONResponse
from fastapi import Request, Query, HTTPException

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache

from oss.src.utils.common import is_ee, is_oss, APIRouter

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access


router = APIRouter()

log = get_module_logger(__name__)


class Allow(JSONResponse):
    def __init__(
        self,
        credentials: Optional[str] = None,
    ) -> None:
        super().__init__(
            status_code=200,
            content={
                "effect": "allow",
                "credentials": credentials,
            },
        )


class Deny(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=403,
            detail="Forbidden",
        )


@router.get(
    "/verify",
    operation_id="verify_permissions",
)
async def verify_permissions(
    request: Request,
    action: Optional[str] = Query(None),
    scope_type: Optional[str] = Query(None),
    scope_id: Optional[UUID] = Query(None),
    resource_type: Optional[str] = Query(None),
    resource_id: Optional[UUID] = Query(None),
):
    cache_key = {
        "action": action,
        "scope_type": scope_type,
        "scope_id": scope_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
    }

    try:
        if is_oss():
            return Allow(request.state.credentials)

        if not action or not resource_type:
            log.warn("Missing required parameters: action, resource_type")
            raise Deny()

        allow = await get_cache(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            namespace="verify_permissions",
            key=cache_key,
        )

        if allow == "allow":
            return Allow(request.state.credentials)
        if allow == "deny":
            log.warn("Permission denied")
            raise Deny()

        # CHECK PERMISSION 1/3: SCOPE
        allow_scope = await check_scope_access(
            # organization_id=request.state.organization_id,
            workspace_id=request.state.workspace_id,
            project_id=request.state.project_id,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        if not allow_scope:
            log.warn("Scope access denied")
            await set_cache(
                project_id=request.state.project_id,
                user_id=request.state.user_id,
                namespace="verify_permissions",
                key=cache_key,
                value="deny",
                ttl=5 * 60,  # seconds
            )
            raise Deny()

        if is_ee():
            # CHECK PERMISSION 1/2: ACTION
            allow_action = await check_action_access(
                project_id=request.state.project_id,
                user_uid=request.state.user_id,
                permission=Permission(action),
            )

            if not allow_action:
                log.warn("Action access denied")
                await set_cache(
                    project_id=request.state.project_id,
                    user_id=request.state.user_id,
                    namespace="verify_permissions",
                    key=cache_key,
                    value="deny",
                    ttl=5 * 60,  # seconds
                )
                raise Deny()

        # CHECK PERMISSION 3/3: RESOURCE
        allow_resource = await check_resource_access(
            resource_type=resource_type,
        )

        if not allow_resource:
            log.warn("Resource access denied")
            await set_cache(
                project_id=request.state.project_id,
                user_id=request.state.user_id,
                namespace="verify_permissions",
                key=cache_key,
                value="deny",
                ttl=5 * 60,  # seconds
            )
            raise Deny()

        await set_cache(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            namespace="verify_permissions",
            key=cache_key,
            value="allow",
            ttl=5 * 60,  # seconds
        )
        return Allow(request.state.credentials)

    except Exception as exc:  # pylint: disable=bare-except
        log.warn(exc)
        await set_cache(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            namespace="verify_permissions",
            key=cache_key,
            value="deny",
            ttl=5 * 60,  # seconds
        )
        raise Deny() from exc


async def check_scope_access(
    # organization_id: UUID,
    workspace_id: UUID,
    project_id: UUID,
    scope_type: Optional[str] = None,
    scope_id: Optional[UUID] = None,
) -> bool:
    allow_scope = False

    if scope_type == "project":
        allow_scope = str(project_id) == str(scope_id)
    elif scope_type == "workspace":
        allow_scope = str(workspace_id) == str(scope_id)
    # elif scope_type == "organization":
    #     allow_scope = str(organization_id) == str(scope_id)
    elif not scope_type and not scope_id:
        allow_scope = True

    return allow_scope


async def check_resource_access(
    resource_type: Optional[str] = None,
) -> bool:
    allow_resource = False

    if resource_type == "service":
        allow_resource = True

    return allow_resource
