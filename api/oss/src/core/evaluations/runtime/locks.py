"""
Evaluation runtime locking primitives.

Logical key suffixes:
    eval:run:{run_id}:lock
    eval:run:{run_id}:job:{lock_id}:lock
    eval:worker:{worker_id}:heartbeat

Implementation detail:
    locks are stored through the existing caching lock helpers, so the actual
    Redis key includes the standard cache prefix and lock namespace prefix:
    cache:p:{project}:u:{user}:lock:{logical_suffix}
"""

from asyncio import CancelledError, sleep
from datetime import datetime, timezone
from time import monotonic
from typing import Literal, Optional

import orjson
from pydantic import BaseModel

import oss.src.utils.caching as caching
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


EVAL_LOCK_HEARTBEAT_INTERVAL = 30
EVAL_LOCK_TTL = 5 * 60
EVAL_LOCK_SAFETY_MARGIN = 60

JobType = Literal["api", "web", "sdk"]


class LockPayload(BaseModel):
    job_type: JobType
    job_id: str
    job_token: str
    created_at: str
    updated_at: str


class WorkerHeartbeatPayload(BaseModel):
    worker_id: str
    created_at: str
    updated_at: str


class JobLockLeaseLostError(RuntimeError):
    def __init__(
        self,
        *,
        run_id: str,
        job_id: str,
        lock_id: Optional[str] = None,
        reason: str,
    ) -> None:
        self.run_id = run_id
        self.job_id = job_id
        self.lock_id = lock_id or job_id
        self.reason = reason
        super().__init__(
            f"Evaluation job lease lost for run {run_id}, "
            f"job {job_id}, lock {self.lock_id}: {reason}"
        )


def run_lock_key(run_id: str) -> str:
    return f"eval:run:{run_id}:lock"


def job_lock_key(run_id: str, lock_id: str) -> str:
    return f"eval:run:{run_id}:job:{lock_id}:lock"


def job_lock_pattern(run_id: str) -> str:
    return f"eval:run:{run_id}:job:*:lock"


def worker_heartbeat_key(worker_id: str) -> str:
    return f"eval:worker:{worker_id}:heartbeat"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lock_args(lock_key: str) -> tuple[str, str]:
    namespace, key = lock_key.split(":", 1)
    return namespace, key


def _actual_lock_name(lock_key: str) -> str:
    return caching.pack(namespace="lock", key=lock_key)


def _actual_meta_name(lock_key: str) -> str:
    return f"{_actual_lock_name(lock_key)}:meta"


def _make_payload(
    *,
    job_type: JobType,
    job_id: str,
    job_token: str,
) -> LockPayload:
    now = _now_iso()
    return LockPayload(
        job_type=job_type,
        job_id=job_id,
        job_token=job_token,
        created_at=now,
        updated_at=now,
    )


async def _write_meta(
    *,
    lock_key: str,
    payload: LockPayload,
    ttl: int,
) -> None:
    await caching.r_lock.set(
        _actual_meta_name(lock_key),
        orjson.dumps(payload.model_dump(mode="json")),
        ex=ttl,
    )


async def _touch_meta(
    *,
    lock_key: str,
    ttl: int,
) -> None:
    meta_key = _actual_meta_name(lock_key)
    raw = await caching.r_lock.get(meta_key)
    if not raw:
        return

    try:
        payload = LockPayload.model_validate(orjson.loads(raw))
    except Exception:
        log.warning("[LOCK] Ignoring malformed lock metadata", lock_key=lock_key)
        return

    payload.updated_at = _now_iso()
    await caching.r_lock.set(
        meta_key,
        orjson.dumps(payload.model_dump(mode="json")),
        ex=ttl,
    )


async def _read_meta_if_lock_exists(
    *,
    lock_key: str,
) -> Optional[LockPayload]:
    actual_lock_key = _actual_lock_name(lock_key)
    if not await caching.r_lock.exists(actual_lock_key):
        await caching.r_lock.delete(_actual_meta_name(lock_key))
        return None

    raw = await caching.r_lock.get(_actual_meta_name(lock_key))
    if not raw:
        return None

    try:
        return LockPayload.model_validate(orjson.loads(raw))
    except Exception:
        log.warning("[LOCK] Ignoring malformed lock metadata", lock_key=lock_key)
        return None


async def _acquire_lock(
    *,
    lock_key: str,
    job_type: JobType,
    job_id: str,
    ttl: int,
) -> Optional[LockPayload]:
    namespace, key = _lock_args(lock_key)
    job_token = await caching.acquire_lock(
        namespace=namespace,
        key=key,
        ttl=ttl,
        strict=True,
    )
    if job_token is None:
        return None

    payload = _make_payload(
        job_type=job_type,
        job_id=job_id,
        job_token=job_token,
    )
    try:
        await _write_meta(
            lock_key=lock_key,
            payload=payload,
            ttl=ttl,
        )
    except Exception:
        log.error(
            "[LOCK] Failed to persist lock metadata; releasing lock",
            lock_key=lock_key,
            job_id=job_id,
            exc_info=True,
        )
        await caching.release_lock(
            namespace=namespace,
            key=key,
            owner=job_token,
        )
        return None

    return payload


async def _renew_lock(
    *,
    lock_key: str,
    job_token: str,
    ttl: int,
) -> bool:
    namespace, key = _lock_args(lock_key)
    renewed = await caching.renew_lock(
        namespace=namespace,
        key=key,
        ttl=ttl,
        owner=job_token,
    )
    if not renewed:
        return False

    try:
        await _touch_meta(
            lock_key=lock_key,
            ttl=ttl,
        )
    except Exception:
        log.warning(
            "[LOCK] Renewed lock but failed to refresh metadata",
            lock_key=lock_key,
            exc_info=True,
        )

    return True


async def _release_lock(
    *,
    lock_key: str,
    job_token: str,
) -> bool:
    namespace, key = _lock_args(lock_key)
    released = await caching.release_lock(
        namespace=namespace,
        key=key,
        owner=job_token,
    )
    if not released:
        return False

    try:
        await caching.r_lock.delete(_actual_meta_name(lock_key))
    except Exception:
        log.warning(
            "[LOCK] Released lock but failed to delete metadata",
            lock_key=lock_key,
            exc_info=True,
        )

    return True


async def acquire_job_lock(
    *,
    run_id: str,
    job_id: str,
    lock_id: Optional[str] = None,
    job_type: JobType = "api",
    ttl: int = EVAL_LOCK_TTL,
) -> Optional[LockPayload]:
    return await _acquire_lock(
        lock_key=job_lock_key(run_id, lock_id or job_id),
        job_type=job_type,
        job_id=job_id,
        ttl=ttl,
    )


async def acquire_mutation_lock(
    *,
    run_id: str,
    job_id: str,
    job_type: JobType = "api",
    ttl: int = EVAL_LOCK_TTL,
) -> Optional[LockPayload]:
    return await _acquire_lock(
        lock_key=run_lock_key(run_id),
        job_type=job_type,
        job_id=job_id,
        ttl=ttl,
    )


async def renew_job_lock(
    *,
    run_id: str,
    job_id: str,
    job_token: str,
    lock_id: Optional[str] = None,
    ttl: int = EVAL_LOCK_TTL,
) -> bool:
    return await _renew_lock(
        lock_key=job_lock_key(run_id, lock_id or job_id),
        job_token=job_token,
        ttl=ttl,
    )


async def renew_mutation_lock(
    *,
    run_id: str,
    job_token: str,
    ttl: int = EVAL_LOCK_TTL,
) -> bool:
    return await _renew_lock(
        lock_key=run_lock_key(run_id),
        job_token=job_token,
        ttl=ttl,
    )


async def release_job_lock(
    *,
    run_id: str,
    job_id: str,
    job_token: str,
    lock_id: Optional[str] = None,
) -> bool:
    return await _release_lock(
        lock_key=job_lock_key(run_id, lock_id or job_id),
        job_token=job_token,
    )


async def release_mutation_lock(
    *,
    run_id: str,
    job_token: str,
) -> bool:
    return await _release_lock(
        lock_key=run_lock_key(run_id),
        job_token=job_token,
    )


async def list_active_job_locks(
    *,
    run_id: str,
) -> list[LockPayload]:
    """
    Return active job lock payloads for a run.

    Wildcard discovery must use SCAN, never KEYS.
    """
    payloads: list[LockPayload] = []
    async for raw_lock_key in caching.r_lock.scan_iter(
        match=_actual_lock_name(job_lock_pattern(run_id))
    ):
        meta_key = (
            raw_lock_key + b":meta"
            if isinstance(raw_lock_key, bytes)
            else f"{raw_lock_key}:meta"
        )
        raw_payload = await caching.r_lock.get(meta_key)
        if not raw_payload:
            continue

        try:
            payloads.append(LockPayload.model_validate(orjson.loads(raw_payload)))
        except Exception:
            log.warning(
                "[LOCK] Ignoring malformed job lock metadata",
                lock_key=raw_lock_key.decode()
                if isinstance(raw_lock_key, bytes)
                else raw_lock_key,
            )

    return payloads


async def get_mutation_lock(
    *,
    run_id: str,
) -> Optional[LockPayload]:
    return await _read_meta_if_lock_exists(lock_key=run_lock_key(run_id))


async def is_run_executing(
    *,
    run_id: str,
) -> bool:
    async for _ in caching.r_lock.scan_iter(
        match=_actual_lock_name(job_lock_pattern(run_id))
    ):
        return True
    return False


async def has_mutation_lock(
    *,
    run_id: str,
) -> bool:
    return bool(await caching.r_lock.exists(_actual_lock_name(run_lock_key(run_id))))


async def refresh_worker_heartbeat(
    *,
    worker_id: str,
    ttl: int = EVAL_LOCK_TTL,
) -> WorkerHeartbeatPayload:
    now = _now_iso()
    hb_key = _actual_lock_name(worker_heartbeat_key(worker_id))
    raw = await caching.r_lock.get(hb_key)
    created_at = now

    if raw:
        try:
            existing = WorkerHeartbeatPayload.model_validate(orjson.loads(raw))
            created_at = existing.created_at
        except Exception:
            log.warning(
                "[LOCK] Ignoring malformed worker heartbeat payload",
                worker_id=worker_id,
            )

    payload = WorkerHeartbeatPayload(
        worker_id=worker_id,
        created_at=created_at,
        updated_at=now,
    )
    await caching.r_lock.set(
        hb_key,
        orjson.dumps(payload.model_dump(mode="json")),
        ex=ttl,
    )
    return payload


async def run_worker_heartbeat(
    *,
    worker_id: str,
    interval: int = EVAL_LOCK_HEARTBEAT_INTERVAL,
    ttl: int = EVAL_LOCK_TTL,
) -> None:
    while True:
        try:
            await refresh_worker_heartbeat(
                worker_id=worker_id,
                ttl=ttl,
            )
            await sleep(interval)
        except CancelledError:
            raise
        except Exception:
            log.warning(
                "[LOCK] Worker heartbeat failed",
                worker_id=worker_id,
                exc_info=True,
            )
            await sleep(interval)


async def run_job_heartbeat(
    *,
    run_id: str,
    job_id: str,
    job_token: str,
    lock_id: Optional[str] = None,
    interval: int = EVAL_LOCK_HEARTBEAT_INTERVAL,
    ttl: int = EVAL_LOCK_TTL,
    safety_margin: int = EVAL_LOCK_SAFETY_MARGIN,
) -> None:
    if safety_margin >= ttl:
        raise ValueError("safety_margin must be smaller than ttl")

    actual_lock_id = lock_id or job_id
    last_successful_renew = monotonic()

    while True:
        try:
            await sleep(interval)
            renewed = await renew_job_lock(
                run_id=run_id,
                job_id=job_id,
                lock_id=lock_id,
                job_token=job_token,
                ttl=ttl,
            )
            if not renewed:
                log.error(
                    "[LOCK] Job heartbeat lost ownership; failing task",
                    run_id=run_id,
                    job_id=job_id,
                    lock_id=actual_lock_id,
                )
                raise JobLockLeaseLostError(
                    run_id=run_id,
                    job_id=job_id,
                    lock_id=actual_lock_id,
                    reason="renew_job_lock returned false",
                )
            last_successful_renew = monotonic()
        except CancelledError:
            raise
        except JobLockLeaseLostError:
            raise
        except Exception:
            now = monotonic()
            critical_deadline = last_successful_renew + ttl - safety_margin
            seconds_until_critical = max(0.0, critical_deadline - now)

            if now < critical_deadline:
                log.warning(
                    "[LOCK] Job heartbeat renew failed; retaining lease until deadline",
                    run_id=run_id,
                    job_id=job_id,
                    lock_id=actual_lock_id,
                    seconds_until_critical=round(seconds_until_critical, 3),
                    exc_info=True,
                )
                continue

            log.error(
                "[LOCK] Job heartbeat missed renew deadline; failing task",
                run_id=run_id,
                job_id=job_id,
                lock_id=actual_lock_id,
                last_successful_renew_age=round(now - last_successful_renew, 3),
                ttl=ttl,
                safety_margin=safety_margin,
                exc_info=True,
            )
            raise JobLockLeaseLostError(
                run_id=run_id,
                job_id=job_id,
                lock_id=actual_lock_id,
                reason="heartbeat renew deadline exceeded",
            )
