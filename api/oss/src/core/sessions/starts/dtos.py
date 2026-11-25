from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.sessions.inputs.dtos import PendingInputState


class SessionStartResult(BaseModel):
    session_id: str
    execution_id: str
    input_id: UUID
    replayed: bool


class SessionInputEnqueueResult(BaseModel):
    """What `enqueue_session_input` did. `state` is the row's stored queue state:
    `pending` while it waits, `promoted` once an execution id is assigned to it, or
    `removed` for a repeat of a key whose row a person removed. `execution_id` is the
    assigned execution id; a replay can return it before that turn has started."""

    input_id: UUID
    state: PendingInputState
    execution_id: Optional[str] = None
