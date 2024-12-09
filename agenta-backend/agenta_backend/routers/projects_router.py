from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from fastapi import Request, Query, HTTPException
from fastapi.responses import JSONResponse

from agenta_backend.utils.common import isCloudEE, isOss, APIRouter
from agenta_backend.services import db_manager

if isCloudEE():
    from agenta_backend.commons.services import db_manager_ee


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
        if isOss():
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

        elif isCloudEE():
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
        print(exc)

        return JSONResponse(
            status_code=404,
            content={"message": "No projects found."},
        )
