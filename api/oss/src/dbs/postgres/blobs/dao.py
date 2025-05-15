from typing import Optional, List, TypeVar, Type
from uuid import UUID, uuid4
from json import dumps
from hashlib import blake2b

from sqlalchemy import select, or_

from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.shared.utils import suppress_exceptions
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.core.blobs.interfaces import BlobDAOInterface
from oss.src.core.blobs.dtos import Blob
from oss.src.core.shared.dtos import Reference

from oss.src.dbs.postgres.blobs.mappings import (
    map_dbe_to_dto,
    map_dto_to_dbe,
)

log = get_module_logger(__name__)


T = TypeVar("T")


class BlobDAO(BlobDAOInterface):
    def __init__(
        self,
        *,
        BlobDBE: Type[T],
    ):
        self.BlobDBE = BlobDBE  # pylint: disable=invalid-name

    # ─ blobs ──────────────────────────────────────────────────────────────────

    @suppress_exceptions()
    async def add_blob(
        self,
        *,
        project_id: UUID,
        #
        blob: Blob,
    ) -> Optional[Blob]:
        blob.id = self._blob_id(
            blob_data=blob.data,
            set_id=blob.set_id,
        )
        blob.slug = blob.slug or uuid4().hex

        async with engine.core_session() as session:
            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,
                self.BlobDBE.id == blob.id,
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

            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,
                self.BlobDBE.id == blob.id,
            )

            result = await session.execute(stmt)

            blob_dbe = result.scalar_one_or_none()

            if not blob_dbe:
                return None

            blob = map_dbe_to_dto(
                DTO=Blob,  # type: ignore
                dbe=blob_dbe,
            )

            return blob

    @suppress_exceptions()
    async def fetch_blob(
        self,
        *,
        project_id: UUID,
        #
        blob_ref: Optional[Reference] = None,
    ) -> Optional[Blob]:
        async with engine.core_session() as session:
            query = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            if blob_ref:
                if blob_ref.id:
                    query = query.filter(self.BlobDBE.id == blob_ref.id)
                elif blob_ref.slug:
                    query = query.filter(self.BlobDBE.slug == blob_ref.slug)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

            blob_dbe = result.scalar_one_or_none()

            if not blob_dbe:
                return None

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
            query = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.BlobDBE.id == blob_id)  # type: ignore

            query = query.limit(1)

            result = await session.execute(query)

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

    @suppress_exceptions()
    async def add_blobs(
        self,
        *,
        project_id: UUID,
        #
        blobs: List[Blob],
    ) -> List[Blob]:
        for blob in blobs:
            blob.id = self._blob_id(
                blob_data=blob.data,
                set_id=blob.set_id,
            )
            blob.slug = blob.slug or uuid4().hex

        blob_ids = [blob.id for blob in blobs]

        async with engine.core_session() as session:
            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,
                self.BlobDBE.id.in_(blob_ids),
            )

            existing = await session.execute(stmt)

            existing_dbes = existing.scalars().all()

            existing_ids = {b.id for b in existing_dbes}

            new_blobs = [blob for blob in blobs if blob.id not in existing_ids]

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

            stmt = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,
                self.BlobDBE.id.in_(blob_ids),
            )

            result = await session.execute(stmt)

            blob_dbes = result.scalars().all()

            blobs = [
                map_dbe_to_dto(
                    DTO=Blob,  # type: ignore
                    dbe=dbe,
                )
                for dbe in blob_dbes
            ]

            return blobs

    @suppress_exceptions()
    async def fetch_blobs(
        self,
        *,
        project_id: UUID,
        #
        set_id: Optional[UUID] = None,
        #
        blob_refs: Optional[List[Reference]] = None,
        #
        limit: Optional[int] = None,
    ) -> List[Blob]:

        async with engine.core_session() as session:
            query = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            if set_id:
                query = query.filter(self.BlobDBE.set_id == set_id)

            if blob_refs:
                blob_ids = [blob_ref.id for blob_ref in blob_refs if blob_ref.id]
                blob_slugs = [blob_ref.slug for blob_ref in blob_refs if blob_ref.slug]

                if blob_ids or blob_slugs:
                    filters = []

                    if blob_ids:
                        filters.append(self.BlobDBE.id.in_(blob_ids))
                    if blob_slugs:
                        filters.append(self.BlobDBE.slug.in_(blob_slugs))

                    query = query.filter(or_(*filters))

            if limit:
                query = query.limit(limit)

            result = await session.execute(query)

            blob_dbes = result.scalars().all()

            if not blob_dbes:
                return []

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
            query = select(self.BlobDBE).filter(
                self.BlobDBE.project_id == project_id,  # type: ignore
            )

            query = query.filter(self.BlobDBE.id.in_(blob_ids))

            query = query.limit(len(blob_ids))

            result = await session.execute(query)

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

    # ──────────────────────────────────────────────────────────────────────────

    # ─ helpers ────────────────────────────────────────────────────────────────

    def _blob_id(
        self,
        *,
        blob_data: dict,
        set_id: UUID,
    ) -> UUID:
        # Deterministically serialize the blob data
        json_blob_data = dumps(blob_data, sort_keys=True, separators=(",", ":"))

        # Combine with set_id
        unhashed = f"{set_id}{json_blob_data}".encode("utf-8")

        # Blake2b with 16-byte digest
        hashed = bytearray(blake2b(unhashed, digest_size=16).digest())

        # Force version 5 (set the version bits: 0101)
        hashed[6] = (hashed[6] & 0x0F) | 0x50

        # Force variant RFC 4122 (bits 10xx)
        hashed[8] = (hashed[8] & 0x3F) | 0x80

        return UUID(bytes=bytes(hashed))

    # ──────────────────────────────────────────────────────────────────────────
