from typing import Optional, List
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, text, or_, Text
from sqlalchemy.exc import IntegrityError

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.folders.interface import FoldersDAOInterface
from oss.src.core.folders.types import (
    FolderKind,
    Folder,
    FolderCreate,
    FolderEdit,
    FolderQuery,
    FolderPathConflict,
    FolderParentMissing,
    FolderPathDepthExceeded,
    FolderPathLengthExceeded,
)
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
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalars().first()


async def _update_folder_path(
    *,
    session,
    project_id: UUID,
    current_path,
    new_prefix,
) -> None:
    """Update folder paths using ltree operations.

    Correctly handles path updates by:
    1. For the exact folder: use new_prefix
    2. For descendants: append their suffix to new_prefix
    """
    await session.execute(
        text(
            """
            UPDATE folders
            SET path = CASE
                -- Exact folder being renamed: just use the new prefix
                WHEN path = CAST(:old_path AS ltree) THEN CAST(:new_prefix AS ltree)
                -- Descendants: calculate suffix and append to new prefix
                -- Only apply subpath if path actually starts with (is descendant of) old_path
                WHEN path <@ CAST(:old_path AS ltree) AND path != CAST(:old_path AS ltree)
                THEN CAST(:new_prefix AS ltree)
                     || subpath(path, nlevel(CAST(:old_path AS ltree)))
            END
            WHERE project_id = :project_id
              AND path <@ CAST(:old_path AS ltree)
            """
        ),
        {
            "new_prefix": new_prefix,
            "old_path": current_path,
            "project_id": str(project_id),
        },
    )


async def _delete_folder_tree(
    *,
    session,
    project_id: UUID,
    folder_path: str,
) -> None:
    """Delete folder and all descendants using ltree with single SQL DELETE."""
    escaped_path = folder_path.replace("'", "''")
    await session.execute(
        text(
            """
            DELETE FROM folders
            WHERE project_id = :project_id
              AND path <@ CAST(:folder_path AS ltree)
            """
        ),
        {
            "project_id": str(project_id),
            "folder_path": escaped_path,
        },
    )


class FoldersDAO(FoldersDAOInterface):
    def __init__(self):
        pass

    @suppress_exceptions(
        exclude=[
            FolderPathConflict,
            FolderParentMissing,
            FolderPathDepthExceeded,
            FolderPathLengthExceeded,
        ]
    )
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
                    raise FolderParentMissing()

                parent_path = str(parent.path)

        folder_dbe = create_dbe_from_dto(
            DBE=FolderDBE,
            project_id=project_id,
            dto=folder_create,
            parent_path=parent_path,
        )
        folder_dbe.created_by_id = user_id

        async with engine.core_session() as session:
            try:
                session.add(folder_dbe)
                await session.commit()
                await session.refresh(folder_dbe)

                return create_dto_from_dbe(
                    DTO=Folder,
                    dbe=folder_dbe,
                )
            except IntegrityError as e:
                if "uq_folders_project_path" in str(e):
                    raise FolderPathConflict()
                raise

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

    @suppress_exceptions(
        exclude=[
            FolderPathConflict,
            FolderParentMissing,
            FolderPathDepthExceeded,
            FolderPathLengthExceeded,
        ]
    )
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

            if folder_edit.parent_id is not None:
                if folder_edit.parent_id:
                    parent = await _get_folder_row(
                        session=session,
                        folder_id=folder_edit.parent_id,
                        project_id=project_id,
                        kind=kind,
                    )
                    if not parent:
                        raise FolderParentMissing()
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

            try:
                await _update_folder_path(
                    session=session,
                    project_id=project_id,
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
            except IntegrityError as e:
                if "uq_folders_project_path" in str(e):
                    raise FolderPathConflict()
                raise

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

            await _delete_folder_tree(
                session=session,
                project_id=project_id,
                folder_path=str(folder.path),
            )

            await session.commit()
            return folder_id

    @suppress_exceptions()
    async def query(
        self,
        *,
        project_id: UUID,
        folder_query: FolderQuery,
    ) -> List[Folder]:
        async with engine.core_session() as session:
            stmt = select(FolderDBE).filter(FolderDBE.project_id == project_id)

            if folder_query.id is not None:
                stmt = stmt.filter(FolderDBE.id == folder_query.id)

            if folder_query.ids:
                stmt = stmt.filter(FolderDBE.id.in_(folder_query.ids))

            if folder_query.slug is not None:
                stmt = stmt.filter(FolderDBE.slug == folder_query.slug)

            if folder_query.slugs:
                stmt = stmt.filter(FolderDBE.slug.in_(folder_query.slugs))

            if folder_query.kind is not None:
                stmt = stmt.filter(FolderDBE.kind == folder_query.kind.value)

            if folder_query.kinds is not None:
                if folder_query.kinds is False:
                    stmt = stmt.filter(FolderDBE.kind.is_(None))
                elif folder_query.kinds is True:
                    stmt = stmt.filter(FolderDBE.kind.isnot(None))
                else:
                    stmt = stmt.filter(
                        FolderDBE.kind.in_([k.value for k in folder_query.kinds])
                    )

            if folder_query.parent_id is not None:
                stmt = stmt.filter(FolderDBE.parent_id == folder_query.parent_id)

            if folder_query.parent_ids:
                stmt = stmt.filter(FolderDBE.parent_id.in_(folder_query.parent_ids))

            if folder_query.path is not None:
                stmt = stmt.filter(FolderDBE.path.cast(Text) == folder_query.path)

            if folder_query.paths:
                stmt = stmt.filter(FolderDBE.path.cast(Text).in_(folder_query.paths))

            if folder_query.prefix is not None:
                escaped_prefix = folder_query.prefix.replace("'", "''")
                stmt = stmt.filter(
                    FolderDBE.path.op("<@")(text(f"'{escaped_prefix}'::ltree"))
                )

            if folder_query.prefixes:
                prefix_filters = []
                for prefix in folder_query.prefixes:
                    escaped_prefix = prefix.replace("'", "''")
                    prefix_filters.append(
                        FolderDBE.path.op("<@")(text(f"'{escaped_prefix}'::ltree"))
                    )
                stmt = stmt.filter(or_(*prefix_filters))

            if folder_query.tags is not None:
                stmt = stmt.filter(FolderDBE.tags.contains(folder_query.tags))

            if folder_query.flags is not None:
                stmt = stmt.filter(FolderDBE.flags.contains(folder_query.flags))

            # meta is JSON (not JSONB) — containment (@>) is not supported
            # if folder_query.meta is not None:
            #     stmt = stmt.filter(FolderDBE.meta.contains(folder_query.meta))

            result = await session.execute(stmt)

            return [
                create_dto_from_dbe(
                    DTO=Folder,
                    dbe=folder_dbe,
                )
                for folder_dbe in result.scalars().all()
            ]
