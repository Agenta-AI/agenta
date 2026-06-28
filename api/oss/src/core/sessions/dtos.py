from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import Lifecycle


class SessionState(Lifecycle):
    id: Optional[UUID] = Field(default=None, description="Own uuid7 pk (state_id).")
    project_id: Optional[UUID] = Field(default=None)
    session_id: str = Field(description="Bare session correlator (not an FK).")
    data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Opaque SDK SessionRecord stored as JSON.",
    )
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id — the single source of truth resume pointer.",
    )


class SessionStateUpsert(BaseModel):
    data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="SDK SessionRecord to persist opaquely.",
    )
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id to record alongside the SDK record.",
    )


class SessionStateSandboxIdUpsert(BaseModel):
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id. Pass null to clear.",
    )
