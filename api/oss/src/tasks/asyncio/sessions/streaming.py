from typing import Literal
from uuid import UUID

from orjson import dumps, loads
from pydantic import BaseModel

from oss.src.dbs.redis.shared.engine import get_streams_engine
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

MAXLEN_STREAMS_SESSIONS = 100_000

SESSIONS_STREAM_NAME = "streams:sessions"
# Every turn-ended signal again, for the producer of child updates. A second consumer
# group on `streams:sessions` would miss entries: the channels outbox deletes each entry
# with `XDEL` once it has processed it.
SESSION_TURN_ENDS_STREAM_NAME = "streams:session-turn-ends"


def _get_redis():
    engine = get_streams_engine()
    return engine.get_redis() if engine else None


class SessionTurnEvent(BaseModel):
    """Wire format for the dedicated session-turn Redis stream.

    Carries only what names the turn — no turn content, no record payload.
    A consumer queries records by `turn_id` itself.
    """

    kind: Literal["turn_started", "turn_ended"]
    project_id: UUID
    session_id: str
    turn_id: str


def deserialize_turn_event(*, payload: bytes) -> SessionTurnEvent:
    raw = loads(payload)
    return SessionTurnEvent.model_validate(raw)


async def _publish_turn_event(
    *,
    kind: Literal["turn_started", "turn_ended"],
    project_id: UUID,
    session_id: str,
    turn_id: str,
) -> bool:
    redis = _get_redis()
    if redis is None:
        log.warning("[SESSIONS] Durable Redis not configured; event not published")
        return False

    try:
        turn_event = SessionTurnEvent(
            kind=kind,
            project_id=project_id,
            session_id=session_id,
            turn_id=turn_id,
        )

        event_bytes = dumps(turn_event.model_dump(mode="json"))

        await redis.xadd(
            name=SESSIONS_STREAM_NAME,
            fields={"data": event_bytes},
            maxlen=MAXLEN_STREAMS_SESSIONS,
            approximate=True,
        )
        # In the same step, so a failure holds the records batch for both streams. A
        # retry writes both again; both consumers treat a repeat as a no-op.
        if kind == "turn_ended":
            await redis.xadd(
                name=SESSION_TURN_ENDS_STREAM_NAME,
                fields={"data": event_bytes},
                maxlen=MAXLEN_STREAMS_SESSIONS,
                approximate=True,
            )
        return True
    except Exception as e:
        log.error(f"[SESSIONS] Failed to publish: {e}", exc_info=True)
        return False


async def publish_turn_started(
    *,
    project_id: UUID,
    session_id: str,
    turn_id: str,
) -> bool:
    return await _publish_turn_event(
        kind="turn_started",
        project_id=project_id,
        session_id=session_id,
        turn_id=turn_id,
    )


async def publish_turn_ended(
    *,
    project_id: UUID,
    session_id: str,
    turn_id: str,
) -> bool:
    return await _publish_turn_event(
        kind="turn_ended",
        project_id=project_id,
        session_id=session_id,
        turn_id=turn_id,
    )
