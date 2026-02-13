from typing import Optional, List
from uuid import UUID, uuid4

from oss.src.core.workflows.dtos import (
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    WorkflowFork,
    #
    WorkflowVariantCreate,
    WorkflowVariantEdit,
    WorkflowVariantQuery,
    #
    WorkflowRevisionCreate,
    WorkflowRevisionEdit,
    WorkflowRevisionCommit,
    WorkflowRevisionQuery,
    WorkflowRevisionsLog,
    #
)
from oss.src.core.shared.dtos import Windowing
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.dtos import (
    SimpleEvaluatorData,
    SimpleEvaluator,
    SimpleEvaluatorCreate,
    SimpleEvaluatorEdit,
    SimpleEvaluatorQuery,
    SimpleEvaluatorFlags,
    EvaluatorFlags,
    Evaluator,
    EvaluatorQuery,
    EvaluatorRevisionsLog,
    EvaluatorCreate,
    EvaluatorEdit,
    EvaluatorFork,
    #
    EvaluatorVariant,
    EvaluatorVariantCreate,
    EvaluatorVariantEdit,
    EvaluatorVariantQuery,
    #
    EvaluatorRevision,
    EvaluatorRevisionCreate,
    EvaluatorRevisionEdit,
    EvaluatorRevisionCommit,
    EvaluatorRevisionQuery,
)
from oss.src.core.shared.dtos import Reference
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


class EvaluatorsService:
    def __init__(
        self,
        workflows_service: WorkflowsService,
    ):
        self.workflows_service = workflows_service

    # evaluators ---------------------------------------------------------------

    async def create_evaluator(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_create: EvaluatorCreate,
        #
        evaluator_id: Optional[UUID] = None,
    ) -> Optional[Evaluator]:
        workflow_create = WorkflowCreate(
            **evaluator_create.model_dump(
                mode="json",
            ),
        )

        workflow = await self.workflows_service.create_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_create=workflow_create,
            #
            workflow_id=evaluator_id,
        )

        if not workflow:
            return None

        evaluator = Evaluator(
            **workflow.model_dump(
                mode="json",
            )
        )

        return evaluator

    async def fetch_evaluator(
        self,
        *,
        project_id: UUID,
        #
        evaluator_ref: Reference,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[Evaluator]:
        workflow = await self.workflows_service.fetch_workflow(
            project_id=project_id,
            #
            workflow_ref=evaluator_ref,
            #
            include_archived=include_archived,
        )

        if not workflow:
            return None

        evaluator = Evaluator(
            **workflow.model_dump(
                mode="json",
            )
        )

        return evaluator

    async def edit_evaluator(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_edit: EvaluatorEdit,
    ) -> Optional[Evaluator]:
        workflow_edit = WorkflowEdit(
            **evaluator_edit.model_dump(
                mode="json",
            ),
        )

        workflow = await self.workflows_service.edit_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_edit=workflow_edit,
        )

        if not workflow:
            return None

        evaluator = Evaluator(
            **workflow.model_dump(
                mode="json",
            )
        )

        return evaluator

    async def archive_evaluator(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_id: UUID,
    ) -> Optional[Evaluator]:
        workflow = await self.workflows_service.archive_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_id=evaluator_id,
        )

        if not workflow:
            return None

        evaluator = Evaluator(
            **workflow.model_dump(
                mode="json",
            )
        )

        return evaluator

    async def unarchive_evaluator(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_id: UUID,
    ) -> Optional[Evaluator]:
        workflow = await self.workflows_service.unarchive_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_id=evaluator_id,
        )

        if not workflow:
            return None

        evaluator = Evaluator(
            **workflow.model_dump(
                mode="json",
            )
        )

        return evaluator

    async def query_evaluators(
        self,
        *,
        project_id: UUID,
        #
        evaluator_query: Optional[EvaluatorQuery] = None,
        #
        evaluator_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Evaluator]:
        workflow_query = (
            WorkflowQuery(
                **evaluator_query.model_dump(
                    mode="json",
                ),
            )
            if evaluator_query
            else WorkflowQuery()
        )

        workflows = await self.workflows_service.query_workflows(
            project_id=project_id,
            #
            workflow_query=workflow_query,
            #
            workflow_refs=evaluator_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        evaluators = [
            Evaluator(
                **workflow.model_dump(
                    mode="json",
                ),
            )
            for workflow in workflows
        ]

        return evaluators

    # evaluator variants -------------------------------------------------------

    async def create_evaluator_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_variant_create: EvaluatorVariantCreate,
    ) -> Optional[EvaluatorVariant]:
        workflow_variant_create = WorkflowVariantCreate(
            **evaluator_variant_create.model_dump(
                mode="json",
            ),
        )

        workflow_variant = await self.workflows_service.create_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_variant_create=workflow_variant_create,
        )

        if not workflow_variant:
            return None

        evaluator_variant = EvaluatorVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return evaluator_variant

    async def fetch_evaluator_variant(
        self,
        *,
        project_id: UUID,
        #
        evaluator_ref: Optional[Reference] = None,
        evaluator_variant_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[EvaluatorVariant]:
        workflow_variant = await self.workflows_service.fetch_workflow_variant(
            project_id=project_id,
            #
            workflow_ref=evaluator_ref,
            workflow_variant_ref=evaluator_variant_ref,
            #
            include_archived=include_archived,
        )

        if not workflow_variant:
            return None

        evaluator_variant = EvaluatorVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return evaluator_variant

    async def edit_evaluator_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_variant_edit: EvaluatorVariantEdit,
    ) -> Optional[EvaluatorVariant]:
        workflow_variant_edit = WorkflowVariantEdit(
            **evaluator_variant_edit.model_dump(
                mode="json",
            )
        )

        evaluator_variant = await self.workflows_service.edit_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_variant_edit=workflow_variant_edit,
        )

        if not evaluator_variant:
            return None

        evaluator_variant = EvaluatorVariant(
            **evaluator_variant.model_dump(
                mode="json",
            )
        )

        return evaluator_variant

    async def archive_evaluator_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_variant_id: UUID,
    ) -> Optional[EvaluatorVariant]:
        workflow_variant = await self.workflows_service.archive_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_variant_id=evaluator_variant_id,
        )

        if not workflow_variant:
            return None

        evaluator_variant = EvaluatorVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return evaluator_variant

    async def unarchive_evaluator_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_variant_id: UUID,
    ) -> Optional[EvaluatorVariant]:
        workflow_variant = await self.workflows_service.unarchive_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_variant_id=evaluator_variant_id,
        )

        if not workflow_variant:
            return None

        evaluator_variant = EvaluatorVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return evaluator_variant

    async def query_evaluator_variants(
        self,
        *,
        project_id: UUID,
        #
        evaluator_variant_query: Optional[EvaluatorVariantQuery] = None,
        #
        evaluator_refs: Optional[List[Reference]] = None,
        evaluator_variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluatorVariant]:
        workflow_variant_query = (
            WorkflowVariantQuery(
                **evaluator_variant_query.model_dump(
                    mode="json",
                )
            )
            if evaluator_variant_query
            else WorkflowVariantQuery()
        )

        workflow_variants = await self.workflows_service.query_workflow_variants(
            project_id=project_id,
            #
            workflow_variant_query=workflow_variant_query,
            #
            workflow_refs=evaluator_refs,
            workflow_variant_refs=evaluator_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        if not workflow_variants:
            return []

        evaluator_variants = [
            EvaluatorVariant(
                **workflow_variant.model_dump(
                    mode="json",
                )
            )
            for workflow_variant in workflow_variants
        ]

        return evaluator_variants

    async def fork_evaluator_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_fork: EvaluatorFork,
    ) -> Optional[EvaluatorVariant]:
        workflow_fork = WorkflowFork(
            **evaluator_fork.model_dump(
                mode="json",
            )
        )

        workflow_variant = await self.workflows_service.fork_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_fork=workflow_fork,
        )

        if not workflow_variant:
            return None

        evaluator_variant = EvaluatorVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return evaluator_variant

    # evaluator revisions ------------------------------------------------------

    async def create_evaluator_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_revision_create: EvaluatorRevisionCreate,
    ) -> Optional[EvaluatorRevision]:
        workflow_revision_create = WorkflowRevisionCreate(
            **evaluator_revision_create.model_dump(
                mode="json",
            )
        )

        workflow_revision = await self.workflows_service.create_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_revision_create=workflow_revision_create,
        )

        if not workflow_revision:
            return None

        evaluator_revision = EvaluatorRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return evaluator_revision

    async def fetch_evaluator_revision(
        self,
        *,
        project_id: UUID,
        #
        evaluator_ref: Optional[Reference] = None,
        evaluator_variant_ref: Optional[Reference] = None,
        evaluator_revision_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[EvaluatorRevision]:
        workflow_revision = await self.workflows_service.fetch_workflow_revision(
            project_id=project_id,
            #
            workflow_ref=evaluator_ref,
            workflow_variant_ref=evaluator_variant_ref,
            workflow_revision_ref=evaluator_revision_ref,
            #
            include_archived=include_archived,
        )

        if not workflow_revision:
            return None

        evaluator_revision = EvaluatorRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return evaluator_revision

    async def edit_evaluator_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_revision_edit: EvaluatorRevisionEdit,
    ) -> Optional[EvaluatorRevision]:
        workflow_revision_edit = WorkflowRevisionEdit(
            **evaluator_revision_edit.model_dump(
                mode="json",
            )
        )

        workflow_revision = await self.workflows_service.edit_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_revision_edit=workflow_revision_edit,
        )

        if not workflow_revision:
            return None

        evaluator_revision = EvaluatorRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return evaluator_revision

    async def archive_evaluator_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_revision_id: UUID,
    ) -> Optional[EvaluatorRevision]:
        workflow_revision = await self.workflows_service.archive_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_revision_id=evaluator_revision_id,
        )

        if not workflow_revision:
            return None

        evaluator_revision = EvaluatorRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return evaluator_revision

    async def unarchive_evaluator_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_revision_id: UUID,
    ) -> Optional[EvaluatorRevision]:
        workflow_revision = await self.workflows_service.unarchive_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_revision_id=evaluator_revision_id,
        )

        if not workflow_revision:
            return None

        evaluator_revision = EvaluatorRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return evaluator_revision

    async def query_evaluator_revisions(
        self,
        *,
        project_id: UUID,
        #
        evaluator_revision_query: Optional[EvaluatorRevisionQuery] = None,
        #
        evaluator_refs: Optional[List[Reference]] = None,
        evaluator_variant_refs: Optional[List[Reference]] = None,
        evaluator_revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluatorRevision]:
        workflow_revision_query = (
            WorkflowRevisionQuery(
                **evaluator_revision_query.model_dump(
                    mode="json",
                )
            )
            if evaluator_revision_query
            else WorkflowRevisionQuery()
        )

        workflow_revisions = await self.workflows_service.query_workflow_revisions(
            project_id=project_id,
            #
            workflow_revision_query=workflow_revision_query,
            #
            workflow_refs=evaluator_refs,
            workflow_variant_refs=evaluator_variant_refs,
            workflow_revision_refs=evaluator_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        if not workflow_revisions:
            return []

        evaluator_revisions = [
            EvaluatorRevision(
                **revision.model_dump(
                    mode="json",
                )
            )
            for revision in workflow_revisions
        ]

        return evaluator_revisions

    async def commit_evaluator_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluator_revision_commit: EvaluatorRevisionCommit,
    ) -> Optional[EvaluatorRevision]:
        workflow_revision_commit = WorkflowRevisionCommit(
            **evaluator_revision_commit.model_dump(
                mode="json",
            )
        )

        workflow_revision = await self.workflows_service.commit_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_revision_commit=workflow_revision_commit,
        )

        if not workflow_revision:
            return None

        evaluator_revision = EvaluatorRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return evaluator_revision

    async def log_evaluator_revisions(
        self,
        *,
        project_id: UUID,
        #
        evaluator_revisions_log: EvaluatorRevisionsLog,
        #
        include_archived: bool = False,
    ) -> List[EvaluatorRevision]:
        workflow_revisions_log = WorkflowRevisionsLog(
            **evaluator_revisions_log.model_dump(
                mode="json",
            )
        )

        workflow_revisions = await self.workflows_service.log_workflow_revisions(
            project_id=project_id,
            #
            workflow_revisions_log=workflow_revisions_log,
            #
            include_archived=include_archived,
        )

        if not workflow_revisions:
            return []

        evaluator_revisions = [
            EvaluatorRevision(
                **revision.model_dump(
                    mode="json",
                )
            )
            for revision in workflow_revisions
        ]

        return evaluator_revisions

    # evaluator services -------------------------------------------------------

    # TODO: Implement ?

    # --------------------------------------------------------------------------


class SimpleEvaluatorsService:
    def __init__(
        self,
        *,
        evaluators_service: EvaluatorsService,
    ):
        self.evaluators_service = evaluators_service

    # public -------------------------------------------------------------------

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_evaluator_create: SimpleEvaluatorCreate,
        #
        evaluator_id: Optional[UUID] = None,
    ) -> Optional[SimpleEvaluator]:
        simple_evaluator_flags = (
            SimpleEvaluatorFlags(
                **(
                    simple_evaluator_create.flags.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                        exclude={"is_evaluator"},
                    )
                ),
                is_evaluator=True,
            )
            if simple_evaluator_create.flags
            else SimpleEvaluatorFlags(
                is_evaluator=True,
            )
        )

        evaluator_flags = EvaluatorFlags(
            **simple_evaluator_flags.model_dump(
                mode="json",
                exclude_none=True,
                exclude_unset=True,
            ),
        )

        evaluator_create = EvaluatorCreate(
            slug=simple_evaluator_create.slug,
            #
            name=simple_evaluator_create.name,
            description=simple_evaluator_create.description,
            #
            flags=evaluator_flags,
            meta=simple_evaluator_create.meta,
            tags=simple_evaluator_create.tags,
        )

        evaluator: Optional[Evaluator] = await self.evaluators_service.create_evaluator(
            project_id=project_id,
            user_id=user_id,
            #
            evaluator_create=evaluator_create,
            #
            evaluator_id=evaluator_id,
        )

        if evaluator is None:
            return None

        evaluator_variant_slug = uuid4().hex[-12:]

        evaluator_variant_create = EvaluatorVariantCreate(
            slug=evaluator_variant_slug,
            #
            name=evaluator_create.name,
            description=evaluator_create.description,
            #
            flags=evaluator_flags,
            tags=evaluator_create.tags,
            meta=evaluator_create.meta,
            #
            evaluator_id=evaluator.id,
        )

        evaluator_variant: Optional[
            EvaluatorVariant
        ] = await self.evaluators_service.create_evaluator_variant(
            project_id=project_id,
            user_id=user_id,
            #
            evaluator_variant_create=evaluator_variant_create,
        )

        if evaluator_variant is None:
            return None

        evaluator_revision_slug = uuid4().hex[-12:]

        evaluator_revision_commit = EvaluatorRevisionCommit(
            slug=evaluator_revision_slug,
            #
            name=evaluator_create.name,
            description=evaluator_create.description,
            #
            flags=evaluator_flags,
            tags=evaluator_create.tags,
            meta=evaluator_create.meta,
            #
            data=None,
            #
            message="Initial commit",
            #
            evaluator_id=evaluator.id,
            evaluator_variant_id=evaluator_variant.id,
        )

        evaluator_revision: Optional[
            EvaluatorRevision
        ] = await self.evaluators_service.commit_evaluator_revision(
            project_id=project_id,
            user_id=user_id,
            evaluator_revision_commit=evaluator_revision_commit,
        )

        if evaluator_revision is None:
            return None

        evaluator_revision_slug = uuid4().hex[-12:]

        evaluator_revision_commit = EvaluatorRevisionCommit(
            slug=evaluator_revision_slug,
            #
            name=evaluator_create.name,
            description=evaluator_create.description,
            #
            flags=evaluator_flags,
            tags=evaluator_create.tags,
            meta=evaluator_create.meta,
            #
            data=simple_evaluator_create.data,
            #
            evaluator_id=evaluator.id,
            evaluator_variant_id=evaluator_variant.id,
        )

        evaluator_revision: Optional[
            EvaluatorRevision
        ] = await self.evaluators_service.commit_evaluator_revision(
            project_id=project_id,
            user_id=user_id,
            evaluator_revision_commit=evaluator_revision_commit,
        )

        if evaluator_revision is None:
            return None

        simple_evaluator_data = SimpleEvaluatorData(
            **(
                evaluator_revision.data.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                )
                if evaluator_revision.data
                else {}
            ),
        )

        simple_evaluator = SimpleEvaluator(
            id=evaluator.id,
            slug=evaluator.slug,
            #
            created_at=evaluator.created_at,
            updated_at=evaluator.updated_at,
            deleted_at=evaluator.deleted_at,
            created_by_id=evaluator.created_by_id,
            updated_by_id=evaluator.updated_by_id,
            deleted_by_id=evaluator.deleted_by_id,
            #
            name=evaluator.name,
            description=evaluator.description,
            #
            flags=simple_evaluator_flags,
            tags=evaluator.tags,
            meta=evaluator.meta,
            #
            data=simple_evaluator_data,
        )

        return simple_evaluator

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        evaluator_id: UUID,
    ) -> Optional[SimpleEvaluator]:
        evaluator_ref = Reference(
            id=evaluator_id,
        )

        evaluator: Optional[Evaluator] = await self.evaluators_service.fetch_evaluator(
            project_id=project_id,
            #
            evaluator_ref=evaluator_ref,
        )

        if evaluator is None:
            return None

        evaluator_variant: Optional[
            EvaluatorVariant
        ] = await self.evaluators_service.fetch_evaluator_variant(
            project_id=project_id,
            #
            evaluator_ref=evaluator_ref,
        )

        if evaluator_variant is None:
            return None

        evaluator_variant_ref = Reference(
            id=evaluator_variant.id,
        )

        evaluator_revision: Optional[
            EvaluatorRevision
        ] = await self.evaluators_service.fetch_evaluator_revision(
            project_id=project_id,
            #
            evaluator_variant_ref=evaluator_variant_ref,
        )

        if evaluator_revision is None:
            return None

        simple_evaluator_flags = SimpleEvaluatorFlags(
            **(
                evaluator.flags.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                )
                if evaluator.flags
                else {}
            )
        )

        simple_evaluator_data = SimpleEvaluatorData(
            **(
                evaluator_revision.data.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                )
                if evaluator_revision.data
                else {}
            ),
        )

        simple_evaluator = SimpleEvaluator(
            id=evaluator.id,
            slug=evaluator.slug,
            #
            created_at=evaluator.created_at,
            updated_at=evaluator.updated_at,
            deleted_at=evaluator.deleted_at,
            created_by_id=evaluator.created_by_id,
            updated_by_id=evaluator.updated_by_id,
            deleted_by_id=evaluator.deleted_by_id,
            #
            name=evaluator.name,
            description=evaluator.description,
            #
            flags=simple_evaluator_flags,
            tags=evaluator.tags,
            meta=evaluator.meta,
            #
            data=simple_evaluator_data,
        )
        return simple_evaluator

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_evaluator_edit: SimpleEvaluatorEdit,
    ) -> Optional[SimpleEvaluator]:
        simple_evaluator_flags = (
            SimpleEvaluatorFlags(
                **(
                    simple_evaluator_edit.flags.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                        exclude={"is_evaluator"},
                    )
                ),
                is_evaluator=True,
            )
            if simple_evaluator_edit.flags
            else SimpleEvaluatorFlags()
        )

        evaluator_flags = EvaluatorFlags(
            **simple_evaluator_flags.model_dump(
                mode="json",
                exclude_none=True,
                exclude_unset=True,
            )
        )

        evaluator_ref = Reference(
            id=simple_evaluator_edit.id,
        )

        evaluator: Optional[Evaluator] = await self.evaluators_service.fetch_evaluator(
            project_id=project_id,
            #
            evaluator_ref=evaluator_ref,
        )

        if evaluator is None:
            return None

        evaluator_edit = EvaluatorEdit(
            id=evaluator.id,
            #
            name=simple_evaluator_edit.name,
            description=simple_evaluator_edit.description,
            #
            flags=evaluator_flags,
            tags=simple_evaluator_edit.tags,
            meta=simple_evaluator_edit.meta,
        )

        evaluator = await self.evaluators_service.edit_evaluator(
            project_id=project_id,
            user_id=user_id,
            #
            evaluator_edit=evaluator_edit,
        )

        if evaluator is None:
            return None

        evaluator_variant: Optional[
            EvaluatorVariant
        ] = await self.evaluators_service.fetch_evaluator_variant(
            project_id=project_id,
            #
            evaluator_ref=evaluator_ref,
        )

        if evaluator_variant is None:
            return None

        evaluator_variant_edit = EvaluatorVariantEdit(
            id=evaluator_variant.id,
            #
            name=evaluator_edit.name,
            description=evaluator_edit.description,
            #
            flags=evaluator_flags,
            tags=evaluator_edit.tags,
            meta=evaluator_edit.meta,
            #
        )

        evaluator_variant = await self.evaluators_service.edit_evaluator_variant(
            project_id=project_id,
            user_id=user_id,
            #
            evaluator_variant_edit=evaluator_variant_edit,
        )

        if evaluator_variant is None:
            return None

        evaluator_revision_slug = uuid4().hex[-12:]

        evaluator_revision_commit = EvaluatorRevisionCommit(
            slug=evaluator_revision_slug,
            #
            name=evaluator_edit.name,
            description=evaluator_edit.description,
            #
            flags=evaluator_flags,
            tags=evaluator_edit.tags,
            meta=evaluator_edit.meta,
            #
            data=simple_evaluator_edit.data,
            #
            evaluator_id=evaluator.id,
            evaluator_variant_id=evaluator_variant.id,
        )

        evaluator_revision: Optional[
            EvaluatorRevision
        ] = await self.evaluators_service.commit_evaluator_revision(
            project_id=project_id,
            user_id=user_id,
            #
            evaluator_revision_commit=evaluator_revision_commit,
        )

        if evaluator_revision is None:
            return None

        simple_evaluator_data = SimpleEvaluatorData(
            **(
                evaluator_revision.data.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                )
                if evaluator_revision.data
                else {}
            ),
        )

        simple_evaluator = SimpleEvaluator(
            id=evaluator.id,
            slug=evaluator.slug,
            #
            created_at=evaluator.created_at,
            updated_at=evaluator.updated_at,
            deleted_at=evaluator.deleted_at,
            created_by_id=evaluator.created_by_id,
            updated_by_id=evaluator.updated_by_id,
            deleted_by_id=evaluator.deleted_by_id,
            #
            name=evaluator.name,
            description=evaluator.description,
            #
            flags=simple_evaluator_flags,
            tags=evaluator.tags,
            meta=evaluator.meta,
            #
            data=simple_evaluator_data,
        )

        return simple_evaluator

    async def query(
        self,
        *,
        project_id: UUID,
        #
        simple_evaluator_query: Optional[SimpleEvaluatorQuery] = None,
        #
        simple_evaluator_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[SimpleEvaluator]:
        query_data = (
            simple_evaluator_query.model_dump(
                mode="json",
            )
            if simple_evaluator_query
            else {}
        )
        query_data.setdefault("flags", {})
        evaluator_query = EvaluatorQuery(**query_data)

        evaluator_queries = await self.evaluators_service.query_evaluators(
            project_id=project_id,
            #
            evaluator_query=evaluator_query,
            #
            evaluator_refs=simple_evaluator_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        if not evaluator_queries:
            return []

        simple_evaluators: List[SimpleEvaluator] = []

        for evaluator_query in evaluator_queries:
            evaluator_ref = Reference(
                id=evaluator_query.id,
            )

            evaluator_variant: Optional[
                EvaluatorVariant
            ] = await self.evaluators_service.fetch_evaluator_variant(
                project_id=project_id,
                #
                evaluator_ref=evaluator_ref,
            )

            if not evaluator_variant:
                continue

            evaluator_variant_ref = Reference(
                id=evaluator_variant.id,
            )

            evaluator_revision: Optional[
                EvaluatorRevision
            ] = await self.evaluators_service.fetch_evaluator_revision(
                project_id=project_id,
                #
                evaluator_variant_ref=evaluator_variant_ref,
            )

            if not evaluator_revision:
                continue

            simple_evaluator_flags = SimpleEvaluatorFlags(
                **(
                    evaluator_query.flags.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                        exclude={"is_evaluator"},
                    )
                    if evaluator_query.flags
                    else {}
                ),
                is_evaluator=True,
            )

            simple_evaluator_data = SimpleEvaluatorData(
                **(
                    evaluator_revision.data.model_dump(
                        mode="json",
                    )
                    if evaluator_revision.data
                    else {}
                ),
            )

            evaluator_query = SimpleEvaluator(
                id=evaluator_query.id,
                slug=evaluator_query.slug,
                #
                created_at=evaluator_query.created_at,
                updated_at=evaluator_query.updated_at,
                deleted_at=evaluator_query.deleted_at,
                created_by_id=evaluator_query.created_by_id,
                updated_by_id=evaluator_query.updated_by_id,
                deleted_by_id=evaluator_query.deleted_by_id,
                #
                name=evaluator_query.name,
                description=evaluator_query.description,
                #
                flags=simple_evaluator_flags,
                tags=evaluator_query.tags,
                meta=evaluator_query.meta,
                #
                data=simple_evaluator_data,
            )

            simple_evaluators.append(evaluator_query)

        return simple_evaluators
