from re import fullmatch
from typing import Optional, List
from uuid import UUID

from oss.src.core.folders.interface import FoldersDAOInterface
from oss.src.core.folders.types import (
    Folder,
    FolderCreate,
    FolderEdit,
    FolderQuery,
    FolderNameInvalid,
    FolderPathDepthExceeded,
    FolderPathLengthExceeded,
    FolderParentMissing,
    FolderKind,
)


def _validate_folder_name(name: Optional[str]) -> None:
    """Allow unicode word chars, spaces, and hyphens."""
    if not name or not fullmatch(r"[\w -]+", name):
        raise FolderNameInvalid()


def _validate_path_length(slug: Optional[str]) -> None:
    """Validate folder slug/path length (max 64 characters)."""
    if slug and len(slug) > 64:
        raise FolderPathLengthExceeded()


def _validate_path_depth(path: str) -> None:
    """Validate folder path depth (max 10 levels)."""
    if len(path.split(".")) > 10:
        raise FolderPathDepthExceeded()


class FoldersService:
    def __init__(
        self,
        *,
        folders_dao: FoldersDAOInterface,
    ):
        self.folders_dao = folders_dao

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        folder_create: FolderCreate,
    ) -> Optional[Folder]:
        _validate_folder_name(folder_create.name)
        _validate_path_length(folder_create.slug)

        parent_path: Optional[str] = None

        if folder_create.parent_id:
            # Ensure parent exists and capture its path for depth validation
            parent_kind = folder_create.kind or FolderKind.APPLICATIONS
            parents = await self.folders_dao.query(
                project_id=project_id,
                folder_query=FolderQuery(
                    id=folder_create.parent_id,
                    kind=parent_kind,
                ),
            )

            parent = parents[0] if parents else None
            if not parent:
                raise FolderParentMissing()

            parent_path = parent.path

        path_str = (
            folder_create.slug
            if not parent_path
            else f"{parent_path}.{folder_create.slug}"
        )
        _validate_path_depth(path_str)

        return await self.folders_dao.create(
            project_id=project_id,
            user_id=user_id,
            #
            folder_create=folder_create,
        )

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        folder_id: UUID,
    ) -> Optional[Folder]:
        return await self.folders_dao.fetch(
            project_id=project_id,
            #
            folder_id=folder_id,
        )

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        folder_edit: FolderEdit,
    ) -> Optional[Folder]:
        _validate_folder_name(folder_edit.name)
        _validate_path_length(folder_edit.slug)

        kind = folder_edit.kind or FolderKind.APPLICATIONS

        # Fetch current folder to determine new path depth
        existing_folders = await self.folders_dao.query(
            project_id=project_id,
            folder_query=FolderQuery(
                id=folder_edit.id,
                kind=kind,
            ),
        )
        current_folder = existing_folders[0] if existing_folders else None
        if not current_folder:
            return None

        new_slug = folder_edit.slug or current_folder.slug

        if folder_edit.parent_id is not None:
            if folder_edit.parent_id:
                parents = await self.folders_dao.query(
                    project_id=project_id,
                    folder_query=FolderQuery(
                        id=folder_edit.parent_id,
                        kind=kind,
                    ),
                )
                new_parent = parents[0] if parents else None
                if not new_parent:
                    raise FolderParentMissing()
                new_parent_path = new_parent.path
            else:
                new_parent_path = None
        else:
            # Keep existing parent path
            if current_folder.path and "." in current_folder.path:
                new_parent_path = ".".join(current_folder.path.split(".")[:-1])
            else:
                new_parent_path = None

        new_prefix = (
            new_slug if not new_parent_path else f"{new_parent_path}.{new_slug}"
        )
        _validate_path_depth(new_prefix)

        return await self.folders_dao.edit(
            project_id=project_id,
            user_id=user_id,
            #
            folder_edit=folder_edit,
        )

    async def delete(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        folder_id: UUID,
    ) -> Optional[UUID]:
        return await self.folders_dao.delete(
            project_id=project_id,
            user_id=user_id,
            #
            folder_id=folder_id,
        )

    async def query(
        self,
        *,
        project_id: UUID,
        #
        folder_query: FolderQuery,
    ) -> List[Folder]:
        return await self.folders_dao.query(
            project_id=project_id,
            #
            folder_query=folder_query,
        )
