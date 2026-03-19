from typing import Optional, List, Union, TYPE_CHECKING
from uuid import UUID, uuid4

if TYPE_CHECKING:
    from oss.src.core.environments.service import EnvironmentsService
    from oss.src.core.embeds.service import EmbedsService

from oss.src.utils.logging import get_module_logger

from agenta.sdk.engines.running.utils import infer_flags_from_data

from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.git.dtos import (
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    ArtifactFork,
    #
    VariantCreate,
    VariantEdit,
    VariantQuery,
    #
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionCommit,
    RevisionsLog,
)
from oss.src.core.workflows.dtos import (
    WorkflowFlags,
    #
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    WorkflowFork,
    WorkflowRevisionsLog,
    #
    WorkflowVariant,
    WorkflowVariantCreate,
    WorkflowVariantEdit,
    WorkflowVariantQuery,
    #
    WorkflowRevision,
    WorkflowRevisionCreate,
    WorkflowRevisionEdit,
    WorkflowRevisionQuery,
    WorkflowRevisionCommit,
    WorkflowRevisionData,
    #
    SimpleWorkflow,
    SimpleWorkflowFlags,
    SimpleWorkflowData,
    SimpleWorkflowCreate,
    SimpleWorkflowEdit,
    SimpleWorkflowQuery,
    #
    WorkflowServiceRequest,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
)

# Resolution is now handled by EmbedsService
from oss.src.core.embeds.dtos import (
    ErrorPolicy,
    ResolutionInfo,
)

from oss.src.services.auth_service import sign_secret_token
from oss.src.services.db_manager import get_project_by_id

from agenta.sdk.decorators.running import (
    invoke_workflow as _invoke_workflow,
    inspect_workflow as _inspect_workflow,
)
from agenta.sdk.models.workflows import (
    WorkflowServiceRequest,  # noqa: F811
    WorkflowServiceBatchResponse,  # noqa: F811
    WorkflowServiceStreamResponse,  # noqa: F811
)

log = get_module_logger(__name__)


# ------------------------------------------------------------------------------


class WorkflowsService:
    def __init__(
        self,
        *,
        workflows_dao: GitDAOInterface,
        #
        environments_service: Optional["EnvironmentsService"] = None,  # type: ignore
        embeds_service: Optional["EmbedsService"] = None,  # type: ignore
    ):
        self.workflows_dao = workflows_dao
        self.environments_service = environments_service
        self.embeds_service = embeds_service

    # workflows ----------------------------------------------------------------

    async def create_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_create: WorkflowCreate,
        #
        workflow_id: Optional[UUID] = None,
    ) -> Optional[Workflow]:
        artifact_create = ArtifactCreate(
            **workflow_create.model_dump(mode="json", exclude_none=True),
        )

        artifact = await self.workflows_dao.create_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_create=artifact_create,
            #
            artifact_id=workflow_id,
        )

        if not artifact:
            return None

        workflow = Workflow(**artifact.model_dump(mode="json"))

        return workflow

    async def fetch_workflow(
        self,
        *,
        project_id: UUID,
        #
        workflow_ref: Reference,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[Workflow]:
        artifact = await self.workflows_dao.fetch_artifact(
            project_id=project_id,
            #
            artifact_ref=workflow_ref,
            #
            include_archived=include_archived,
        )

        if not artifact:
            return None

        workflow = Workflow(**artifact.model_dump(mode="json"))

        return workflow

    async def edit_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_edit: WorkflowEdit,
    ) -> Optional[Workflow]:
        artifact_edit = ArtifactEdit(
            **workflow_edit.model_dump(mode="json", exclude_none=True),
        )

        artifact = await self.workflows_dao.edit_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_edit=artifact_edit,
        )

        if not artifact:
            return None

        workflow = Workflow(**artifact.model_dump(mode="json"))

        return workflow

    async def query_workflows(
        self,
        *,
        project_id: UUID,
        #
        workflow_query: Optional[WorkflowQuery] = None,
        #
        workflow_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Workflow]:
        artifact_query = (
            ArtifactQuery(
                **workflow_query.model_dump(mode="json", exclude_none=True),
            )
            if workflow_query
            else ArtifactQuery()
        )

        artifacts = await self.workflows_dao.query_artifacts(
            project_id=project_id,
            #
            artifact_query=artifact_query,
            #
            artifact_refs=workflow_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        workflows = [
            Workflow(
                **artifact.model_dump(mode="json"),
            )
            for artifact in artifacts
        ]

        return workflows

    async def archive_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[Workflow]:
        artifact = await self.workflows_dao.archive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=workflow_id,
        )

        if not artifact:
            return None

        _workflow = Workflow(**artifact.model_dump(mode="json"))

        return _workflow

    async def unarchive_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[Workflow]:
        artifact = await self.workflows_dao.unarchive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=workflow_id,
        )

        if not artifact:
            return None

        _workflow = Workflow(**artifact.model_dump(mode="json"))

        return _workflow

    # workflow variants --------------------------------------------------------

    async def create_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_variant_create: WorkflowVariantCreate,
    ) -> Optional[WorkflowVariant]:
        _variant_create = VariantCreate(
            **workflow_variant_create.model_dump(mode="json", exclude_none=True),
        )

        variant = await self.workflows_dao.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_create=_variant_create,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )

        return _workflow_variant

    async def fetch_workflow_variant(
        self,
        *,
        project_id: UUID,
        #
        workflow_ref: Optional[Reference] = None,
        workflow_variant_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.fetch_variant(
            project_id=project_id,
            #
            artifact_ref=workflow_ref,
            variant_ref=workflow_variant_ref,
            #
            include_archived=include_archived,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )

        return _workflow_variant

    async def edit_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_variant_edit: WorkflowVariantEdit,
    ) -> Optional[WorkflowVariant]:
        _variant_edit = VariantEdit(
            **workflow_variant_edit.model_dump(mode="json", exclude_none=True),
        )

        variant = await self.workflows_dao.edit_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_edit=_variant_edit,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )

        return _workflow_variant

    async def query_workflow_variants(
        self,
        *,
        project_id: UUID,
        #
        workflow_variant_query: Optional[WorkflowVariantQuery] = None,
        #
        workflow_refs: Optional[List[Reference]] = None,
        workflow_variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WorkflowVariant]:
        _variant_query = (
            VariantQuery(
                **workflow_variant_query.model_dump(mode="json", exclude_none=True),
            )
            if workflow_variant_query
            else VariantQuery()
        )

        variants = await self.workflows_dao.query_variants(
            project_id=project_id,
            #
            variant_query=_variant_query,
            #
            artifact_refs=workflow_refs,
            variant_refs=workflow_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        _workflow_variants = [
            WorkflowVariant(
                **variant.model_dump(mode="json"),
            )
            for variant in variants
        ]

        return _workflow_variants

    async def fork_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_fork: WorkflowFork,
    ) -> Optional[WorkflowVariant]:
        _artifact_fork = ArtifactFork(
            **workflow_fork.model_dump(mode="json"),
        )

        variant = await self.workflows_dao.fork_variant(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_fork=_artifact_fork,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )

        return _workflow_variant

    async def archive_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_variant_id: UUID,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.archive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=workflow_variant_id,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )

        return _workflow_variant

    async def unarchive_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_variant_id: UUID,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.unarchive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=workflow_variant_id,
        )

        if not variant:
            return None

        _workdlow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )

        return _workdlow_variant

    # workflow revisions -------------------------------------------------------

    async def create_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_create: WorkflowRevisionCreate,
    ) -> Optional[WorkflowRevision]:
        _revision_create = RevisionCreate(
            **workflow_revision_create.model_dump(mode="json", exclude_none=True),
        )

        revision = await self.workflows_dao.create_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_create=_revision_create,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )

        return _workflow_revision

    async def fetch_workflow_revision(
        self,
        *,
        project_id: UUID,
        #
        workflow_ref: Optional[Reference] = None,
        workflow_variant_ref: Optional[Reference] = None,
        workflow_revision_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[WorkflowRevision]:
        if not workflow_ref and not workflow_variant_ref and not workflow_revision_ref:
            return None

        if workflow_ref and not workflow_variant_ref and not workflow_revision_ref:
            workflow = await self.fetch_workflow(
                project_id=project_id,
                #
                workflow_ref=workflow_ref,
                #
                include_archived=include_archived,
            )

            if not workflow:
                return None

            workflow_ref = Reference(
                id=workflow.id,
                slug=workflow.slug,
            )

            workflow_variant = await self.fetch_workflow_variant(
                project_id=project_id,
                #
                workflow_ref=workflow_ref,
                #
                include_archived=include_archived,
            )

            if not workflow_variant:
                return None

            workflow_variant_ref = Reference(
                id=workflow_variant.id,
                slug=workflow_variant.slug,
            )

        revision = await self.workflows_dao.fetch_revision(
            project_id=project_id,
            #
            variant_ref=workflow_variant_ref,
            revision_ref=workflow_revision_ref,
            #
            include_archived=include_archived,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )

        return _workflow_revision

    async def edit_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_edit: WorkflowRevisionEdit,
    ) -> Optional[WorkflowRevision]:
        _workflow_revision_edit = RevisionEdit(
            **workflow_revision_edit.model_dump(mode="json", exclude_none=True),
        )

        revision = await self.workflows_dao.edit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_edit=_workflow_revision_edit,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )

        return _workflow_revision

    async def query_workflow_revisions(
        self,
        *,
        project_id: UUID,
        #
        workflow_revision_query: Optional[WorkflowRevisionQuery] = None,
        #
        workflow_refs: Optional[List[Reference]] = None,
        workflow_variant_refs: Optional[List[Reference]] = None,
        workflow_revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WorkflowRevision]:
        _revision_query = (
            RevisionQuery(
                **workflow_revision_query.model_dump(mode="json", exclude_none=True),
            )
            if workflow_revision_query
            else RevisionQuery()
        )

        revisions = await self.workflows_dao.query_revisions(
            project_id=project_id,
            #
            revision_query=_revision_query,
            #
            artifact_refs=workflow_refs,
            variant_refs=workflow_variant_refs,
            revision_refs=workflow_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        _workflow_revisions = [
            WorkflowRevision(
                **revision.model_dump(mode="json"),
            )
            for revision in revisions
        ]

        return _workflow_revisions

    async def commit_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_commit: WorkflowRevisionCommit,
    ) -> Optional[WorkflowRevision]:
        workflow_revision_commit = workflow_revision_commit.model_copy(
            update={
                "flags": infer_flags_from_data(
                    flags=workflow_revision_commit.flags,
                    data=workflow_revision_commit.data,
                )
            }
        )

        _revision_commit = RevisionCommit(
            **workflow_revision_commit.model_dump(mode="json", exclude_none=True),
        )

        if not _revision_commit.artifact_id:
            if not _revision_commit.variant_id:
                return None

            variant = await self.workflows_dao.fetch_variant(
                project_id=project_id,
                #
                variant_ref=Reference(id=_revision_commit.variant_id),
            )

            if not variant:
                return None

            _revision_commit.artifact_id = variant.artifact_id

        revision = await self.workflows_dao.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_commit=_revision_commit,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )

        return _workflow_revision

    async def log_workflow_revisions(
        self,
        *,
        project_id: UUID,
        #
        workflow_revisions_log: WorkflowRevisionsLog,
        #
        include_archived: bool = False,
    ) -> List[WorkflowRevision]:
        _revisions_log = RevisionsLog(
            **workflow_revisions_log.model_dump(mode="json"),
        )

        revisions = await self.workflows_dao.log_revisions(
            project_id=project_id,
            #
            revisions_log=_revisions_log,
            #
            include_archived=include_archived,
        )

        _workflow_revisions = [
            WorkflowRevision(
                **revision.model_dump(mode="json"),
            )
            for revision in revisions
        ]

        return _workflow_revisions

    async def archive_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_id: UUID,
    ) -> Optional[WorkflowRevision]:
        revision = await self.workflows_dao.archive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=workflow_revision_id,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )

        return _workflow_revision

    async def unarchive_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_id: UUID,
    ) -> Optional[WorkflowRevision]:
        revision = await self.workflows_dao.unarchive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=workflow_revision_id,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )

        return _workflow_revision

    # workflow services --------------------------------------------------------

    async def invoke_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        request: WorkflowServiceRequest,
        #
        **kwargs,
    ) -> Union[
        WorkflowServiceBatchResponse,
        WorkflowServiceStreamResponse,
    ]:
        project = await get_project_by_id(
            project_id=str(project_id),
        )

        secret_token = await sign_secret_token(
            user_id=str(user_id),
            project_id=str(project_id),
            workspace_id=str(project.workspace_id),
            organization_id=str(project.organization_id),
        )

        credentials = f"Secret {secret_token}"

        return await _invoke_workflow(
            request=request,
            #
            credentials=credentials,
            #
            **kwargs,
        )

    async def inspect_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        request: WorkflowServiceRequest,
    ) -> WorkflowServiceRequest:
        return await _inspect_workflow(
            request=request,
        )

    async def resolve_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_ref: Optional[Reference] = None,
        workflow_variant_ref: Optional[Reference] = None,
        workflow_revision_ref: Optional[Reference] = None,
        #
        workflow_revision: Optional["WorkflowRevision"] = None,
        #
        max_depth: int = 10,
        max_embeds: int = 100,
        error_policy: str = "exception",
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[tuple["WorkflowRevision", "ResolutionInfo"]]:
        """
        Fetch and resolve a workflow revision with embedded references.

        Resolves embedded workflow and environment references within the
        workflow revision's configuration data.

        When `workflow_revision` is provided, skips the fetch step and resolves
        its data inline. Only revision.data is used — id and other metadata are
        ignored. Use this when the caller already holds the revision (e.g. SDK).

        Args:
            project_id: Project scope
            user_id: User performing resolution
            workflow_ref: Workflow reference (mutually exclusive with workflow_revision)
            workflow_variant_ref: Variant reference (mutually exclusive with workflow_revision)
            workflow_revision_ref: Revision reference (mutually exclusive with workflow_revision)
            workflow_revision: Revision to resolve inline (skips fetch when set)
            max_depth: Maximum nesting depth for embeds
            max_embeds: Maximum total embeds allowed
            error_policy: How to handle errors (exception, placeholder, keep)
            include_archived: Include archived entities

        Returns:
            Tuple of (WorkflowRevision with resolved configuration, ResolutionInfo metadata)

        Raises:
            Various embed resolution errors based on error_policy
        """
        if not self.embeds_service:
            raise RuntimeError("EmbedsService not initialized")

        if workflow_revision is not None:
            # Inline mode: resolve the provided revision's data without fetching
            if not workflow_revision.data:
                return None
            (
                resolved_data,
                resolution_info,
            ) = await self.embeds_service.resolve_configuration(
                project_id=project_id,
                configuration=workflow_revision.data.model_dump(mode="json"),
                max_depth=max_depth,
                max_embeds=max_embeds,
                error_policy=ErrorPolicy(error_policy),
                include_archived=include_archived,
            )
            workflow_revision.data = WorkflowRevisionData(**resolved_data)
            return (workflow_revision, resolution_info)

        # Stored-revision mode: fetch by reference then resolve
        revision = await self.fetch_workflow_revision(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
            workflow_variant_ref=workflow_variant_ref,
            workflow_revision_ref=workflow_revision_ref,
            #
            include_archived=include_archived,
        )

        if not revision or not revision.data:
            return None

        (
            revision_data,
            resolution_info,
        ) = await self.embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=revision.data.model_dump(mode="json"),
            max_depth=max_depth,
            max_embeds=max_embeds,
            error_policy=ErrorPolicy(error_policy),
            include_archived=include_archived,
        )

        # Update revision with resolved configuration
        revision.data = WorkflowRevisionData(**revision_data)

        return (revision, resolution_info)

    # --------------------------------------------------------------------------


class SimpleWorkflowsService:
    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
    ):
        self.workflows_service = workflows_service

    # public -------------------------------------------------------------------

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_workflow_create: SimpleWorkflowCreate,
        #
        workflow_id: Optional[UUID] = None,
    ) -> Optional[SimpleWorkflow]:
        simple_workflow_flags = SimpleWorkflowFlags(
            **(
                simple_workflow_create.flags.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                )
                if simple_workflow_create.flags
                else {}
            )
        )

        workflow_flags = WorkflowFlags(
            **simple_workflow_flags.model_dump(
                mode="json",
                exclude_none=True,
                exclude_unset=True,
            ),
        )

        workflow_create = WorkflowCreate(
            slug=simple_workflow_create.slug,
            #
            name=simple_workflow_create.name,
            description=simple_workflow_create.description,
            #
            flags=workflow_flags,
            meta=simple_workflow_create.meta,
            tags=simple_workflow_create.tags,
        )

        workflow: Optional[Workflow] = await self.workflows_service.create_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_create=workflow_create,
            #
            workflow_id=workflow_id,
        )

        if workflow is None:
            return None

        workflow_variant_slug = uuid4().hex[-12:]

        workflow_variant_create = WorkflowVariantCreate(
            slug=workflow_variant_slug,
            #
            name=workflow_create.name,
            description=workflow_create.description,
            #
            flags=workflow_flags,
            tags=workflow_create.tags,
            meta=workflow_create.meta,
            #
            workflow_id=workflow.id,
        )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.create_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_variant_create=workflow_variant_create,
        )

        if workflow_variant is None:
            return None

        workflow_revision_slug = uuid4().hex[-12:]

        workflow_revision_commit = WorkflowRevisionCommit(
            slug=workflow_revision_slug,
            #
            name=workflow_create.name,
            description=workflow_create.description,
            #
            flags=workflow_flags,
            tags=workflow_create.tags,
            meta=workflow_create.meta,
            #
            data=None,
            #
            message="Initial commit",
            #
            workflow_id=workflow.id,
            workflow_variant_id=workflow_variant.id,
        )

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.commit_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            workflow_revision_commit=workflow_revision_commit,
        )

        if workflow_revision is None:
            return None

        workflow_revision_slug = uuid4().hex[-12:]

        workflow_revision_commit = WorkflowRevisionCommit(
            slug=workflow_revision_slug,
            #
            name=workflow_create.name,
            description=workflow_create.description,
            #
            flags=workflow_flags,
            tags=workflow_create.tags,
            meta=workflow_create.meta,
            #
            data=simple_workflow_create.data,
            #
            workflow_id=workflow.id,
            workflow_variant_id=workflow_variant.id,
        )

        workflow_revision = await self.workflows_service.commit_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            workflow_revision_commit=workflow_revision_commit,
        )

        if workflow_revision is None:
            return None

        simple_workflow = SimpleWorkflow(
            id=workflow.id,
            slug=workflow.slug,
            #
            name=workflow.name,
            description=workflow.description,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            flags=simple_workflow_flags,
            meta=workflow.meta,
            tags=workflow.tags,
            #
            variant_id=workflow_variant.id,
            revision_id=workflow_revision.id,
            #
            data=SimpleWorkflowData(
                **(
                    workflow_revision.data.model_dump(mode="json")
                    if workflow_revision.data
                    else {}
                ),
            ),
        )

        return simple_workflow

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[SimpleWorkflow]:
        workflow_ref = Reference(id=workflow_id)

        workflow: Optional[Workflow] = await self.workflows_service.fetch_workflow(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
        )

        if workflow is None:
            return None

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_workflow_variant(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
        )

        if workflow_variant is None:
            return None

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.fetch_workflow_revision(
            project_id=project_id,
            #
            workflow_variant_ref=Reference(id=workflow_variant.id),
        )

        if workflow_revision is None:
            return None

        simple_workflow_flags = SimpleWorkflowFlags(
            **(
                workflow.flags.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                )
                if workflow.flags
                else {}
            )
        )

        simple_workflow = SimpleWorkflow(
            id=workflow.id,
            slug=workflow.slug,
            #
            name=workflow.name,
            description=workflow.description,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            flags=simple_workflow_flags,
            meta=workflow.meta,
            tags=workflow.tags,
            #
            variant_id=workflow_variant.id,
            revision_id=workflow_revision.id,
            #
            data=SimpleWorkflowData(
                **(
                    workflow_revision.data.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                    )
                    if workflow_revision.data
                    else {}
                ),
            ),
        )

        return simple_workflow

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_workflow_edit: SimpleWorkflowEdit,
    ) -> Optional[SimpleWorkflow]:
        workflow_ref = Reference(id=simple_workflow_edit.id)

        workflow: Optional[Workflow] = await self.workflows_service.fetch_workflow(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
        )

        if workflow is None:
            return None

        workflow_edit = WorkflowEdit(
            id=simple_workflow_edit.id,
            #
            name=simple_workflow_edit.name,
            description=simple_workflow_edit.description,
            #
            flags=(
                WorkflowFlags(
                    **simple_workflow_edit.flags.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                    ),
                )
                if simple_workflow_edit.flags
                else workflow.flags
            ),
            meta=simple_workflow_edit.meta
            if simple_workflow_edit.meta is not None
            else workflow.meta,
            tags=simple_workflow_edit.tags
            if simple_workflow_edit.tags is not None
            else workflow.tags,
        )

        workflow = await self.workflows_service.edit_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_edit=workflow_edit,
        )

        if workflow is None:
            return None

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_workflow_variant(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
        )

        if workflow_variant is None:
            return None

        if simple_workflow_edit.data:
            workflow_revision_slug = uuid4().hex[-12:]

            workflow_revision_commit = WorkflowRevisionCommit(
                slug=workflow_revision_slug,
                #
                name=workflow_edit.name,
                description=workflow_edit.description,
                #
                flags=workflow_edit.flags,
                tags=workflow_edit.tags,
                meta=workflow_edit.meta,
                #
                data=WorkflowRevisionData(
                    **simple_workflow_edit.data.model_dump(mode="json"),
                ),
                #
                workflow_id=workflow.id,
                workflow_variant_id=workflow_variant.id,
            )

            workflow_revision: Optional[
                WorkflowRevision
            ] = await self.workflows_service.commit_workflow_revision(
                project_id=project_id,
                user_id=user_id,
                workflow_revision_commit=workflow_revision_commit,
            )
        else:
            workflow_revision = await self.workflows_service.fetch_workflow_revision(
                project_id=project_id,
                #
                workflow_variant_ref=Reference(id=workflow_variant.id),
            )

        if workflow_revision is None:
            return None

        simple_workflow_flags = SimpleWorkflowFlags(
            **(
                workflow.flags.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                )
                if workflow.flags
                else {}
            )
        )

        simple_workflow = SimpleWorkflow(
            id=workflow.id,
            slug=workflow.slug,
            #
            name=workflow.name,
            description=workflow.description,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            flags=simple_workflow_flags,
            meta=workflow.meta,
            tags=workflow.tags,
            #
            variant_id=workflow_variant.id,
            revision_id=workflow_revision.id,
            #
            data=SimpleWorkflowData(
                **(
                    workflow_revision.data.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                    )
                    if workflow_revision.data
                    else {}
                ),
            ),
        )

        return simple_workflow

    async def archive(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[SimpleWorkflow]:
        workflow = await self.workflows_service.archive_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_id=workflow_id,
        )

        if workflow is None:
            return None

        return await self.fetch(
            project_id=project_id,
            workflow_id=workflow_id,
        )

    async def unarchive(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[SimpleWorkflow]:
        workflow = await self.workflows_service.unarchive_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_id=workflow_id,
        )

        if workflow is None:
            return None

        return await self.fetch(
            project_id=project_id,
            workflow_id=workflow_id,
        )

    async def query(
        self,
        *,
        project_id: UUID,
        #
        simple_workflow_query: Optional[SimpleWorkflowQuery] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[SimpleWorkflow]:
        query_data = (
            simple_workflow_query.model_dump(
                mode="json",
                exclude_none=True,
                exclude_unset=True,
            )
            if simple_workflow_query
            else {}
        )
        query_data.setdefault("flags", {})
        workflow_query = WorkflowQuery(**query_data)

        workflows = await self.workflows_service.query_workflows(
            project_id=project_id,
            #
            workflow_query=workflow_query,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        simple_workflows = []

        for workflow in workflows:
            simple_workflow = await self.fetch(
                project_id=project_id,
                workflow_id=workflow.id,  # type: ignore
            )

            if simple_workflow:
                simple_workflows.append(simple_workflow)

        return simple_workflows

    # --------------------------------------------------------------------------
