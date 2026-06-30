from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import Reference, Selector, Status


class SessionInteractionKind(str, Enum):
    user_approval = "user_approval"
    user_input = "user_input"
    client_tool = "client_tool"


class SessionInteractionStatus(str, Enum):
    # Lifecycle state only — NOT the verdict (approve/deny lives in the answer content).
    pending = "pending"  # awaiting a reaction
    responded = "responded"  # reacted to via the interactions API plane
    resolved = "resolved"  # reacted to via the messages plane
    cancelled = "cancelled"  # runner abandoned the gate; no one is waiting on the token


class SessionInteractionData(BaseModel):
    request: Optional[Dict[str, Any]] = None
    references: Optional[Dict[str, Reference]] = None
    selector: Optional[Selector] = None
    resolution: Optional[Dict[str, Any]] = None


class SessionInteractionFlags(BaseModel):
    delivered_in_band: bool = False
    delivered_webhook: bool = False


class SessionInteraction(BaseModel):
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
    turn_id: Optional[str] = None
    token: str
    kind: SessionInteractionKind
    status: Optional[Status] = None
    data: Optional[SessionInteractionData] = None
    flags: SessionInteractionFlags = SessionInteractionFlags()


class SessionInteractionCreate(BaseModel):
    project_id: UUID
    session_id: str
    turn_id: Optional[str] = None
    token: str
    kind: SessionInteractionKind
    data: Optional[SessionInteractionData] = None
    flags: SessionInteractionFlags = SessionInteractionFlags()


class SessionInteractionTransition(BaseModel):
    project_id: UUID
    session_id: str
    token: str
    status: SessionInteractionStatus


class SessionInteractionQuery(BaseModel):
    session_id: Optional[str] = None
    turn_id: Optional[str] = None
    kind: Optional[SessionInteractionKind] = None
    status: Optional[SessionInteractionStatus] = None
    actionable_only: bool = False
