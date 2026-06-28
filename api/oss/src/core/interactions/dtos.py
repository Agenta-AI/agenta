from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import Reference, Selector, Status


class InteractionKind(str, Enum):
    user_approval = "user_approval"
    user_input = "user_input"
    tool_call = "tool_call"


class InteractionStatus(str, Enum):
    pending = "pending"
    resolved = "resolved"
    denied = "denied"
    cancelled = "cancelled"


class InteractionData(BaseModel):
    request: Optional[Dict[str, Any]] = None
    references: Optional[Dict[str, Reference]] = None
    selector: Optional[Selector] = None
    resolution: Optional[Dict[str, Any]] = None


class InteractionFlags(BaseModel):
    delivered_in_band: bool = False
    delivered_webhook: bool = False


class Interaction(BaseModel):
    id: Optional[UUID] = None
    #
    created_at: Optional[Any] = None
    updated_at: Optional[Any] = None
    deleted_at: Optional[Any] = None
    created_by_id: Optional[UUID] = None
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None
    #
    project_id: Optional[UUID] = None
    session_id: str
    run_id: Optional[str] = None
    token: str
    kind: InteractionKind
    status: Optional[Status] = None
    data: Optional[InteractionData] = None
    flags: InteractionFlags = InteractionFlags()


class InteractionCreate(BaseModel):
    project_id: UUID
    session_id: str
    run_id: Optional[str] = None
    token: str
    kind: InteractionKind
    data: Optional[InteractionData] = None
    flags: InteractionFlags = InteractionFlags()


class InteractionTransition(BaseModel):
    project_id: UUID
    session_id: str
    token: str
    status: InteractionStatus


class InteractionQuery(BaseModel):
    session_id: Optional[str] = None
    run_id: Optional[str] = None
    kind: Optional[InteractionKind] = None
    status: Optional[InteractionStatus] = None
    actionable_only: bool = False
