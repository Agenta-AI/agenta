from typing import Optional, List, TypeVar, Type
from uuid import UUID
from datetime import datetime, timezone

from sqlalchemy import select

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.shared.dtos import Windowing
from oss.src.core.blobs.dtos import Blob, BlobCreate, BlobEdit, BlobQuery
from oss.src.core.blobs.interfaces import BlobsDAOInterface
from oss.src.core.blobs.utils import compute_blob_id

from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.dbs.postgres.shared.exceptions import check_entity_creation_conflict
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.blobs.mappings import map_dbe_to_dto, map_dto_to_dbe


log = get_module_logger(__name__)


T = TypeVar("T")


class BlobsDAO(BlobsDAOInterface):
    def __init__(
        self,
        *,
        BlobDBE: Type[T],
    ):
        self.BlobDBE = BlobDBE  # pylint: disable=invalid-name

    # ─ blobs ──────────────────────────────────────────────────────────────────

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def add_blob(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        blob_create: BlobCreate,
    ) -> Optional[Blob]:
        blob = Blob(
            id=compute_blob_id(
                blob_data=blob_create.data,
                set_id=blob_create.set_id,
            ),
            #
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
            #
            flags=blob_create.flags,
            tags=blob_create.tags,
            meta=blob_create.meta,
            #
            data=blob_create.data,
            #
            set_id=blob_create.set_id,
        )

        try:
            async with engine.core_session() as session:
                stmt = select(self.BlobDBE).filter(
                    self.BlobDBE.project_id == project_id,  # type: ignore
                )

                stmt = stmt.filter(
                    self.BlobDBE.id == blob.id,  # type: ignore
                )

                result = await session.execute(stmt)

                existing_dbe = result.scalar_one_or_none()

                if not existing_dbe:
                    blob_dbe = map_dto_to_dbe(
                        DBE=self.BlobDBE,  # type: ignore
                        project_id=project_id,
                        dto=blob,
                    )
                    session.add(blob_dbe)

                    await session.commit()

                return await self.fetch_blob(
                    project_id=project_id,
                    #
                    blob_id=blob.id,  # type: ignore
                )

        except Exception as e:
            log.warn(f"Failed to add blob: {e}")
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def fetch_blob(
        self,
        *,
        project_id: UUID,
        #
        blob_id: UUID,
    ) -> Optional[Blob]:
        async with engine.core_session() as session:
            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            stmt = stmt.filter(self.BlobDBE.id == blob_id)  # type: ignore

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            blob_dbe = result.scalar_one_or_none()

            if not blob_dbe:
                return None

            blob = map_dbe_to_dto(
                DTO=Blob,
                dbe=blob_dbe,  # type: ignore
            )

            return blob

    @suppress_exceptions()
    async def edit_blob(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        blob_edit: BlobEdit,
    ) -> Optional[Blob]:
        async with engine.core_session() as session:
            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            stmt = stmt.filter(self.BlobDBE.id == blob_edit.id)  # type: ignore

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            blob_dbe = result.scalar_one_or_none()

            if not blob_dbe:
                return None

            for key, value in blob_edit.model_dump(exclude_unset=True).items():
                setattr(blob_dbe, key, value)

            blob_dbe.updated_at = datetime.now(timezone.utc)  # type: ignore
            blob_dbe.updated_by_id = user_id  # type: ignore

            await session.commit()

            await session.refresh(blob_dbe)

            blob = map_dbe_to_dto(
                DTO=Blob,
                dbe=blob_dbe,  # type: ignore
            )

            return blob

    @suppress_exceptions()
    async def remove_blob(
        self,
        *,
        project_id: UUID,
        #
        blob_id: UUID,
    ) -> Optional[Blob]:
        async with engine.core_session() as session:
            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            stmt = stmt.filter(self.BlobDBE.id == blob_id)  # type: ignore

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            blob_dbe = result.scalar_one_or_none()

            if not blob_dbe:
                return None

            await session.delete(blob_dbe)

            await session.commit()

            blob = map_dbe_to_dto(
                DTO=Blob,
                dbe=blob_dbe,  # type: ignore
            )

            return blob

    @suppress_exceptions(default=[], exclude=[EntityCreationConflict])
    async def add_blobs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        blob_creates: List[BlobCreate],
    ) -> List[Blob]:
        blobs: List[Blob] = [
            Blob(
                id=compute_blob_id(
                    blob_data=blob_create.data,
                    set_id=blob_create.set_id,
                ),
                #
                created_at=datetime.now(timezone.utc),
                created_by_id=user_id,
                #
                flags=blob_create.flags,
                tags=blob_create.tags,
                meta=blob_create.meta,
                #
                data=blob_create.data,
                #
                set_id=blob_create.set_id,
            )
            for blob_create in blob_creates
        ]

        blob_ids = [blob.id for blob in blobs]

        try:
            async with engine.core_session() as session:
                stmt = select(self.BlobDBE).filter(
                    self.BlobDBE.project_id == project_id,  # type: ignore
                )

                stmt = stmt.filter(
                    self.BlobDBE.id.in_(blob_ids),  # type: ignore
                )

                existing = await session.execute(stmt)

                existing_dbes = existing.scalars().all()

                existing_ids = {b.id for b in existing_dbes}  # type: ignore

                new_blobs = list(
                    {
                        blob.id: blob for blob in blobs if blob.id not in existing_ids
                    }.values()
                )

                blob_dbes = [
                    map_dto_to_dbe(
                        DBE=self.BlobDBE,  # type: ignore
                        project_id=project_id,
                        dto=blob,
                    )
                    for blob in new_blobs
                ]

                session.add_all(blob_dbes)

                await session.commit()

                all_blobs = await self.fetch_blobs(
                    project_id=project_id,
                    #
                    blob_ids=blob_ids,  # type: ignore
                )

                return all_blobs

        except Exception as e:
            log.warn(f"Failed to add blobs: {e}")
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def fetch_blobs(
        self,
        *,
        project_id: UUID,
        #
        blob_ids: List[UUID],
    ) -> List[Blob]:
        async with engine.core_session() as session:
            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            stmt = stmt.filter(self.BlobDBE.id.in_(blob_ids))  # type: ignore

            result = await session.execute(stmt)

            blob_dbes = result.scalars().all()

            if not blob_dbes:
                return []

            _blobs = {
                blob_dbe.id: map_dbe_to_dto(  # type: ignore
                    DTO=Blob,
                    dbe=blob_dbe,  # type: ignore
                )
                for blob_dbe in blob_dbes
            }

            blobs = [_blobs.get(blob_id) for blob_id in blob_ids if blob_id in _blobs]
            blobs = [blob for blob in blobs if blob is not None]

            return blobs

    @suppress_exceptions()
    async def edit_blobs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        blob_edits: List[BlobEdit],
    ) -> List[Blob]:
        async with engine.core_session() as session:
            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            blob_ids = [blob_edit.id for blob_edit in blob_edits]

            stmt = stmt.filter(self.BlobDBE.id.in_(blob_ids))  # type: ignore

            stmt = stmt.limit(len(blob_edits))

            result = await session.execute(stmt)

            blob_dbes = result.scalars().all()

            if not blob_dbes:
                return []

            for blob_dbe in blob_dbes:
                for blob_edit in blob_edits:
                    if blob_dbe.id == blob_edit.id:  # type: ignore
                        for key, value in blob_edit.model_dump().items():
                            setattr(blob_dbe, key, value)

                        blob_dbe.updated_at = datetime.now(timezone.utc)  # type: ignore
                        blob_dbe.updated_by_id = user_id  # type: ignore

            await session.commit()

            for blob_dbe in blob_dbes:
                await session.refresh(blob_dbe)

            blobs = [
                map_dbe_to_dto(
                    DTO=Blob,
                    dbe=blob_dbe,  # type: ignore
                )
                for blob_dbe in blob_dbes
            ]

            return blobs

    @suppress_exceptions()
    async def remove_blobs(
        self,
        *,
        project_id: UUID,
        #
        blob_ids: List[UUID],
    ) -> List[Blob]:
        async with engine.core_session() as session:
            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            stmt = stmt.filter(self.BlobDBE.id.in_(blob_ids))  # type: ignore

            stmt = stmt.limit(len(blob_ids))

            result = await session.execute(stmt)

            blob_dbes = result.scalars().all()

            if not blob_dbes:
                return []

            for blob_dbe in blob_dbes:
                await session.delete(blob_dbe)

            await session.commit()

            blobs = [
                map_dbe_to_dto(
                    DTO=Blob,
                    dbe=blob_dbe,  # type: ignore
                )
                for blob_dbe in blob_dbes
            ]

            return blobs

    @suppress_exceptions()
    async def query_blobs(
        self,
        *,
        project_id: UUID,
        #
        blob_query: BlobQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Blob]:
        async with engine.core_session() as session:
            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            if blob_query.set_ids:
                stmt = stmt.filter(self.BlobDBE.set_id.in_(blob_query.set_ids))  # type: ignore

            if blob_query.blob_ids:
                stmt = stmt.filter(self.BlobDBE.id.in_(blob_query.blob_ids))  # type: ignore

            if blob_query.flags:
                stmt = stmt.filter(
                    self.BlobDBE.flags.contains(blob_query.flags),  # type: ignore
                )

            if blob_query.tags:
                stmt = stmt.filter(
                    self.BlobDBE.tags.contains(blob_query.tags),  # type: ignore
                )

            # meta is JSON (not JSONB) — containment (@>) is not supported
            # if blob_query.meta:
            #     stmt = stmt.filter(
            #         self.BlobDBE.meta.contains(blob_query.meta),
            #     )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=self.BlobDBE,
                    attribute="created_at",  # Blob IDs are content-hashed (UUID5), use timestamp for ordering
                    order="ascending",  # data-style
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            blob_dbes = result.scalars().all()

            if not blob_dbes:
                return []

            # If blob_ids were provided, preserve their order in the result
            if blob_query.blob_ids:
                _blobs = {
                    blob_dbe.id: map_dbe_to_dto(  # type: ignore
                        DTO=Blob,
                        dbe=blob_dbe,  # type: ignore
                    )
                    for blob_dbe in blob_dbes
                }

                blobs = [
                    _blobs[blob_id]
                    for blob_id in blob_query.blob_ids
                    if blob_id in _blobs
                ]

                return blobs

            blobs = [
                map_dbe_to_dto(
                    DTO=Blob,
                    dbe=blob_dbe,  # type: ignore
                )
                for blob_dbe in blob_dbes
            ]

            return blobs

    # ──────────────────────────────────────────────────────────────────────────
