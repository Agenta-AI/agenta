from typing import Optional
from uuid import UUID

from fastapi import Request, Query, HTTPException
from fastapi.responses import JSONResponse

from agenta_backend.utils.common import isCloudEE, isOss, APIRouter
from agenta_backend.services import db_manager

if isCloudEE():
    from agenta_backend.commons.models.shared_models import Permission
    from agenta_backend.commons.utils.permissions import check_action_access


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


router = APIRouter()


@router.get(
    "/verify",
    operation_id="verify_permissions",
)
async def verify_permissions(
    request: Request,
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    resource_id: Optional[UUID] = Query(None),
):
    try:
        if isOss():
            return Allow(None)

        if not action or not resource_type:
            raise Deny()

        if isCloudEE():
            permission = Permission(action)

            # CHECK PERMISSION 1/2: ACTION
            allow_action = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=permission,
            )

            if not allow_action:
                raise Deny()

            # CHECK PERMISSION 2/2: RESOURCE
            allow_resource = await check_resource_access(
                project_id=UUID(request.state.project_id),
                resource_type=resource_type,
                resource_id=resource_id,
            )

            if not allow_resource:
                raise Deny()

            return Allow(request.state.credentials)

    except Exception as exc:  # pylint: disable=bare-except
        print(exc)
        raise Deny() from exc


async def check_resource_access(
    project_id: UUID,
    resource_type: str,
    resource_id: Optional[UUID] = None,
) -> bool:
    resource_project_id = None

    if resource_type == "application":
        app = await db_manager.get_app_instance_by_id(app_id=str(resource_id))

        resource_project_id = app.project_id

    if resource_type == "service":
        if resource_id is None:
            resource_project_id = project_id

        else:
            base = await db_manager.fetch_base_by_id(base_id=str(resource_id))

            resource_project_id = base.project_id

    allow_resource = resource_project_id == project_id

    return allow_resource
