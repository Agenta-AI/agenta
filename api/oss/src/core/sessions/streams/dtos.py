from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from agenta.sdk.models.workflows import WorkflowServiceRequestData

from oss.src.core.shared.dtos import Header, Identifier, Lifecycle
from oss.src.core.sessions.types import SessionDelivery, SessionOrigin, SessionTrigger


class SessionStreamFlags(BaseModel):
    """The nest as primitive bools (alive ⊇ running ⊇ attached).

    resumable (alive & !running) and reattachable (running & !attached) are
    derived client-side, never stored.
    """

    is_alive: bool = False
    is_running: bool = False
    is_attached: bool = False


class SessionStreamQueryFlags(BaseModel):
    is_alive: Optional[bool] = None
    is_running: Optional[bool] = None
    is_attached: Optional[bool] = None


class SessionStream(Identifier, Header, Lifecycle):
    project_id: UUID
    session_id: str
    flags: SessionStreamFlags = SessionStreamFlags()
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    turn_id: Optional[str] = None
    # Set = archived (hidden but restorable); distinct from `deleted_at` (killed, still listed).
    archived_at: Optional[datetime] = None
    origin: Optional[SessionOrigin] = None
    trigger: Optional[SessionTrigger] = None
    delivery: Optional[SessionDelivery] = None


class SessionStreamReadOptions(BaseModel):
    include_trigger_details: bool = False


class SessionStreamQueryResult(BaseModel):
    stream: SessionStream
    trigger_name: Optional[str] = None


class SessionStreamCreate(Header):
    session_id: str
    flags: Optional[SessionStreamFlags] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    turn_id: Optional[str] = None


class SessionStreamEdit(Header):
    flags: Optional[SessionStreamFlags] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    turn_id: Optional[str] = None


class SessionStreamHeaderEdit(Header):
    """The rename edit: a full-PUT of the header fields only.

    Distinct from SessionStreamEdit (used by the flag-mirror/heartbeat paths) so the
    liveness-only writes can never carry name/description, and vice versa.

    ``name`` may be omitted/``None`` (no change) or an empty string (the explicit
    clear-title action the chat rail's rename path uses), but a NON-empty name must
    contain a non-whitespace character: storing ``"   "`` clears the visible title
    while the row still holds a value, a state no caller ever means. The LLM-facing
    ``rename_session`` schema already rejects both; this closes the direct-API hole.
    """

    @field_validator("name")
    @classmethod
    def _non_empty_name_must_not_be_blank(cls, value: Optional[str]) -> Optional[str]:
        if value and not value.strip():
            raise ValueError(
                "name must contain a non-whitespace character"
                " (send an empty string to clear the title)"
            )
        return value


class SessionStreamQuery(BaseModel):
    session_id: Optional[str] = None
    flags: Optional[SessionStreamQueryFlags] = None
    # Include ended (killed → soft-deleted) rows so a durable list shows resumable history, not
    # just live sessions. Their `deleted_at` is populated for the caller to mark them ended.
    include_ended: bool = False
    # Include archived (deliberately-hidden) rows — off by default so archive hides; on for the
    # archived view. Orthogonal to `include_ended` (a row can be killed OR archived).
    include_archived: bool = False
    # Case-insensitive substring match over `name` (the session title).
    search: Optional[str] = None
    # jsonb containment against the row's `tags` — carries the origin filter.
    tags: Optional[Dict[str, Any]] = None
    # Its negation. A row with NULL tags PASSES: absence of a stamp is not a match.
    exclude_tags: Optional[Dict[str, Any]] = None
    origins: Optional[list[SessionOrigin]] = None
    exclude_origins: Optional[list[SessionOrigin]] = None


class CommandMode(str, Enum):
    """Derived from the inputs/data × force matrix."""

    send = "send"  # inputs + no force → 409 if alive
    steer = "steer"  # inputs + force → cancel holder, run new
    cancel = "cancel"  # no inputs + no force → cancel holder
    attach = "attach"  # no inputs + force → steal attached, watch


class SessionStreamCommandRequest(BaseModel):
    """The set_session_stream edit: a state mutation over the lock/row nest.

    Runs nothing itself — the runner (execution plane) is the only thing that runs.
    `data` mirrors the workflow-invoke shape (`WorkflowServiceRequestData`, keyed on
    `.inputs`) so the discriminator aligns with `WorkflowInvokeRequest.data.inputs`
    rather than a bespoke `prompt` string.
    """

    session_id: str
    data: Optional[WorkflowServiceRequestData] = None
    force: bool = False
    detached: bool = False  # fire-and-forget mode


class SessionStreamCommandResponse(BaseModel):
    mode: CommandMode
    session_id: str
    turn_id: Optional[str] = None
    watcher_id: Optional[str] = None
    detached: bool = False


class SessionHeartbeatRequest(BaseModel):
    session_id: str
    replica_id: str = Field(min_length=1)  # the runner CONTAINER (affinity / owner key)
    turn_id: Optional[str] = None  # the current TURN (proves alive-lock ownership)
    is_running: bool = True


class SessionLiveness(BaseModel):
    alive: bool
    running: bool
    attached: bool


class SessionHeartbeatResult(BaseModel):
    """A heartbeat's outcome: the reconciled stream plus the session's actual owner replica.

    `replica_id` is the replica that currently holds the affinity key after the claim
    (this caller if it won or already held it, another replica otherwise). The runner reads
    it to refuse serving a local sandbox session it does not own.

    `stream` is None when a losing replica heartbeats a session that has no row yet: it may
    not create or stamp one, since that row belongs to the owner.

    `is_current_turn` (W7.4) is False when this turn_id's alive/running lock was gone or
    reassigned at the moment of this beat — i.e. a cancel/steer/kill interrupted this turn
    since the last heartbeat. The runner's watchdog reads this to abort the in-flight run;
    without it a cancel that raced a heartbeat's nx=True re-acquire would silently re-arm the
    SAME lock under the SAME turn_id and the interruption would never surface.
    """

    stream: Optional[SessionStream] = None
    replica_id: str
    is_current_turn: bool = True
