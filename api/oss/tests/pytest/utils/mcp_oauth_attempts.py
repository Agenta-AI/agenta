"""An in-memory `MCPOAuthAttemptsDAOInterface` for tests that need no database.

It keeps the properties the Postgres DAO is relied on for — a handle is handed to
exactly one consumer, expiry is not applied on consume — so a test that passes here and
fails against Postgres is a real disagreement, not a fixture artifact.
"""

from datetime import datetime, timezone
from typing import Dict, Optional
from uuid import uuid4

from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttempt,
    MCPOAuthAttemptCreate,
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

    async def consume_attempt(self, *, state: str) -> Optional[MCPOAuthAttempt]:
        return self.attempts.pop(state, None)

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
