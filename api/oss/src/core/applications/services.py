from typing import Optional, List
from uuid import UUID, uuid4

from oss.src.utils.logging import get_module_logger
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
from oss.src.core.shared.dtos import Windowing, Reference
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.applications.dtos import (
    SimpleApplicationData,
    SimpleApplication,
    SimpleApplicationCreate,
    SimpleApplicationEdit,
    SimpleApplicationQuery,
    SimpleApplicationFlags,
    ApplicationFlags,
    Application,
    ApplicationQuery,
    ApplicationRevisionsLog,
    ApplicationCreate,
    ApplicationEdit,
    ApplicationFork,
    #
    ApplicationVariant,
    ApplicationVariantCreate,
    ApplicationVariantEdit,
    ApplicationVariantQuery,
    #
    ApplicationRevision,
    ApplicationRevisionCreate,
    ApplicationRevisionData,
    ApplicationRevisionEdit,
    ApplicationRevisionCommit,
    ApplicationRevisionQuery,
)


log = get_module_logger(__name__)


class ApplicationsService:
    def __init__(
        self,
        workflows_service: WorkflowsService,
    ):
        self.workflows_service = workflows_service

    # applications -------------------------------------------------------------

    async def create_application(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_create: ApplicationCreate,
        #
        application_id: Optional[UUID] = None,
    ) -> Optional[Application]:
        workflow_create = WorkflowCreate(
            **application_create.model_dump(
                mode="json",
            ),
        )

        workflow = await self.workflows_service.create_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_create=workflow_create,
            #
            workflow_id=application_id,
        )

        if not workflow:
            return None

        application = Application(
            **workflow.model_dump(
                mode="json",
            )
        )

        return application

    async def fetch_application(
        self,
        *,
        project_id: UUID,
        #
        application_ref: Reference,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[Application]:
        workflow = await self.workflows_service.fetch_workflow(
            project_id=project_id,
            #
            workflow_ref=application_ref,
            #
            include_archived=include_archived,
        )

        if not workflow:
            return None

        application = Application(
            **workflow.model_dump(
                mode="json",
            )
        )

        return application

    async def edit_application(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_edit: ApplicationEdit,
    ) -> Optional[Application]:
        workflow_edit = WorkflowEdit(
            **application_edit.model_dump(
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

        application = Application(
            **workflow.model_dump(
                mode="json",
            )
        )

        return application

    async def archive_application(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_id: UUID,
    ) -> Optional[Application]:
        workflow = await self.workflows_service.archive_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_id=application_id,
        )

        if not workflow:
            return None

        application = Application(
            **workflow.model_dump(
                mode="json",
            )
        )

        return application

    async def unarchive_application(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_id: UUID,
    ) -> Optional[Application]:
        workflow = await self.workflows_service.unarchive_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_id=application_id,
        )

        if not workflow:
            return None

        application = Application(
            **workflow.model_dump(
                mode="json",
            )
        )

        return application

    async def query_applications(
        self,
        *,
        project_id: UUID,
        #
        application_query: Optional[ApplicationQuery] = None,
        #
        application_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Application]:
        workflow_query = (
            WorkflowQuery(
                **application_query.model_dump(
                    mode="json",
                ),
            )
            if application_query
            else WorkflowQuery()
        )

        workflows = await self.workflows_service.query_workflows(
            project_id=project_id,
            #
            workflow_query=workflow_query,
            #
            workflow_refs=application_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        applications = [
            Application(
                **workflow.model_dump(
                    mode="json",
                ),
            )
            for workflow in workflows
        ]

        return applications

    # application variants -----------------------------------------------------

    async def create_application_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_variant_create: ApplicationVariantCreate,
    ) -> Optional[ApplicationVariant]:
        workflow_variant_create = WorkflowVariantCreate(
            **application_variant_create.model_dump(
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

        application_variant = ApplicationVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return application_variant

    async def fetch_application_variant(
        self,
        *,
        project_id: UUID,
        #
        application_ref: Optional[Reference] = None,
        application_variant_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[ApplicationVariant]:
        workflow_variant = await self.workflows_service.fetch_workflow_variant(
            project_id=project_id,
            #
            workflow_ref=application_ref,
            workflow_variant_ref=application_variant_ref,
            #
            include_archived=include_archived,
        )

        if not workflow_variant:
            return None

        application_variant = ApplicationVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return application_variant

    async def edit_application_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_variant_edit: ApplicationVariantEdit,
    ) -> Optional[ApplicationVariant]:
        workflow_variant_edit = WorkflowVariantEdit(
            **application_variant_edit.model_dump(
                mode="json",
            )
        )

        application_variant = await self.workflows_service.edit_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_variant_edit=workflow_variant_edit,
        )

        if not application_variant:
            return None

        application_variant = ApplicationVariant(
            **application_variant.model_dump(
                mode="json",
            )
        )

        return application_variant

    async def archive_application_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_variant_id: UUID,
    ) -> Optional[ApplicationVariant]:
        workflow_variant = await self.workflows_service.archive_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_variant_id=application_variant_id,
        )

        if not workflow_variant:
            return None

        application_variant = ApplicationVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return application_variant

    async def unarchive_application_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_variant_id: UUID,
    ) -> Optional[ApplicationVariant]:
        workflow_variant = await self.workflows_service.unarchive_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_variant_id=application_variant_id,
        )

        if not workflow_variant:
            return None

        application_variant = ApplicationVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return application_variant

    async def query_application_variants(
        self,
        *,
        project_id: UUID,
        #
        application_variant_query: Optional[ApplicationVariantQuery] = None,
        #
        application_refs: Optional[List[Reference]] = None,
        application_variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ApplicationVariant]:
        workflow_variant_query = (
            WorkflowVariantQuery(
                **application_variant_query.model_dump(
                    mode="json",
                )
            )
            if application_variant_query
            else WorkflowVariantQuery()
        )

        workflow_variants = await self.workflows_service.query_workflow_variants(
            project_id=project_id,
            #
            workflow_variant_query=workflow_variant_query,
            #
            workflow_refs=application_refs,
            workflow_variant_refs=application_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        if not workflow_variants:
            return []

        application_variants = [
            ApplicationVariant(
                **workflow_variant.model_dump(
                    mode="json",
                )
            )
            for workflow_variant in workflow_variants
        ]

        return application_variants

    async def fork_application_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_fork: ApplicationFork,
    ) -> Optional[ApplicationVariant]:
        workflow_fork = WorkflowFork(
            **application_fork.model_dump(
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

        application_variant = ApplicationVariant(
            **workflow_variant.model_dump(
                mode="json",
            )
        )

        return application_variant

    # application revisions ----------------------------------------------------

    async def create_application_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_revision_create: ApplicationRevisionCreate,
    ) -> Optional[ApplicationRevision]:
        workflow_revision_create = WorkflowRevisionCreate(
            **application_revision_create.model_dump(
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

        application_revision = ApplicationRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return application_revision

    async def fetch_application_revision(
        self,
        *,
        project_id: UUID,
        #
        application_ref: Optional[Reference] = None,
        application_variant_ref: Optional[Reference] = None,
        application_revision_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[ApplicationRevision]:
        workflow_revision = await self.workflows_service.fetch_workflow_revision(
            project_id=project_id,
            #
            workflow_ref=application_ref,
            workflow_variant_ref=application_variant_ref,
            workflow_revision_ref=application_revision_ref,
            #
            include_archived=include_archived,
        )

        if not workflow_revision:
            return None

        application_revision = ApplicationRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return application_revision

    async def edit_application_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_revision_edit: ApplicationRevisionEdit,
    ) -> Optional[ApplicationRevision]:
        workflow_revision_edit = WorkflowRevisionEdit(
            **application_revision_edit.model_dump(
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

        application_revision = ApplicationRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return application_revision

    async def archive_application_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_revision_id: UUID,
    ) -> Optional[ApplicationRevision]:
        workflow_revision = await self.workflows_service.archive_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_revision_id=application_revision_id,
        )

        if not workflow_revision:
            return None

        application_revision = ApplicationRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return application_revision

    async def unarchive_application_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_revision_id: UUID,
    ) -> Optional[ApplicationRevision]:
        workflow_revision = await self.workflows_service.unarchive_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_revision_id=application_revision_id,
        )

        if not workflow_revision:
            return None

        application_revision = ApplicationRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return application_revision

    async def query_application_revisions(
        self,
        *,
        project_id: UUID,
        #
        application_revision_query: Optional[ApplicationRevisionQuery] = None,
        #
        application_refs: Optional[List[Reference]] = None,
        application_variant_refs: Optional[List[Reference]] = None,
        application_revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ApplicationRevision]:
        workflow_revision_query = (
            WorkflowRevisionQuery(
                **application_revision_query.model_dump(
                    mode="json",
                )
            )
            if application_revision_query
            else WorkflowRevisionQuery()
        )

        workflow_revisions = await self.workflows_service.query_workflow_revisions(
            project_id=project_id,
            #
            workflow_revision_query=workflow_revision_query,
            #
            workflow_refs=application_refs,
            workflow_variant_refs=application_variant_refs,
            workflow_revision_refs=application_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        if not workflow_revisions:
            return []

        application_revisions = [
            ApplicationRevision(
                **revision.model_dump(
                    mode="json",
                )
            )
            for revision in workflow_revisions
        ]

        return application_revisions

    async def commit_application_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_revision_commit: ApplicationRevisionCommit,
    ) -> Optional[ApplicationRevision]:
        workflow_revision_commit = WorkflowRevisionCommit(
            **application_revision_commit.model_dump(
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

        application_revision = ApplicationRevision(
            **workflow_revision.model_dump(
                mode="json",
            )
        )

        return application_revision

    async def log_application_revisions(
        self,
        *,
        project_id: UUID,
        #
        application_revisions_log: ApplicationRevisionsLog,
        #
        include_archived: bool = False,
    ) -> List[ApplicationRevision]:
        workflow_revisions_log = WorkflowRevisionsLog(
            **application_revisions_log.model_dump(
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

        application_revisions = [
            ApplicationRevision(
                **revision.model_dump(
                    mode="json",
                )
            )
            for revision in workflow_revisions
        ]

        return application_revisions

    # --------------------------------------------------------------------------


class SimpleApplicationsService:
    def __init__(
        self,
        *,
        applications_service: ApplicationsService,
    ):
        self.applications_service = applications_service

    # public -------------------------------------------------------------------

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_application_create: SimpleApplicationCreate,
        #
        application_id: Optional[UUID] = None,
    ) -> Optional[SimpleApplication]:
        simple_application_flags = (
            SimpleApplicationFlags(
                **(
                    simple_application_create.flags.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                        exclude={"is_evaluator"},
                    )
                ),
                is_evaluator=False,
            )
            if simple_application_create.flags
            else SimpleApplicationFlags(
                is_evaluator=False,
            )
        )

        application_flags = ApplicationFlags(
            **simple_application_flags.model_dump(
                mode="json",
                exclude_none=True,
                exclude_unset=True,
            ),
        )

        application_create = ApplicationCreate(
            slug=simple_application_create.slug,
            #
            name=simple_application_create.name,
            description=simple_application_create.description,
            #
            flags=application_flags,
            meta=simple_application_create.meta,
            tags=simple_application_create.tags,
        )

        application: Optional[
            Application
        ] = await self.applications_service.create_application(
            project_id=project_id,
            user_id=user_id,
            #
            application_create=application_create,
            #
            application_id=application_id,
        )

        if application is None:
            return None

        application_variant_slug = uuid4().hex[-12:]

        application_variant_create = ApplicationVariantCreate(
            slug=application_variant_slug,
            #
            name=application_create.name,
            description=application_create.description,
            #
            flags=application_flags,
            tags=application_create.tags,
            meta=application_create.meta,
            #
            application_id=application.id,
        )

        application_variant: Optional[
            ApplicationVariant
        ] = await self.applications_service.create_application_variant(
            project_id=project_id,
            user_id=user_id,
            #
            application_variant_create=application_variant_create,
        )

        if application_variant is None:
            return None

        application_revision_slug = uuid4().hex[-12:]

        application_revision_commit = ApplicationRevisionCommit(
            slug=application_revision_slug,
            #
            name=application_create.name,
            description=application_create.description,
            #
            flags=application_flags,
            tags=application_create.tags,
            meta=application_create.meta,
            #
            data=None,
            #
            message="Initial commit",
            #
            application_id=application.id,
            application_variant_id=application_variant.id,
        )

        application_revision: Optional[
            ApplicationRevision
        ] = await self.applications_service.commit_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_commit=application_revision_commit,
        )

        if application_revision is None:
            return None

        application_revision_slug = uuid4().hex[-12:]

        application_revision_commit = ApplicationRevisionCommit(
            slug=application_revision_slug,
            #
            name=application_create.name,
            description=application_create.description,
            #
            flags=application_flags,
            tags=application_create.tags,
            meta=application_create.meta,
            #
            data=simple_application_create.data,
            #
            application_id=application.id,
            application_variant_id=application_variant.id,
        )

        application_revision = (
            await self.applications_service.commit_application_revision(
                project_id=project_id,
                user_id=user_id,
                application_revision_commit=application_revision_commit,
            )
        )

        if application_revision is None:
            return None

        simple_application = SimpleApplication(
            id=application.id,
            slug=application.slug,
            #
            name=application.name,
            description=application.description,
            #
            created_at=application.created_at,
            updated_at=application.updated_at,
            deleted_at=application.deleted_at,
            created_by_id=application.created_by_id,
            updated_by_id=application.updated_by_id,
            deleted_by_id=application.deleted_by_id,
            #
            flags=simple_application_flags,
            meta=application.meta,
            tags=application.tags,
            #
            data=SimpleApplicationData(
                **(
                    application_revision.data.model_dump(mode="json")
                    if application_revision.data
                    else {}
                ),
            ),
        )

        return simple_application

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        application_id: UUID,
    ) -> Optional[SimpleApplication]:
        application = await self.applications_service.fetch_application(
            project_id=project_id,
            #
            application_ref=Reference(id=application_id),
        )

        if application is None:
            return None

        application_variant = await self.applications_service.fetch_application_variant(
            project_id=project_id,
            #
            application_ref=Reference(id=application.id),
        )

        if application_variant is None:
            return None

        application_revision = (
            await self.applications_service.fetch_application_revision(
                project_id=project_id,
                #
                application_variant_ref=Reference(id=application_variant.id),
            )
        )

        if application_revision is None:
            return None

        simple_application_flags = (
            SimpleApplicationFlags(
                **application.flags.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                ),
            )
            if application.flags
            else SimpleApplicationFlags()
        )

        simple_application = SimpleApplication(
            id=application.id,
            slug=application.slug,
            #
            name=application.name,
            description=application.description,
            #
            created_at=application.created_at,
            updated_at=application.updated_at,
            deleted_at=application.deleted_at,
            created_by_id=application.created_by_id,
            updated_by_id=application.updated_by_id,
            deleted_by_id=application.deleted_by_id,
            #
            flags=simple_application_flags,
            meta=application.meta,
            tags=application.tags,
            #
            data=SimpleApplicationData(
                **(
                    application_revision.data.model_dump(mode="json")
                    if application_revision.data
                    else {}
                ),
            ),
        )

        return simple_application

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_application_edit: SimpleApplicationEdit,
    ) -> Optional[SimpleApplication]:
        application = await self.applications_service.fetch_application(
            project_id=project_id,
            #
            application_ref=Reference(id=simple_application_edit.id),
        )

        if application is None:
            return None

        application_edit = ApplicationEdit(
            id=simple_application_edit.id,
            #
            name=simple_application_edit.name,
            description=simple_application_edit.description,
            #
            flags=(
                ApplicationFlags(
                    **simple_application_edit.flags.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                    ),
                )
                if simple_application_edit.flags
                else application.flags
            ),
            meta=simple_application_edit.meta
            if simple_application_edit.meta is not None
            else application.meta,
            tags=simple_application_edit.tags
            if simple_application_edit.tags is not None
            else application.tags,
        )

        application = await self.applications_service.edit_application(
            project_id=project_id,
            user_id=user_id,
            #
            application_edit=application_edit,
        )

        if application is None:
            return None

        application_variant = await self.applications_service.fetch_application_variant(
            project_id=project_id,
            #
            application_ref=Reference(id=application.id),
        )

        if application_variant is None:
            return None

        if simple_application_edit.data:
            application_revision_slug = uuid4().hex[-12:]

            application_revision_commit = ApplicationRevisionCommit(
                slug=application_revision_slug,
                #
                name=application_edit.name,
                description=application_edit.description,
                #
                flags=application_edit.flags,
                tags=application_edit.tags,
                meta=application_edit.meta,
                #
                data=ApplicationRevisionData(
                    **simple_application_edit.data.model_dump(mode="json"),
                ),
                #
                application_id=application.id,
                application_variant_id=application_variant.id,
            )

            application_revision = (
                await self.applications_service.commit_application_revision(
                    project_id=project_id,
                    user_id=user_id,
                    application_revision_commit=application_revision_commit,
                )
            )
        else:
            application_revision = (
                await self.applications_service.fetch_application_revision(
                    project_id=project_id,
                    #
                    application_variant_ref=Reference(id=application_variant.id),
                )
            )

        if application_revision is None:
            return None

        simple_application_flags = (
            SimpleApplicationFlags(
                **application.flags.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                ),
            )
            if application.flags
            else SimpleApplicationFlags()
        )

        simple_application = SimpleApplication(
            id=application.id,
            slug=application.slug,
            #
            name=application.name,
            description=application.description,
            #
            created_at=application.created_at,
            updated_at=application.updated_at,
            deleted_at=application.deleted_at,
            created_by_id=application.created_by_id,
            updated_by_id=application.updated_by_id,
            deleted_by_id=application.deleted_by_id,
            #
            flags=simple_application_flags,
            meta=application.meta,
            tags=application.tags,
            #
            data=SimpleApplicationData(
                **(
                    application_revision.data.model_dump(mode="json")
                    if application_revision.data
                    else {}
                ),
            ),
        )

        return simple_application

    async def archive(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_id: UUID,
    ) -> Optional[SimpleApplication]:
        application = await self.applications_service.archive_application(
            project_id=project_id,
            user_id=user_id,
            #
            application_id=application_id,
        )

        if application is None:
            return None

        return await self.fetch(
            project_id=project_id,
            application_id=application_id,
        )

    async def unarchive(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        application_id: UUID,
    ) -> Optional[SimpleApplication]:
        application = await self.applications_service.unarchive_application(
            project_id=project_id,
            user_id=user_id,
            #
            application_id=application_id,
        )

        if application is None:
            return None

        return await self.fetch(
            project_id=project_id,
            application_id=application_id,
        )

    async def query(
        self,
        *,
        project_id: UUID,
        #
        simple_application_query: Optional[SimpleApplicationQuery] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[SimpleApplication]:
        query_data = (
            simple_application_query.model_dump(
                mode="json",
                exclude_none=True,
                exclude_unset=True,
            )
            if simple_application_query
            else {}
        )
        query_data.setdefault("flags", {})
        application_query = ApplicationQuery(**query_data)

        applications = await self.applications_service.query_applications(
            project_id=project_id,
            #
            application_query=application_query,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        simple_applications = []

        for application in applications:
            simple_application = await self.fetch(
                project_id=project_id,
                application_id=application.id,  # type: ignore
            )

            if simple_application:
                simple_applications.append(simple_application)

        return simple_applications

    # --------------------------------------------------------------------------
