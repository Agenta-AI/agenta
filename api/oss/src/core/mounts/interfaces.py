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
    ) -> Mount: ...

    @abstractmethod
    async def upsert_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_create: MountCreate,
    ) -> Mount: ...

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
