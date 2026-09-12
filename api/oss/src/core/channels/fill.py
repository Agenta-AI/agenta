"""Backfill fetch and the forwardfill range-select helper.

Both are read/write helpers over the DAO and the adapter port — no queue,
nothing claimed, nothing marked beyond the space's own `is_backfilled` flag.

`run_backfill` is called once per space, the first time any agent is
addressed there. It is guarded by `flags.is_backfilled` rather than a count
of `PULLED` rows, because a successful fetch can legitimately return
nothing, and that must stay distinguishable from never having fetched.

`select_forwardfill_range` is the range read `compose_input` performs: this
thread's latest trigger for the offset, then the space's events after it,
ordered `(origin, id)`. The caller keeps the forwardfill policy branch —
with forwardfill off it narrows this range to the addressing event alone.
"""

from typing import List, Optional
from uuid import UUID

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelSpace,
)
from oss.src.core.channels.interfaces import ChannelsDAOInterface
from oss.src.core.shared.dtos import Status
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


async def run_backfill(
    *,
    project_id: UUID,
    channels_dao: ChannelsDAOInterface,
    adapter: ChannelAdapterInterface,
    connection: ChannelConnection,
    space: ChannelSpace,
    capabilities: ChannelCapabilities,
    limit: Optional[int] = None,
) -> Optional[Status]:
    """The one-time, per-space history fetch.

    Returns `None` when nothing needs writing to the trigger row's `Status`:
    either the fetch succeeded (including an empty result, which still sets
    the flag), or the platform declares no backfill support at all, in which
    case no attempt is made and nothing is recorded, ever.

    Returns a `Status` describing the refusal when the platform's history
    API denies the request. The caller (the inbox worker) writes that onto
    the trigger row via `transition_inbox_trigger` — this function never
    calls it, because no trigger row exists yet at the point backfill must run
    (before `open_turn`).

    Does nothing at all, silently, if `flags.is_backfilled` is already true:
    the guard is the flag, never a count of `PULLED` rows.
    """

    if space.flags.is_backfilled:
        return None

    if not capabilities.fill.backfill.supported:
        # Not a permission question — never attempted, never recorded.
        return None

    try:
        fetched = await adapter.fetch_history(
            connection=connection,
            locator=space.data.external_locator,
            limit=limit,
        )
    except Exception as e:  # noqa: BLE001 - the port declares "raises", not a type
        log.info(
            "[FILL] backfill refused for space=%s: %s",
            space.id,
            e,
        )
        return Status(code="403", message=str(e))

    events = [
        ChannelInboxEventCreate(
            connection_id=connection.id,
            external_id=inbound.external_id,
            kind=inbound.kind,
            origin=ChannelEventOrigin.PULLED,
            data=ChannelInboxEventData(
                external_locator=inbound.external_locator,
                processed=inbound.processed,
            ),
        )
        for inbound in fetched
    ]

    if events:
        await channels_dao.record_inbox_events(
            project_id=project_id,
            events=events,
        )

    # A successful fetch that returned nothing still sets the flag: what
    # matters is that the fetch was answered, not that it carried rows.
    await channels_dao.mark_space_backfilled(
        project_id=project_id,
        space_id=space.id,
    )

    return None


async def select_forwardfill_range(
    *,
    project_id: UUID,
    channels_dao: ChannelsDAOInterface,
    thread_id: UUID,
    space_id: UUID,
) -> List[ChannelInboxEvent]:
    """This thread's latest trigger for the offset, then the space's events
    after it, ordered `(origin, id)` — the drain as a range query.

    No trigger row yet reads as "from the beginning", which is what makes
    the first turn in a thread see the backfilled rows ahead of anything
    pushed since. Applying the forwardfill policy is the caller's.
    """

    latest_trigger = await channels_dao.fetch_latest_trigger(
        project_id=project_id,
        thread_id=thread_id,
    )

    return await channels_dao.query_events_since(
        project_id=project_id,
        space_id=space_id,
        after_event_id=latest_trigger.event_id if latest_trigger else None,
    )
