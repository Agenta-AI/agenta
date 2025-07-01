from typing import Optional, List, TypeVar, Type
from uuid import UUID
from datetime import datetime, timezone

from sqlalchemy import select, func, update

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.git.dtos import (
    Artifact,
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    ArtifactFork,
    ArtifactLog,
    #
    Variant,
    VariantCreate,
    VariantEdit,
    VariantQuery,
    #
    Revision,
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionCommit,
)

from oss.src.dbs.postgres.shared.exceptions import check_entity_creation_conflict
from oss.src.utils.exceptions import suppress_exceptions
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.git.mappings import (
    map_dbe_to_dto,
    map_dto_to_dbe,
)


log = get_module_logger(__name__)


T = TypeVar("T")


class GitDAO(GitDAOInterface):
    def __init__(
        self,
        *,
        ArtifactDBE: Type[T],
        VariantDBE: Type[T],
        RevisionDBE: Type[T],
    ):
        self.ArtifactDBE = ArtifactDBE  # pylint: disable=invalid-name
        self.VariantDBE = VariantDBE  # pylint: disable=invalid-name
        self.RevisionDBE = RevisionDBE  # pylint: disable=invalid-name

    # ─ artifacts ──────────────────────────────────────────────────────────────

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_create: ArtifactCreate,
        #
        artifact_id: Optional[UUID] = None,
    ) -> Optional[Artifact]:
        artifact = Artifact(
            project_id=project_id,
            #
            id=artifact_id,
            slug=artifact_create.slug,
            #
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
            #
            flags=artifact_create.flags,
            tags=artifact_create.tags,
            meta=artifact_create.meta,
            #
            name=artifact_create.name,
            description=artifact_create.description,
        )

        artifact_dbe = map_dto_to_dbe(
            DBE=self.ArtifactDBE,  # type: ignore
            project_id=project_id,
            dto=artifact,
        )

        try:
            async with engine.core_session() as session:
                session.add(artifact_dbe)

                await session.commit()

                if not artifact_dbe:
                    return None

                artifact = map_dbe_to_dto(
                    DTO=Artifact,
                    dbe=artifact_dbe,  # type: ignore
                )

                return artifact

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def fetch_artifact(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Reference,
    ) -> Optional[Artifact]:
        if not artifact_ref:
            return None

        async with engine.core_session() as session:
            query = select(self.ArtifactDBE).filter(
                self.ArtifactDBE.project_id == project_id,  # type: ignore
            )

            if artifact_ref.id:
                query = query.filter(self.ArtifactDBE.id == artifact_ref.id)  # type: ignore
            elif artifact_ref.slug:
                query = query.filter(self.ArtifactDBE.slug == artifact_ref.slug)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            artifact_dbe = result.scalars().first()

            if not artifact_dbe:
                return None

            artifact = map_dbe_to_dto(
                DTO=Artifact,
                dbe=artifact_dbe,  # type: ignore
            )

            return artifact

    @suppress_exceptions()
    async def edit_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_edit: ArtifactEdit,
    ) -> Optional[Artifact]:
        async with engine.core_session() as session:
            query = select(self.ArtifactDBE).filter(
                self.ArtifactDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.ArtifactDBE.id == artifact_edit.id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            artifact_dbe = result.scalars().first()

            if not artifact_dbe:
                return None

            now = datetime.now(timezone.utc)
            artifact_dbe.updated_at = now  # type: ignore
            artifact_dbe.updated_by_id = user_id  # type: ignore
            #
            artifact_dbe.flags = artifact_edit.flags  # type: ignore
            artifact_dbe.tags = artifact_edit.tags  # type: ignore
            artifact_dbe.meta = artifact_edit.meta  # type: ignore
            #
            artifact_dbe.name = artifact_edit.name  # type: ignore
            artifact_dbe.description = artifact_edit.description  # type: ignore

            await session.commit()

            await session.refresh(artifact_dbe)

            artifact = map_dbe_to_dto(
                DTO=Artifact,
                dbe=artifact_dbe,  # type: ignore
            )

            return artifact

    @suppress_exceptions()
    async def archive_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
    ) -> Optional[Artifact]:
        async with engine.core_session() as session:
            query = select(self.ArtifactDBE).filter(
                self.ArtifactDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.ArtifactDBE.id == artifact_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            artifact_dbe = result.scalars().first()

            if not artifact_dbe:
                return None

            now = datetime.now(timezone.utc)
            artifact_dbe.updated_at = now
            artifact_dbe.deleted_at = now
            artifact_dbe.updated_by_id = user_id
            artifact_dbe.deleted_by_id = user_id

            await session.commit()

            await session.refresh(artifact_dbe)

            artifact = map_dbe_to_dto(
                DTO=Artifact,
                dbe=artifact_dbe,  # type: ignore
            )

            return artifact

    @suppress_exceptions()
    async def unarchive_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
    ) -> Optional[Artifact]:
        async with engine.core_session() as session:
            query = select(self.ArtifactDBE).filter(
                self.ArtifactDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.ArtifactDBE.id == artifact_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            artifact_dbe = result.scalars().first()

            if not artifact_dbe:
                return None

            now = datetime.now(timezone.utc)
            artifact_dbe.updated_at = now
            artifact_dbe.deleted_at = None
            artifact_dbe.updated_by_id = user_id
            artifact_dbe.deleted_by_id = None

            await session.commit()

            await session.refresh(artifact_dbe)

            artifact = map_dbe_to_dto(
                DTO=Artifact,
                dbe=artifact_dbe,  # type: ignore
            )

            return artifact

    @suppress_exceptions(default=[])
    async def query_artifacts(
        self,
        *,
        project_id: UUID,
        #
        artifact_query: ArtifactQuery,
        #
        artifact_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Artifact]:
        async with engine.core_session() as session:
            query = select(self.ArtifactDBE).filter(
                self.ArtifactDBE.project_id == project_id,  # type: ignore
            )

            if artifact_refs:
                artifact_ids = [
                    artifact.id for artifact in artifact_refs if artifact.id
                ]

                if artifact_ids:
                    query = query.filter(
                        self.ArtifactDBE.id.in_(artifact_ids)  # type: ignore
                    )

                artifact_slugs = [
                    artifact.slug for artifact in artifact_refs if artifact.slug
                ]

                if artifact_slugs:
                    query = query.filter(
                        self.ArtifactDBE.slug.in_(artifact_slugs)  # type: ignore
                    )

            if artifact_query.flags:
                query = query.filter(
                    self.ArtifactDBE.flags.contains(artifact_query.flags)  # type: ignore
                )

            if artifact_query.tags:
                query = query.filter(
                    self.ArtifactDBE.tags.contains(artifact_query.tags)  # type: ignore
                )

            if artifact_query.meta:
                query = query.filter(
                    self.ArtifactDBE.meta.contains(artifact_query.meta)  # type: ignore
                )

            if include_archived is not True:
                query = query.filter(
                    self.ArtifactDBE.deleted_at.is_(None)  # type: ignore
                )

            query = query.order_by(self.ArtifactDBE.id.asc())  # type: ignore

            if windowing:
                if windowing.next is not None:
                    query = query.filter(
                        self.ArtifactDBE.id > windowing.next,  # type: ignore
                    )
                if windowing.start:
                    query = query.filter(
                        self.ArtifactDBE.created_at > windowing.start,  # type: ignore
                    )

                if windowing.stop:
                    query = query.filter(
                        self.ArtifactDBE.created_at <= windowing.stop,  # type: ignore
                    )

                if windowing.limit:
                    query = query.limit(windowing.limit)

            result = await session.execute(query)

            artifact_dbes = result.scalars().all()

            artifacts = [
                map_dbe_to_dto(
                    DTO=Artifact,
                    dbe=artifact_dbe,
                )
                for artifact_dbe in artifact_dbes
            ]

            return artifacts

    # ──────────────────────────────────────────────────────────────────────────

    # ─ variants ───────────────────────────────────────────────────────────────

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_create: VariantCreate,
    ) -> Optional[Variant]:
        variant = Variant(
            project_id=project_id,
            #
            artifact_id=variant_create.artifact_id,
            #
            slug=variant_create.slug,
            #
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
            #
            flags=variant_create.flags,
            tags=variant_create.tags,
            meta=variant_create.meta,
            #
            name=variant_create.name,
            description=variant_create.description,
        )

        variant_dbe = map_dto_to_dbe(
            DBE=self.VariantDBE,  # type: ignore
            project_id=project_id,
            dto=variant,
        )

        try:
            async with engine.core_session() as session:
                session.add(variant_dbe)

                await session.commit()

                if not variant_dbe:
                    return None

                variant = map_dbe_to_dto(
                    DTO=Variant,
                    dbe=variant_dbe,  # type: ignore
                )

                return variant

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def fetch_variant(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Optional[Reference] = None,
        variant_ref: Optional[Reference] = None,
    ) -> Optional[Variant]:
        if not artifact_ref and not variant_ref:
            return None

        async with engine.core_session() as session:
            query = select(self.VariantDBE).filter(
                self.VariantDBE.project_id == project_id,  # type: ignore
            )

            if variant_ref:
                if variant_ref.id:
                    query = query.filter(self.VariantDBE.id == variant_ref.id)  # type: ignore
                elif variant_ref.slug:
                    query = query.filter(self.VariantDBE.slug == variant_ref.slug)  # type: ignore
            elif artifact_ref:
                if artifact_ref.id:
                    query = query.filter(self.VariantDBE.artifact_id == artifact_ref.id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            variant_dbe = result.scalars().first()

            if not variant_dbe:
                return None

            variant = map_dbe_to_dto(
                DTO=Variant,
                dbe=variant_dbe,  # type: ignore
            )

            return variant

    @suppress_exceptions()
    async def edit_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_edit: VariantEdit,
    ) -> Optional[Variant]:
        async with engine.core_session() as session:
            query = select(self.VariantDBE).filter(
                self.VariantDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.VariantDBE.id == variant_edit.id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            variant_dbe = result.scalars().first()

            if not variant_dbe:
                return None

            now = datetime.now(timezone.utc)
            variant_dbe.updated_at = now
            variant_dbe.updated_by_id = user_id
            #
            variant_dbe.flags = variant_edit.flags
            variant_dbe.tags = variant_edit.tags
            variant_dbe.meta = variant_edit.meta
            #
            variant_dbe.name = variant_edit.name
            variant_dbe.description = variant_edit.description

            await session.commit()

            await session.refresh(variant_dbe)

            variant = map_dbe_to_dto(
                DTO=Variant,
                dbe=variant_dbe,  # type: ignore
            )

            return variant

    @suppress_exceptions()
    async def archive_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
    ) -> Optional[Variant]:
        async with engine.core_session() as session:
            query = select(self.VariantDBE).filter(
                self.VariantDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.VariantDBE.id == variant_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            variant_dbe = result.scalars().first()

            if not variant_dbe:
                return None

            now = datetime.now(timezone.utc)
            variant_dbe.updated_at = now
            variant_dbe.updated_by_id = user_id
            variant_dbe.deleted_at = now
            variant_dbe.deleted_by_id = user_id

            await session.commit()

            await session.refresh(variant_dbe)

            variant = map_dbe_to_dto(
                DTO=Variant,
                dbe=variant_dbe,  # type: ignore
            )

            return variant

    @suppress_exceptions()
    async def unarchive_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
    ) -> Optional[Variant]:
        async with engine.core_session() as session:
            query = select(self.VariantDBE).filter(
                self.VariantDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.VariantDBE.id == variant_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            variant_dbe = result.scalars().first()

            if not variant_dbe:
                return None

            now = datetime.now(timezone.utc)
            variant_dbe.updated_at = now
            variant_dbe.deleted_at = None
            variant_dbe.updated_by_id = user_id
            variant_dbe.deleted_by_id = None

            await session.commit()

            await session.refresh(variant_dbe)

            variant = map_dbe_to_dto(
                DTO=Variant,
                dbe=variant_dbe,  # type: ignore
            )

            return variant

    @suppress_exceptions(default=[])
    async def query_variants(
        self,
        *,
        project_id: UUID,
        #
        variant_query: VariantQuery,
        #
        artifact_refs: Optional[List[Reference]] = None,
        variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Variant]:
        async with engine.core_session() as session:
            query = select(self.VariantDBE).filter(
                self.VariantDBE.project_id == project_id,  # type: ignore
            )

            if artifact_refs:
                artifact_ids = [
                    artifact.id for artifact in artifact_refs if artifact.id
                ]

                if artifact_ids:
                    query = query.filter(
                        self.VariantDBE.artifact_id.in_(artifact_ids)  # type: ignore
                    )

                artifact_slugs = [
                    artifact.slug for artifact in artifact_refs if artifact.slug
                ]

                if artifact_slugs:
                    query = query.filter(
                        self.VariantDBE.artifact_id.in_(artifact_slugs)  # type: ignore
                    )

            if variant_refs:
                variant_ids = [variant.id for variant in variant_refs if variant.id]

                if variant_ids:
                    query = query.filter(
                        self.VariantDBE.id.in_(variant_ids)  # type: ignore
                    )

                variant_slugs = [
                    variant.slug for variant in variant_refs if variant.slug
                ]

                if variant_slugs:
                    query = query.filter(
                        self.VariantDBE.slug.in_(variant_slugs)  # type: ignore
                    )

            if variant_query.flags:
                query = query.filter(
                    self.VariantDBE.flags.contains(variant_query.flags)  # type: ignore
                )

            if variant_query.tags:
                query = query.filter(
                    self.VariantDBE.tags.contains(variant_query.tags)  # type: ignore
                )

            if variant_query.meta:
                query = query.filter(
                    self.VariantDBE.meta.contains(variant_query.meta)  # type: ignore
                )

            if include_archived is not True:
                query = query.filter(self.VariantDBE.deleted_at.is_(None))  # type: ignore

            query = query.order_by(self.VariantDBE.id.asc())  # type: ignore

            if windowing:
                if windowing.next is not None:
                    query = query.filter(
                        self.VariantDBE.id > windowing.next,  # type: ignore
                    )
                if windowing.start:
                    query = query.filter(
                        self.VariantDBE.created_at > windowing.start,  # type: ignore
                    )

                if windowing.stop:
                    query = query.filter(
                        self.VariantDBE.created_at <= windowing.stop,  # type: ignore
                    )

                if windowing.limit:
                    query = query.limit(windowing.limit)

            result = await session.execute(query)

            variant_dbes = result.scalars().all()

            variants = [
                map_dbe_to_dto(
                    DTO=Variant,
                    dbe=variant_dbe,
                )
                for variant_dbe in variant_dbes
            ]

            return variants

    # --------------------------------------------------------------------------

    @suppress_exceptions()
    async def fork_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_fork: ArtifactFork,
    ) -> Optional[Variant]:
        source_revisions = await self.log_revisions(
            project_id=project_id,
            #
            artifact_log=ArtifactLog(
                variant_id=artifact_fork.variant_id,
                revision_id=artifact_fork.revision_id,
                depth=artifact_fork.depth,
            ),
        )

        if not source_revisions:
            return None

        source_variant = await self.fetch_variant(
            project_id=project_id,
            #
            variant_ref=Reference(id=source_revisions[0].variant_id),
        )

        if not source_variant:
            return None

        variant_create = VariantCreate(
            slug=artifact_fork.variant.slug,
            #
            name=artifact_fork.variant.name,
            description=artifact_fork.variant.description,
            #
            flags=artifact_fork.variant.flags,
            tags=artifact_fork.variant.tags,
            meta=artifact_fork.variant.meta,
            #
            artifact_id=source_variant.artifact_id,
        )

        target_variant = await self.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_create=variant_create,
        )

        if not target_variant:
            return None

        _hash = "_" + target_variant.id.hex

        for revision in reversed(source_revisions):
            revision_commit = RevisionCommit(
                slug=revision.slug + _hash,
                #
                name=revision.name,
                description=revision.description,
                #
                flags=revision.flags,
                tags=revision.tags,
                meta=revision.meta,
                #
                message=revision.message,
                data=revision.data,
                #
                artifact_id=target_variant.artifact_id,
                variant_id=target_variant.id,
            )

            await self.commit_revision(
                project_id=project_id,
                user_id=user_id,
                #
                revision_commit=revision_commit,
            )

        revision_commit = RevisionCommit(
            slug=artifact_fork.revision.slug,
            #
            name=artifact_fork.revision.name,
            description=artifact_fork.revision.description,
            #
            flags=artifact_fork.revision.flags,
            tags=artifact_fork.revision.tags,
            meta=artifact_fork.revision.meta,
            #
            message=artifact_fork.revision.message,
            data=artifact_fork.revision.data or source_revisions[0].data,
            #
            artifact_id=target_variant.artifact_id,
            variant_id=target_variant.id,
        )

        await self.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_commit=revision_commit,
        )

        return target_variant  # type: ignore

    # ──────────────────────────────────────────────────────────────────────────

    # ─ revisions ──────────────────────────────────────────────────────────────

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_create: RevisionCreate,
    ) -> Optional[Revision]:
        now = datetime.now(timezone.utc)
        revision = Revision(
            project_id=project_id,
            #
            artifact_id=revision_create.artifact_id,
            variant_id=revision_create.variant_id,
            #
            slug=revision_create.slug,
            #
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
            #
            flags=revision_create.flags,
            tags=revision_create.tags,
            meta=revision_create.meta,
            #
            name=revision_create.name,
            description=revision_create.description,
            #
            author=user_id,
            date=now,
            message="Initial commit",
        )

        revision_dbe = map_dto_to_dbe(
            DBE=self.RevisionDBE,  # type: ignore
            project_id=project_id,
            dto=revision,
        )

        try:
            async with engine.core_session() as session:
                session.add(revision_dbe)

                await session.commit()

                if not revision_dbe:
                    return None

                revision = map_dbe_to_dto(
                    DTO=Revision,
                    dbe=revision_dbe,  # type: ignore
                )

                revision.version = await self._get_version(
                    project_id=project_id,
                    variant_id=revision.variant_id,  # type: ignore
                    created_at=revision.created_at,  # type: ignore
                )

                await self._set_version(
                    project_id=project_id,
                    revision_id=revision.id,  # type: ignore
                    version=revision.version,
                )

                return revision

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def fetch_revision(
        self,
        *,
        project_id: UUID,
        #
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
    ) -> Optional[Revision]:
        if not variant_ref and not revision_ref:
            return None

        async with engine.core_session() as session:
            query = select(self.RevisionDBE).filter(
                self.RevisionDBE.project_id == project_id,  # type: ignore
            )

            if revision_ref and not revision_ref.version:
                if revision_ref.id:
                    query = query.filter(self.RevisionDBE.id == revision_ref.id)  # type: ignore
                elif revision_ref.slug:
                    query = query.filter(self.RevisionDBE.slug == revision_ref.slug)  # type: ignore
            elif variant_ref:
                if variant_ref.id:
                    query = query.filter(self.RevisionDBE.variant_id == variant_ref.id)  # type: ignore

                if revision_ref and revision_ref.version:
                    query = query.filter(self.RevisionDBE.version == revision_ref.version)  # type: ignore
                else:
                    query = query.order_by(self.RevisionDBE.created_at.desc())  # type: ignore
                    query = query.offset(0)

            query = query.limit(1)

            result = await session.execute(query)

            revision_dbe = result.scalars().first()

            if not revision_dbe:
                return None

            revision = map_dbe_to_dto(
                DTO=Revision,
                dbe=revision_dbe,  # type: ignore
            )

            return revision

    @suppress_exceptions()
    async def edit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_edit: RevisionEdit,
    ) -> Optional[Revision]:
        async with engine.core_session() as session:
            query = select(self.RevisionDBE).filter(
                self.RevisionDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.RevisionDBE.id == revision_edit.id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            revision_dbe = result.scalars().first()

            if not revision_dbe:
                return None

            now = datetime.now(timezone.utc)
            revision_dbe.updated_at = now
            revision_dbe.updated_by_id = user_id
            #
            revision_dbe.flags = revision_edit.flags
            revision_dbe.tags = revision_edit.tags
            revision_dbe.meta = revision_edit.meta
            #
            revision_dbe.name = revision_edit.name
            revision_dbe.description = revision_edit.description

            await session.commit()

            await session.refresh(revision_dbe)

            revision = map_dbe_to_dto(
                DTO=Revision,
                dbe=revision_dbe,  # type: ignore
            )

            return revision

    @suppress_exceptions()
    async def archive_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
    ) -> Optional[Revision]:
        async with engine.core_session() as session:
            query = select(self.RevisionDBE).filter(
                self.RevisionDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.RevisionDBE.id == revision_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            revision_dbe = result.scalars().first()

            if not revision_dbe:
                return None

            now = datetime.now(timezone.utc)
            revision_dbe.updated_at = now
            revision_dbe.updated_by_id = user_id
            revision_dbe.deleted_at = now
            revision_dbe.deleted_by_id = user_id

            await session.commit()

            await session.refresh(revision_dbe)

            revision = map_dbe_to_dto(
                DTO=Revision,
                dbe=revision_dbe,  # type: ignore
            )

            return revision

    @suppress_exceptions()
    async def unarchive_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
    ) -> Optional[Revision]:
        async with engine.core_session() as session:
            query = select(self.RevisionDBE).filter(
                self.RevisionDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.RevisionDBE.id == revision_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            revision_dbe = result.scalars().first()

            if not revision_dbe:
                return None

            now = datetime.now(timezone.utc)
            revision_dbe.updated_at = now
            revision_dbe.deleted_at = None
            revision_dbe.updated_by_id = user_id
            revision_dbe.deleted_by_id = None

            await session.commit()

            await session.refresh(revision_dbe)

            revision = map_dbe_to_dto(
                DTO=Revision,
                dbe=revision_dbe,  # type: ignore
            )

            return revision

    @suppress_exceptions(default=[])
    async def query_revisions(
        self,
        *,
        project_id: UUID,
        #
        revision_query: RevisionQuery,
        #
        artifact_refs: Optional[List[Reference]] = None,
        variant_refs: Optional[List[Reference]] = None,
        revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Revision]:
        async with engine.core_session() as session:
            query = select(self.RevisionDBE).filter(
                self.RevisionDBE.project_id == project_id,  # type: ignore
            )

            if artifact_refs:
                artifact_ids = [
                    artifact.id for artifact in artifact_refs if artifact.id
                ]

                if artifact_ids:
                    query = query.filter(
                        self.RevisionDBE.artifact_id.in_(artifact_ids)  # type: ignore
                    )

                artifact_slugs = [
                    artifact.slug for artifact in artifact_refs if artifact.slug
                ]

                if artifact_slugs:
                    query = query.filter(
                        self.RevisionDBE.artifact_id.in_(artifact_slugs)  # type: ignore
                    )

            if variant_refs:
                variant_ids = [variant.id for variant in variant_refs if variant.id]

                if variant_ids:
                    query = query.filter(
                        self.RevisionDBE.variant_id.in_(variant_ids)  # type: ignore
                    )

                variant_slugs = [
                    variant.slug for variant in variant_refs if variant.slug
                ]

                if variant_slugs:
                    query = query.filter(
                        self.RevisionDBE.variant_id.in_(variant_slugs)  # type: ignore
                    )

            if revision_refs:
                revision_ids = [
                    revision.id for revision in revision_refs if revision.id
                ]

                if revision_ids:
                    query = query.filter(
                        self.RevisionDBE.id.in_(revision_ids)  # type: ignore
                    )

                revision_slugs = [
                    revision.slug for revision in revision_refs if revision.slug
                ]

                if revision_slugs:
                    query = query.filter(
                        self.RevisionDBE.slug.in_(revision_slugs)  # type: ignore
                    )

            if revision_query.authors:
                query = query.filter(
                    self.RevisionDBE.author.in_(revision_query.authors)  # type: ignore
                )

            if revision_query.flags:
                query = query.filter(
                    self.RevisionDBE.flags.contains(revision_query.flags)  # type: ignore
                )

            if revision_query.tags:
                query = query.filter(
                    self.RevisionDBE.tags.contains(revision_query.tags)  # type: ignore
                )

            if revision_query.meta:
                query = query.filter(
                    self.RevisionDBE.meta.contains(revision_query.meta)  # type: ignore
                )

            if include_archived is not True:
                query = query.filter(
                    self.RevisionDBE.deleted_at.is_(None),  # type: ignore
                )

            query = query.order_by(self.RevisionDBE.id.asc())  # type: ignore

            if windowing:
                if windowing.next is not None:
                    query = query.filter(
                        self.RevisionDBE.id > windowing.next,  # type: ignore
                    )
                if windowing.start:
                    query = query.filter(
                        self.RevisionDBE.created_at > windowing.start,  # type: ignore
                    )

                if windowing.stop:
                    query = query.filter(
                        self.RevisionDBE.created_at <= windowing.stop,  # type: ignore
                    )

                if windowing.limit:
                    query = query.limit(windowing.limit)

            result = await session.execute(query)

            revision_dbes = result.scalars().all()

            revisions = [
                map_dbe_to_dto(
                    DTO=Revision,
                    dbe=revision_dbe,  # type: ignore
                )
                for revision_dbe in revision_dbes
            ]

            return revisions

    # --------------------------------------------------------------------------

    @suppress_exceptions()
    async def commit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_commit: RevisionCommit,
    ) -> Optional[Revision]:
        now = datetime.now(timezone.utc)
        revision = Revision(
            project_id=project_id,
            #
            artifact_id=revision_commit.artifact_id,
            variant_id=revision_commit.variant_id,
            #
            slug=revision_commit.slug,
            #
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
            #
            flags=revision_commit.flags,
            tags=revision_commit.tags,
            meta=revision_commit.meta,
            #
            name=revision_commit.name,
            description=revision_commit.description,
            #
            author=user_id,
            date=now,
            message=revision_commit.message,
            data=revision_commit.data,
        )

        revision_dbe = map_dto_to_dbe(
            DBE=self.RevisionDBE,  # type: ignore
            project_id=project_id,
            dto=revision,
        )

        try:
            async with engine.core_session() as session:
                session.add(revision_dbe)

                await session.commit()

                await session.refresh(revision_dbe)

                if not revision_dbe:
                    return None

                revision = map_dbe_to_dto(
                    DTO=Revision,
                    dbe=revision_dbe,  # type: ignore
                )

                revision.version = await self._get_version(
                    project_id=project_id,
                    variant_id=revision.variant_id,  # type: ignore
                    created_at=revision.created_at,  # type: ignore
                )

                await self._set_version(
                    project_id=project_id,
                    revision_id=revision.id,  # type: ignore
                    version=revision.version,
                )

                return revision

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions(default=[])
    async def log_revisions(
        self,
        *,
        project_id: UUID,
        #
        artifact_log: ArtifactLog,
    ) -> List[Revision]:
        revision = await self.fetch_revision(  # type: ignore
            project_id=project_id,
            variant_ref=(
                Reference(
                    id=artifact_log.variant_id,
                )
                if artifact_log.variant_id
                else None
            ),
            revision_ref=(
                Reference(
                    id=artifact_log.revision_id,
                )
                if artifact_log.revision_id
                else None
            ),
        )

        if not revision:
            return []

        depth = artifact_log.depth
        version = int(revision.version) if revision.version else 0

        if depth is not None:
            if not isinstance(depth, int):
                return []

            if depth < 1:
                return []

        offset = None
        limit = None
        order_by = self.RevisionDBE.created_at.desc()  # type: ignore

        if depth is None:
            offset = 0
            limit = version + 1
            order_by = self.RevisionDBE.created_at.asc()  # type: ignore
        elif depth is not None:
            offset = max(version - depth + 1, 0)
            limit = min(depth, version + 1)
            order_by = self.RevisionDBE.created_at.asc()  # type: ignore

        async with engine.core_session() as session:
            query = select(self.RevisionDBE).filter(
                self.RevisionDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(
                self.RevisionDBE.variant_id == revision.variant_id,  # type: ignore
            )

            query = query.order_by(order_by)
            query = query.offset(offset)
            query = query.limit(limit)

            result = await session.execute(query)

            revision_dbes = result.scalars().all()

            if not revision_dbes:
                return []

            revisions = [
                map_dbe_to_dto(
                    DTO=Revision,
                    dbe=revision_dbe,  # type: ignore
                )
                for revision_dbe in revision_dbes
            ]

            return revisions

    # ──────────────────────────────────────────────────────────────────────────

    # ─ helpers ────────────────────────────────────────────────────────────────

    async def _get_version(
        self,
        *,
        project_id: UUID,
        variant_id: UUID,
        created_at: datetime,
    ) -> str:
        async with engine.core_session() as session:
            stmt = (
                select(func.count())  # pylint: disable=not-callable
                .select_from(self.RevisionDBE)  # type: ignore
                .where(
                    self.RevisionDBE.project_id == project_id,  # type: ignore
                    self.RevisionDBE.variant_id == variant_id,  # type: ignore
                    self.RevisionDBE.created_at < created_at,  # type: ignore
                )
            )

            result = await session.execute(stmt)

            position = result.scalar_one()

            return str(position)

    async def _set_version(
        self,
        *,
        project_id: UUID,
        revision_id: UUID,
        version: str,
    ) -> None:
        async with engine.core_session() as session:
            query = update(self.RevisionDBE).filter(
                self.RevisionDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.RevisionDBE.id == revision_id)  # type: ignore

            query = query.values(version=version)  # type: ignore

            await session.execute(query)

            await session.commit()

    # ──────────────────────────────────────────────────────────────────────────
