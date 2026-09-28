from datetime import datetime, timezone
from typing import Awaitable, Callable, List, Optional
from uuid import UUID

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.mounts.dtos import (
    AppShare,
    Mount,
    MountCreate,
    MountEdit,
    MountQuery,
)
from oss.src.core.mounts.interfaces import MountsDAOInterface
from oss.src.core.mounts.types import (
    ATTACHMENTS_MOUNT_PURPOSE,
    PROTECTED_MOUNT_SLUG_LIKE_ESCAPE,
    MountSlugConflict,
    protected_mount_slug_like_pattern,
)
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
        #
        reactivate: bool,
    ) -> Mount:
        now = datetime.now(timezone.utc)
        values = map_mount_dto_to_dbe_upsert(
            project_id=project_id,
            user_id=user_id,
            now=now,
            mount_create=mount_create,
        )

        stmt = insert(MountDBE).values(**values)
        # On re-bind (same project + slug), keep the original row/id: touch the audit fields,
        # and clear any archive only when `reactivate` says so. A session drive stays archived
        # until its session is unarchived. name/description/flags are left intact. `purpose` is
        # server-owned and derived from the slug, so re-binding backfills it on rows minted
        # before the column existed.
        set_ = {
            "updated_at": now,
            "updated_by_id": user_id,
            "purpose": stmt.excluded.purpose,
        }
        if reactivate:
            set_["deleted_at"] = None
            set_["deleted_by_id"] = None
        stmt = stmt.on_conflict_do_update(
            constraint="uq_mounts_project_id_slug",
            set_=set_,
            # Without `reactivate`, an archived row is read-only: leave it untouched.
            where=None if reactivate else MountDBE.deleted_at.is_(None),
        ).returning(MountDBE)

        async with self.engine.session() as session:
            result = await session.execute(stmt)
            await session.commit()
            mount_dbe = result.scalars().first()
            if mount_dbe is None:
                # The conflict hit an archived row, which the update skipped: return it as is.
                mount_dbe = (
                    await session.execute(
                        select(MountDBE).where(
                            MountDBE.project_id == project_id,
                            MountDBE.slug == mount_create.slug,
                        )
                    )
                ).scalar_one()

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

    async def fetch_mount_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[Mount]:
        """Fetch by slug, excluding archived rows for agent-mount reads."""
        async with self.engine.session() as session:
            stmt = select(MountDBE).where(
                MountDBE.project_id == project_id,
                MountDBE.slug == slug,
                MountDBE.deleted_at.is_(None),
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

    async def update_app_share(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
        #
        mutate: Callable[[Mount, Optional[AppShare]], Awaitable[Optional[AppShare]]],
    ) -> Optional[AppShare]:
        """Change one app's share entry under a row lock, so concurrent changes both land.

        `mutate` gets the drive and the current entry and returns the new one (None removes it).
        It runs while the lock is held and must make no DAO call: a nested call in this task
        would share this session and commit early.
        """
        async with self.engine.session() as session:
            stmt = (
                select(MountDBE)
                .where(
                    MountDBE.project_id == project_id,
                    MountDBE.id == mount_id,
                )
                .with_for_update()
            )
            mount_dbe = (await session.execute(stmt)).scalar_one_or_none()
            if not mount_dbe:
                return None

            mount = map_mount_dbe_to_dto(mount_dbe=mount_dbe)
            updated = await mutate(mount, mount.data.shares.get(path))

            data = dict(mount_dbe.data or {})
            shares = dict(data.get("shares") or {})
            if updated is None:
                shares.pop(path, None)
            else:
                shares[path] = updated.model_dump(mode="json")
            data["shares"] = shares
            # A new dict: the `json` column does not track in-place mutation.
            mount_dbe.data = data

            await session.commit()
            return updated

    async def fetch_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[Mount]:
        """Every mount row bound to a session, archived and protected ones included."""
        async with self.engine.session() as session:
            stmt = select(MountDBE).where(
                MountDBE.project_id == project_id,
                MountDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            return [
                map_mount_dbe_to_dto(mount_dbe=dbe) for dbe in result.scalars().all()
            ]

    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[Mount]:
        """Hard delete the mount rows bound to a session. Mounts are semi-
        independent (optional `session_id`, may outlive a session) — this is
        the explicit, session-scoped fan-out (S7/F1, WP5), not a blind
        cascade. Returns the deleted rows so the caller can tear down their
        object-store prefixes."""
        async with self.engine.session() as session:
            stmt = select(MountDBE).where(
                MountDBE.project_id == project_id,
                MountDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            mount_dbes = list(result.scalars().all())
            mounts = [map_mount_dbe_to_dto(mount_dbe=dbe) for dbe in mount_dbes]

            if mount_dbes:
                del_stmt = sa_delete(MountDBE).where(
                    MountDBE.project_id == project_id,
                    MountDBE.session_id == session_id,
                )
                await session.execute(del_stmt)
                await session.commit()

        return mounts

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
            # Same protected-mount policy as `is_protected_mount`, in SQL so the exclusion
            # happens before the window's LIMIT rather than shortening the returned page.
            stmt = stmt.where(
                MountDBE.purpose.is_distinct_from(ATTACHMENTS_MOUNT_PURPOSE),
                MountDBE.slug.not_like(
                    protected_mount_slug_like_pattern(),
                    escape=PROTECTED_MOUNT_SLUG_LIKE_ESCAPE,
                ),
            )

            if mount_query:
                if not mount_query.include_archived:
                    stmt = stmt.where(MountDBE.deleted_at.is_(None))

                if mount_query.session_id is not None:
                    stmt = stmt.where(MountDBE.session_id == mount_query.session_id)

                if mount_query.agent_id is not None:
                    stmt = stmt.where(MountDBE.agent_id == mount_query.agent_id)

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
            else:
                # Consumers index into this list (the web drive picks a mount out of it), so an
                # unordered query made their pick depend on whatever row order Postgres returned.
                stmt = stmt.order_by(MountDBE.created_at.asc(), MountDBE.id.asc())

            result = await session.execute(stmt)

            return [
                map_mount_dbe_to_dto(mount_dbe=dbe) for dbe in result.scalars().all()
            ]
