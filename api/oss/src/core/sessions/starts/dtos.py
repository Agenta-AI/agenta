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
    """What `enqueue_session_input` did. `state` is `pending` when the input waits in
    the queue and `promoted` when it started a turn (or a turn already runs it), and
    `execution_id` is that turn's execution."""

    input_id: UUID
    state: PendingInputState
    execution_id: Optional[str] = None
