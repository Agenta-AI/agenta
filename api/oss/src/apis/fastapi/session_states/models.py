from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

from oss.src.core.sessions.dtos import SessionState


class SessionStateResponse(BaseModel):
    count: int = Field(default=0)
    session_state: Optional[SessionState] = Field(default=None)


class SessionStateUpsertRequest(BaseModel):
    data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Opaque SDK SessionRecord to persist.",
    )
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id to record alongside the SDK record.",
    )


class SessionStateSandboxIdUpsertRequest(BaseModel):
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id. Pass null to clear.",
    )
