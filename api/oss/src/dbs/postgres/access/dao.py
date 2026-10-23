"""Postgres implementation of `PrincipalsDAOInterface`.

One statement per call for every principal kind, read through the `fetch_principal`
cache. The cache stores the absence of a principal too, so a repeated unknown id costs
one Redis read. Callers invalidate an entry with `invalidate_principal_cache` after a
key, binding, connection or user change.
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict
from sqlalchemy import text

from oss.src.core.access.dtos import PrincipalKind, PrincipalRecord, PrincipalRef
from oss.src.core.access.interfaces import PrincipalsDAOInterface
from oss.src.dbs.postgres.access.mappings import (
    map_api_key_dbe_to_principal_record,
    map_channel_agent_dbe_to_principal_record,
    map_user_dbe_to_principal_record,
)
from oss.src.models.db_models import APIKeyDB, UserDB  # noqa: F401  (tables read here)
from oss.src.utils.caching import get_cache, invalidate_cache, set_cache


_NAMESPACE = "fetch_principal"


class _CachedPrincipal(BaseModel):
    """The cache entry. `record=None` is a cached absence, not a miss."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    record: Optional[PrincipalRecord] = None


def _cache_key(principal: PrincipalRef) -> dict:
    return {"k": principal.kind.value, "id": str(principal.id)}


_FETCH_USER_SQL = """
SELECT u.id FROM users u WHERE u.id = :id
"""

# The key is active only when its creator is a user: today a key whose creator has no
# `users` row fails every request, and the Agenta channel refuses it.
_FETCH_API_KEY_SQL = """
SELECT k.id, k.project_id, k.created_by_id, k.expiration_date,
       u.id IS NOT NULL AS creator_exists
FROM api_keys k
LEFT JOIN users u ON u.id = k.created_by_id
WHERE k.id = :id
"""

_FETCH_INSTALLATION_SQL = """
SELECT a.id, a.project_id, a.created_by_id,
       a.deleted_at IS NULL AS agent_live,
       COALESCE((a.flags->>'is_active')::boolean, true) AS agent_active,
       c.id IS NOT NULL AS connection_exists,
       c.deleted_at IS NULL AS connection_live,
       COALESCE((c.flags->>'is_active')::boolean, true) AS connection_active
FROM channel_agents a
LEFT JOIN channel_connections c
       ON c.id = a.connection_id AND c.project_id = a.project_id
WHERE a.id = :id
"""


class PrincipalsDAO(PrincipalsDAOInterface):
    def __init__(self, *, engine):
        self.engine = engine

    async def fetch_principal(
        self,
        *,
        principal: PrincipalRef,
    ) -> Optional[PrincipalRecord]:
        cached = await get_cache(
            namespace=_NAMESPACE,
            key=_cache_key(principal),
            model=_CachedPrincipal,
        )
        if cached is not None:
            return cached.record

        record = await self._read(principal=principal)

        await set_cache(
            namespace=_NAMESPACE,
            key=_cache_key(principal),
            value=_CachedPrincipal(record=record),
        )
        return record

    async def _read(self, *, principal: PrincipalRef) -> Optional[PrincipalRecord]:
        if principal.kind == PrincipalKind.HUMAN:
            sql, mapper = _FETCH_USER_SQL, map_user_dbe_to_principal_record
        elif principal.kind == PrincipalKind.API_KEY:
            sql, mapper = _FETCH_API_KEY_SQL, map_api_key_dbe_to_principal_record
        elif principal.kind == PrincipalKind.INSTALLATION:
            sql, mapper = (
                _FETCH_INSTALLATION_SQL,
                map_channel_agent_dbe_to_principal_record,
            )
        else:  # pragma: no cover - the enum is closed
            return None

        async with self.engine.session() as session:
            row = (await session.execute(text(sql), {"id": principal.id})).first()

        if row is None:
            return None
        return mapper(row)


async def invalidate_principal_cache(*, principal: PrincipalRef) -> Optional[bool]:
    """A direct delete by key. Returns `None` when the delete failed (or caching is
    off)."""

    return await invalidate_cache(namespace=_NAMESPACE, key=_cache_key(principal))
