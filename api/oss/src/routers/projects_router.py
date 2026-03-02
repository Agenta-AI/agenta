from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from fastapi import Request, HTTPException
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
    workspace_id: Optional[UUID] = None
    workspace_name: Optional[str] = None
    project_id: UUID
    project_name: str
    is_default_project: bool = False
    user_role: Optional[str] = None
    is_demo: Optional[bool] = None


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


def _get_oss_user_role(organization, user_id: str) -> str:
    """Owner vs editor logic used across OSS endpoints."""
    return "owner" if str(organization.owner_id) == str(user_id) else "editor"


async def _get_ee_membership_for_project(user_id, project_id):
    """
    Return the project membership for this user & project in EE, or None.
    Uses the same source as get_projects/get_project (fetch_project_memberships_by_user_id).
    """
    if not is_ee():
        return None

    memberships = await db_manager_ee.fetch_project_memberships_by_user_id(
        user_id=user_id
    )
    return next(
        (m for m in memberships if str(m.project_id) == str(project_id)),
        None,
    )


async def _project_to_response(
    project,
    *,
    user_role: Optional[str],
    is_demo: Optional[bool],
    workspace=None,
    organization=None,
) -> ProjectsResponse:
    workspace_obj = workspace
    if workspace_obj is None and project.workspace_id:
        workspace_obj = await db_manager.fetch_workspace_by_id(
            workspace_id=str(project.workspace_id)
        )

    organization_obj = organization
    if organization_obj is None and project.organization_id:
        organization_obj = await db_manager.fetch_organization_by_id(
            organization_id=str(project.organization_id)
        )

    if workspace_obj is None or organization_obj is None:
        raise HTTPException(
            status_code=404, detail="Workspace or Organization not found"
        )

    return ProjectsResponse(
        organization_id=UUID(str(organization_obj.id)),
        organization_name=str(organization_obj.name),
        workspace_id=UUID(str(workspace_obj.id)),
        workspace_name=str(workspace_obj.name),
        project_id=UUID(str(project.id)),
        project_name=str(project.project_name),
        is_default_project=bool(project.is_default),
        user_role=user_role,
        is_demo=is_demo,
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
        if is_oss():
            workspace_id = getattr(request.state, "workspace_id", None)
            if not workspace_id:
                raise HTTPException(
                    status_code=400, detail="Workspace context is required"
                )

            workspace = await db_manager.fetch_workspace_by_id(
                workspace_id=str(workspace_id)
            )
            if not workspace:
                raise HTTPException(status_code=404, detail="Workspace not found")

            organization = await db_manager.fetch_organization_by_id(
                organization_id=str(workspace.organization_id)
            )
            if not organization:
                raise HTTPException(status_code=404, detail="Organization not found")

            projects_db = await db_manager.fetch_projects_by_workspace(
                workspace_id=str(workspace_id)
            )
            if not projects_db:
                raise HTTPException(status_code=404, detail="No projects found")

            user_role = _get_oss_user_role(organization, request.state.user_id)

            projects = []
            for project in projects_db:
                project_response = await _project_to_response(
                    project,
                    user_role=user_role,
                    is_demo=False,
                    workspace=workspace,
                    organization=organization,
                )
                projects.append(project_response)

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

            projects: List[ProjectsResponse] = []
            for project_membership in _project_memberships:
                project_response = await _project_to_response(
                    project_membership.project,
                    user_role=project_membership.role,
                    is_demo=project_membership.is_demo,
                    workspace=project_membership.project.workspace,
                    organization=project_membership.project.organization,
                )
                projects.append(project_response)

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

        if is_oss():
            project = await db_manager.fetch_project_by_id(
                project_id=str(lookup_project_id)
            )
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            organization = project.organization
            if not organization:
                organization = await db_manager.fetch_organization_by_id(
                    organization_id=str(project.organization_id)
                )

            user_role = _get_oss_user_role(organization, request.state.user_id)

            return await _project_to_response(
                project,
                user_role=user_role,
                is_demo=False,
                organization=organization,
            )

        if is_ee():
            memberships = await db_manager_ee.fetch_project_memberships_by_user_id(
                user_id=request.state.user_id
            )
            membership = next(
                (
                    project_membership
                    for project_membership in memberships
                    if str(project_membership.project_id) == str(lookup_project_id)
                ),
                None,
            )
            if not membership:
                raise HTTPException(status_code=404, detail="Project not found")

            return await _project_to_response(
                membership.project,
                user_role=membership.role,
                is_demo=membership.is_demo,
                workspace=membership.project.workspace,
                organization=membership.project.organization,
            )

        raise HTTPException(status_code=404, detail="Project not found")

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
        # EE: project created + memberships cloned
        project = await db_manager_ee.create_workspace_project(
            project_name=project_name,
            workspace_id=str(workspace_id),
            set_default=payload.make_default,
        )

        # Create default human evaluator for the new project
        # Import here to avoid circular import at module load time
        from oss.src.core.evaluators.defaults import create_default_human_evaluator

        await create_default_human_evaluator(
            project_id=project.id,
            user_id=UUID(request.state.user_id),
        )

        # Create default environments for the new project
        from oss.src.core.environments.defaults import create_default_environments

        await create_default_environments(
            project_id=project.id,
            user_id=UUID(request.state.user_id),
        )

        membership = await _get_ee_membership_for_project(
            user_id=request.state.user_id,
            project_id=project.id,
        )
        user_role = membership.role if membership else None
        is_demo = membership.is_demo if membership else None

        return await _project_to_response(
            project,
            user_role=user_role,
            is_demo=is_demo,
        )

    # OSS
    project = await db_manager.create_workspace_project(
        project_name=project_name,
        workspace_id=str(workspace_id),
        organization_id=str(organization_id),
        set_default=payload.make_default,
    )

    # Create default human evaluator for the new project
    # Import here to avoid circular import at module load time
    from oss.src.core.evaluators.defaults import create_default_human_evaluator

    await create_default_human_evaluator(
        project_id=project.id,
        user_id=UUID(request.state.user_id),
    )

    # Create default environments for the new project
    from oss.src.core.environments.defaults import create_default_environments

    await create_default_environments(
        project_id=project.id,
        user_id=UUID(request.state.user_id),
    )

    organization = await db_manager.fetch_organization_by_id(
        organization_id=str(organization_id)
    )
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    user_role = _get_oss_user_role(organization, request.state.user_id)

    return await _project_to_response(
        project,
        user_role=user_role,
        is_demo=False,
        organization=organization,
    )


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

    workspace_id = getattr(request.state, "workspace_id", None)

    if not workspace_id:
        raise HTTPException(status_code=400, detail="Workspace context is required")

    project = await db_manager.fetch_project_by_id(project_id=str(project_id))

    if not project or str(project.workspace_id) != str(workspace_id):
        raise HTTPException(status_code=404, detail="Project not found")

    if payload.name is None and payload.make_default is None:
        raise HTTPException(
            status_code=400, detail="Provide a new name and/or set default flag"
        )

    updated_project = project

    if payload.name is not None:
        try:
            updated_project = await db_manager.update_project_name(
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
        updated_project = await db_manager.set_default_project(str(project_id))

    workspace = await db_manager.fetch_workspace_by_id(
        workspace_id=str(updated_project.workspace_id)
    )

    organization = await db_manager.fetch_organization_by_id(
        organization_id=str(updated_project.organization_id)
    )

    if is_ee():
        membership = await _get_ee_membership_for_project(
            user_id=request.state.user_id,
            project_id=updated_project.id,
        )
        user_role = membership.role if membership else None
        is_demo = membership.is_demo if membership else None
    else:
        user_role = _get_oss_user_role(organization, request.state.user_id)
        is_demo = False

    return await _project_to_response(
        updated_project,
        user_role=user_role,
        is_demo=is_demo,
        workspace=workspace,
        organization=organization,
    )
