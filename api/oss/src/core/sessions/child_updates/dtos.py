from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel


class ChildTurnStatus(str, Enum):
    """The status of a child turn, in the words of the session tools. `running` is the
    still-running update; the others come from the ending or pause of one execution."""

    running = "running"
    paused = "paused"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    lost = "lost"


# `person`: a Stop, the cancel route, the kill of the session, or a person's message that
# replaced the turn. `calling_session`: the calling agent used `cancel_session`.
ChildCancelledBy = Literal["person", "calling_session"]


class ChildTurnAgent(BaseModel):
    id: UUID
    slug: Optional[str] = None
    name: Optional[str] = None


class ChildTurnRevision(BaseModel):
    id: UUID
    version: Optional[str] = None


class ChildTurnError(BaseModel):
    """The run error of a failed or lost turn: the `code` and the `message` of its
    `error` record, never its `detail`."""

    code: Optional[str] = None
    message: Optional[str] = None


class ChildTurnWaitingFor(BaseModel):
    interaction_id: Optional[str] = None
    kind: Optional[str] = None
    tool: Optional[str] = None


class ChildTurnResult(BaseModel):
    """The result shape of one child turn (design D3). The model never gets it as JSON
    when it names a turn: `render_child_turn` gives the marked form."""

    session_id: str
    agent: Optional[ChildTurnAgent] = None
    revision: Optional[ChildTurnRevision] = None
    status: ChildTurnStatus
    # The child's turn: the id of its first execution. Never an execution id.
    turn_id: Optional[str] = None
    last_message: Optional[str] = None
    is_truncated: bool = False
    cancelled_by: Optional[ChildCancelledBy] = None
    error: Optional[ChildTurnError] = None
    result_path: Optional[str] = None
    waiting_for: Optional[List[ChildTurnWaitingFor]] = None


# The key of the structured part, on the row's one message and on the stored user
# `message` record of the turn that the row started.
CHILD_UPDATE_PART_KEY = "child_update"


def child_update_part(
    *, session_id: str, turn_id: Optional[str], status: ChildTurnStatus
) -> Dict[str, Any]:
    """The one server-written structured part of a `child_update` row. The chat and the
    wait tool read only this part, and only on a row with `kind = child_update`."""
    return {"session_id": session_id, "turn_id": turn_id, "status": status.value}


def stored_child_update_part(content: Any) -> Optional[Dict[str, Any]]:
    """The part of a stored `child_update` row: at `child_update` on the last message of
    `data.inputs.messages`. None when the row holds none."""
    try:
        part = content["data"]["inputs"]["messages"][-1][CHILD_UPDATE_PART_KEY]
    except (KeyError, IndexError, TypeError):
        return None
    return dict(part) if isinstance(part, dict) else None
