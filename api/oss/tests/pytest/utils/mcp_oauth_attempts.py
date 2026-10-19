"""An in-memory `MCPOAuthAttemptsDAOInterface` for tests that need no database.

It keeps the properties the Postgres DAO is relied on for — a handle is handed to
exactly one consumer, expiry is not applied on consume, a consumed row stays with its
outcome — so a test that passes here and
fails against Postgres is a real disagreement, not a fixture artifact.
"""

from datetime import datetime, timezone
from typing import Dict, Optional
from uuid import uuid4

from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttempt,
    MCPOAuthAttemptCreate,
    MCPOAuthAttemptStatus,
)
from oss.src.core.gateways.mcps.oauth.interfaces import MCPOAuthAttemptsDAOInterface


class InMemoryMCPOAuthAttemptsDAO(MCPOAuthAttemptsDAOInterface):
    def __init__(self) -> None:
        self.attempts: Dict[str, MCPOAuthAttempt] = {}

    async def create_attempt(
        self,
        *,
        attempt: MCPOAuthAttemptCreate,
    ) -> MCPOAuthAttempt:
        record = MCPOAuthAttempt(id=uuid4(), **attempt.model_dump())
        self.attempts[record.state] = record

        return record

    async def fetch_attempt(self, *, state: str) -> Optional[MCPOAuthAttempt]:
        return self.attempts.get(state)

    async def fetch_attempt_by_id(
        self,
        *,
        project_id,
        endpoint_id,
        attempt_id,
    ) -> Optional[MCPOAuthAttempt]:
        for record in self.attempts.values():
            if (
                record.id == attempt_id
                and record.project_id == project_id
                and record.endpoint_id == endpoint_id
            ):
                return record
        return None

    async def consume_attempt(self, *, state: str) -> Optional[MCPOAuthAttempt]:
        record = self.attempts.get(state)
        if record is None or record.status != MCPOAuthAttemptStatus.PENDING:
            return None
        self.attempts[state] = record.model_copy(
            update={"status": MCPOAuthAttemptStatus.CLAIMED, "code_verifier": ""}
        )
        return record

    async def settle_attempt(self, *, attempt_id, status, error=None) -> None:
        for state, record in self.attempts.items():
            if (
                record.id == attempt_id
                and record.status == MCPOAuthAttemptStatus.CLAIMED
            ):
                self.attempts[state] = record.model_copy(
                    update={"status": status, "error": error}
                )

    async def cancel_attempts(
        self,
        *,
        project_id,
        endpoint_id,
        attempt_id=None,
    ) -> int:
        cancelled = [
            state
            for state, record in self.attempts.items()
            if record.project_id == project_id
            and record.endpoint_id == endpoint_id
            and record.status
            in (MCPOAuthAttemptStatus.PENDING, MCPOAuthAttemptStatus.CLAIMED)
            and (attempt_id is None or record.id == attempt_id)
        ]
        for state in cancelled:
            self.attempts[state] = self.attempts[state].model_copy(
                update={
                    "status": MCPOAuthAttemptStatus.CANCELLED,
                    "code_verifier": "",
                }
            )

        return len(cancelled)

    async def has_active_attempts(self, *, project_id, endpoint_id) -> bool:
        return any(
            record.project_id == project_id
            and record.endpoint_id == endpoint_id
            and record.status
            in (MCPOAuthAttemptStatus.PENDING, MCPOAuthAttemptStatus.CLAIMED)
            and record.expires_at > datetime.now(timezone.utc)
            for record in self.attempts.values()
        )

    async def sweep_expired_attempts(
        self,
        *,
        now: Optional[datetime] = None,
    ) -> int:
        cutoff = now or datetime.now(timezone.utc)
        expired = [
            state
            for state, record in self.attempts.items()
            if record.expires_at < cutoff
        ]
        for state in expired:
            del self.attempts[state]

        return len(expired)
