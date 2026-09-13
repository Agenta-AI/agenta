"""Postgres DAO for MCP OAuth authorization attempts.

Postgres rather than Redis, for three reasons. The callback can land on any API
replica, so the record has to be visible from all of them. The browser is away at a
consent screen while it exists, and a rolling restart in that window must not silently
drop every in-flight connection. And the row is tenant data: it hangs off `projects`
with `ON DELETE CASCADE`, so deleting a project takes its in-flight attempts with it,
which nothing in Redis would do for us.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import delete, select

from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttempt,
    MCPOAuthAttemptCreate,
)
from oss.src.core.gateways.mcps.oauth.interfaces import MCPOAuthAttemptsDAOInterface
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
    )


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

            return _to_dto(
                {
                    column.name: getattr(dbe, column.name)
                    for column in self.MCPOAuthAttemptDBE.__table__.columns
                }
            )

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
            if dbe is None:
                return None

            return _to_dto(
                {
                    column.name: getattr(dbe, column.name)
                    for column in self.MCPOAuthAttemptDBE.__table__.columns
                }
            )

    async def consume_attempt(
        self,
        *,
        state: str,
    ) -> Optional[MCPOAuthAttempt]:
        # One statement, not read-then-delete: `DELETE ... RETURNING` hands the row to
        # exactly one caller, because the row is gone by the time any concurrent
        # statement can match it. Two callbacks racing the same handle therefore see
        # one success and one `None`, with no window between the read and the delete
        # for the second to slip through.
        async with self.engine.session() as session:
            stmt = (
                delete(self.MCPOAuthAttemptDBE)
                .where(self.MCPOAuthAttemptDBE.state == state)
                .returning(*self.MCPOAuthAttemptDBE.__table__.columns)
                .execution_options(synchronize_session=False)
            )

            result = await session.execute(stmt)
            row = result.fetchone()
            await session.commit()

            return _to_dto(row) if row is not None else None

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
