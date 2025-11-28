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
)


def _validate_folder_name(name: Optional[str]) -> None:
    """Allow unicode word chars, spaces, and hyphens."""
    if not name or not fullmatch(r"[\w -]+", name):
        raise FolderNameInvalid()


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
