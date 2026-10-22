from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse

from oss.src.utils.common import is_ee, is_oss, APIRouter
from oss.src.services import db_manager
from oss.src.core.memberships.dtos import ProjectListing
from oss.src.core.memberships.service import get_memberships_service

from oss.src.utils.logging import get_module_logger

if is_ee():
    from ee.src.core.access.entitlements.service import project_limit_refusal

log = get_module_logger(__name__)


class ProjectsResponse(BaseModel):
    organization_id: Optional[UUID] = None
    organization_name: Optional[str] = None
    workspace_id: Optional[UUID] = None
    workspace_name: Optional[str] = None
    project_id: UUID
    project_name: str
    is_default_project: bool = False
    user_role: Optional[str] = None


class CreateProjectRequest(BaseModel):
    name: str
    make_default: bool = False


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    make_default: Optional[bool] = None


router = APIRouter()


async def _assert_org_owner(request: Request):
    organization_id = getattr(request.state, "organization_id", None)
    user_id = getattr(request.state, "user_id", None)

    if not organization_id or not user_id:
        raise HTTPException(
            status_code=400, detail="Missing organization context for request"
        )

    organization = await db_manager.fetch_organization_by_id(
        organization_id=str(organization_id)
    )
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    if str(organization.owner_id) != str(user_id):
        raise HTTPException(
            status_code=403,
            detail="Only the organization owner can perform this action",
        )

    return organization


def _project_to_response(listing: ProjectListing) -> ProjectsResponse:
    summary = listing.summary
    return ProjectsResponse(
        organization_id=summary.organization_id,
        organization_name=summary.organization_name,
        workspace_id=summary.workspace_id,
        workspace_name=summary.workspace_name,
        project_id=summary.project_id,
        project_name=summary.project_name,
        is_default_project=summary.is_default,
        user_role=listing.membership.role,
    )


async def _fetch_listing(request: Request, project_id) -> Optional[ProjectListing]:
    return await get_memberships_service().fetch_for_user(
        user_id=UUID(str(request.state.user_id)),
        project_id=UUID(str(project_id)),
    )


@router.get(
    "/",
    operation_id="get_projects",
    response_model=List[ProjectsResponse],
)
async def get_projects(
    request: Request,
):
    try:
        if not (is_oss() or is_ee()):
            return JSONResponse(
                status_code=404,
                content={"message": "No projects found."},
            )

        listings = await get_memberships_service().list_for_user(
            user_id=UUID(str(request.state.user_id))
        )

        if not listings:
            return JSONResponse(
                status_code=404,
                content={"message": "No projects found."},
            )

        projects: List[ProjectsResponse] = [
            _project_to_response(listing) for listing in listings
        ]

        return projects

    except Exception as exc:  # pylint: disable=bare-except
        log.error(exc)

        return JSONResponse(
            status_code=404,
            content={"message": "No projects found."},
        )


@router.get(
    "/{project_id}",
    operation_id="get_project",
    response_model=ProjectsResponse,
)
async def get_project(
    project_id: str,
    request: Request,
) -> ProjectsResponse:
    try:
        lookup_project_id = project_id
        if project_id == "current":
            lookup_project_id = str(getattr(request.state, "project_id", ""))
            if not lookup_project_id:
                raise HTTPException(
                    status_code=400, detail="Active project context is missing"
                )

        try:
            listing = await _fetch_listing(request, lookup_project_id)
        except ValueError:
            listing = None
        if listing is None:
            raise HTTPException(status_code=404, detail="Project not found")

        return _project_to_response(listing)

    except HTTPException:
        raise
    except Exception as exc:  # pylint: disable=bare-except
        log.error(exc)
        raise HTTPException(status_code=500, detail="Unable to fetch project") from exc


@router.post(
    "/",
    operation_id="create_project",
    response_model=ProjectsResponse,
    status_code=201,
)
async def create_project(
    request: Request,
    payload: CreateProjectRequest,
) -> ProjectsResponse:
    # await _assert_org_owner(request)

    workspace_id = getattr(request.state, "workspace_id", None)
    organization_id = getattr(request.state, "organization_id", None)

    if not workspace_id or not organization_id:
        raise HTTPException(
            status_code=400, detail="Workspace and organization context are required"
        )

    project_name = payload.name.strip()

    if not project_name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")

    if is_ee():
        refusal = await project_limit_refusal(UUID(str(organization_id)))
        if refusal:
            raise HTTPException(status_code=403, detail=refusal)

    project = await db_manager.create_workspace_project(
        project_name=project_name,
        workspace_id=str(workspace_id),
        organization_id=str(organization_id),
        set_default=payload.make_default,
    )

    # Import here to avoid circular import at module load time
    from oss.src.core.evaluators.defaults import create_default_evaluators
    from oss.src.core.environments.defaults import create_default_environments

    await create_default_evaluators(
        project_id=project.id,
        user_id=UUID(request.state.user_id),
    )
    await create_default_environments(
        project_id=project.id,
        user_id=UUID(request.state.user_id),
    )

    listing = await _fetch_listing(request, project.id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Project not found")

    return _project_to_response(listing)


@router.delete(
    "/{project_id}",
    operation_id="delete_project",
)
async def delete_project(
    project_id: UUID,
    request: Request,
):
    # await _assert_org_owner(request)

    workspace_id = getattr(request.state, "workspace_id", None)

    if not workspace_id:
        raise HTTPException(status_code=400, detail="Workspace context is required")

    project = await db_manager.fetch_project_by_id(project_id=str(project_id))

    if not project or str(project.workspace_id) != str(workspace_id):
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        await db_manager.delete_project(str(project_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return JSONResponse(status_code=200, content={"detail": "Project deleted"})


@router.patch(
    "/{project_id}",
    operation_id="update_project",
    response_model=ProjectsResponse,
)
async def update_project(
    project_id: UUID,
    payload: UpdateProjectRequest,
    request: Request,
) -> ProjectsResponse:
    # await _assert_org_owner(request)

    listing = await _fetch_listing(request, project_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Project not found")

    if payload.name is None and payload.make_default is None:
        raise HTTPException(
            status_code=400, detail="Provide a new name and/or set default flag"
        )

    if payload.name is not None:
        try:
            await db_manager.update_project_name(
                str(project_id), project_name=payload.name
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if payload.make_default is not None:
        if payload.make_default is False:
            raise HTTPException(
                status_code=400,
                detail="make_default can only be set to true",
            )
        await db_manager.set_default_project(str(project_id))

    listing = await _fetch_listing(request, project_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Project not found")

    return _project_to_response(listing)
