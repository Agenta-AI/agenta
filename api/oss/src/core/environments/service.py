from typing import Optional, List, Dict
from uuid import UUID, uuid4

from oss.src.utils.logging import get_module_logger
from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.git.dtos import (
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    #
    VariantCreate,
    VariantEdit,
    VariantQuery,
    #
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionCommit,
)
from oss.src.core.environments.dtos import (
    Environment,
    EnvironmentCreate,
    EnvironmentEdit,
    EnvironmentQuery,
    EnvironmentRevisionsLog,
    EnvironmentFlags,
    #
    EnvironmentVariant,
    EnvironmentVariantCreate,
    EnvironmentVariantEdit,
    EnvironmentVariantQuery,
    #
    EnvironmentRevision,
    EnvironmentRevisionData,
    EnvironmentRevisionCreate,
    EnvironmentRevisionEdit,
    EnvironmentRevisionQuery,
    EnvironmentRevisionCommit,
    SimpleEnvironment,
    SimpleEnvironmentCreate,
    SimpleEnvironmentEdit,
    SimpleEnvironmentQuery,
)


log = get_module_logger(__name__)


class EnvironmentsService:
    def __init__(
        self,
        *,
        environments_dao: GitDAOInterface,
    ):
        self.environments_dao = environments_dao

    # environments ---------------------------------------------------------

    async def create_environment(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_create: EnvironmentCreate,
        #
        environment_id: Optional[UUID] = None,
    ) -> Optional[Environment]:
        artifact_create = ArtifactCreate(
            **environment_create.model_dump(
                mode="json",
            ),
        )

        artifact = await self.environments_dao.create_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_create=artifact_create,
            #
            artifact_id=environment_id,
        )

        if not artifact:
            return None

        environment = Environment(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return environment

    async def fetch_environment(
        self,
        *,
        project_id: UUID,
        #
        environment_ref: Reference,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[Environment]:
        artifact = await self.environments_dao.fetch_artifact(
            project_id=project_id,
            #
            artifact_ref=environment_ref,
            #
            include_archived=include_archived,
        )

        if not artifact:
            return None

        environment = Environment(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return environment

    async def edit_environment(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_edit: EnvironmentEdit,
    ) -> Optional[Environment]:
        artifact_edit = ArtifactEdit(
            **environment_edit.model_dump(
                mode="json",
            ),
        )

        artifact = await self.environments_dao.edit_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_edit=artifact_edit,
        )

        if not artifact:
            return None

        environment = Environment(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return environment

    async def archive_environment(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_id: UUID,
    ) -> Optional[Environment]:
        artifact = await self.environments_dao.archive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=environment_id,
        )

        if not artifact:
            return None

        environment = Environment(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return environment

    async def unarchive_environment(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_id: UUID,
    ) -> Optional[Environment]:
        artifact = await self.environments_dao.unarchive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=environment_id,
        )

        if not artifact:
            return None

        environment = Environment(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return environment

    async def query_environments(
        self,
        *,
        project_id: UUID,
        #
        environment_query: Optional[EnvironmentQuery] = None,
        #
        environment_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Environment]:
        artifact_query = (
            ArtifactQuery(
                **environment_query.model_dump(
                    mode="json",
                ),
            )
            if environment_query
            else ArtifactQuery()
        )

        artifacts = await self.environments_dao.query_artifacts(
            project_id=project_id,
            #
            artifact_query=artifact_query,
            #
            artifact_refs=environment_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        environments = [
            Environment(
                **artifact.model_dump(
                    mode="json",
                ),
            )
            for artifact in artifacts
        ]

        return environments

    # environment variants -------------------------------------------------

    async def create_environment_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_variant_create: EnvironmentVariantCreate,
    ) -> Optional[EnvironmentVariant]:
        variant_create = VariantCreate(
            **environment_variant_create.model_dump(
                mode="json",
            ),
        )

        variant = await self.environments_dao.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_create=variant_create,
        )

        if not variant:
            return None

        environment_variant = EnvironmentVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return environment_variant

    async def fetch_environment_variant(
        self,
        *,
        project_id: UUID,
        #
        environment_ref: Optional[Reference] = None,
        environment_variant_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[EnvironmentVariant]:
        variant = await self.environments_dao.fetch_variant(
            project_id=project_id,
            #
            artifact_ref=environment_ref,
            variant_ref=environment_variant_ref,
            #
            include_archived=include_archived,
        )

        if not variant:
            return None

        environment_variant = EnvironmentVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return environment_variant

    async def edit_environment_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_variant_edit: EnvironmentVariantEdit,
    ) -> Optional[EnvironmentVariant]:
        variant_edit = VariantEdit(
            **environment_variant_edit.model_dump(
                mode="json",
            ),
        )

        variant = await self.environments_dao.edit_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_edit=variant_edit,
        )

        if not variant:
            return None

        environment_variant = EnvironmentVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return environment_variant

    async def archive_environment_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_variant_id: UUID,
    ) -> Optional[EnvironmentVariant]:
        variant = await self.environments_dao.archive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=environment_variant_id,
        )

        if not variant:
            return None

        environment_variant = EnvironmentVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return environment_variant

    async def unarchive_environment_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_variant_id: UUID,
    ) -> Optional[EnvironmentVariant]:
        variant = await self.environments_dao.unarchive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=environment_variant_id,
        )

        if not variant:
            return None

        environment_variant = EnvironmentVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return environment_variant

    async def query_environment_variants(
        self,
        *,
        project_id: UUID,
        #
        environment_variant_query: Optional[EnvironmentVariantQuery] = None,
        #
        environment_refs: Optional[List[Reference]] = None,
        environment_variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EnvironmentVariant]:
        variant_query = (
            VariantQuery(
                **environment_variant_query.model_dump(
                    mode="json",
                ),
            )
            if environment_variant_query
            else VariantQuery()
        )

        variants = await self.environments_dao.query_variants(
            project_id=project_id,
            #
            variant_query=variant_query,
            #
            artifact_refs=environment_refs,
            variant_refs=environment_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        environment_variants = [
            EnvironmentVariant(
                **variant.model_dump(
                    mode="json",
                ),
            )
            for variant in variants
        ]

        return environment_variants

    # environment revisions ------------------------------------------------

    async def create_environment_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_revision_create: EnvironmentRevisionCreate,
    ) -> Optional[EnvironmentRevision]:
        revision_create = RevisionCreate(
            **environment_revision_create.model_dump(
                mode="json",
            ),
        )

        revision = await self.environments_dao.create_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_create=revision_create,
        )

        if not revision:
            return None

        environment_revision = EnvironmentRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        return environment_revision

    async def fetch_environment_revision(
        self,
        *,
        project_id: UUID,
        #
        environment_ref: Optional[Reference] = None,
        environment_variant_ref: Optional[Reference] = None,
        environment_revision_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[EnvironmentRevision]:
        if (
            not environment_ref
            and not environment_variant_ref
            and not environment_revision_ref
        ):
            return None

        if (
            environment_ref
            and not environment_variant_ref
            and not environment_revision_ref
        ):
            environment = await self.fetch_environment(
                project_id=project_id,
                #
                environment_ref=environment_ref,
                #
                include_archived=include_archived,
            )

            if not environment:
                return None

            environment_ref = Reference(
                id=environment.id,
                slug=environment.slug,
            )

            environment_variant = await self.fetch_environment_variant(
                project_id=project_id,
                #
                environment_ref=environment_ref,
                #
                include_archived=include_archived,
            )

            if not environment_variant:
                return None

            environment_variant_ref = Reference(
                id=environment_variant.id,
                slug=environment_variant.slug,
            )

        revision = await self.environments_dao.fetch_revision(
            project_id=project_id,
            #
            variant_ref=environment_variant_ref,
            revision_ref=environment_revision_ref,
            #
            include_archived=include_archived,
        )

        if not revision:
            return None

        environment_revision = EnvironmentRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        return environment_revision

    async def edit_environment_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_revision_edit: EnvironmentRevisionEdit,
    ) -> Optional[EnvironmentRevision]:
        revision_edit = RevisionEdit(
            **environment_revision_edit.model_dump(
                mode="json",
            ),
        )

        revision = await self.environments_dao.edit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_edit=revision_edit,
        )

        if not revision:
            return None

        environment_revision = EnvironmentRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        return environment_revision

    async def archive_environment_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_revision_id: UUID,
    ) -> Optional[EnvironmentRevision]:
        revision = await self.environments_dao.archive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=environment_revision_id,
        )

        if not revision:
            return None

        environment_revision = EnvironmentRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        return environment_revision

    async def unarchive_environment_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_revision_id: UUID,
    ) -> Optional[EnvironmentRevision]:
        revision = await self.environments_dao.unarchive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=environment_revision_id,
        )

        if not revision:
            return None

        environment_revision = EnvironmentRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        return environment_revision

    async def query_environment_revisions(
        self,
        *,
        project_id: UUID,
        #
        environment_revision_query: Optional[EnvironmentRevisionQuery] = None,
        #
        environment_refs: Optional[List[Reference]] = None,
        environment_variant_refs: Optional[List[Reference]] = None,
        environment_revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EnvironmentRevision]:
        revision_query = (
            RevisionQuery(
                **environment_revision_query.model_dump(
                    mode="json",
                ),
            )
            if environment_revision_query
            else RevisionQuery()
        )

        revisions = await self.environments_dao.query_revisions(
            project_id=project_id,
            #
            revision_query=revision_query,
            #
            artifact_refs=environment_refs,
            variant_refs=environment_variant_refs,
            revision_refs=environment_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        if not revisions:
            return []

        environment_revisions = [
            EnvironmentRevision(
                **revision.model_dump(
                    mode="json",
                ),
            )
            for revision in revisions
        ]

        return environment_revisions

    async def commit_environment_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_revision_commit: EnvironmentRevisionCommit,
    ) -> Optional[EnvironmentRevision]:
        # Route to delta handler if delta provided without data
        if environment_revision_commit.delta and not environment_revision_commit.data:
            return await self._commit_environment_revision_delta(
                project_id=project_id,
                user_id=user_id,
                environment_revision_commit=environment_revision_commit,
            )

        dumped = environment_revision_commit.model_dump(
            mode="json",
            exclude_none=True,
        )

        revision_commit = RevisionCommit(**dumped)

        revision = await self.environments_dao.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_commit=revision_commit,
        )

        if not revision:
            return None

        environment_revision = EnvironmentRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        return environment_revision

    async def _commit_environment_revision_delta(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        environment_revision_commit: EnvironmentRevisionCommit,
    ) -> Optional[EnvironmentRevision]:
        """Apply delta operations to the latest revision's references and commit.

        1. Fetch the latest revision for the environment variant.
        2. If the latest revision has no data, scan backwards for one that does.
        3. Apply ``delta.set`` (add/update keys) and ``delta.remove`` (delete keys).
        4. Re-enter ``commit_environment_revision`` with the resolved full data.
        """

        delta = environment_revision_commit.delta

        # Resolve the environment variant to find the latest revision
        variant_id = (
            environment_revision_commit.environment_variant_id
            or environment_revision_commit.variant_id
        )

        base_references: Dict[str, Dict[str, Reference]] = {}

        if variant_id:
            # Fetch revisions ordered by newest first (windowing applies descending order)
            revisions = await self.query_environment_revisions(
                project_id=project_id,
                environment_variant_refs=[Reference(id=variant_id)],
                windowing=Windowing(),  # Ensures descending order by ID (UUID7)
            )

            # Find the most recent revision that has reference data
            for rev in revisions:
                if rev.data and rev.data.references:
                    base_references = dict(rev.data.references)
                    break

        # Apply delta operations
        if delta.set:
            base_references.update(delta.set)

        if delta.remove:
            for key in delta.remove:
                base_references.pop(key, None)

        # Reconstruct commit with full data (no delta)
        environment_revision_commit = EnvironmentRevisionCommit(
            slug=environment_revision_commit.slug,
            name=environment_revision_commit.name,
            description=environment_revision_commit.description,
            tags=environment_revision_commit.tags,
            meta=environment_revision_commit.meta,
            message=environment_revision_commit.message,
            environment_id=environment_revision_commit.environment_id,
            environment_variant_id=environment_revision_commit.environment_variant_id,
            data=EnvironmentRevisionData(
                references=base_references if base_references else None,
            ),
        )

        # Re-enter with full data
        return await self.commit_environment_revision(
            project_id=project_id,
            user_id=user_id,
            environment_revision_commit=environment_revision_commit,
        )

    async def log_environment_revisions(
        self,
        *,
        project_id: UUID,
        #
        environment_revisions_log: EnvironmentRevisionsLog,
        #
        include_archived: bool = False,
    ) -> List[EnvironmentRevision]:
        revisions = await self.environments_dao.log_revisions(
            project_id=project_id,
            #
            revisions_log=environment_revisions_log,
            #
            include_archived=include_archived,
        )

        if not revisions:
            return []

        environment_revisions = [
            EnvironmentRevision(
                **revision.model_dump(
                    mode="json",
                ),
            )
            for revision in revisions
        ]

        return environment_revisions

    # ----------------------------------------------------------------------


class SimpleEnvironmentsService:
    def __init__(
        self,
        *,
        environments_service: EnvironmentsService,
    ):
        self.environments_service = environments_service

    # public ---------------------------------------------------------------

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_environment_create: SimpleEnvironmentCreate,
        #
        environment_id: Optional[UUID] = None,
    ) -> Optional[SimpleEnvironment]:
        environment_create = EnvironmentCreate(
            slug=simple_environment_create.slug,
            #
            name=simple_environment_create.name,
            description=simple_environment_create.description,
            #
            flags=simple_environment_create.flags,
            tags=simple_environment_create.tags,
            meta=simple_environment_create.meta,
        )

        environment: Optional[
            Environment
        ] = await self.environments_service.create_environment(
            project_id=project_id,
            user_id=user_id,
            #
            environment_create=environment_create,
            #
            environment_id=environment_id,
        )

        if environment is None:
            return None

        environment_variant_slug = uuid4().hex[-12:]

        environment_variant_create = EnvironmentVariantCreate(
            slug=environment_variant_slug,
            #
            name=environment_create.name,
            description=environment_create.description,
            #
            tags=environment_create.tags,
            meta=environment_create.meta,
            #
            environment_id=environment.id,
        )

        environment_variant: Optional[
            EnvironmentVariant
        ] = await self.environments_service.create_environment_variant(
            project_id=project_id,
            user_id=user_id,
            #
            environment_variant_create=environment_variant_create,
        )

        if environment_variant is None:
            return None

        environment_revision_slug = uuid4().hex[-12:]

        environment_revision_commit = EnvironmentRevisionCommit(
            slug=environment_revision_slug,
            #
            name=environment_create.name,
            description=environment_create.description,
            #
            tags=environment_create.tags,
            meta=environment_create.meta,
            #
            data=None,
            #
            message="Initial commit",
            #
            environment_id=environment.id,
            environment_variant_id=environment_variant.id,
        )

        environment_revision: Optional[
            EnvironmentRevision
        ] = await self.environments_service.commit_environment_revision(
            project_id=project_id,
            user_id=user_id,
            environment_revision_commit=environment_revision_commit,
        )

        if environment_revision is None:
            return None

        environment_revision_slug = uuid4().hex[-12:]

        environment_revision_commit = EnvironmentRevisionCommit(
            slug=environment_revision_slug,
            #
            name=environment_create.name,
            description=environment_create.description,
            #
            tags=environment_create.tags,
            meta=environment_create.meta,
            #
            data=simple_environment_create.data,
            #
            environment_id=environment.id,
            environment_variant_id=environment_variant.id,
        )

        environment_revision: Optional[
            EnvironmentRevision
        ] = await self.environments_service.commit_environment_revision(
            project_id=project_id,
            user_id=user_id,
            environment_revision_commit=environment_revision_commit,
        )

        if environment_revision is None:
            return None

        simple_environment = SimpleEnvironment(
            id=environment.id,
            slug=environment.slug,
            #
            created_at=environment.created_at,
            updated_at=environment.updated_at,
            deleted_at=environment.deleted_at,
            created_by_id=environment.created_by_id,
            updated_by_id=environment.updated_by_id,
            deleted_by_id=environment.deleted_by_id,
            #
            name=environment.name,
            description=environment.description,
            #
            flags=(
                EnvironmentFlags(**environment.flags) if environment.flags else None
            ),
            tags=environment.tags,
            meta=environment.meta,
            #
            data=(
                EnvironmentRevisionData(
                    **(
                        environment_revision.data.model_dump(
                            mode="json",
                            exclude_none=True,
                            exclude_unset=True,
                        )
                        if environment_revision.data
                        else {}
                    ),
                )
                if environment_revision.data
                else None
            ),
            #
            variant_id=environment_variant.id,
            revision_id=environment_revision.id,
        )

        return simple_environment

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        environment_id: UUID,
    ) -> Optional[SimpleEnvironment]:
        environment_ref = Reference(
            id=environment_id,
        )

        environment: Optional[
            Environment
        ] = await self.environments_service.fetch_environment(
            project_id=project_id,
            #
            environment_ref=environment_ref,
        )

        if environment is None:
            return None

        environment_variant: Optional[
            EnvironmentVariant
        ] = await self.environments_service.fetch_environment_variant(
            project_id=project_id,
            #
            environment_ref=environment_ref,
        )

        if environment_variant is None:
            return None

        environment_variant_ref = Reference(
            id=environment_variant.id,
        )

        environment_revision: Optional[
            EnvironmentRevision
        ] = await self.environments_service.fetch_environment_revision(
            project_id=project_id,
            #
            environment_variant_ref=environment_variant_ref,
        )

        if environment_revision is None:
            return None

        simple_environment = SimpleEnvironment(
            id=environment.id,
            slug=environment.slug,
            #
            created_at=environment.created_at,
            updated_at=environment.updated_at,
            deleted_at=environment.deleted_at,
            created_by_id=environment.created_by_id,
            updated_by_id=environment.updated_by_id,
            deleted_by_id=environment.deleted_by_id,
            #
            name=environment.name,
            description=environment.description,
            #
            flags=(
                EnvironmentFlags(**environment.flags) if environment.flags else None
            ),
            tags=environment.tags,
            meta=environment.meta,
            #
            data=(
                EnvironmentRevisionData(
                    **(
                        environment_revision.data.model_dump(
                            mode="json",
                            exclude_none=True,
                            exclude_unset=True,
                        )
                        if environment_revision.data
                        else {}
                    ),
                )
                if environment_revision.data
                else None
            ),
            #
            variant_id=environment_variant.id,
            revision_id=environment_revision.id,
        )

        return simple_environment

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_environment_edit: SimpleEnvironmentEdit,
    ) -> Optional[SimpleEnvironment]:
        environment_ref = Reference(
            id=simple_environment_edit.id,
        )

        environment: Optional[
            Environment
        ] = await self.environments_service.fetch_environment(
            project_id=project_id,
            #
            environment_ref=environment_ref,
        )

        if environment is None:
            return None

        environment_edit = EnvironmentEdit(
            id=environment.id,
            #
            name=simple_environment_edit.name,
            description=simple_environment_edit.description,
            #
            flags=simple_environment_edit.flags,
            tags=simple_environment_edit.tags,
            meta=simple_environment_edit.meta,
        )

        environment = await self.environments_service.edit_environment(
            project_id=project_id,
            user_id=user_id,
            #
            environment_edit=environment_edit,
        )

        if environment is None:
            return None

        environment_variant: Optional[
            EnvironmentVariant
        ] = await self.environments_service.fetch_environment_variant(
            project_id=project_id,
            #
            environment_ref=environment_ref,
        )

        if environment_variant is None:
            return None

        environment_variant_edit = EnvironmentVariantEdit(
            id=environment_variant.id,
            #
            name=environment_edit.name,
            description=environment_edit.description,
            #
            tags=environment_edit.tags,
            meta=environment_edit.meta,
        )

        environment_variant = await self.environments_service.edit_environment_variant(
            project_id=project_id,
            user_id=user_id,
            #
            environment_variant_edit=environment_variant_edit,
        )

        if environment_variant is None:
            return None

        environment_revision_slug = uuid4().hex[-12:]

        environment_revision_commit = EnvironmentRevisionCommit(
            slug=environment_revision_slug,
            #
            name=environment_edit.name,
            description=environment_edit.description,
            #
            tags=environment_edit.tags,
            meta=environment_edit.meta,
            #
            data=simple_environment_edit.data,
            #
            environment_id=environment.id,
            environment_variant_id=environment_variant.id,
        )

        environment_revision: Optional[
            EnvironmentRevision
        ] = await self.environments_service.commit_environment_revision(
            project_id=project_id,
            user_id=user_id,
            #
            environment_revision_commit=environment_revision_commit,
        )

        if environment_revision is None:
            return None

        simple_environment = SimpleEnvironment(
            id=environment.id,
            slug=environment.slug,
            #
            created_at=environment.created_at,
            updated_at=environment.updated_at,
            deleted_at=environment.deleted_at,
            created_by_id=environment.created_by_id,
            updated_by_id=environment.updated_by_id,
            deleted_by_id=environment.deleted_by_id,
            #
            name=environment.name,
            description=environment.description,
            #
            flags=(
                EnvironmentFlags(**environment.flags) if environment.flags else None
            ),
            tags=environment.tags,
            meta=environment.meta,
            #
            data=(
                EnvironmentRevisionData(
                    **(
                        environment_revision.data.model_dump(
                            mode="json",
                            exclude_none=True,
                            exclude_unset=True,
                        )
                        if environment_revision.data
                        else {}
                    ),
                )
                if environment_revision.data
                else None
            ),
            #
            variant_id=environment_variant.id,
            revision_id=environment_revision.id,
        )

        return simple_environment

    async def query(
        self,
        *,
        project_id: UUID,
        #
        simple_environment_query: Optional[SimpleEnvironmentQuery] = None,
        #
        simple_environment_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[SimpleEnvironment]:
        environment_query = EnvironmentQuery(
            **(
                simple_environment_query.model_dump(
                    mode="json",
                )
                if simple_environment_query
                else {}
            ),
        )

        environments = await self.environments_service.query_environments(
            project_id=project_id,
            #
            environment_query=environment_query,
            #
            environment_refs=simple_environment_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        if not environments:
            return []

        simple_environments: List[SimpleEnvironment] = []

        for environment in environments:
            environment_ref = Reference(
                id=environment.id,
            )

            environment_variant: Optional[
                EnvironmentVariant
            ] = await self.environments_service.fetch_environment_variant(
                project_id=project_id,
                #
                environment_ref=environment_ref,
            )

            if not environment_variant:
                continue

            environment_variant_ref = Reference(
                id=environment_variant.id,
            )

            environment_revision: Optional[
                EnvironmentRevision
            ] = await self.environments_service.fetch_environment_revision(
                project_id=project_id,
                #
                environment_variant_ref=environment_variant_ref,
            )

            if not environment_revision:
                continue

            simple_environment = SimpleEnvironment(
                id=environment.id,
                slug=environment.slug,
                #
                created_at=environment.created_at,
                updated_at=environment.updated_at,
                deleted_at=environment.deleted_at,
                created_by_id=environment.created_by_id,
                updated_by_id=environment.updated_by_id,
                deleted_by_id=environment.deleted_by_id,
                #
                name=environment.name,
                description=environment.description,
                #
                flags=(
                    EnvironmentFlags(**environment.flags) if environment.flags else None
                ),
                tags=environment.tags,
                meta=environment.meta,
                #
                data=(
                    EnvironmentRevisionData(
                        **(
                            environment_revision.data.model_dump(
                                mode="json",
                                exclude_none=True,
                                exclude_unset=True,
                            )
                            if environment_revision.data
                            else {}
                        ),
                    )
                    if environment_revision.data
                    else None
                ),
                #
                variant_id=environment_variant.id,
                revision_id=environment_revision.id,
            )

            simple_environments.append(simple_environment)

        return simple_environments

    # ----------------------------------------------------------------------
