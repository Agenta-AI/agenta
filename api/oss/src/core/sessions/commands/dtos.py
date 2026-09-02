"""Durable session commands — the data shapes.

A command is one durable request to change an execution. Version one has one kind, `cancel`,
which the product calls Stop.

Two ideas are kept apart on purpose, and the separation is the point of the whole record:

  * `state` says where the COMMAND is in its delivery (pending, claimed, applied, obsolete).
  * `outcome` says what happened to the EXECUTION (stopped, not_running, ...).

A client that draws a Stop button reads the execution; a client that retries safely reads the
command id. Merging them is what makes today's cancel ambiguous.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import Identifier, Lifecycle


class SessionCommandKind(str, Enum):
    cancel = "cancel"


class SessionCommandState(str, Enum):
    """Where the command is in its delivery. `applied` and `obsolete` are terminal."""

    pending = "pending"  # durable, not yet taken by a runner
    claimed = "claimed"  # a runner holds a lease on it
    applied = "applied"  # the runner did the work and reported
    obsolete = "obsolete"  # there was nothing to do, or nobody could ever do it


class SessionCommandOutcome(str, Enum):
    """What happened to the targeted execution. Null while the command is open."""

    stopped = "stopped"  # cancelled as asked
    not_running = "not_running"  # no such execution anywhere
    superseded_by_newer_turn = (
        "superseded_by_newer_turn"  # a later turn holds the session
    )
    failed = "failed"  # the cancel itself failed
    lost = "lost"  # nobody ever reported; the sweep settled it


class SessionCommand(Identifier, Lifecycle):
    project_id: UUID
    session_id: str
    kind: SessionCommandKind

    # The execution the API resolved at admission and pinned. Null when nothing ran.
    target_turn_id: Optional[str] = None
    # The execution the caller asserted was running, stored exactly as sent. Null when none.
    expected_turn_id: Optional[str] = None

    # The command's own arguments. Empty for `cancel`; reserved for steer and queue.
    data: Optional[Dict[str, Any]] = None

    state: SessionCommandState
    claimed_by: Optional[str] = None
    claim_expires_at: Optional[datetime] = None
    claim_count: int = 0

    outcome: Optional[SessionCommandOutcome] = None
    idempotency_key: Optional[str] = None
    settled_at: Optional[datetime] = None

    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class SessionCommandCreate(BaseModel):
    """One insert. `state`/`outcome`/`settled_at` are carried because admission can insert a
    command that is ALREADY settled (nothing was running, or a newer turn took the session),
    and that must be one write, not an insert followed by an update."""

    project_id: UUID
    session_id: str
    kind: SessionCommandKind = SessionCommandKind.cancel

    target_turn_id: Optional[str] = None
    expected_turn_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

    state: SessionCommandState = SessionCommandState.pending
    outcome: Optional[SessionCommandOutcome] = None
    settled_at: Optional[datetime] = None

    idempotency_key: Optional[str] = None

    # The instant the service stamped as the request's arrival. It is stored as `created_at`
    # rather than left to the server default, so the value the stale-Stop guard COMPARED is the
    # value the row CARRIES. A guard that compares one timestamp and stores another is not a
    # guard the runner can repeat.
    created_at: Optional[datetime] = None


class SessionCommandSettle(BaseModel):
    """The terminal transition, guarded on the state the caller expects to find.

    `replica_id` guards a settlement that follows a claim: only the replica that holds the
    claim may write the outcome. It is None when the API itself settles a command nobody ever
    took, which is the `not_held` case and the sweep's `lost` case.
    """

    project_id: UUID
    command_id: UUID
    state: SessionCommandState
    outcome: SessionCommandOutcome
    expected_state: SessionCommandState = SessionCommandState.claimed
    replica_id: Optional[str] = None
