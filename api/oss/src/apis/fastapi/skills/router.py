from uuid import UUID

from fastapi import APIRouter, Request, status

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions

from oss.src.core.skills.dtos import SkillRegistryQuery, SkillUsageQuery
from oss.src.core.skills.service import SkillsService
from oss.src.core.skills.import_service import (
    SkillImportService,
    SourceScanResult,
    ImportResult,
    UpdateApplyResult,
    UpdateCheckResult,
)
from oss.src.apis.fastapi.skills.exceptions import handle_skills_exceptions
from oss.src.apis.fastapi.skills.models import (
    SkillsQueryRequest,
    SkillsResponse,
    SkillSourceScanRequest,
    SkillSourceImportRequest,
    SkillCreateRequest,
    SkillCreateResponse,
    SkillCommitRequest,
    SkillCommitResponse,
    SkillRevisionsResponse,
    SkillRevisionRow,
    SkillReferencedByResponse,
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
        import_service: SkillImportService,
    ):
        self.skills_service = skills_service
        self.import_service = import_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/sources/scan",
            self.scan_skill_source,
            methods=["POST"],
            operation_id="scan_skill_source",
            status_code=status.HTTP_200_OK,
            response_model=SourceScanResult,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{skill_id}/updates/check",
            self.check_skill_update,
            methods=["POST"],
            operation_id="check_skill_update",
            status_code=status.HTTP_200_OK,
            response_model=UpdateCheckResult,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{skill_id}/updates/apply",
            self.apply_skill_update,
            methods=["POST"],
            operation_id="apply_skill_update",
            status_code=status.HTTP_200_OK,
            response_model=UpdateApplyResult,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/sources",
            self.import_skill_source,
            methods=["POST"],
            operation_id="import_skill_source",
            status_code=status.HTTP_200_OK,
            response_model=ImportResult,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/",
            self.create_skill,
            methods=["POST"],
            operation_id="create_skill",
            status_code=status.HTTP_200_OK,
            response_model=SkillCreateResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{skill_id}/revisions/commit",
            self.commit_skill_revision,
            methods=["POST"],
            operation_id="commit_skill_revision",
            status_code=status.HTTP_200_OK,
            response_model=SkillCommitResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{skill_id}/revisions/log",
            self.log_skill_revisions,
            methods=["POST"],
            operation_id="log_skill_revisions",
            status_code=status.HTTP_200_OK,
            response_model=SkillRevisionsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{skill_id}/archive",
            self.archive_skill,
            methods=["POST"],
            operation_id="archive_skill",
            status_code=status.HTTP_200_OK,
            response_model=SkillCreateResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{skill_id}/unarchive",
            self.unarchive_skill,
            methods=["POST"],
            operation_id="unarchive_skill",
            status_code=status.HTTP_200_OK,
            response_model=SkillCreateResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{skill_id}/referenced-by",
            self.list_skill_referenced_by,
            methods=["GET"],
            operation_id="list_skill_referenced_by",
            status_code=status.HTTP_200_OK,
            response_model=SkillReferencedByResponse,
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
    @handle_skills_exceptions()
    async def create_skill(
        self,
        request: Request,
        *,
        create_request: SkillCreateRequest,
    ) -> SkillCreateResponse:
        """
        Create a registry skill.

        The server owns the invariants: the payload validates against the
        SkillTemplate contract, the storage slug is generated (display names
        may collide), and the skill flags + builtin URI are stamped on both
        the artifact and the v1 revision.
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        created = await self.skills_service.create_skill(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            skill=create_request.skill,
        )
        return SkillCreateResponse(**created.model_dump())

    @intercept_exceptions()
    @handle_skills_exceptions()
    async def commit_skill_revision(
        self,
        request: Request,
        *,
        skill_id: UUID,
        commit_request: SkillCommitRequest,
    ) -> SkillCommitResponse:
        """
        Commit a new revision of one skill.

        Validated server-side; pass `base_revision_id` so a concurrent edit
        answers 409 (`revision_conflict`) instead of being overwritten.
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        outcome = await self.skills_service.commit_skill_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            workflow_id=skill_id,
            skill=commit_request.skill,
            message=commit_request.message,
            base_revision_id=commit_request.base_revision_id,
        )
        return SkillCommitResponse(**outcome.model_dump())

    @intercept_exceptions()
    @handle_skills_exceptions()
    async def log_skill_revisions(
        self,
        request: Request,
        *,
        skill_id: UUID,
    ) -> SkillRevisionsResponse:
        """The skill's revision history, newest first, with stored content per row."""
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        rows = await self.skills_service.log_skill_revisions(
            project_id=UUID(request.state.project_id),
            workflow_id=skill_id,
        )
        return SkillRevisionsResponse(
            count=len(rows),
            revisions=[SkillRevisionRow(**row.model_dump()) for row in rows],
        )

    @intercept_exceptions()
    @handle_skills_exceptions()
    async def archive_skill(
        self,
        request: Request,
        *,
        skill_id: UUID,
    ) -> SkillCreateResponse:
        """Archive a skill (its slug stays reserved; unarchive restores it)."""
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow = await self.skills_service.archive_skill(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            workflow_id=skill_id,
        )
        return SkillCreateResponse(workflow_id=str(workflow.id), slug=workflow.slug)

    @intercept_exceptions()
    @handle_skills_exceptions()
    async def unarchive_skill(
        self,
        request: Request,
        *,
        skill_id: UUID,
    ) -> SkillCreateResponse:
        """Restore an archived skill with its full history."""
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow = await self.skills_service.unarchive_skill(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            workflow_id=skill_id,
        )
        return SkillCreateResponse(workflow_id=str(workflow.id), slug=workflow.slug)

    @intercept_exceptions()
    async def list_skill_referenced_by(
        self,
        request: Request,
        *,
        skill_id: UUID,
    ) -> SkillReferencedByResponse:
        """
        The agents referencing this skill, with `mode` "latest" (follows the
        head) or "pinned" (revision reference with `pinned_version`).
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        usage = await self.skills_service.get_skill_usage(
            project_id=UUID(request.state.project_id),
            query=SkillUsageQuery(workflow_id=skill_id),
        )
        return SkillReferencedByResponse(count=len(usage), referenced_by=usage)

    @intercept_exceptions()
    @handle_skills_exceptions()
    async def scan_skill_source(
        self,
        request: Request,
        *,
        scan_request: SkillSourceScanRequest,
    ) -> SourceScanResult:
        """
        Preview a repo/marketplace as skill candidates — no writes.

        Detects the layout (Claude marketplace manifest, single skill, or a
        multi-skill tree), parses every candidate, and reports per-candidate
        validity, issues, and skipped-file warnings — exactly what the import
        drawer renders.
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        return await self.import_service.scan_source(
            project_id=UUID(request.state.project_id),
            repo_url=scan_request.repo_url,
            ref=scan_request.ref,
        )

    @intercept_exceptions()
    @handle_skills_exceptions()
    async def import_skill_source(
        self,
        request: Request,
        *,
        import_request: SkillSourceImportRequest,
    ) -> ImportResult:
        """
        Import selected skills from a repo/marketplace as registry skills.

        Each selected valid candidate becomes an ordinary skill workflow
        (v1); provenance is recorded so sync can offer new versions later.
        Snapshot-only — nothing runs from the source.
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        return await self.import_service.import_from_source(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            repo_url=import_request.repo_url,
            ref=import_request.ref,
            paths=import_request.paths,
        )

    @intercept_exceptions()
    @handle_skills_exceptions()
    async def check_skill_update(
        self,
        request: Request,
        *,
        skill_id: UUID,
    ) -> UpdateCheckResult:
        """
        Read-only: compare one imported skill against its upstream origin.

        Reports `update_available`, `up_to_date`, `detached` (edited locally —
        never overwritten), `missing_in_source`, or `invalid_in_source`.
        Nothing is written.
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        return await self.import_service.check_update(
            project_id=UUID(request.state.project_id),
            workflow_id=skill_id,
        )

    @intercept_exceptions()
    @handle_skills_exceptions()
    async def apply_skill_update(
        self,
        request: Request,
        *,
        skill_id: UUID,
    ) -> UpdateApplyResult:
        """
        Commit the upstream version of one imported skill as a new revision.

        The commit uses the current head as its base, so a concurrent edit
        conflicts instead of being overwritten; locally edited skills report
        `detached` and are never touched.
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_WORKFLOWS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        return await self.import_service.apply_update(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            workflow_id=skill_id,
        )
