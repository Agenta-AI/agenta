from uuid import UUID

from fastapi import APIRouter, Request, status

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions

from oss.src.core.skills.dtos import SkillRegistryQuery, SkillUsageQuery
from oss.src.core.skills.service import SkillsService
from oss.src.apis.fastapi.skills.models import (
    SkillsQueryRequest,
    SkillsResponse,
    SkillUsageRequest,
    SkillUsageResponse,
)
from oss.src.apis.fastapi.shared.utils import compute_next_windowing

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

log = get_module_logger(__name__)


class SkillsRouter:
    def __init__(
        self,
        *,
        skills_service: SkillsService,
    ):
        self.skills_service = skills_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/usage",
            self.query_skill_usage,
            methods=["POST"],
            operation_id="query_skill_usage",
            status_code=status.HTTP_200_OK,
            response_model=SkillUsageResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_registry_skills,
            methods=["POST"],
            operation_id="query_registry_skills",
            status_code=status.HTTP_200_OK,
            response_model=SkillsResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def query_registry_skills(
        self,
        request: Request,
        *,
        skills_query_request: SkillsQueryRequest,
    ) -> SkillsResponse:
        """
        List the project's skill registry.

        `skills` is the paginated, database-backed block (head revision per
        skill workflow, filtered in SQL); `builtin` is the code-defined Agenta
        block, returned whole and unpaginated. `search` matches the workflow
        name and description.
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        registry = await self.skills_service.list_registry_skills(
            project_id=UUID(request.state.project_id),
            #
            query=SkillRegistryQuery(
                search=skills_query_request.search,
                include_archived=skills_query_request.include_archived,
                windowing=skills_query_request.windowing,
            ),
        )

        next_windowing = compute_next_windowing(
            entities=registry.skills,
            attribute="id",
            windowing=skills_query_request.windowing,
            order="descending",
        )

        return SkillsResponse(
            count=len(registry.skills),
            skills=registry.skills,
            builtin=registry.builtin,
            windowing=next_windowing,
        )

    @intercept_exceptions()
    async def query_skill_usage(
        self,
        request: Request,
        *,
        skill_usage_request: SkillUsageRequest,
    ) -> SkillUsageResponse:
        """
        Which agents use this skill, and how.

        Each row names an agent whose head revision embeds the skill, with
        `mode` "latest" (artifact-level reference, follows the head) or
        "pinned" (revision-level reference with `pinned_version`).
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        usage = await self.skills_service.get_skill_usage(
            project_id=UUID(request.state.project_id),
            #
            query=SkillUsageQuery(
                workflow_id=skill_usage_request.workflow_id,
                workflow_slug=skill_usage_request.workflow_slug,
            ),
        )

        return SkillUsageResponse(
            count=len(usage),
            usage=usage,
        )
