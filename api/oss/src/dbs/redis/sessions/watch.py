"""Session and project watch channels — fire-and-forget publishers.

Publish side of the session and project SSE endpoints. Every publish is best-effort:
a failure is logged and swallowed so the write path that triggered it (records
append, turn lifecycle, interaction create/resolve) never fails or re-drives
because of the relay. PUBLISH to zero subscribers is an O(1) Redis no-op.

Plane: durable Redis — the SSE endpoint subscribes there via
``get_streams_engine()``; publisher and subscriber must share one plane.
"""

import asyncio
import json
from typing import TYPE_CHECKING, Optional

from oss.src.dbs.redis.sessions.contract import (
    make_watch_entity_changed_payload,
    make_watch_interaction_payload,
    make_watch_lifecycle_payload,
    make_watch_records_changed_payload,
    project_watch_channel,
    watch_channel,
)
from oss.src.dbs.redis.shared.engine import get_streams_engine
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:
    from redis.asyncio import Redis

log = get_module_logger(__name__)


class SessionsWatchPublisher:
    """Publishes watch events on the durable plane. Never raises."""

    def __init__(self, *, redis_client: Optional["Redis"] = None) -> None:
        # An injected client (e.g. the stream worker's durable connection) is
        # reused; otherwise the shared streams engine client is opened lazily.
        self._redis = redis_client

    def _client(self) -> "Redis":
        if self._redis is None:
            self._redis = get_streams_engine().get_redis()
        return self._redis

    async def _publish(
        self,
        *,
        channel: str,
        project_id: str,
        payload: dict,
    ) -> None:
        try:
            # Bounded: the streams client has no socket timeouts, and these publishes
            # sit on turn-lifecycle/interaction write paths — a black-holed Redis must
            # cost at most 1s, never a TCP timeout.
            await asyncio.wait_for(
                self._client().publish(
                    channel,
                    json.dumps(payload).encode(),
                ),
                timeout=1.0,
            )
        except Exception:
            # Relay only — the write this notifies about is already committed.
            log.warning(
                "[WATCH] publish failed",
                project_id=project_id,
                session_id=payload.get("session_id"),
                event_type=payload.get("type"),
            )

    async def records_changed(self, *, project_id: str, session_id: str) -> None:
        await self._publish(
            channel=watch_channel(project_id, session_id),
            project_id=project_id,
            payload=make_watch_records_changed_payload(session_id=session_id),
        )

    async def lifecycle(
        self,
        *,
        project_id: str,
        session_id: str,
        state: str,
    ) -> None:
        await self._publish(
            channel=watch_channel(project_id, session_id),
            project_id=project_id,
            payload=make_watch_lifecycle_payload(session_id=session_id, state=state),
        )

    async def interaction(
        self,
        *,
        project_id: str,
        session_id: str,
        status: str,
    ) -> None:
        await self._publish(
            channel=watch_channel(project_id, session_id),
            project_id=project_id,
            payload=make_watch_interaction_payload(
                session_id=session_id, status=status
            ),
        )

    async def changed(self, *, project_id: str, entity: str, id: str) -> None:
        await self._publish(
            channel=project_watch_channel(project_id),
            project_id=project_id,
            payload=make_watch_entity_changed_payload(entity=entity, id=id),
        )
