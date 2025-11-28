from typing import Optional, List
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, text

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.folders.interface import FoldersDAOInterface
from oss.src.core.folders.types import FolderKind, Folder, FolderCreate, FolderEdit, FolderQuery
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.folders.dbes import FolderDBE
from oss.src.dbs.postgres.folders.mappings import (
    create_dbe_from_dto,
    edit_dbe_from_dto,
    create_dto_from_dbe,
)

log = get_module_logger(__name__)


async def _get_folder_row(
    *,
    session,
    folder_id: UUID,
    project_id: UUID,
    kind,
) -> Optional[FolderDBE]:
    stmt = (
        select(FolderDBE)
        .filter(FolderDBE.project_id == project_id)
        .filter(FolderDBE.id == folder_id)
        .filter(FolderDBE.kind == kind)
        .filter(FolderDBE.deleted_at.is_(None))
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalars().first()


async def _update_folder_path(
    *,
    session,
    project_id: UUID,
    kind: FolderKind,
    current_path,
    new_prefix,
) -> None:
    """Update folder paths using ltree operations."""
    await session.execute(
        text(
            """
            UPDATE folders
            SET path = (:new_prefix)::ltree || subpath(path, nlevel(:old_path))
            WHERE project_id = :project_id
              AND kind = :kind
              AND path <@ (:old_path)::ltree
            """
        ),
        {
            "new_prefix": new_prefix,
            "old_path": current_path,
            "project_id": str(project_id),
            "kind": kind.value,
        },
    )


async def _soft_delete_folder_tree(
    *,
    session,
    project_id: UUID,
    kind: FolderKind,
    folder_path: str,
    user_id: UUID,
    now: datetime,
) -> None:
    """Soft delete folder and all descendants using ltree."""
    await session.execute(
        text(
            """
            UPDATE folders
            SET deleted_at = :now, deleted_by_id = :user_id
            WHERE project_id = :project_id
              AND kind = :kind
              AND path <@ :path
            """
        ),
        {
            "now": now,
            "user_id": user_id,
            "project_id": project_id,
            "kind": kind.value,
            "path": folder_path,
        },
    )


class FoldersDAO(FoldersDAOInterface):
    def __init__(self):
        pass

    @suppress_exceptions()
    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        folder_create: FolderCreate,
    ) -> Optional[Folder]:
        parent_path = None

        if folder_create.parent_id:
            async with engine.core_session() as session:
                parent = await _get_folder_row(
                    session=session,
                    folder_id=folder_create.parent_id,
                    project_id=project_id,
                    kind=folder_create.kind or FolderKind.APPLICATIONS,
                )
                if not parent:
                    raise ValueError("parent folder not found")

                parent_path = str(parent.path)

        folder_dbe = create_dbe_from_dto(
            DBE=FolderDBE,
            project_id=project_id,
            dto=folder_create,
            parent_path=parent_path,
        )
        folder_dbe.created_by_id = user_id

        async with engine.core_session() as session:
            session.add(folder_dbe)
            await session.commit()
            await session.refresh(folder_dbe)

            return create_dto_from_dbe(
                DTO=Folder,
                dbe=folder_dbe,
            )

    @suppress_exceptions()
    async def fetch(
        self,
        *,
        project_id: UUID,
        folder_id: UUID,
    ) -> Optional[Folder]:
        async with engine.core_session() as session:
            folder = await _get_folder_row(
                session=session,
                folder_id=folder_id,
                project_id=project_id,
                kind=FolderKind.APPLICATIONS,
            )
            if folder is None:
                return None

            return create_dto_from_dbe(
                DTO=Folder,
                dbe=folder,
            )

    @suppress_exceptions(default=[])
    async def query(
        self,
        *,
        project_id: UUID,
        folder_query: FolderQuery,
    ) -> List[Folder]:
        async with engine.core_session() as session:
            stmt = (
                select(FolderDBE)
                .filter(FolderDBE.project_id == project_id)
                .filter(FolderDBE.deleted_at.is_(None))
            )

            if folder_query.ids or folder_query.id:
                ids = folder_query.ids or []
                if folder_query.id:
                    ids.append(folder_query.id)
                stmt = stmt.filter(FolderDBE.id.in_(ids))

            if folder_query.parent_ids or folder_query.parent_id is not None:
                parent_ids = folder_query.parent_ids or []
                if folder_query.parent_id:
                    parent_ids.append(folder_query.parent_id)
                stmt = stmt.filter(FolderDBE.parent_id.in_(parent_ids))

            if folder_query.slugs or folder_query.slug:
                slugs = folder_query.slugs or []
                if folder_query.slug:
                    slugs.append(folder_query.slug)
                stmt = stmt.filter(FolderDBE.slug.in_(slugs))

            if folder_query.kind:
                stmt = stmt.filter(FolderDBE.kind == folder_query.kind)
            if folder_query.kinds:
                stmt = stmt.filter(FolderDBE.kind.in_(folder_query.kinds))

            if folder_query.paths or folder_query.path:
                paths = folder_query.paths or []
                if folder_query.path:
                    paths.append(folder_query.path)
                stmt = stmt.filter(FolderDBE.path.in_(paths))

            if folder_query.glob:
                stmt = stmt.filter(text("path ~ :glob")).params(glob=folder_query.glob)

            if folder_query.tags is not None:
                stmt = stmt.filter(FolderDBE.tags.contains(folder_query.tags))

            if folder_query.meta is not None:
                stmt = stmt.filter(FolderDBE.meta.contains(folder_query.meta))

            result = await session.execute(stmt)
            return [
                create_dto_from_dbe(
                    DTO=Folder,
                    dbe=folder_dbe,
                )
                for folder_dbe in result.scalars().all()
            ]

    @suppress_exceptions()
    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        folder_edit: FolderEdit,
    ) -> Optional[Folder]:
        kind = folder_edit.kind or FolderKind.APPLICATIONS

        async with engine.core_session() as session:
            folder = await _get_folder_row(
                session=session,
                folder_id=folder_edit.id,
                project_id=project_id,
                kind=kind,
            )

            if not folder:
                return None

            current_path = str(folder.path)
            new_slug = folder_edit.slug or folder.slug  # type: ignore[attr-defined]

            new_parent_path = None
            new_parent_id = folder.parent_id

            if folder_edit.parent_id is not None:
                new_parent_id = folder_edit.parent_id
                if folder_edit.parent_id:
                    parent = await _get_folder_row(
                        session=session,
                        folder_id=folder_edit.parent_id,
                        project_id=project_id,
                        kind=kind,
                    )
                    if not parent:
                        raise ValueError("parent folder not found")
                    new_parent_path = str(parent.path)
                else:
                    new_parent_path = None
            else:
                if folder.parent_id:
                    parent = await _get_folder_row(
                        session=session,
                        folder_id=folder.parent_id,
                        project_id=project_id,
                        kind=kind,
                    )
                    new_parent_path = str(parent.path) if parent else None

            new_prefix = (
                new_slug if not new_parent_path else f"{new_parent_path}.{new_slug}"
            )

            await _update_folder_path(
                session=session,
                project_id=project_id,
                kind=kind,
                current_path=current_path,
                new_prefix=new_prefix,
            )

            folder = edit_dbe_from_dto(
                dbe=folder,
                dto=folder_edit,
                updated_by_id=user_id,
                updated_at=datetime.now(timezone.utc),
            )

            await session.commit()
            await session.refresh(folder)

            return create_dto_from_dbe(
                DTO=Folder,
                dbe=folder,
            )

    @suppress_exceptions()
    async def delete(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        folder_id: UUID,
    ) -> Optional[UUID]:
        async with engine.core_session() as session:
            folder = await _get_folder_row(
                session=session,
                folder_id=folder_id,
                project_id=project_id,
                kind=FolderKind.APPLICATIONS,
            )
            if not folder:
                return None

            now = datetime.now(timezone.utc)

            await _soft_delete_folder_tree(
                session=session,
                project_id=project_id,
                kind=FolderKind.APPLICATIONS,
                folder_path=str(folder.path),
                user_id=user_id,
                now=now,
            )

            await session.commit()
            return folder_id
