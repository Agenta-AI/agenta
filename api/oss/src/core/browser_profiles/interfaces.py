from typing import Any, Callable, Dict, List, Optional
from uuid import UUID

from oss.src.core.browser_profiles.dtos import BrowserProfile, BrowserSessionState


class BrowserProfilesDAOInterface:
    async def create_profile(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        name: str,
        allowed_hosts: List[str],
    ) -> BrowserProfile:
        raise NotImplementedError()

    async def fetch_profile(
        self,
        *,
        project_id: UUID,
        #
        profile_id: UUID,
    ) -> Optional[BrowserProfile]:
        raise NotImplementedError()

    async def query_profiles(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> List[BrowserProfile]:
        raise NotImplementedError()

    async def edit_profile(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
        name: Optional[str] = None,
        allowed_hosts: Optional[List[str]] = None,
    ) -> Optional[BrowserProfile]:
        raise NotImplementedError()

    async def archive_profile(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
    ) -> Optional[BrowserProfile]:
        raise NotImplementedError()

    async def fetch_session_states(
        self,
        *,
        project_id: UUID,
        #
        profile_ids: List[UUID],
    ) -> Dict[UUID, BrowserSessionState]:
        raise NotImplementedError()

    async def store_login_state(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
        storage_state: Dict[str, Any],
    ) -> Optional[BrowserProfile]:
        raise NotImplementedError()

    async def save_session_state(
        self,
        *,
        project_id: UUID,
        #
        profile_id: UUID,
        generation: int,
        rebase: Callable[[Optional[Dict[str, Any]]], Dict[str, Any]],
    ) -> bool:
        """Under the row lock: replaces the state with `rebase(stored)` unless a newer login replaced it."""
        raise NotImplementedError()
