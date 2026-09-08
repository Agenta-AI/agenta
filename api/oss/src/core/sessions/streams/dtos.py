from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from agenta.sdk.models.workflows import WorkflowServiceRequestData

from oss.src.core.shared.dtos import Header, Identifier, Lifecycle
from oss.src.core.sessions.types import (
    SessionDelivery,
    SessionOrigin,
    SessionReference,
    SessionTrigger,
)


class SessionHeaderAuthor(str, Enum):
    """Who chose the name a header edit carries.

    ``user`` is a person typing a name, and it is the default: an unmarked caller (a
    script, an older SDK) is treated as a person, which is the safe reading because a
    person's name is the one this distinction exists to protect. ``auto`` is a name a
    program proposed — the agent's own ``rename_session``, or the browser's auto-title
    from a first message.

    It travels as a query parameter, never in the body, so a model cannot claim to be a
    person: the ``rename_session`` catalog entry fixes ``author=auto`` inside its path and
    the model only ever fills the body.
    """

    user = "user"
    auto = "auto"


# Who chose the session's CURRENT name. Stamped "user" by a header edit a person authored,
# and removed by an automatic one, so the row always answers "did a person type this name?".
# A reserved tag rather than a column: it needs no migration, it is stripped from every client
# read by the streams mapper, and no live writer sends `tags` on the flag-mirror edit, so a
# heartbeat cannot erase it.
SESSION_NAME_AUTHOR_TAG_KEY = "ag.name.author"


def name_author_tags(
    *,
    author: SessionHeaderAuthor,
    name: Optional[str],
    tags: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """`tags` with the name-author stamp brought in line with an edit that sets `name`.

    Returns the tags unchanged when the edit sets no name, because an edit that changes only
    the description leaves the question "who named this session?" alone. A person's name is
    stamped; an automatic name, and a cleared name, remove the stamp — an automatic name is
    exactly the thing the guard must let the next automatic caller replace.
    """
    if name is None:
        return tags
    current = dict(tags) if isinstance(tags, dict) else {}
    if author is SessionHeaderAuthor.user and name.strip():
        current[SESSION_NAME_AUTHOR_TAG_KEY] = SessionHeaderAuthor.user.value
    else:
        current.pop(SESSION_NAME_AUTHOR_TAG_KEY, None)
    return current or None


def decode_name_author(
    tags: Optional[Dict[str, Any]],
) -> Optional[SessionHeaderAuthor]:
    """The stamped author of the row's current name, or None when nothing stamped it.

    A junk value reads as None rather than raising: this decides how a rename behaves, and a
    row nobody can parse must not make every read of the session fail.
    """
    if not isinstance(tags, dict):
        return None
    try:
        return SessionHeaderAuthor(tags.get(SESSION_NAME_AUTHOR_TAG_KEY))
    except (TypeError, ValueError):
        return None


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


class SessionCapabilities(BaseModel):
    shared_reader: bool = Field(
        default=False,
        description="Deployment-wide shared-reader switch; version one has no project allowlist.",
    )


class SessionStream(Identifier, Header, Lifecycle):
    project_id: UUID
    session_id: str
    flags: SessionStreamFlags = SessionStreamFlags()
    capabilities: SessionCapabilities = SessionCapabilities()
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    turn_id: Optional[str] = None
    # When `turn_id` started. Stamped only when the id changes, so repeated heartbeats never
    # move it. The stale-Stop guard compares a cancel request's arrival time against this.
    turn_started_at: Optional[datetime] = None
    # The execution an accepted Stop is waiting on. Null when nothing is stopping.
    stopping_turn_id: Optional[str] = None
    # What this session runs. Filled once, from the first beat that knows — turn appends
    # are fire-and-forget, so a session whose only reference carrier was a dropped append
    # is unopenable forever.
    references: Optional[List[SessionReference]] = None
    # Set = archived (hidden but restorable); distinct from `deleted_at` (killed, still listed).
    archived_at: Optional[datetime] = None
    origin: Optional[SessionOrigin] = None
    trigger: Optional[SessionTrigger] = None
    delivery: Optional[SessionDelivery] = None
    # Who chose `name`, decoded from the reserved tag the header edit stamps. Read by the
    # rename guard, which is why it rides on the row a caller already fetches rather than
    # needing a second read. Null on every row written before the stamp existed.
    name_author: Optional[SessionHeaderAuthor] = None


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
    references: Optional[List[SessionReference]] = None


class SessionStreamEdit(Header):
    flags: Optional[SessionStreamFlags] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    turn_id: Optional[str] = None
    # Internal heartbeat fence. When present, the DAO updates only this still-current,
    # non-terminal execution generation. Excluded from serialization because it is a write
    # precondition, not stream state.
    expected_turn_id: Optional[str] = Field(default=None, exclude=True)


class SessionStreamHeaderEdit(Header):
    """The rename edit: a full-PUT of the header fields only.

    Distinct from SessionStreamEdit (used by the flag-mirror/heartbeat paths) so the
    liveness-only writes can never carry name/description, and vice versa. The one
    other header writer is the heartbeat's fill-once proposal, which goes through the
    DAO's NULL-guarded `fill_missing` and so cannot overwrite this edit.

    ``name`` may be omitted/``None`` (no change) or an empty string (the explicit
    clear-title action the chat rail's rename path uses), but a NON-empty name must
    contain a non-whitespace character: storing ``"   "`` clears the visible title
    while the row still holds a value, a state no caller ever means. The LLM-facing
    ``rename_session`` schema already rejects both; this closes the direct-API hole.
    """

    # Set by a caller whose name a person asked for, so an `auto` edit may replace a name
    # that person typed. Body-carried on purpose: this one IS the model's decision to make,
    # unlike `author`. Defaults false, so a stale replay never gets past the guard by
    # accident.
    override_user_name: bool = False

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
    # Restrict to archived rows. Wins over `include_archived` — this is the archived VIEW, not a
    # widening of the active one.
    archived_only: bool = False
    # Case-insensitive substring match over `name` (the session title).
    search: Optional[str] = None
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
    # A stale-request guard for cancel mode only; send, steer, and attach ignore it.
    expected_execution_id: Optional[str] = Field(
        default=None,
        description=(
            "Optional stale-request guard honored only in cancel mode; ignored for send, "
            "steer, and attach."
        ),
    )

    @field_validator("expected_execution_id")
    @classmethod
    def _blank_expected_execution_id_means_absent(
        cls, value: Optional[str]
    ) -> Optional[str]:
        if value is None:
            return None
        return value.strip() or None

    # Cancel guard (RFC D-010). Public name; internally this IS a turn id — the coordination
    # plane's word for one execution of a session. The RFC calls it an execution id, so the
    # public DTO keeps that name and the service maps it onto `turn_id` at the boundary.
    # Optional by decision: external callers may cancel blind. When present, cancel touches
    # that turn or nothing.
    expected_execution_id: Optional[str] = None

    @field_validator("expected_execution_id")
    @classmethod
    def _blank_expected_execution_id_means_absent(
        cls, value: Optional[str]
    ) -> Optional[str]:
        """A whitespace-only guard is a client bug, not a request to cancel a turn named "".

        Reading it as "no guard" is the safe failure: the caller falls back to the arrival-time
        check instead of matching a turn id nothing can hold.
        """
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None


class SessionStreamCommandResponse(BaseModel):
    mode: CommandMode
    session_id: str
    turn_id: Optional[str] = None
    watcher_id: Optional[str] = None
    detached: bool = False
    # Cancel only: every turn this cancel tombstoned. Usually one. It is a list because
    # `alive` and `running` can be held by different turns during a handover, and both die.
    cancelled_turn_ids: List[str] = Field(default_factory=list)


class SessionHeartbeatRequest(BaseModel):
    """A beat, plus what this run knows about the session that nothing else records.

    ``name`` and ``references`` are PROPOSALS, not edits: the service writes each only
    onto a NULL column (see `SessionStreamsService.heartbeat`). The runner is the only
    component present on every execution path — browser, headless invoke, scheduled
    trigger — so it is the only one that can title and attribute a session that no
    browser will ever render.
    """

    session_id: str
    replica_id: str = Field(min_length=1)  # the runner CONTAINER (affinity / owner key)
    turn_id: Optional[str] = None  # the current TURN (proves alive-lock ownership)
    is_running: bool = True
    name: Optional[str] = None
    references: Optional[List[SessionReference]] = None
    # The INVERSE beat, sent once per session as a runner shuts down: hand the affinity key
    # back instead of renewing it. `claim_owner` never steals, so a replica that dies still
    # holding `owner:session:<id>` locks the session out of every other replica for the rest
    # of OWNER_TTL_SECONDS — a local-provider session then refuses every message until the
    # lease expires. The release is conditional on still being the owner, so it can never
    # take a session from a live replica. Everything else about the beat is skipped: a
    # departing runner asserts no liveness and no turn.
    release_owner: bool = False


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
