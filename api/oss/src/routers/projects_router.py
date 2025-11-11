from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from fastapi import Request, Query, HTTPException
from fastapi.responses import JSONResponse

from oss.src.utils.common import is_ee, is_oss, APIRouter
from oss.src.services import db_manager

if is_ee():
    from ee.src.services import db_manager_ee


from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class ProjectsResponse(BaseModel):
    organization_id: Optional[UUID] = None
    organization_name: Optional[str] = None
    # is_default_organization: Optional[bool] = None
    workspace_id: Optional[UUID] = None
    workspace_name: Optional[str] = None
    # is_default_workspace: Optional[bool] = None
    project_id: UUID
    project_name: str
    # is_default_project: bool
    user_role: Optional[str] = None
    is_demo: Optional[bool] = None


router = APIRouter()


@router.get(
    "/",
    operation_id="get_projects",
    response_model=List[ProjectsResponse],
)
async def get_projects(
    request: Request,
):
    try:
        if is_oss():
            _project = await db_manager.fetch_project_by_id(
                project_id=request.state.project_id
            )

            projects = [
                ProjectsResponse(
                    project_id=_project.id,
                    project_name=_project.project_name,
                )
            ]

            return projects

        elif is_ee():
            _project_memberships = (
                await db_manager_ee.fetch_project_memberships_by_user_id(
                    user_id=request.state.user_id
                )
            )

            if not _project_memberships:
                return JSONResponse(
                    status_code=404,
                    content={"message": "No projects found."},
                )

            projects = [
                ProjectsResponse(
                    organization_id=project_membership.project.organization.id,
                    organization_name=project_membership.project.organization.name,
                    workspace_id=project_membership.project.workspace.id,
                    workspace_name=project_membership.project.workspace.name,
                    project_id=project_membership.project.id,
                    project_name=project_membership.project.project_name,
                    user_role=project_membership.role,
                    is_demo=project_membership.is_demo,
                )
                for project_membership in _project_memberships
            ]

            return projects

        else:
            return JSONResponse(
                status_code=404,
                content={"message": "No projects found."},
            )

    except Exception as exc:  # pylint: disable=bare-except
        log.error(exc)

        return JSONResponse(
            status_code=404,
            content={"message": "No projects found."},
        )
