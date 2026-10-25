from abc import ABC, abstractmethod
from typing import List, Optional
from uuid import UUID

from oss.src.core.mounts.dtos import Mount, MountCreate, MountEdit, MountQuery
from oss.src.core.shared.dtos import Windowing


class MountsDAOInterface(ABC):
    @abstractmethod
    async def create_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_create: MountCreate,
    ) -> Mount:
        """Insert a mount. The new row stores the prefix the DAO writes in the same insert:
        `project_storage_prefix(project_id=..., mount_id=<new id>)`."""
        ...

    @abstractmethod
    async def upsert_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_create: MountCreate,
    ) -> Mount:
        """Insert or re-bind a mount by `(project_id, slug)`. A new row stores the prefix the
        DAO writes in the same statement, as in `create_mount`; on conflict the existing row
        and its prefix win."""
        ...

    @abstractmethod
    async def fetch_mount(
        self,
        *,
        project_id: UUID,
        #
        mount_id: UUID,
    ) -> Optional[Mount]: ...

    @abstractmethod
    async def fetch_mount_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[Mount]: ...

    @abstractmethod
    async def edit_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_edit: MountEdit,
    ) -> Optional[Mount]: ...

    @abstractmethod
    async def archive_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_id: UUID,
    ) -> Optional[Mount]: ...

    @abstractmethod
    async def unarchive_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_id: UUID,
    ) -> Optional[Mount]: ...

    @abstractmethod
    async def query_mounts(
        self,
        *,
        project_id: UUID,
        #
        mount_query: Optional[MountQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Mount]: ...

    @abstractmethod
    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[Mount]: ...
