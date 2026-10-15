"""Postgres DAO for MCP OAuth authorization attempts.

Postgres rather than Redis, for three reasons. The callback can land on any API
replica, so the record has to be visible from all of them. The browser is away at a
consent screen while it exists, and a rolling restart in that window must not silently
drop every in-flight connection. And the row is tenant data: it hangs off `projects`
with `ON DELETE CASCADE`, so deleting a project takes its in-flight attempts with it,
which nothing in Redis would do for us.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncIterator, Optional
from uuid import UUID, uuid4

from sqlalchemy import delete, select, update

from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttempt,
    MCPOAuthAttemptCreate,
    MCPOAuthAttemptStatus,
)
from oss.src.core.gateways.mcps.oauth.interfaces import (
    MCPOAuthAttemptSettler,
    MCPOAuthAttemptsDAOInterface,
)
from oss.src.dbs.postgres.gateways.mcps.dbes import MCPOAuthAttemptDBE
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _to_dto(row) -> MCPOAuthAttempt:
    """Build the DTO from either an ORM instance or a RETURNING row mapping."""
    values = row if isinstance(row, dict) else dict(row._mapping)  # noqa: SLF001

    return MCPOAuthAttempt(
        id=values["id"],
        state=values["state"],
        project_id=values["project_id"],
        user_id=values["user_id"],
        endpoint_id=values["endpoint_id"],
        server_url=values["server_url"],
        issuer=values["issuer"],
        token_endpoint=values["token_endpoint"],
        redirect_uri=values["redirect_uri"],
        resource=values.get("resource"),
        code_verifier=values["code_verifier"],
        scopes=values.get("scopes") or [],
        strategy=values["strategy"],
        expires_at=values["expires_at"],
        status=values["status"],
        error=values.get("error"),
    )


def _columns(dbe) -> dict:
    return {column.name: getattr(dbe, column.name) for column in dbe.__table__.columns}


class MCPOAuthAttemptsDAO(MCPOAuthAttemptsDAOInterface):
    def __init__(
        self,
        *,
        MCPOAuthAttemptDBE: type = MCPOAuthAttemptDBE,
        engine: TransactionsEngine = None,
    ):
        self.MCPOAuthAttemptDBE = MCPOAuthAttemptDBE
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def create_attempt(
        self,
        *,
        attempt: MCPOAuthAttemptCreate,
    ) -> MCPOAuthAttempt:
        # Deliberately unsuppressed: a swallowed write here would hand the browser a
        # `state` no callback can ever resolve, and the user would only find out after
        # consenting.
        dbe = self.MCPOAuthAttemptDBE(
            id=uuid4(),
            state=attempt.state,
            project_id=attempt.project_id,
            user_id=attempt.user_id,
            endpoint_id=attempt.endpoint_id,
            server_url=attempt.server_url,
            issuer=attempt.issuer,
            token_endpoint=attempt.token_endpoint,
            redirect_uri=attempt.redirect_uri,
            resource=attempt.resource,
            code_verifier=attempt.code_verifier,
            scopes=list(attempt.scopes),
            strategy=attempt.strategy,
            expires_at=attempt.expires_at,
        )

        async with self.engine.session() as session:
            session.add(dbe)
            await session.commit()
            await session.refresh(dbe)

            return _to_dto(_columns(dbe))

    async def fetch_attempt(
        self,
        *,
        state: str,
    ) -> Optional[MCPOAuthAttempt]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(self.MCPOAuthAttemptDBE).where(
                    self.MCPOAuthAttemptDBE.state == state
                )
            )
            dbe = result.scalars().first()

            return _to_dto(_columns(dbe)) if dbe is not None else None

    async def fetch_attempt_by_id(
        self,
        *,
        project_id: UUID,
        endpoint_id: UUID,
        attempt_id: UUID,
    ) -> Optional[MCPOAuthAttempt]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(self.MCPOAuthAttemptDBE)
                .where(self.MCPOAuthAttemptDBE.id == attempt_id)
                .where(self.MCPOAuthAttemptDBE.project_id == project_id)
                .where(self.MCPOAuthAttemptDBE.endpoint_id == endpoint_id)
            )
            dbe = result.scalars().first()

            return _to_dto(_columns(dbe)) if dbe is not None else None

    async def consume_attempt(
        self,
        *,
        state: str,
    ) -> Optional[MCPOAuthAttempt]:
        # The row is locked as it is read, so two callbacks racing the same handle are
        # serialized here: the second one's read waits for the first to commit, then
        # finds the row no longer pending and gets `None`.
        async with self.engine.session() as session:
            result = await session.execute(
                select(self.MCPOAuthAttemptDBE)
                .where(self.MCPOAuthAttemptDBE.state == state)
                .where(
                    self.MCPOAuthAttemptDBE.status
                    == MCPOAuthAttemptStatus.PENDING.value
                )
                .with_for_update()
            )
            dbe = result.scalars().first()
            if dbe is None:
                return None

            claimed = _to_dto(_columns(dbe))
            dbe.status = MCPOAuthAttemptStatus.CLAIMED.value
            dbe.code_verifier = ""
            await session.commit()

            return claimed

    async def settle_attempt(
        self,
        *,
        attempt_id: UUID,
        status: MCPOAuthAttemptStatus,
        error: Optional[str] = None,
    ) -> None:
        async with self.engine.session() as session:
            await session.execute(
                update(self.MCPOAuthAttemptDBE)
                .where(self.MCPOAuthAttemptDBE.id == attempt_id)
                .where(
                    self.MCPOAuthAttemptDBE.status
                    == MCPOAuthAttemptStatus.CLAIMED.value
                )
                .values(status=status.value, error=error)
                .execution_options(synchronize_session=False)
            )
            await session.commit()

    @asynccontextmanager
    async def finalize_attempt(
        self,
        *,
        attempt_id: UUID,
    ) -> AsyncIterator[Optional[MCPOAuthAttemptSettler]]:
        # Its own connection, not the task-scoped session: the block runs DAO calls that
        # open that session and commit it on exit, which would release this lock.
        table = self.MCPOAuthAttemptDBE.__table__
        async with self.engine.transaction() as connection:
            locked = await connection.execute(
                select(table.c.id)
                .where(table.c.id == attempt_id)
                .where(table.c.status == MCPOAuthAttemptStatus.CLAIMED.value)
                .where(table.c.expires_at > datetime.now(timezone.utc))
                .with_for_update()
            )
            if locked.first() is None:
                yield None
                return

            async def settle(status: MCPOAuthAttemptStatus) -> None:
                await connection.execute(
                    update(table)
                    .where(table.c.id == attempt_id)
                    .values(status=status.value)
                )

            yield settle

    async def cancel_attempts(
        self,
        *,
        project_id: UUID,
        endpoint_id: UUID,
        attempt_id: Optional[UUID] = None,
    ) -> int:
        stmt = (
            update(self.MCPOAuthAttemptDBE)
            .where(self.MCPOAuthAttemptDBE.project_id == project_id)
            .where(self.MCPOAuthAttemptDBE.endpoint_id == endpoint_id)
            .where(
                self.MCPOAuthAttemptDBE.status.in_(
                    [
                        MCPOAuthAttemptStatus.PENDING.value,
                        MCPOAuthAttemptStatus.CLAIMED.value,
                    ]
                )
            )
        )
        if attempt_id is not None:
            stmt = stmt.where(self.MCPOAuthAttemptDBE.id == attempt_id)

        async with self.engine.session() as session:
            result = await session.execute(
                stmt.values(
                    status=MCPOAuthAttemptStatus.CANCELLED.value, code_verifier=""
                ).execution_options(synchronize_session=False)
            )
            await session.commit()

            return int(result.rowcount or 0)

    async def sweep_expired_attempts(
        self,
        *,
        now: Optional[datetime] = None,
    ) -> int:
        cutoff = now or datetime.now(timezone.utc)

        async with self.engine.session() as session:
            result = await session.execute(
                delete(self.MCPOAuthAttemptDBE)
                .where(self.MCPOAuthAttemptDBE.expires_at < cutoff)
                .execution_options(synchronize_session=False)
            )
            await session.commit()

            return int(result.rowcount or 0)
