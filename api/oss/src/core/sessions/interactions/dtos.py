from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from oss.src.core.shared.dtos import Identifier, Lifecycle, Reference, Selector


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


class SessionInteractionRequest(BaseModel):
    # The gated call this interaction is asking about.
    #
    # `tool_call_id` is the harness's id for the call, which the row's `token` is NOT (that is the
    # permission gate's id). Both ride the live event stream, so the playground can answer without
    # it; a caller building an answer from the stored row alone cannot, and names the wrong call.
    # Optional because rows written before the field exists carry only the token.
    #
    # Extra keys are kept: producers other than the approval gate write their own request shapes
    # here, and dropping what this model does not name would lose them on any round-trip.
    model_config = ConfigDict(extra="allow")

    tool: Optional[str] = None
    args: Optional[Any] = None
    tool_call_id: Optional[str] = None


class SessionInteractionData(BaseModel):
    request: Optional[SessionInteractionRequest] = None
    references: Optional[Dict[str, Reference]] = None
    selector: Optional[Selector] = None
    resolution: Optional[Dict[str, Any]] = None
    # The effective config the gated turn was running, stamped by the runner. Replaying it as
    # the resume's `data.parameters` suppresses reference hydration and reproduces the turn
    # (tool permissions included) instead of running the referenced variant's HEAD revision.
    # Absent on rows written before this field existed; those resume via `references` alone.
    parameters: Optional[Dict[str, Any]] = None


class SessionInteractionFlags(BaseModel):
    delivered_in_band: bool = False
    delivered_webhook: bool = False


class SessionInteractionQueryFlags(BaseModel):
    delivered_in_band: Optional[bool] = None
    delivered_webhook: Optional[bool] = None


class SessionInteraction(Identifier, Lifecycle):
    project_id: Optional[UUID] = None
    session_id: str
    turn_id: Optional[str] = None
    token: str
    kind: SessionInteractionKind
    status: Optional[SessionInteractionStatus] = None
    data: Optional[SessionInteractionData] = None
    flags: SessionInteractionFlags = SessionInteractionFlags()
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class SessionInteractionCreate(BaseModel):
    project_id: UUID
    session_id: str
    turn_id: Optional[str] = None
    token: str
    kind: SessionInteractionKind
    data: Optional[SessionInteractionData] = None
    flags: SessionInteractionFlags = SessionInteractionFlags()
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class SessionInteractionTransition(BaseModel):
    project_id: UUID
    session_id: str
    token: str
    status: SessionInteractionStatus
    resolution: Optional[Dict[str, Any]] = None


class SessionInteractionQuery(BaseModel):
    session_id: Optional[str] = None
    turn_id: Optional[str] = None
    kind: Optional[SessionInteractionKind] = None
    status: Optional[SessionInteractionStatus] = None
    flags: Optional[SessionInteractionQueryFlags] = None
    actionable_only: bool = False
