from typing import Optional, Union
from uuid import UUID

from fastapi.responses import JSONResponse
from fastapi import Request, Query, HTTPException

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache

from oss.src.utils.common import is_ee, is_oss, APIRouter

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access
    from ee.src.utils.entitlements import check_entitlements, Counter


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

        # allow = None
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
        # log.debug("Checking scope access...")
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
            )
            raise Deny()

        # CHECK PERMISSION 1/2: ACTION
        # log.debug("Checking action access...")
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
            )
            raise Deny()

        # CHECK PERMISSION 3/3: RESOURCE
        # log.debug("Checking resource access...")
        allow_resource = await check_resource_access(
            organization_id=request.state.organization_id,
            resource_type=resource_type,
        )

        if isinstance(allow_resource, bool):
            if allow_resource is False:
                log.warn("Resource access denied")
                await set_cache(
                    project_id=request.state.project_id,
                    user_id=request.state.user_id,
                    namespace="verify_permissions",
                    key=cache_key,
                    value="deny",
                )
                raise Deny()

            if allow_resource is True:
                await set_cache(
                    project_id=request.state.project_id,
                    user_id=request.state.user_id,
                    namespace="verify_permissions",
                    key=cache_key,
                    value="allow",
                )
                return Allow(request.state.credentials)

        elif isinstance(allow_resource, int):
            if allow_resource <= 0:
                log.warn("Resource access denied")
                await set_cache(
                    project_id=request.state.project_id,
                    user_id=request.state.user_id,
                    namespace="verify_permissions",
                    key=cache_key,
                    value="deny",
                )
                raise Deny()
            else:
                return Allow(request.state.credentials)

        # else:
        log.warn("Resource access denied")
        await set_cache(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            namespace="verify_permissions",
            key=cache_key,
            value="deny",
        )
        raise Deny()

    except Exception as exc:  # pylint: disable=bare-except
        log.warn(exc)
        await set_cache(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            namespace="verify_permissions",
            key=cache_key,
            value="deny",
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
    organization_id: UUID,
    resource_type: Optional[str] = None,
) -> Union[bool, int]:
    allow_resource = False

    if resource_type == "service":
        allow_resource = True

    if resource_type == "local_secrets":
        check, meter, _ = await check_entitlements(
            organization_id=organization_id,
            key=Counter.CREDITS,
            delta=1,
        )

        if not check:
            return False

        if not meter or not meter.value:
            return False

        return meter.value

    return allow_resource