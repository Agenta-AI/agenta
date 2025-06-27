from typing import Optional, List, TypeVar, Type
from uuid import UUID
from datetime import datetime, timezone

from sqlalchemy import select, func, update

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.shared.dtos import Reference
from oss.src.core.git.dtos import (
    Flags,
    Meta,
    Data,
    Artifact,
    Variant,
    Revision,
)
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

    @suppress_exceptions()
    async def create_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_slug: str,
        #
        artifact_flags: Optional[Flags] = None,
        artifact_meta: Optional[Meta] = None,
        artifact_name: Optional[str] = None,
        artifact_description: Optional[str] = None,
    ) -> Optional[Artifact]:
        artifact = Artifact(
            project_id=project_id,
            #
            slug=artifact_slug,
            #
            created_by_id=user_id,
            #
            flags=artifact_flags,
            meta=artifact_meta,
            name=artifact_name,
            description=artifact_description,
        )

        artifact_dbe = map_dto_to_dbe(
            DBE=self.ArtifactDBE,  # type: ignore
            project_id=project_id,
            dto=artifact,
        )

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

    @suppress_exceptions()
    async def fetch_artifact(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Optional[Reference] = None,
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

            artifact_dbe = result.scalar_one_or_none()

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
        artifact_id: UUID,
        #
        artifact_flags: Optional[Flags] = None,
        artifact_meta: Optional[Meta] = None,
        artifact_name: Optional[str] = None,
        artifact_description: Optional[str] = None,
    ) -> Optional[Artifact]:
        async with engine.core_session() as session:
            query = select(self.ArtifactDBE).filter(
                self.ArtifactDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.ArtifactDBE.id == artifact_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            artifact_dbe = result.scalar_one_or_none()

            if not artifact_dbe:
                return None

            now = datetime.now(timezone.utc)
            artifact_dbe.updated_at = now
            artifact_dbe.updated_by_id = user_id
            artifact_dbe.flags = artifact_flags
            artifact_dbe.meta = artifact_meta
            artifact_dbe.name = artifact_name
            artifact_dbe.description = artifact_description

            await session.commit()

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

            artifact_dbe = result.scalar_one_or_none()

            if not artifact_dbe:
                return None

            now = datetime.now(timezone.utc)
            artifact_dbe.updated_at = now
            artifact_dbe.updated_by_id = user_id
            artifact_dbe.deleted_at = now
            artifact_dbe.deleted_by_id = user_id

            await session.commit()

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

            artifact_dbe = result.scalar_one_or_none()

            if not artifact_dbe:
                return None

            now = datetime.now(timezone.utc)
            artifact_dbe.updated_at = now
            artifact_dbe.updated_by_id = user_id
            artifact_dbe.deleted_at = None
            artifact_dbe.deleted_by_id = None

            await session.commit()

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
        artifact_flags: Optional[Flags] = None,
        artifact_meta: Optional[Meta] = None,
        #
        include_archived: Optional[bool] = None,
    ) -> List[Artifact]:
        async with engine.core_session() as session:
            query = select(self.ArtifactDBE).filter(
                self.ArtifactDBE.project_id == project_id,  # type: ignore
            )

            if artifact_flags:
                query = query.filter(
                    self.ArtifactDBE.flags.contains(artifact_flags)  # type: ignore
                )

            if artifact_meta:
                query = query.filter(
                    self.ArtifactDBE.meta.contains(artifact_meta)  # type: ignore
                )

            # using include_* means defaulting to non-archived only
            # using exclude_* means defaulting to all
            if include_archived is not True:
                query = query.filter(
                    self.ArtifactDBE.deleted_at.is_(None)  # type: ignore
                )

            result = await session.execute(query)

            artifact_dbes = result.scalars().all()

            artifact = [
                map_dbe_to_dto(
                    DTO=Artifact,
                    dbe=artifact_dbe,
                )
                for artifact_dbe in artifact_dbes
            ]

            return artifact

    # ──────────────────────────────────────────────────────────────────────────

    # ─ variants ───────────────────────────────────────────────────────────────

    @suppress_exceptions()
    async def create_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
        #
        variant_slug: str,
        #
        variant_flags: Optional[Flags] = None,
        variant_meta: Optional[Meta] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
    ) -> Optional[Variant]:
        variant = Variant(
            project_id=project_id,
            #
            artifact_id=artifact_id,
            #
            slug=variant_slug,
            #
            created_by_id=user_id,
            #
            flags=variant_flags,
            meta=variant_meta,
            name=variant_name,
            description=variant_description,
        )

        variant_dbe = map_dto_to_dbe(
            DBE=self.VariantDBE,  # type: ignore
            project_id=project_id,
            dto=variant,
        )

        async with engine.core_session() as session:
            session.add(variant_dbe)

            await session.commit()

            # await session.refresh(variant_dbe, ["artifact"])

            if not variant_dbe:
                return None

            variant = map_dbe_to_dto(
                DTO=Variant,
                dbe=variant_dbe,  # type: ignore
            )

            return variant

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

            # query = query.options(
            #     joinedload(self.VariantDBE.artifact),  # type: ignore
            # )

            result = await session.execute(query)

            variant_dbe = result.scalar_one_or_none()

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
        variant_id: UUID,
        #
        variant_flags: Optional[Flags] = None,
        variant_meta: Optional[Meta] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
    ) -> Optional[Variant]:
        async with engine.core_session() as session:
            query = select(self.VariantDBE).filter(
                self.VariantDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.VariantDBE.id == variant_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            variant_dbe = result.scalar_one_or_none()

            if not variant_dbe:
                return None

            now = datetime.now(timezone.utc)
            variant_dbe.updated_at = now
            variant_dbe.updated_by_id = user_id
            variant_dbe.flags = variant_flags
            variant_dbe.meta = variant_meta
            variant_dbe.name = variant_name
            variant_dbe.description = variant_description

            await session.commit()

            # await session.refresh(variant_dbe, ["artifact"])

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

            variant_dbe = result.scalar_one_or_none()

            if not variant_dbe:
                return None

            now = datetime.now(timezone.utc)
            variant_dbe.updated_at = now
            variant_dbe.updated_by_id = user_id
            variant_dbe.deleted_at = now
            variant_dbe.deleted_by_id = user_id

            await session.commit()

            # await session.refresh(variant_dbe, ["artifact"])

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

            variant_dbe = result.scalar_one_or_none()

            if not variant_dbe:
                return None

            now = datetime.now(timezone.utc)
            variant_dbe.updated_at = now
            variant_dbe.updated_by_id = user_id
            variant_dbe.deleted_at = None
            variant_dbe.deleted_by_id = None

            await session.commit()

            # await session.refresh(variant_dbe, ["artifact"])

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
        variant_flags: Optional[Flags] = None,
        variant_meta: Optional[Meta] = None,
        #
        include_archived: Optional[bool] = None,
    ) -> List[Variant]:
        async with engine.core_session() as session:
            query = select(self.VariantDBE).filter(
                self.VariantDBE.project_id == project_id,  # type: ignore
            )

            if variant_flags:
                query = query.filter(
                    self.VariantDBE.flags.contains(variant_flags)  # type: ignore
                )

            if variant_meta:
                query = query.filter(
                    self.VariantDBE.meta.contains(variant_meta)  # type: ignore
                )

            # using include_* means defaulting to non-archived only
            # using exclude_* means defaulting to all
            if include_archived is not True:
                query = query.filter(
                    self.VariantDBE.deleted_at.is_(None)  # type: ignore
                )

            # query = query.options(
            #     joinedload(self.VariantDBE.artifact),  # type: ignore
            # )

            result = await session.execute(query)

            variant_dbes = result.scalars().all()

            variant = [
                map_dbe_to_dto(
                    DTO=Variant,
                    dbe=variant_dbe,
                )
                for variant_dbe in variant_dbes
            ]

            return variant

    # --------------------------------------------------------------------------

    @suppress_exceptions()
    async def fork_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_slug: str,
        revision_slug: str,
        #
        variant_id: Optional[UUID] = None,
        revision_id: Optional[UUID] = None,
        depth: Optional[int] = None,
        #
        variant_flags: Optional[Flags] = None,
        variant_meta: Optional[Meta] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
        #
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
        revision_message: Optional[str] = None,
    ) -> Optional[Variant]:
        source_revisions = await self.log_revisions(
            project_id=project_id,
            #
            variant_ref=Reference(id=variant_id),
            revision_ref=Reference(id=revision_id),
            depth=depth,
        )

        if not source_revisions:
            return None

        source_variant = source_revisions[0].variant

        if not source_variant:
            return None

        target_variant = await self.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=source_variant.artifact_id,
            #
            variant_slug=variant_slug,
            #
            variant_flags=variant_flags,
            variant_meta=variant_meta,
            variant_name=variant_name,
            variant_description=variant_description,
        )

        if not target_variant:
            return None

        _hash = "_" + target_variant.id.hex

        for revision in reversed(source_revisions):
            await self.commit_revision(
                project_id=project_id,
                user_id=user_id,
                #
                artifact_id=target_variant.artifact_id,
                variant_id=target_variant.id,
                #
                revision_slug=revision.slug + _hash,
                #
                revision_flags=revision.flags,
                revision_meta=revision.meta,
                revision_name=revision.name,
                revision_description=revision.description,
                revision_message=revision.message,
                revision_data=revision.data,
            )

        await self.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=target_variant.artifact_id,
            variant_id=target_variant.id,
            #
            revision_slug=revision_slug,
            #
            revision_flags=revision_flags,
            revision_meta=revision_meta,
            revision_name=revision_name,
            revision_description=revision_description,
            revision_message=revision_message,
            revision_data=source_revisions[0].data,
        )

        return target_variant  # type: ignore

    # ──────────────────────────────────────────────────────────────────────────

    # ─ revisions ──────────────────────────────────────────────────────────────

    @suppress_exceptions()
    async def create_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
        variant_id: UUID,
        #
        revision_slug: str,
        #
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
    ) -> Optional[Revision]:
        now = datetime.now(timezone.utc)
        revision = Revision(
            project_id=project_id,
            #
            artifact_id=artifact_id,
            variant_id=variant_id,
            #
            slug=revision_slug,
            #
            created_by_id=user_id,
            #
            flags=revision_flags,
            meta=revision_meta,
            name=revision_name,
            description=revision_description,
            author=user_id,
            date=now,
        )

        revision_dbe = map_dto_to_dbe(
            DBE=self.RevisionDBE,  # type: ignore
            project_id=project_id,
            dto=revision,
        )

        async with engine.core_session() as session:
            session.add(revision_dbe)

            await session.commit()

            # await session.refresh(revision_dbe, ["variant"])

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

            # query = query.options(
            #     joinedload(self.RevisionDBE.variant),  # type: ignore
            # )

            result = await session.execute(query)

            revision_dbe = result.scalar_one_or_none()

            if not revision_dbe:
                return None

            revision = map_dbe_to_dto(
                DTO=Revision,
                dbe=revision_dbe,  # type: ignore
            )

            # TODO: improve map_dbe_to_dto to include relationships from dbe
            # revision.variant = self._map_variant_relationship(dbe=revision_dbe)

            return revision

    @suppress_exceptions()
    async def edit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
        #
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
    ) -> Optional[Revision]:
        async with engine.core_session() as session:
            query = select(self.RevisionDBE).filter(
                self.RevisionDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.RevisionDBE.id == revision_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            revision_dbe = result.scalar_one_or_none()

            if not revision_dbe:
                return None

            now = datetime.now(timezone.utc)
            revision_dbe.updated_at = now
            revision_dbe.updated_by_id = user_id
            revision_dbe.flags = revision_flags
            revision_dbe.meta = revision_meta
            revision_dbe.name = revision_name
            revision_dbe.description = revision_description

            await session.commit()

            # await session.refresh(revision_dbe, ["variant"])

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

            revision_dbe = result.scalar_one_or_none()

            if not revision_dbe:
                return None

            now = datetime.now(timezone.utc)
            revision_dbe.updated_at = now
            revision_dbe.updated_by_id = user_id
            revision_dbe.deleted_at = now
            revision_dbe.deleted_by_id = user_id

            await session.commit()

            # await session.refresh(revision_dbe, ["variant"])

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

            revision_dbe = result.scalar_one_or_none()

            if not revision_dbe:
                return None

            now = datetime.now(timezone.utc)
            revision_dbe.updated_at = now
            revision_dbe.updated_by_id = user_id
            revision_dbe.deleted_at = None
            revision_dbe.deleted_by_id = None

            await session.commit()

            # await session.refresh(revision_dbe, ["variant"])

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
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        #
        include_archived: Optional[bool] = None,
    ) -> List[Revision]:
        async with engine.core_session() as session:
            query = select(self.RevisionDBE).filter(
                self.RevisionDBE.project_id == project_id,  # type: ignore
            )

            if revision_flags:
                query = query.filter(
                    self.RevisionDBE.flags.contains(revision_flags)  # type: ignore
                )

            if revision_meta:
                query = query.filter(
                    self.RevisionDBE.meta.contains(revision_meta)  # type: ignore
                )

            # using include_* means defaulting to non-archived only
            # using exclude_* means defaulting to all
            if include_archived is not True:
                query = query.filter(
                    self.RevisionDBE.deleted_at.is_(None),  # type: ignore
                )

            # query = query.options(
            #     joinedload(self.RevisionDBE.variant),  # type: ignore
            # )

            result = await session.execute(query)

            revision_dbes = result.scalars().all()

            revisions = [
                map_dbe_to_dto(
                    DTO=Revision,
                    dbe=revision_dbe,  # type: ignore
                )
                for revision_dbe in revision_dbes
            ]

            # TODO: improve map_dbe_to_dto to include relationships from dbe
            # for revision_dbe, revision in zip(revision_dbes, revisions):
            #     revision.variant = self._map_variant_relationship(dbe=revision_dbe)

            return revisions

    # --------------------------------------------------------------------------

    @suppress_exceptions()
    async def commit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
        variant_id: UUID,
        #
        revision_slug: str,
        #
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
        revision_message: Optional[str] = None,
        revision_data: Optional[Data] = None,
    ) -> Optional[Revision]:
        now = datetime.now(timezone.utc)
        revision = Revision(
            project_id=project_id,
            #
            artifact_id=artifact_id,
            variant_id=variant_id,
            #
            slug=revision_slug,
            #
            created_by_id=user_id,
            #
            flags=revision_flags,
            meta=revision_meta,
            name=revision_name,
            description=revision_description,
            author=user_id,
            date=now,
            message=revision_message,
            data=revision_data,
        )

        revision_dbe = map_dto_to_dbe(
            DBE=self.RevisionDBE,  # type: ignore
            project_id=project_id,
            dto=revision,
        )

        async with engine.core_session() as session:
            session.add(revision_dbe)

            await session.commit()

            # await session.refresh(revision_dbe, ["variant"])

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

    @suppress_exceptions(default=[])
    async def log_revisions(
        self,
        *,
        project_id: UUID,
        #
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
        depth: Optional[int] = None,
    ) -> List[Revision]:
        revision = await self.fetch_revision(  # type: ignore
            project_id=project_id,
            variant_ref=variant_ref,
            revision_ref=revision_ref,
        )

        if not revision:
            return []

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
            limit = revision.version + 1
            order_by = self.RevisionDBE.created_at.asc()  # type: ignore
        elif depth is not None:
            offset = max(revision.version - depth + 1, 0)
            limit = min(depth, revision.version + 1)
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

            # query = query.options(
            #     joinedload(self.RevisionDBE.variant),  # type: ignore
            # )

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

            # TODO: improve map_dbe_to_dto to include relationships from dbe
            # for revision_dbe, revision in zip(revision_dbes, revisions):
            #     revision.variant = self._map_variant_relationship(dbe=revision_dbe)

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
