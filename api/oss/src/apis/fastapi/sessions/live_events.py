import asyncio
import json
import math
from contextlib import suppress
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from oss.src.core.sessions.records.dtos import SessionDurableEvent

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

HEARTBEAT_FRAME = ": heartbeat\n\n"
RELAY_CLOSE_EVENT = "relay-close"


def retry_frame(retry_milliseconds: int) -> str:
    return f"retry: {retry_milliseconds}\n\n"


def ready_frame() -> str:
    return "event: ready\ndata: {}\n\n"


def close_frame(*, reason: str, reconnect: bool) -> str:
    payload = json.dumps({"reason": reason, "reconnect": reconnect})
    return f"event: {RELAY_CLOSE_EVENT}\ndata: {payload}\n\n"


def format_live_frame(raw: Any) -> Optional[str]:
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or payload.get("kind") not in {"frame", "event"}:
        return None
    return f"data: {json.dumps(payload)}\n\n"


def format_durable_event(event: SessionDurableEvent) -> str:
    return f"data: {event.model_dump_json()}\n\n"


async def live_event_stream(
    *,
    channel: str,
    pubsub_factory: Callable[[], Any],
    authorization_check: Callable[[], Awaitable[bool]],
    authorization_recheck_seconds: float,
    heartbeat_seconds: float,
    retry_milliseconds: int,
    buffer_limit: int,
    after: int = 0,
    replay_query: Optional[
        Callable[[int], Awaitable[list[SessionDurableEvent]]]
    ] = None,
) -> AsyncIterator[str]:
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=max(1, buffer_limit))
    stopped = asyncio.Event()
    pubsub = pubsub_factory()
    cursor = after
    seen_event_ids: set[str] = set()

    def force_close(*, reason: str, reconnect: bool) -> None:
        while not queue.empty():
            with suppress(asyncio.QueueEmpty):
                queue.get_nowait()
        queue.put_nowait(close_frame(reason=reason, reconnect=reconnect))
        stopped.set()

    def enqueue(frame: str) -> None:
        try:
            queue.put_nowait(frame)
        except asyncio.QueueFull:
            force_close(reason="slow_reader", reconnect=True)

    async def replay() -> None:
        nonlocal cursor
        if replay_query is None:
            return
        for event in await replay_query(cursor):
            if event.frame_or_event_id in seen_event_ids:
                continue
            if event.sequence is not None and event.sequence <= cursor:
                continue
            seen_event_ids.add(event.frame_or_event_id)
            enqueue(format_durable_event(event))
            if event.sequence is not None:
                cursor = event.sequence

    async def pump() -> None:
        try:
            await pubsub.subscribe(channel)
            await queue.put(retry_frame(retry_milliseconds))
            await replay()
            await queue.put(ready_frame())
            loop = asyncio.get_running_loop()
            last_authorization_check = loop.time()
            poll_seconds = min(
                1.0,
                heartbeat_seconds,
                authorization_recheck_seconds,
            )
            idle_polls_per_heartbeat = max(
                1, math.ceil(heartbeat_seconds / poll_seconds)
            )
            idle_polls = 0

            while not stopped.is_set():
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=poll_seconds,
                )
                now = loop.time()
                if now - last_authorization_check >= authorization_recheck_seconds:
                    last_authorization_check = now
                    try:
                        authorized = await authorization_check()
                    except Exception:
                        authorized = False
                    if not authorized:
                        force_close(reason="authorization_revoked", reconnect=False)
                        return

                if message is None:
                    idle_polls += 1
                    if idle_polls >= idle_polls_per_heartbeat:
                        idle_polls = 0
                        enqueue(HEARTBEAT_FRAME)
                    continue
                idle_polls = 0
                if message.get("type") != "message":
                    continue
                try:
                    payload = json.loads(message.get("data"))
                except (ValueError, TypeError):
                    continue
                if (
                    replay_query is not None
                    and isinstance(payload, dict)
                    and payload.get("kind") == "event"
                ):
                    await replay()
                    continue
                frame = format_live_frame(message.get("data"))
                if frame is not None:
                    enqueue(frame)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning(
                "[SESSION-LIVE] relay reader failed", channel=channel, exc_info=True
            )
            force_close(reason="relay_unavailable", reconnect=True)
        finally:
            try:
                await pubsub.unsubscribe(channel)
            except Exception:
                log.warning("[SESSION-LIVE] pubsub unsubscribe failed", channel=channel)
            try:
                await pubsub.aclose()
            except Exception:
                log.warning("[SESSION-LIVE] pubsub close failed", channel=channel)

    task = asyncio.create_task(pump())
    try:
        while True:
            frame = await queue.get()
            yield frame
            if frame.startswith(f"event: {RELAY_CLOSE_EVENT}"):
                break
            if task.done() and queue.empty():
                break
    finally:
        stopped.set()
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
