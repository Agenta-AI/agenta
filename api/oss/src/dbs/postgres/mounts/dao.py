from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.mounts.dtos import Mount, MountCreate, MountEdit, MountQuery
from oss.src.core.mounts.interfaces import MountsDAOInterface
from oss.src.core.mounts.types import MountSlugConflict
from oss.src.core.shared.dtos import Windowing

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.dbs.postgres.mounts.dbes import MountDBE
from oss.src.dbs.postgres.mounts.mappings import (
    map_mount_dbe_to_dto,
    map_mount_dto_to_dbe_create,
    map_mount_dto_to_dbe_edit,
    map_mount_dto_to_dbe_upsert,
)


class MountsDAO(MountsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def create_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_create: MountCreate,
    ) -> Mount:
        mount_dbe = map_mount_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            mount_create=mount_create,
        )

        try:
            async with self.engine.session() as session:
                session.add(mount_dbe)
                await session.commit()
                await session.refresh(mount_dbe)
        except IntegrityError as e:
            if "uq_mounts_project_id_slug" in str(e.orig):
                raise MountSlugConflict() from e
            raise

        return map_mount_dbe_to_dto(mount_dbe=mount_dbe)

    async def upsert_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_create: MountCreate,
    ) -> Mount:
        now = datetime.now(timezone.utc)
        values = map_mount_dto_to_dbe_upsert(
            project_id=project_id,
            user_id=user_id,
            now=now,
            mount_create=mount_create,
        )

        stmt = insert(MountDBE).values(**values)
        # On re-bind (same project + slug), keep the original row/id and re-activate it:
        # touch the audit fields and clear any archive, so a re-attached session gets a
        # live mount on the same durable prefix. name/description/flags are left intact.
        stmt = stmt.on_conflict_do_update(
            constraint="uq_mounts_project_id_slug",
            set_={
                "updated_at": now,
                "updated_by_id": user_id,
                "deleted_at": None,
                "deleted_by_id": None,
            },
        ).returning(MountDBE)

        async with self.engine.session() as session:
            result = await session.execute(stmt)
            await session.commit()
            mount_dbe = result.scalars().first()

        return map_mount_dbe_to_dto(mount_dbe=mount_dbe)

    async def fetch_mount(
        self,
        *,
        project_id: UUID,
        #
        mount_id: UUID,
    ) -> Optional[Mount]:
        async with self.engine.session() as session:
            stmt = select(MountDBE).where(
                MountDBE.project_id == project_id,
                MountDBE.id == mount_id,
            )

            result = await session.execute(stmt)
            mount_dbe = result.scalar_one_or_none()

            if not mount_dbe:
                return None

            return map_mount_dbe_to_dto(mount_dbe=mount_dbe)

    async def edit_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_edit: MountEdit,
    ) -> Optional[Mount]:
        async with self.engine.session() as session:
            stmt = select(MountDBE).where(
                MountDBE.project_id == project_id,
                MountDBE.id == mount_edit.id,
            )

            result = await session.execute(stmt)
            mount_dbe = result.scalar_one_or_none()

            if not mount_dbe:
                return None

            map_mount_dto_to_dbe_edit(
                mount_dbe=mount_dbe,
                user_id=user_id,
                mount_edit=mount_edit,
            )

            await session.commit()
            await session.refresh(mount_dbe)

            return map_mount_dbe_to_dto(mount_dbe=mount_dbe)

    async def archive_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_id: UUID,
    ) -> Optional[Mount]:
        async with self.engine.session() as session:
            stmt = select(MountDBE).where(
                MountDBE.project_id == project_id,
                MountDBE.id == mount_id,
            )

            result = await session.execute(stmt)
            mount_dbe = result.scalar_one_or_none()

            if not mount_dbe:
                return None

            mount_dbe.deleted_at = datetime.now(timezone.utc)
            mount_dbe.deleted_by_id = user_id

            await session.commit()
            await session.refresh(mount_dbe)

            return map_mount_dbe_to_dto(mount_dbe=mount_dbe)

    async def unarchive_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_id: UUID,
    ) -> Optional[Mount]:
        async with self.engine.session() as session:
            stmt = select(MountDBE).where(
                MountDBE.project_id == project_id,
                MountDBE.id == mount_id,
            )

            result = await session.execute(stmt)
            mount_dbe = result.scalar_one_or_none()

            if not mount_dbe:
                return None

            mount_dbe.deleted_at = None
            mount_dbe.deleted_by_id = None
            mount_dbe.updated_by_id = user_id

            await session.commit()
            await session.refresh(mount_dbe)

            return map_mount_dbe_to_dto(mount_dbe=mount_dbe)

    async def query_mounts(
        self,
        *,
        project_id: UUID,
        #
        mount_query: Optional[MountQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Mount]:
        async with self.engine.session() as session:
            stmt = select(MountDBE).where(
                MountDBE.project_id == project_id,
            )

            if mount_query:
                if not mount_query.include_archived:
                    stmt = stmt.where(MountDBE.deleted_at.is_(None))

                if mount_query.session_id is not None:
                    stmt = stmt.where(MountDBE.session_id == mount_query.session_id)

            else:
                stmt = stmt.where(MountDBE.deleted_at.is_(None))

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=MountDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_mount_dbe_to_dto(mount_dbe=dbe) for dbe in result.scalars().all()
            ]
