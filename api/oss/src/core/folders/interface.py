from typing import Optional, List
from uuid import UUID

from oss.src.core.folders.types import (
    Folder,
    FolderCreate,
    FolderEdit,
    FolderQuery,
)


class FoldersDAOInterface:
    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        folder_create: FolderCreate,
    ) -> Optional[Folder]:
        raise NotImplementedError()

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        folder_id: UUID,
    ) -> Optional[Folder]:
        raise NotImplementedError()

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        folder_edit: FolderEdit,
    ) -> Optional[Folder]:
        raise NotImplementedError()

    async def delete(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        folder_id: UUID,
    ) -> Optional[UUID]:
        raise NotImplementedError()

    async def query(
        self,
        *,
        project_id: UUID,
        #
        folder_query: FolderQuery,
    ) -> List[Folder]:
        raise NotImplementedError()
