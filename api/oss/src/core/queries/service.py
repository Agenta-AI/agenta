from typing import Optional, List
from uuid import UUID, uuid4

from oss.src.utils.logging import get_module_logger

from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.git.dtos import (
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    ArtifactFork,
    RevisionsLog,
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
from oss.src.core.queries.dtos import (
    Query,
    QueryCreate,
    QueryEdit,
    QueryQuery,
    QueryFork,
    #
    QueryVariant,
    QueryVariantCreate,
    QueryVariantEdit,
    QueryVariantQuery,
    #
    QueryRevision,
    QueryRevisionCreate,
    QueryRevisionEdit,
    QueryRevisionQuery,
    QueryRevisionCommit,
    QueryRevisionsLog,
    #
    SimpleQuery,
    SimpleQueryCreate,
    SimpleQueryEdit,
    SimpleQueryQuery,
)


log = get_module_logger(__name__)


class QueriesService:
    def __init__(
        self,
        *,
        queries_dao: GitDAOInterface,
    ):
        self.queries_dao = queries_dao

    ## -- artifacts ------------------------------------------------------------

    async def create_query(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_create: QueryCreate,
        #
        query_id: Optional[UUID] = None,
    ) -> Optional[Query]:
        _artifact_create = ArtifactCreate(
            **query_create.model_dump(mode="json"),
        )

        artifact = await self.queries_dao.create_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_create=_artifact_create,
            #
            artifact_id=query_id,
        )

        if not artifact:
            return None

        _query = Query(**artifact.model_dump(mode="json"))

        return _query

    async def fetch_query(
        self,
        *,
        project_id: UUID,
        #
        query_ref: Reference,
    ) -> Optional[Query]:
        artifact = await self.queries_dao.fetch_artifact(
            project_id=project_id,
            #
            artifact_ref=query_ref,
        )

        if not artifact:
            return None

        _query = Query(**artifact.model_dump(mode="json"))

        return _query

    async def edit_query(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_edit: QueryEdit,
    ) -> Optional[Query]:
        _artifact_edit = ArtifactEdit(
            **query_edit.model_dump(mode="json"),
        )

        artifact = await self.queries_dao.edit_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_edit=_artifact_edit,
        )

        if not artifact:
            return None

        _query = Query(**artifact.model_dump(mode="json"))

        return _query

    async def archive_query(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_id: UUID,
    ) -> Optional[Query]:
        artifact = await self.queries_dao.archive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=query_id,
        )

        if not artifact:
            return None

        _query = Query(**artifact.model_dump(mode="json"))

        return _query

    async def unarchive_query(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_id: UUID,
    ) -> Optional[Query]:
        artifact = await self.queries_dao.unarchive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=query_id,
        )

        if not artifact:
            return None

        _query = Query(**artifact.model_dump(mode="json"))

        return _query

    async def query_queries(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[QueryQuery] = None,
        #
        query_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Query]:
        _artifact_query = (
            ArtifactQuery(
                **query.model_dump(mode="json", exclude_none=True),
            )
            if query
            else ArtifactQuery()
        )

        artifacts = await self.queries_dao.query_artifacts(
            project_id=project_id,
            #
            artifact_query=_artifact_query,
            #
            artifact_refs=query_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        _queries = [
            Query(
                **artifact.model_dump(mode="json"),
            )
            for artifact in artifacts
        ]

        return _queries

    ## -------------------------------------------------------------------------

    ## -- variants -------------------------------------------------------------

    async def create_query_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_variant_create: QueryVariantCreate,
    ) -> Optional[QueryVariant]:
        _variant_create = VariantCreate(
            **query_variant_create.model_dump(mode="json"),
        )

        variant = await self.queries_dao.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_create=_variant_create,
        )

        if not variant:
            return None

        _query_variant = QueryVariant(
            **variant.model_dump(mode="json"),
        )

        return _query_variant

    async def fetch_query_variant(
        self,
        *,
        project_id: UUID,
        #
        query_ref: Optional[Reference] = None,
        query_variant_ref: Optional[Reference] = None,
    ) -> Optional[QueryVariant]:
        variant = await self.queries_dao.fetch_variant(
            project_id=project_id,
            #
            artifact_ref=query_ref,
            variant_ref=query_variant_ref,
        )

        if not variant:
            return None

        _query_variant = QueryVariant(
            **variant.model_dump(mode="json"),
        )

        return _query_variant

    async def edit_query_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_variant_edit: QueryVariantEdit,
    ) -> Optional[QueryVariant]:
        _variant_edit = VariantEdit(
            **query_variant_edit.model_dump(mode="json"),
        )

        variant = await self.queries_dao.edit_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_edit=_variant_edit,
        )

        if not variant:
            return None

        _query_variant = QueryVariant(
            **variant.model_dump(mode="json"),
        )

        return _query_variant

    async def archive_query_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_variant_id: UUID,
    ) -> Optional[QueryVariant]:
        variant = await self.queries_dao.archive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=query_variant_id,
        )

        if not variant:
            return None

        _query_variant = QueryVariant(
            **variant.model_dump(mode="json"),
        )

        return _query_variant

    async def unarchive_query_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_variant_id: UUID,
    ) -> Optional[QueryVariant]:
        variant = await self.queries_dao.unarchive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=query_variant_id,
        )

        if not variant:
            return None

        _workdlow_variant = QueryVariant(
            **variant.model_dump(mode="json"),
        )

        return _workdlow_variant

    async def query_query_variants(
        self,
        *,
        project_id: UUID,
        #
        query_variant_query: Optional[QueryVariantQuery] = None,
        #
        query_refs: Optional[List[Reference]] = None,
        query_variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[QueryVariant]:
        _variant_query = (
            VariantQuery(
                **query_variant_query.model_dump(mode="json", exclude_none=True),
            )
            if query_variant_query
            else VariantQuery()
        )

        variants = await self.queries_dao.query_variants(
            project_id=project_id,
            #
            variant_query=_variant_query,
            #
            artifact_refs=query_refs,
            variant_refs=query_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        _query_variants = [
            QueryVariant(
                **variant.model_dump(mode="json"),
            )
            for variant in variants
        ]

        return _query_variants

    ## .........................................................................

    async def fork_query_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_fork: QueryFork,
    ) -> Optional[QueryVariant]:
        _artifact_fork = ArtifactFork(
            **query_fork.model_dump(mode="json"),
        )

        variant = await self.queries_dao.fork_variant(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_fork=_artifact_fork,
        )

        if not variant:
            return None

        _query_variant = QueryVariant(
            **variant.model_dump(mode="json"),
        )

        return _query_variant

    ## -------------------------------------------------------------------------

    ## -- revisions ------------------------------------------------------------

    async def create_query_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_revision_create: QueryRevisionCreate,
    ) -> Optional[QueryRevision]:
        _revision_create = RevisionCreate(
            **query_revision_create.model_dump(mode="json"),
        )

        revision = await self.queries_dao.create_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_create=_revision_create,
        )

        if not revision:
            return None

        _query_revision = QueryRevision(
            **revision.model_dump(mode="json"),
        )

        return _query_revision

    async def fetch_query_revision(
        self,
        *,
        project_id: UUID,
        #
        query_ref: Optional[Reference] = None,
        query_variant_ref: Optional[Reference] = None,
        query_revision_ref: Optional[Reference] = None,
    ) -> Optional[QueryRevision]:
        if not query_ref and not query_variant_ref and not query_revision_ref:
            return None

        if query_ref and not query_variant_ref and not query_revision_ref:
            query = await self.fetch_query(
                project_id=project_id,
                #
                query_ref=query_ref,
            )

            if not query:
                return None

            query_ref = Reference(
                id=query.id,
                slug=query.slug,
            )

            query_variant = await self.fetch_query_variant(
                project_id=project_id,
                #
                query_ref=query_ref,
            )

            if not query_variant:
                return None

            query_variant_ref = Reference(
                id=query_variant.id,
                slug=query_variant.slug,
            )

        revision = await self.queries_dao.fetch_revision(
            project_id=project_id,
            #
            variant_ref=query_variant_ref,
            revision_ref=query_revision_ref,
        )

        if not revision:
            return None

        _query_revision = QueryRevision(
            **revision.model_dump(mode="json"),
        )

        return _query_revision

    async def edit_query_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_revision_edit: QueryRevisionEdit,
    ) -> Optional[QueryRevision]:
        _query_revision_edit = RevisionEdit(
            **query_revision_edit.model_dump(mode="json"),
        )

        revision = await self.queries_dao.edit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_edit=_query_revision_edit,
        )

        if not revision:
            return None

        _query_revision = QueryRevision(
            **revision.model_dump(mode="json"),
        )

        return _query_revision

    async def archive_query_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_revision_id: UUID,
    ) -> Optional[QueryRevision]:
        revision = await self.queries_dao.archive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=query_revision_id,
        )

        if not revision:
            return None

        _query_revision = QueryRevision(
            **revision.model_dump(mode="json"),
        )

        return _query_revision

    async def unarchive_query_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_revision_id: UUID,
    ) -> Optional[QueryRevision]:
        revision = await self.queries_dao.unarchive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=query_revision_id,
        )

        if not revision:
            return None

        _query_revision = QueryRevision(
            **revision.model_dump(mode="json"),
        )

        return _query_revision

    async def query_query_revisions(
        self,
        *,
        project_id: UUID,
        #
        query_revision: Optional[QueryRevisionQuery] = None,
        #
        query_refs: Optional[List[Reference]] = None,
        query_variant_refs: Optional[List[Reference]] = None,
        query_revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[QueryRevision]:
        _revision_query = (
            RevisionQuery(
                **query_revision.model_dump(mode="json", exclude_none=True),
            )
            if query_revision
            else RevisionQuery()
        )

        revisions = await self.queries_dao.query_revisions(
            project_id=project_id,
            #
            revision_query=_revision_query,
            #
            artifact_refs=query_refs,
            variant_refs=query_variant_refs,
            revision_refs=query_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        _query_revisions = [
            QueryRevision(
                **revision.model_dump(mode="json"),
            )
            for revision in revisions
        ]

        return _query_revisions

    ## .........................................................................

    async def commit_query_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_revision_commit: QueryRevisionCommit,
    ) -> Optional[QueryRevision]:
        _revision_commit = RevisionCommit(
            **query_revision_commit.model_dump(mode="json"),
        )

        if not _revision_commit.artifact_id:
            if not _revision_commit.variant_id:
                return None

            variant = await self.queries_dao.fetch_variant(
                project_id=project_id,
                #
                variant_ref=Reference(id=_revision_commit.variant_id),
            )

            if not variant:
                return None

            _revision_commit.artifact_id = variant.artifact_id

        revision = await self.queries_dao.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_commit=_revision_commit,
        )

        if not revision:
            return None

        _query_revision = QueryRevision(
            **revision.model_dump(mode="json"),
        )

        return _query_revision

    async def log_query_revisions(
        self,
        *,
        project_id: UUID,
        #
        query_revisions_log: QueryRevisionsLog,
        #
        include_archived: bool = False,
    ) -> List[QueryRevision]:
        _revisions_log = RevisionsLog(
            **query_revisions_log.model_dump(mode="json"),
        )

        revisions = await self.queries_dao.log_revisions(
            project_id=project_id,
            #
            revisions_log=_revisions_log,
            #
            include_archived=include_archived,
        )

        _query_revisions = [
            QueryRevision(
                **revision.model_dump(mode="json"),
            )
            for revision in revisions
        ]

        return _query_revisions

    ## -------------------------------------------------------------------------


class SimpleQueriesService:
    def __init__(
        self,
        queries_service: QueriesService,
    ):
        self.queries_service = queries_service

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_query_create: SimpleQueryCreate,
        #
        query_id: Optional[UUID] = None,
    ) -> Optional[SimpleQuery]:
        # ----------------------------------------------------------------------
        # Query
        # ----------------------------------------------------------------------
        _query_create = QueryCreate(
            slug=simple_query_create.slug,
            #
            name=simple_query_create.name,
            description=simple_query_create.description,
            #
            flags=simple_query_create.flags,
            tags=simple_query_create.tags,
            meta=simple_query_create.meta,
        )

        query: Optional[Query] = await self.queries_service.create_query(
            project_id=project_id,
            user_id=user_id,
            #
            query_create=_query_create,
            #
            query_id=query_id,
        )

        if not query:
            return None

        # ----------------------------------------------------------------------
        # Query variant
        # ----------------------------------------------------------------------
        query_variant_slug = uuid4().hex[-12:]

        _query_variant_create = QueryVariantCreate(
            slug=query_variant_slug,
            #
            name=simple_query_create.name,
            description=simple_query_create.description,
            #
            flags=simple_query_create.flags,
            tags=simple_query_create.tags,
            meta=simple_query_create.meta,
            #
            query_id=query.id,  # type: ignore[arg-type]
        )

        query_variant: Optional[
            QueryVariant
        ] = await self.queries_service.create_query_variant(
            project_id=project_id,
            user_id=user_id,
            #
            query_variant_create=_query_variant_create,
        )

        if not query_variant:
            return None

        # ----------------------------------------------------------------------
        # Query revision
        # ----------------------------------------------------------------------
        query_revision_slug = uuid4().hex[-12:]

        _query_revision_commit = QueryRevisionCommit(
            slug=query_revision_slug,
            #
            name=simple_query_create.name,
            description=simple_query_create.description,
            #
            flags=simple_query_create.flags,
            tags=simple_query_create.tags,
            meta=simple_query_create.meta,
            #
            data=simple_query_create.data,
            #
            query_id=query.id,
            query_variant_id=query_variant.id,
        )

        query_revision: Optional[
            QueryRevision
        ] = await self.queries_service.commit_query_revision(
            project_id=project_id,
            user_id=user_id,
            query_revision_commit=_query_revision_commit,
        )

        if not query_revision:
            return None

        # ----------------------------------------------------------------------
        # Simple Query
        # ----------------------------------------------------------------------
        simple_query = SimpleQuery(
            id=query.id,
            slug=query.slug,
            #
            created_at=query.created_at,
            updated_at=query.updated_at,
            deleted_at=query.deleted_at,
            created_by_id=query.created_by_id,
            updated_by_id=query.updated_by_id,
            deleted_by_id=query.deleted_by_id,
            #
            name=query.name,
            description=query.description,
            #
            flags=query.flags,
            tags=query.tags,
            meta=query.meta,
            #
            data=query_revision.data,
        )

        return simple_query

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        query_id: Optional[UUID] = None,
    ) -> Optional[SimpleQuery]:
        # ----------------------------------------------------------------------
        # Query
        # ----------------------------------------------------------------------
        query_ref = Reference(
            id=query_id,
        )

        query: Optional[Query] = await self.queries_service.fetch_query(
            project_id=project_id,
            #
            query_ref=query_ref,
        )

        if not query:
            return None

        # ----------------------------------------------------------------------
        # Query variant
        # ----------------------------------------------------------------------
        query_variant: Optional[
            QueryVariant
        ] = await self.queries_service.fetch_query_variant(
            project_id=project_id,
            #
            query_ref=query_ref,
        )

        if not query_variant:
            return None

        # ----------------------------------------------------------------------
        # Query
        # ----------------------------------------------------------------------

        query_variant_ref = Reference(
            id=query_variant.id,
        )
        query_revision: Optional[
            QueryRevision
        ] = await self.queries_service.fetch_query_revision(
            project_id=project_id,
            #
            query_variant_ref=query_variant_ref,
        )

        if not query_revision:
            return None

        # ----------------------------------------------------------------------
        # Simple Query
        # ----------------------------------------------------------------------

        simple_query = SimpleQuery(
            id=query.id,
            slug=query.slug,
            #
            created_at=query.created_at,
            updated_at=query.updated_at,
            deleted_at=query.deleted_at,
            created_by_id=query.created_by_id,
            updated_by_id=query.updated_by_id,
            deleted_by_id=query.deleted_by_id,
            #
            name=query.name,
            description=query.description,
            #
            flags=query.flags,
            tags=query.tags,
            meta=query.meta,
            #
            data=query_revision.data,
        )

        return simple_query

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_query_edit: SimpleQueryEdit,
        #
        query_id: UUID,
    ) -> Optional[SimpleQuery]:
        if str(query_id) != str(simple_query_edit.id):
            return None

        # ----------------------------------------------------------------------
        # Query
        # ----------------------------------------------------------------------
        query_ref = Reference(id=simple_query_edit.id)

        query: Optional[Query] = await self.queries_service.fetch_query(
            project_id=project_id,
            #
            query_ref=query_ref,
        )

        if not query:
            return None

        _query_edit = QueryEdit(
            id=query.id,
            #
            name=simple_query_edit.name,
            description=simple_query_edit.description,
            #
            flags=simple_query_edit.flags,
            tags=simple_query_edit.tags,
            meta=simple_query_edit.meta,
        )

        query = await self.queries_service.edit_query(
            project_id=project_id,
            user_id=user_id,
            #
            query_edit=_query_edit,
        )

        if not query:
            return None

        # ----------------------------------------------------------------------
        # Query variant
        # ----------------------------------------------------------------------
        query_variant: Optional[
            QueryVariant
        ] = await self.queries_service.fetch_query_variant(
            project_id=project_id,
            #
            query_ref=query_ref,
        )

        if not query_variant:
            return None

        _query_variant_edit = QueryVariantEdit(
            id=query_variant.id,
            #
            name=simple_query_edit.name,
            description=simple_query_edit.description,
            #
            flags=simple_query_edit.flags,
            tags=simple_query_edit.tags,
            meta=simple_query_edit.meta,
        )

        query_variant = await self.queries_service.edit_query_variant(
            project_id=project_id,
            user_id=user_id,
            #
            query_variant_edit=_query_variant_edit,
        )

        if not query_variant:
            return None

        # ----------------------------------------------------------------------
        # Query revision
        # ----------------------------------------------------------------------
        query_revision_slug = uuid4().hex[-12:]

        _query_revision_commit = QueryRevisionCommit(
            slug=query_revision_slug,
            #
            name=simple_query_edit.name,
            description=simple_query_edit.description,
            #
            flags=simple_query_edit.flags,
            tags=simple_query_edit.tags,
            meta=simple_query_edit.meta,
            #
            data=simple_query_edit.data,
            #
            query_id=query.id,
            query_variant_id=query_variant.id,
        )

        query_revision: Optional[
            QueryRevision
        ] = await self.queries_service.commit_query_revision(
            project_id=project_id,
            user_id=user_id,
            #
            query_revision_commit=_query_revision_commit,
        )

        if not query_revision:
            return None

        # ----------------------------------------------------------------------
        # Simple Query
        # ----------------------------------------------------------------------
        simple_query = SimpleQuery(
            id=query.id,
            slug=query.slug,
            #
            created_at=query.created_at,
            updated_at=query.updated_at,
            deleted_at=query.deleted_at,
            created_by_id=query.created_by_id,
            updated_by_id=query.updated_by_id,
            deleted_by_id=query.deleted_by_id,
            #
            name=query.name,
            description=query.description,
            #
            flags=query.flags,
            tags=query.tags,
            meta=query.meta,
            #
            data=query_revision.data,
        )

        return simple_query

    async def query(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SimpleQueryQuery] = None,
        #
        query_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[SimpleQuery]:
        # ----------------------------------------------------------------------
        # Queries
        # ----------------------------------------------------------------------
        queries: List[Query] = await self.queries_service.query_queries(
            project_id=project_id,
            #
            query=query,
            #
            query_refs=query_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        if not queries:
            return []

        simple_queries: List[SimpleQuery] = []

        for query in queries:
            # ------------------------------------------------------------------
            # Query variants
            # ------------------------------------------------------------------
            query_ref = Reference(
                id=query.id,
            )

            query_variant: Optional[
                QueryVariant
            ] = await self.queries_service.fetch_query_variant(
                project_id=project_id,
                #
                query_ref=query_ref,
            )

            if not query_variant:
                continue

            # ------------------------------------------------------------------
            # Query revisions
            # ------------------------------------------------------------------
            query_variant_ref = Reference(
                id=query_variant.id,
            )

            query_revision: Optional[
                QueryRevision
            ] = await self.queries_service.fetch_query_revision(
                project_id=project_id,
                #
                query_variant_ref=query_variant_ref,
            )

            if not query_revision:
                continue

            # ------------------------------------------------------------------
            # Simple Queries
            # ------------------------------------------------------------------
            simple_query = SimpleQuery(
                id=query.id,
                slug=query.slug,
                #
                created_at=query.created_at,
                updated_at=query.updated_at,
                deleted_at=query.deleted_at,
                created_by_id=query.created_by_id,
                updated_by_id=query.updated_by_id,
                deleted_by_id=query.deleted_by_id,
                #
                name=query.name,
                description=query.description,
                #
                flags=query.flags,
                tags=query.tags,
                meta=query.meta,
                #
                data=query_revision.data,
            )

            simple_queries.append(simple_query)

        return simple_queries

    async def archive(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_id: Optional[UUID] = None,
    ) -> Optional[SimpleQuery]:
        # ----------------------------------------------------------------------
        # Query
        # ----------------------------------------------------------------------
        query_ref = Reference(
            id=query_id,
        )

        query: Optional[Query] = await self.queries_service.fetch_query(
            project_id=project_id,
            #
            query_ref=query_ref,
        )

        if not query:
            return None

        query: Optional[Query] = await self.queries_service.archive_query(
            project_id=project_id,
            user_id=user_id,
            #
            query_id=query_id,
        )

        if not query:
            return None

        # ----------------------------------------------------------------------
        # Query variant
        # ----------------------------------------------------------------------
        query_variant: Optional[
            QueryVariant
        ] = await self.queries_service.fetch_query_variant(
            project_id=project_id,
            #
            query_ref=query_ref,
        )

        if not query_variant:
            return None

        query_variant: Optional[
            QueryVariant
        ] = await self.queries_service.archive_query_variant(
            project_id=project_id,
            user_id=user_id,
            #
            query_variant_id=query_variant.id,
        )

        if not query_variant:
            return None

        # ----------------------------------------------------------------------
        # Simple Query
        # ----------------------------------------------------------------------
        simple_query = SimpleQuery(
            id=query.id,
            slug=query.slug,
            #
            created_at=query.created_at,
            updated_at=query.updated_at,
            deleted_at=query.deleted_at,
            created_by_id=query.created_by_id,
            updated_by_id=query.updated_by_id,
            deleted_by_id=query.deleted_by_id,
            #
            name=query.name,
            description=query.description,
            #
            flags=query.flags,
            tags=query.tags,
            meta=query.meta,
        )

        return simple_query

    async def unarchive(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_id: Optional[UUID] = None,
    ) -> Optional[SimpleQuery]:
        # ----------------------------------------------------------------------
        # Query
        # ----------------------------------------------------------------------
        query_ref = Reference(
            id=query_id,
        )

        query: Optional[Query] = await self.queries_service.fetch_query(
            project_id=project_id,
            #
            query_ref=query_ref,
        )

        if not query:
            return None

        query: Optional[Query] = await self.queries_service.unarchive_query(
            project_id=project_id,
            user_id=user_id,
            #
            query_id=query_id,
        )

        if not query:
            return None

        # ----------------------------------------------------------------------
        # Query variant
        # ----------------------------------------------------------------------
        query_variant: Optional[
            QueryVariant
        ] = await self.queries_service.fetch_query_variant(
            project_id=project_id,
            #
            query_ref=query_ref,
        )

        if not query_variant:
            return None

        query_variant: Optional[
            QueryVariant
        ] = await self.queries_service.unarchive_query_variant(
            project_id=project_id,
            user_id=user_id,
            #
            query_variant_id=query_variant.id,
        )

        if not query_variant:
            return None

        # ----------------------------------------------------------------------
        # Simple Query
        # ----------------------------------------------------------------------
        simple_query = SimpleQuery(
            id=query.id,
            slug=query.slug,
            #
            created_at=query.created_at,
            updated_at=query.updated_at,
            deleted_at=query.deleted_at,
            created_by_id=query.created_by_id,
            updated_by_id=query.updated_by_id,
            deleted_by_id=query.deleted_by_id,
            #
            name=query.name,
            description=query.description,
            #
            flags=query.flags,
            tags=query.tags,
            meta=query.meta,
        )

        return simple_query
