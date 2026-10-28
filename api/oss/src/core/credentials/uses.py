"""Which person's own account each run used, per connection (M7, design D8).

Recorded when a run first uses a person's own credential for a connection, and read per
session so each turn can say which account it used. No value and no provider account
detail: the owner, the credential id and its display name at the time.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class CredentialUse(BaseModel):
    session_id: str
    run_id: str
    connection_key: str  # "<kind>:<service>", e.g. "model:openai", "mcp:notes"
    binding: str
    owner_kind: str
    owner_id: UUID
    credential_id: UUID
    credential_name: Optional[str] = None
    created_at: Optional[datetime] = None


class CredentialUsesDAOInterface(ABC):
    @abstractmethod
    async def record_use(self, *, project_id: UUID, use: CredentialUse) -> None:
        """Idempotent per (project, run, connection)."""

    @abstractmethod
    async def list_for_session(
        self, *, project_id: UUID, session_id: str
    ) -> List[CredentialUse]: ...
