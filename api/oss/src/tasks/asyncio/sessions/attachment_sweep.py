import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from oss.src.core.sessions.attachments.dtos import Attachment
from oss.src.core.sessions.attachments.interfaces import (
    AttachmentOriginalStore,
    SessionAttachmentsDAOInterface,
)
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_ATTACHMENT_SWEEP_LOCK_KEY = "locks:sessions:attachment-sweep"
_ATTACHMENT_SWEEP_BATCH_SIZE = 100
# A fresh pod on a fresh node can fail its first Redis connects (agenta#7518). Retry soon
# instead of waiting a full sweep interval, and log at ERROR only once Redis stays down.
_REDIS_FAILURES_BEFORE_ERROR = 3
_REDIS_RETRY_BASE_SECONDS = 5
_REDIS_RETRY_MAX_SECONDS = 60
_RELEASE_IF_OWNER_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""
_RENEW_IF_OWNER_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
"""


async def _release_lock(
    *,
    lock_engine: LockEngine,
    owner: bytes,
) -> None:
    await lock_engine.eval(
        _RELEASE_IF_OWNER_LUA,
        1,
        _ATTACHMENT_SWEEP_LOCK_KEY.encode(),
        owner,
    )


async def _renew_lock(
    *,
    lock_engine: LockEngine,
    owner: bytes,
    lease_ttl_seconds: int,
) -> bool:
    result = await lock_engine.eval(
        _RENEW_IF_OWNER_LUA,
        1,
        _ATTACHMENT_SWEEP_LOCK_KEY.encode(),
        owner,
        lease_ttl_seconds,
    )
    return result == 1


async def run_attachment_sweep(
    *,
    attachments_dao: SessionAttachmentsDAOInterface,
    original_store: AttachmentOriginalStore,
    lock_engine: LockEngine,
    pending_ttl_seconds: int,
    unreferenced_ttl_seconds: int,
    sweep_interval_seconds: int,
) -> None:
    owner = uuid4().hex.encode()
    lease_ttl_seconds = max(sweep_interval_seconds * 2, 300)
    acquired = await lock_engine.set(
        _ATTACHMENT_SWEEP_LOCK_KEY,
        owner,
        nx=True,
        ex=lease_ttl_seconds,
    )
    if not acquired:
        return

    async def delete_original(attachment: Attachment) -> None:
        await original_store.delete_attachment_original(
            project_id=attachment.project_id,
            mount_id=attachment.mount_id,
            path=attachment.path,
        )

    try:
        now = datetime.now(timezone.utc)
        while True:
            reaped = await attachments_dao.reap_stale_pending(
                older_than=now - timedelta(seconds=pending_ttl_seconds),
                delete_original=delete_original,
                limit=_ATTACHMENT_SWEEP_BATCH_SIZE,
            )
            if len(reaped) < _ATTACHMENT_SWEEP_BATCH_SIZE:
                break
            if not await _renew_lock(
                lock_engine=lock_engine,
                owner=owner,
                lease_ttl_seconds=lease_ttl_seconds,
            ):
                return
        while True:
            swept = await attachments_dao.sweep_unreferenced_ready(
                older_than=now - timedelta(seconds=unreferenced_ttl_seconds),
                delete_original=delete_original,
                limit=_ATTACHMENT_SWEEP_BATCH_SIZE,
            )
            if len(swept) < _ATTACHMENT_SWEEP_BATCH_SIZE:
                break
            if not await _renew_lock(
                lock_engine=lock_engine,
                owner=owner,
                lease_ttl_seconds=lease_ttl_seconds,
            ):
                return
    finally:
        await asyncio.shield(
            _release_lock(
                lock_engine=lock_engine,
                owner=owner,
            )
        )


async def attachment_sweep_loop(
    *,
    attachments_dao: SessionAttachmentsDAOInterface,
    original_store: AttachmentOriginalStore,
    lock_engine: LockEngine,
    pending_ttl_seconds: int,
    unreferenced_ttl_seconds: int,
    sweep_interval_seconds: int,
) -> None:
    redis_failures = 0
    while True:
        try:
            await run_attachment_sweep(
                attachments_dao=attachments_dao,
                original_store=original_store,
                lock_engine=lock_engine,
                pending_ttl_seconds=pending_ttl_seconds,
                unreferenced_ttl_seconds=unreferenced_ttl_seconds,
                sweep_interval_seconds=sweep_interval_seconds,
            )
            redis_failures = 0
        except asyncio.CancelledError:
            raise
        except (RedisConnectionError, RedisTimeoutError) as error:
            redis_failures += 1
            if redis_failures >= _REDIS_FAILURES_BEFORE_ERROR:
                log.error(
                    "attachment_sweep: redis unreachable for %d passes in a row: %s",
                    redis_failures,
                    error,
                    exc_info=True,
                )
            else:
                log.warning(
                    "attachment_sweep: redis not reachable yet (%s); retrying",
                    error,
                )
            await asyncio.sleep(
                min(
                    _REDIS_RETRY_BASE_SECONDS * 2 ** (redis_failures - 1),
                    _REDIS_RETRY_MAX_SECONDS,
                )
            )
            continue
        except Exception as error:
            log.error(
                "attachment_sweep: error during sweep pass: %s",
                error,
                exc_info=True,
            )
        # Floored: a zero or negative interval would turn the loop into a hot spin.
        await asyncio.sleep(max(sweep_interval_seconds, 1))
