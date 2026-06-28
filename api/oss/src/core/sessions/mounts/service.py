"""Thin session-scoped view over the mounts domain.

Delegates to ``core.mounts.MountsService``; owns no storage of its own. The
mounts table is reused via the mounts DAO — there is no ``dbs`` layer here.
"""

from typing import List, Optional
from uuid import UUID

from oss.src.core.mounts.service import MountsService
from oss.src.core.mounts.dtos import Mount, MountQuery
from oss.src.core.shared.dtos import Windowing


class SessionMountsService:
    def __init__(
        self,
        *,
        mounts_service: MountsService,
    ):
        self.mounts_service = mounts_service

    async def query_mounts(
        self,
        *,
        project_id: UUID,
        #
        mount_query: Optional[MountQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Mount]:
        return await self.mounts_service.query_mounts(
            project_id=project_id,
            mount_query=mount_query,
            windowing=windowing,
        )
