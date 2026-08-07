from abc import ABC, abstractmethod
from typing import List, Optional, Tuple
from uuid import UUID

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentCreate,
    ChannelAgentEdit,
    ChannelAgentQuery,
    ChannelDeliveryState,
    ChannelGrant,
    ChannelGrantCreate,
    ChannelGrantEdit,
    ChannelGrantQuery,
    ChannelInboxEvent,
    ChannelInboxEventCreate,
    ChannelInboxEventQuery,
    ChannelInboxTrigger,
    ChannelInboxTriggerCreate,
    ChannelInboxTriggerQuery,
    ChannelOutboxEvent,
    ChannelOutboxEventCreate,
    ChannelOutboxEventData,
    ChannelOutboxEventQuery,
    ChannelSpace,
    ChannelSpaceCreate,
    ChannelSpaceEdit,
    ChannelSpaceQuery,
    ChannelThread,
    ChannelThreadCreate,
    ChannelThreadQuery,
    ChannelTriggerState,
)
from oss.src.core.shared.dtos import Status, Windowing


class ChannelsDAOInterface(ABC):
    """Persistence contract for the channels domain."""

    # --- agents ------------------------------------------------------------- #

    @abstractmethod
    async def create_agent(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent: ChannelAgentCreate,
    ) -> ChannelAgent: ...

    @abstractmethod
    async def fetch_agent(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> Optional[ChannelAgent]: ...

    @abstractmethod
    async def fetch_agent_by_slug(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        slug: str,
    ) -> Optional[ChannelAgent]:
        """Resolve the sigil. Backed by uq_channel_agents_connection_slug."""
        ...

    @abstractmethod
    async def fetch_default_agent(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Optional[ChannelAgent]:
        """The connection-wide fallback — the last step of the chain (§2.5).

        Backed by the partial unique index on flags->>'is_default', so this
        returns at most one row by construction rather than by LIMIT 1.
        """
        ...

    @abstractmethod
    async def edit_agent(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent: ChannelAgentEdit,
    ) -> Optional[ChannelAgent]: ...

    @abstractmethod
    async def delete_agent(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_agents(
        self,
        *,
        project_id: UUID,
        #
        agent: Optional[ChannelAgentQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelAgent]: ...

    # --- spaces ------------------------------------------------------------- #

    @abstractmethod
    async def create_space(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        space: ChannelSpaceCreate,
    ) -> ChannelSpace: ...

    @abstractmethod
    async def fetch_space(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelSpace]: ...

    @abstractmethod
    async def fetch_space_by_key(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        external_key: UUID,
    ) -> Optional[ChannelSpace]:
        """The routing lookup — default-deny, so None means "not configured here".

        This is the whole reason external_key is a column rather than living
        inside the locator (§2.2): the unique constraint serves this read.
        """
        ...

    @abstractmethod
    async def edit_space(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        space: ChannelSpaceEdit,
    ) -> Optional[ChannelSpace]: ...

    @abstractmethod
    async def delete_space(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_spaces(
        self,
        *,
        project_id: UUID,
        #
        space: Optional[ChannelSpaceQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelSpace]: ...

    @abstractmethod
    async def mark_space_backfilled(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelSpace]:
        """Set flags.is_backfilled after the one-time history fetch (§2.4).

        Separate from edit_space because the writer is a worker, not a person:
        an operator editing a space must not be able to clear this and trigger a
        refetch, and this write must not clobber a concurrent operator edit.
        """
        ...

    # --- grants ------------------------------------------------------------- #

    @abstractmethod
    async def create_grant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        grant: ChannelGrantCreate,
    ) -> ChannelGrant: ...

    @abstractmethod
    async def fetch_grant(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
        space_id: UUID,
    ) -> Optional[ChannelGrant]:
        """The pair lookup, for policy resolution. Backed by the unique constraint."""
        ...

    @abstractmethod
    async def fetch_default_grant(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelGrant]:
        """The space's default agent — the middle step of the chain (§2.5)."""
        ...

    @abstractmethod
    async def edit_grant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        grant: ChannelGrantEdit,
    ) -> Optional[ChannelGrant]: ...

    @abstractmethod
    async def delete_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_grants(
        self,
        *,
        project_id: UUID,
        #
        grant: Optional[ChannelGrantQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelGrant]: ...

    @abstractmethod
    async def count_grants(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> int:
        """Does this agent have ANY grant? Zero means unrestricted (§1).

        A count rather than a query because the service only needs the
        predicate, and an agent granted in five hundred spaces should not load
        five hundred rows to answer it.
        """
        ...

    # --- threads ------------------------------------------------------------ #

    @abstractmethod
    async def create_thread(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        thread: ChannelThreadCreate,
    ) -> ChannelThread: ...

    @abstractmethod
    async def fetch_current_thread(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
        external_key: Optional[UUID],
        agent_id: UUID,
    ) -> Optional[ChannelThread]:
        """The most recent thread row for this (space, key, agent) triple.

        `ORDER BY created_at DESC LIMIT 1` — the table is append-only and the
        latest row wins (D12), so there is deliberately no unique constraint to
        read against (§3). `external_key` is None when the scope is the space.
        """
        ...

    @abstractmethod
    async def query_threads(
        self,
        *,
        project_id: UUID,
        #
        thread: Optional[ChannelThreadQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelThread]: ...

    @abstractmethod
    async def close_thread(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        thread_id: UUID,
    ) -> Optional[ChannelThread]:
        """Flip flags.is_active on THIS row, in place — never inserts (D12).

        GAP NOTE (flagged per WP1's brief): entities.md §8 assigns
        ChannelsService.close_thread a real WP1 implementation, but the frozen
        §7 method list has no write path over an existing thread row — threads
        are append-only and get no edit_thread. Added minimally, mirroring
        transition_inbox_trigger's "update in place by id, never insert" shape,
        so close_thread is not left calling a route that does not exist. Flag
        at the WP1→WP2/WP3 checkpoint if this should move or be renamed.
        """
        ...

    # --- inbox: the log ----------------------------------------------------- #

    @abstractmethod
    async def record_inbox_event(
        self,
        *,
        project_id: UUID,
        #
        event: ChannelInboxEventCreate,
    ) -> Optional[ChannelInboxEvent]:
        """Append to the log. Returns None if already recorded.

        `INSERT ... ON CONFLICT (project_id, connection_id, external_id) DO
        NOTHING ... RETURNING`. None is the dedup contract, not an error: the
        platform redelivered and the caller must not invoke again. Same shape as
        `claim_delivery` in triggers.
        """
        ...

    @abstractmethod
    async def record_inbox_events(
        self,
        *,
        project_id: UUID,
        #
        events: List[ChannelInboxEventCreate],
    ) -> List[ChannelInboxEvent]:
        """Bulk append for backfill — one statement, so `id` order is fetch order.

        This is what makes `origin` sufficient for ordering (§2.4): the batch is
        written in one pass, in the order the platform returned it.
        """
        ...

    @abstractmethod
    async def attach_space(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
        space_id: UUID,
    ) -> Optional[ChannelInboxEvent]:
        """Set space_id once the event is routed — it is null on arrival (§2)."""
        ...

    @abstractmethod
    async def query_events_since(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
        after_event_id: Optional[UUID],
        #
        limit: Optional[int] = None,
    ) -> List[ChannelInboxEvent]:
        """The backlog read — D21's drain as a range query (§2.4).

        `WHERE (origin, id) > (PUSHED, :after_event_id) ORDER BY origin, id`, or
        the whole log when `after_event_id` is None (a thread nobody has
        addressed yet, which reads as "from the beginning"). Consumes nothing and
        claims nothing: two threads can read the same range concurrently.
        """
        ...

    @abstractmethod
    async def query_inbox_events(
        self,
        *,
        project_id: UUID,
        #
        event: Optional[ChannelInboxEventQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelInboxEvent]: ...

    # --- inbox: the offsets ------------------------------------------------- #

    @abstractmethod
    async def fetch_latest_trigger(
        self,
        *,
        project_id: UUID,
        #
        thread_id: UUID,
    ) -> Optional[ChannelInboxTrigger]:
        """This agent's consumer offset — `ORDER BY id DESC LIMIT 1` (D26).

        None means never addressed, which is the case that triggers backfill.
        """
        ...

    @abstractmethod
    async def record_inbox_trigger(
        self,
        *,
        project_id: UUID,
        #
        trigger: ChannelInboxTriggerCreate,
    ) -> Optional[ChannelInboxTrigger]:
        """Move the offset — one insert, `ON CONFLICT DO NOTHING`.

        None when `(thread_id, event_id)` is taken: two workers raced the same
        addressing and this one lost. That is the entire concurrency story
        inbound; nothing is locked and nothing is claimed (§2.4).
        """
        ...

    @abstractmethod
    async def transition_inbox_trigger(
        self,
        *,
        project_id: UUID,
        #
        trigger_id: UUID,
        state: ChannelTriggerState,
        status: Optional[Status] = None,
    ) -> Optional[ChannelInboxTrigger]:
        """Record the turn's fate in place, by id — never inserts.

        Same discipline as `update_delivery` in triggers: a post-invoke write
        failure must not manifest as "no row exists" on retry.
        """
        ...

    @abstractmethod
    async def query_inbox_triggers(
        self,
        *,
        project_id: UUID,
        #
        trigger: Optional[ChannelInboxTriggerQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelInboxTrigger]: ...

    # --- outbox ------------------------------------------------------------- #

    @abstractmethod
    async def record_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event: ChannelOutboxEventCreate,
    ) -> ChannelOutboxEvent:
        """Insert at state=CREATED, idempotent on `key` (§2.6).

        `ON CONFLICT (project_id, key) DO NOTHING ... RETURNING`, falling back to
        a fetch — so a re-run of the outbox worker returns the EXISTING row
        rather than None. Unlike the inbox, the caller needs the row either way:
        it may still have to post it, and it must not fork the message.
        """
        ...

    @abstractmethod
    async def fetch_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
    ) -> Optional[ChannelOutboxEvent]: ...

    @abstractmethod
    async def fetch_outbox_event_by_key(
        self,
        *,
        project_id: UUID,
        #
        key: UUID,
    ) -> Optional[ChannelOutboxEvent]:
        """Find the row for an item without knowing its row id — for the edit path.

        The worker rendering a turn's final answer holds `(thread, turn, item)`
        and so can derive `key`, but it does not hold the `uuid7` id. This is why
        `key` is stored (§2.6).
        """
        ...

    @abstractmethod
    async def claim_outbox_events(
        self,
        *,
        project_id: Optional[UUID] = None,
        #
        limit: int = 100,
    ) -> List[ChannelOutboxEvent]:
        """The delivery sweep: CREATED rows, oldest first.

        `project_id` is Optional here and only here on the write side, because a
        single sweeper serves every project — the same cross-project shape, and
        the same justification, as `fetch_active_schedules` in triggers.
        """
        ...

    @abstractmethod
    async def transition_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
        state: ChannelDeliveryState,
        status: Optional[Status] = None,
        data: Optional[ChannelOutboxEventData] = None,
    ) -> Optional[ChannelOutboxEvent]:
        """Advance the row in place — SENT with a locator, or FAILED/ABANDONED.

        `data` is how the receipt lands (§2.7). One posted message is one row for
        its whole life, so this is an update and never an insert.
        """
        ...

    @abstractmethod
    async def query_outbox_events(
        self,
        *,
        project_id: UUID,
        #
        event: Optional[ChannelOutboxEventQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelOutboxEvent]: ...

    # --- ingress: the one unscoped read ------------------------------------- #

    @abstractmethod
    async def get_project_and_connection_by_external_id(
        self,
        *,
        channel: str,
        external_id: str,
    ) -> Optional[Tuple[UUID, UUID]]:
        """Resolve a platform workspace/team id to (project_id, connection_id).

        Deliberately cross-project, and the ONLY unscoped method here. An inbound
        Slack event carries a team id and no tenant scope, so this lookup
        *recovers* the project before anything else can be scoped. Exactly the
        shape and the justification of
        `get_project_and_subscription_by_trigger_id` in triggers.
        """
        ...
