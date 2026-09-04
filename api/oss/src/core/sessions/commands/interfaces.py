"""The two ports of the session commands plane.

`SessionCommandsDAOInterface` is storage. `ControlDeliveryPort` is transport: how the API
reaches whichever runner process holds a session. Durability, authorization, idempotency, the
state machine and terminal settlement live in the service and must not move into an adapter.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, NamedTuple, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandSettle,
)


class SessionScope(BaseModel):
    """One session a runner holds warm. The routing input of a claim."""

    project_id: UUID
    session_id: str


class CommandCreateResult(NamedTuple):
    """The stored command and whether this call inserted it."""

    command: SessionCommand
    inserted: bool


class DeliveryReceipt(BaseModel):
    """What the TRANSPORT learned, never what happened to the execution.

    * `accepted` — a runner took the command and will report through the outcome route.
    * `unreachable` — the transport failed. The command is durable, so a later claim or the
      settlement sweep recovers it.
    * `not_held` — a reachable runner said it does not hold that session, which lets the
      service settle at once instead of waiting for the deadline.
    """

    status: str  # "accepted" | "unreachable" | "not_held"
    detail: Optional[str] = None
    # Which runner process took it, when the transport learned that. The service uses it as the
    # claim owner, so the outcome route's guard reads the same way on every transport.
    replica_id: Optional[str] = None


class ControlDeliveryPort(ABC):
    """How the API reaches the runner that holds a session. Transport only."""

    @abstractmethod
    async def deliver(self, *, command: SessionCommand) -> DeliveryReceipt:
        """Make `command` reachable by whoever holds its session, promptly.

        Best effort: a failure here never fails admission, because the command is already
        durable.
        """

    @abstractmethod
    async def acknowledge(self, *, command_id: UUID, replica_id: str) -> None:
        """Record that a replica took the command, for adapters that keep their own delivery
        bookkeeping. A no-op where the claim compare-and-set already IS the acknowledgement."""


class SessionCommandsDAOInterface(ABC):
    @abstractmethod
    async def create_command(
        self,
        *,
        user_id: Optional[UUID],
        command: SessionCommandCreate,
        stopping_turn_id: Optional[str] = None,
    ) -> SessionCommand:
        """Insert one command and, in the SAME transaction, stamp the session row's
        `stopping_turn_id`. Idempotent on `(project_id, session_id, idempotency_key)`."""

    @abstractmethod
    async def create_command_with_status(
        self,
        *,
        user_id: Optional[UUID],
        command: SessionCommandCreate,
        stopping_turn_id: Optional[str] = None,
    ) -> CommandCreateResult:
        """Create a command and report whether this call inserted it."""

    @abstractmethod
    async def fetch_by_idempotency_key(
        self,
        *,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
    ) -> Optional[SessionCommand]:
        """The command previously created for this session-scoped retry key."""

    @abstractmethod
    async def fetch_open_command(
        self,
        *,
        project_id: UUID,
        session_id: str,
        kind: SessionCommandKind,
        target_turn_id: Optional[str],
    ) -> Optional[SessionCommand]:
        """The open (`pending` or `claimed`) command for this exact target, if one exists.
        This is what collapses two Stops in a row onto one command."""

    @abstractmethod
    async def fetch_command(
        self,
        *,
        command_id: UUID,
        project_id: Optional[UUID] = None,
    ) -> Optional[SessionCommand]:
        """One command by id. `project_id` is optional because the runner reports an outcome
        with the command id alone and holds no project credential."""

    @abstractmethod
    async def claim_commands(
        self,
        *,
        sessions: List[SessionScope],
        replica_id: str,
        lease_seconds: int,
        limit: int,
    ) -> List[SessionCommand]:
        """Take up to `limit` pending commands for these sessions. Compare-and-set, so two API
        replicas serving two claims at once never hand out the same command twice."""

    @abstractmethod
    async def claim_for_delivery(
        self,
        *,
        project_id: UUID,
        command_id: UUID,
        replica_id: str,
        lease_seconds: int,
    ) -> Optional[SessionCommand]:
        """Move ONE command from `pending` to `claimed` for a runner that just accepted it over
        a direct call. The long-poll adapter reaches the same transition through
        `claim_commands`; both exist so the outcome route's guard reads the same either way."""

    @abstractmethod
    async def settle_command(
        self,
        *,
        settle: SessionCommandSettle,
    ) -> Optional[SessionCommand]:
        """Terminal transition, guarded on `state='claimed' AND claimed_by=:replica_id`.
        None means the claim had expired or somebody else settled it first."""

    @abstractmethod
    async def clear_stopping_turn(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: Optional[str] = None,
    ) -> None:
        """Clear `session_streams.stopping_turn_id`. With `turn_id`, only when it matches, so a
        late settlement cannot clear a NEWER Stop's marker."""

    @abstractmethod
    async def expire_claims(
        self,
        *,
        now: datetime,
        max_deliveries: int,
    ) -> List[SessionCommand]:
        """Commands whose claim lease has passed. The settlement sweep reads this. Not called
        in this slice; the execution watchdog owns settlement (see the slice document)."""
