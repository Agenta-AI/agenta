import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select

from oss.src.core.browser_profiles.dtos import (
    BrowserProfile,
    BrowserProfileState,
    BrowserSessionState,
)
from oss.src.dbs.postgres.browser_profiles.mappings import (
    map_browser_login_data_to_session_state,
    map_browser_login_dbe_to_dto,
)
from oss.src.core.browser_profiles.interfaces import BrowserProfilesDAOInterface
from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.enums import SecretKind
from oss.src.dbs.postgres.secrets.dbes import SecretsDBE
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.utils.env import env

Data = Dict[str, Any]


def rebase_saved_state(
    data: Data, *, generation: int, rebase: Callable[[Optional[Data]], Data]
) -> Optional[Data]:
    """The login's data with its rebased state, or None when a newer login replaced it."""
    if data["generation"] != generation:
        return None
    return {**data, "storage_state": rebase(data.get("storage_state"))}


def _live(*, project_id: UUID, profile_id: UUID):
    return (
        SecretsDBE.project_id == project_id,
        SecretsDBE.id == profile_id,
        SecretsDBE.kind == SecretKind.BROWSER_LOGIN,
        SecretsDBE.deleted_at.is_(None),
    )


class BrowserProfilesDAO(BrowserProfilesDAOInterface):
    """A login is a `browser_login` vault row; `data` is `{allowed_hosts, state, generation, storage_state}`."""

    def __init__(
        self,
        *,
        engine: Optional[TransactionsEngine] = None,
        crypt_key: Optional[str] = None,
    ):
        self.engine = engine or get_transactions_engine()
        self.crypt_key = crypt_key or env.agenta.crypt_key

    @asynccontextmanager
    async def _session(self):
        with set_data_encryption_key(self.crypt_key):
            async with self.engine.session() as session:
                yield session

    async def _update(
        self,
        *,
        project_id: UUID,
        profile_id: UUID,
        change: Callable[[Data], Optional[Data]],
        **columns: Any,
    ) -> Optional[BrowserProfile]:
        # `data` is one encrypted blob, so the change is a locked read-modify-write.
        async with self._session() as session:
            result = await session.execute(
                select(SecretsDBE)
                .where(*_live(project_id=project_id, profile_id=profile_id))
                .with_for_update()
            )
            dbe = result.scalars().first()
            if dbe is None:
                return None
            data = change(json.loads(dbe.data))  # type: ignore
            if data is None:
                return None
            dbe.data = json.dumps(data)  # type: ignore
            dbe.updated_at = datetime.now(timezone.utc)  # type: ignore
            for key, value in columns.items():
                setattr(dbe, key, value)
            return map_browser_login_dbe_to_dto(dbe=dbe)

    async def create_profile(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        name: str,
        allowed_hosts: List[str],
    ) -> BrowserProfile:
        dbe = SecretsDBE(
            project_id=project_id,
            kind=SecretKind.BROWSER_LOGIN,
            name=name,
            data=json.dumps(
                {
                    "allowed_hosts": allowed_hosts,
                    "state": BrowserProfileState.PENDING_LOGIN.value,
                    "generation": 0,
                    "storage_state": None,
                }
            ),
            created_by_id=user_id,
        )
        async with self._session() as session:
            session.add(dbe)
            await session.flush()
            await session.refresh(dbe)
            return map_browser_login_dbe_to_dto(dbe=dbe)

    async def fetch_profile(
        self,
        *,
        project_id: UUID,
        #
        profile_id: UUID,
    ) -> Optional[BrowserProfile]:
        async with self._session() as session:
            result = await session.execute(
                select(SecretsDBE).where(
                    *_live(project_id=project_id, profile_id=profile_id)
                )
            )
            dbe = result.scalars().first()
            return map_browser_login_dbe_to_dto(dbe=dbe) if dbe else None

    async def query_profiles(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> List[BrowserProfile]:
        async with self._session() as session:
            result = await session.execute(
                select(SecretsDBE)
                .where(
                    SecretsDBE.project_id == project_id,
                    SecretsDBE.kind == SecretKind.BROWSER_LOGIN,
                    SecretsDBE.created_by_id == user_id,
                    SecretsDBE.deleted_at.is_(None),
                )
                .order_by(SecretsDBE.created_at)
            )
            return [
                map_browser_login_dbe_to_dto(dbe=dbe) for dbe in result.scalars().all()
            ]

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
        columns: Dict[str, Any] = {"updated_by_id": user_id}
        if name is not None:
            columns["name"] = name
        return await self._update(
            project_id=project_id,
            profile_id=profile_id,
            change=lambda data: (
                data
                if allowed_hosts is None
                else {**data, "allowed_hosts": allowed_hosts}
            ),
            **columns,
        )

    async def archive_profile(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
    ) -> Optional[BrowserProfile]:
        return await self._update(
            project_id=project_id,
            profile_id=profile_id,
            change=lambda data: {**data, "storage_state": None},
            updated_by_id=user_id,
            deleted_at=datetime.now(timezone.utc),
            deleted_by_id=user_id,
        )

    async def fetch_session_states(
        self,
        *,
        project_id: UUID,
        #
        profile_ids: List[UUID],
    ) -> Dict[UUID, BrowserSessionState]:
        async with self._session() as session:
            result = await session.execute(
                select(SecretsDBE.id, SecretsDBE.data).where(
                    SecretsDBE.project_id == project_id,
                    SecretsDBE.id.in_(profile_ids),
                    SecretsDBE.kind == SecretKind.BROWSER_LOGIN,
                    SecretsDBE.deleted_at.is_(None),
                )
            )
            rows = result.all()
        return {
            profile_id: map_browser_login_data_to_session_state(data=data)
            for profile_id, data in rows
        }

    async def store_login_state(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
        storage_state: Dict[str, Any],
    ) -> Optional[BrowserProfile]:
        return await self._update(
            project_id=project_id,
            profile_id=profile_id,
            change=lambda data: {
                **data,
                "storage_state": storage_state,
                "generation": data["generation"] + 1,
                "state": BrowserProfileState.READY.value,
            },
            updated_by_id=user_id,
        )

    async def save_session_state(
        self,
        *,
        project_id: UUID,
        #
        profile_id: UUID,
        generation: int,
        rebase: Callable[[Optional[Dict[str, Any]]], Dict[str, Any]],
    ) -> bool:
        saved = await self._update(
            project_id=project_id,
            profile_id=profile_id,
            change=lambda data: rebase_saved_state(
                data, generation=generation, rebase=rebase
            ),
        )
        return saved is not None
