"""
Evaluation runtime locking primitives.

Key space:
    eval:run:{run_id}:lock              — mutation lock (prevents concurrent run edits)
    eval:run:{run_id}:job:{job_id}:lock — job execution lock (heartbeated by workers/SDK)
    eval:worker:{worker_id}:heartbeat   — worker liveness signal

All locks use the volatile Redis instance and carry a JSON payload with an
ownership token so that only the original acquirer can renew or release.

Defaults:
    heartbeat interval  30 s
    lock TTL            5 min (expires if no heartbeat renewal)
"""

from typing import Literal, Optional
from asyncio import sleep, CancelledError
from datetime import datetime, timezone
from uuid import uuid4

import orjson
from pydantic import BaseModel
from redis.asyncio import Redis

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

log = get_module_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EVAL_LOCK_HEARTBEAT_INTERVAL = 30  # seconds between heartbeats
EVAL_LOCK_TTL = 5 * 60  # 5 minutes — lock expires if heartbeat stops

# ---------------------------------------------------------------------------
# Redis client (lazy-initialised, volatile instance)
# ---------------------------------------------------------------------------

_r: Optional[Redis] = None


def _get_redis() -> Redis:
    global _r
    if _r is None:
        _r = Redis.from_url(
            url=env.redis.uri_volatile,
            decode_responses=False,
            socket_timeout=2.0,
        )
    return _r


# ---------------------------------------------------------------------------
# Key builders
# ---------------------------------------------------------------------------


def run_lock_key(run_id: str) -> str:
    return f"eval:run:{run_id}:lock"


def job_lock_key(run_id: str, job_id: str) -> str:
    return f"eval:run:{run_id}:job:{job_id}:lock"


def job_lock_pattern(run_id: str) -> str:
    return f"eval:run:{run_id}:job:*:lock"


def worker_heartbeat_key(worker_id: str) -> str:
    return f"eval:worker:{worker_id}:heartbeat"


# ---------------------------------------------------------------------------
# Payload
# ---------------------------------------------------------------------------

JobType = Literal["api", "web", "sdk"]


class LockPayload(BaseModel):
    job_type: JobType
    job_id: str
    job_token: str
    created_at: str
    updated_at: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_payload(
    *,
    job_type: JobType,
    job_id: str,
) -> LockPayload:
    now = _now_iso()
    return LockPayload(
        job_type=job_type,
        job_id=job_id,
        job_token=str(uuid4()),
        created_at=now,
        updated_at=now,
    )


# ---------------------------------------------------------------------------
# Core lock operations
# ---------------------------------------------------------------------------


async def acquire_job_lock(
    *,
    run_id: str,
    job_id: str,
    job_type: JobType = "api",
    ttl: int = EVAL_LOCK_TTL,
) -> Optional[LockPayload]:
    """
    Acquire eval:run:{run_id}:job:{job_id}:lock (SET NX).

    Returns LockPayload (containing the ownership token) on success,
    None if the key already exists.
    """
    r = _get_redis()
    key = job_lock_key(run_id, job_id)
    payload = _make_payload(job_type=job_type, job_id=job_id)
    value = orjson.dumps(payload.model_dump())
    acquired = await r.set(key, value, nx=True, ex=ttl)
    if acquired:
        return payload
    return None


async def acquire_mutation_lock(
    *,
    run_id: str,
    job_id: str,
    job_type: JobType = "api",
    ttl: int = EVAL_LOCK_TTL,
) -> Optional[LockPayload]:
    """
    Acquire eval:run:{run_id}:lock (mutation / edit-gating lock, SET NX).

    Returns LockPayload on success, None if the key already exists.
    """
    r = _get_redis()
    key = run_lock_key(run_id)
    payload = _make_payload(job_type=job_type, job_id=job_id)
    value = orjson.dumps(payload.model_dump())
    acquired = await r.set(key, value, nx=True, ex=ttl)
    if acquired:
        return payload
    return None


async def _renew_lock(
    *,
    key: str,
    job_token: str,
    ttl: int = EVAL_LOCK_TTL,
) -> bool:
    """
    Renew a lock's TTL when the provided token matches the stored token.

    Returns True on success, False if the key is missing or token mismatches.
    Non-atomic (GET → compare → SETEX) — acceptable for 5-minute TTLs with
    30-second heartbeat windows.
    """
    r = _get_redis()
    raw = await r.get(key)
    if not raw:
        return False
    try:
        stored = orjson.loads(raw)
    except Exception:
        return False
    if stored.get("job_token") != job_token:
        return False
    stored["updated_at"] = _now_iso()
    await r.setex(key, ttl, orjson.dumps(stored))
    return True


async def renew_job_lock(
    *,
    run_id: str,
    job_id: str,
    job_token: str,
    ttl: int = EVAL_LOCK_TTL,
) -> bool:
    return await _renew_lock(
        key=job_lock_key(run_id, job_id),
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
        key=run_lock_key(run_id),
        job_token=job_token,
        ttl=ttl,
    )


async def _release_lock(
    *,
    key: str,
    job_token: str,
) -> bool:
    """
    Release a lock when the provided token matches the stored token.

    Returns True on success, False if the key is missing or token mismatches.
    """
    r = _get_redis()
    raw = await r.get(key)
    if not raw:
        return False
    try:
        stored = orjson.loads(raw)
    except Exception:
        return False
    if stored.get("job_token") != job_token:
        return False
    await r.delete(key)
    return True


async def release_job_lock(
    *,
    run_id: str,
    job_id: str,
    job_token: str,
) -> bool:
    return await _release_lock(
        key=job_lock_key(run_id, job_id),
        job_token=job_token,
    )


async def release_mutation_lock(
    *,
    run_id: str,
    job_token: str,
) -> bool:
    return await _release_lock(
        key=run_lock_key(run_id),
        job_token=job_token,
    )


# ---------------------------------------------------------------------------
# Observability helpers
# ---------------------------------------------------------------------------


async def list_active_job_locks(
    *,
    run_id: str,
) -> list[LockPayload]:
    """
    Return all active job-lock payloads for a run by scanning the key pattern.

    Uses SCAN to avoid blocking Redis.
    """
    r = _get_redis()
    pattern = job_lock_pattern(run_id)
    payloads: list[LockPayload] = []
    async for key in r.scan_iter(pattern):
        raw = await r.get(key)
        if raw:
            try:
                payloads.append(LockPayload(**orjson.loads(raw)))
            except Exception:
                pass
    return payloads


async def get_mutation_lock(
    *,
    run_id: str,
) -> Optional[LockPayload]:
    """Return the current mutation lock payload if present, else None."""
    r = _get_redis()
    raw = await r.get(run_lock_key(run_id))
    if not raw:
        return None
    try:
        return LockPayload(**orjson.loads(raw))
    except Exception:
        return None


async def is_run_executing(
    *,
    run_id: str,
) -> bool:
    """Return True if any active job locks exist for this run."""
    locks = await list_active_job_locks(run_id=run_id)
    return len(locks) > 0


async def has_mutation_lock(
    *,
    run_id: str,
) -> bool:
    """Return True if a mutation lock exists for this run."""
    return await get_mutation_lock(run_id=run_id) is not None


# ---------------------------------------------------------------------------
# Worker heartbeat
# ---------------------------------------------------------------------------


async def set_worker_heartbeat(
    *,
    worker_id: str,
    ttl: int = EVAL_LOCK_TTL,
) -> None:
    """Register or refresh the worker liveness key."""
    r = _get_redis()
    key = worker_heartbeat_key(worker_id)
    await r.setex(key, ttl, _now_iso().encode())


async def run_worker_heartbeat(
    *,
    worker_id: str,
    interval: int = EVAL_LOCK_HEARTBEAT_INTERVAL,
    ttl: int = EVAL_LOCK_TTL,
) -> None:
    """
    Background coroutine: register the worker heartbeat key and refresh it
    every `interval` seconds.  Start with asyncio.create_task() at worker boot.
    """
    try:
        while True:
            try:
                await set_worker_heartbeat(worker_id=worker_id, ttl=ttl)
            except Exception as exc:
                log.warning(
                    "[LOCK] Worker heartbeat failed",
                    worker_id=worker_id,
                    error=str(exc),
                )
            await sleep(interval)
    except CancelledError:
        log.info("[LOCK] Worker heartbeat cancelled", worker_id=worker_id)


# ---------------------------------------------------------------------------
# Job heartbeat
# ---------------------------------------------------------------------------


async def run_job_heartbeat(
    *,
    run_id: str,
    job_id: str,
    job_token: str,
    interval: int = EVAL_LOCK_HEARTBEAT_INTERVAL,
    ttl: int = EVAL_LOCK_TTL,
) -> None:
    """
    Background coroutine: renew a job lock every `interval` seconds.
    Start with asyncio.create_task() while the job is executing.
    Cancel it (or let it be collected) when the job finishes.
    """
    try:
        while True:
            await sleep(interval)
            ok = await renew_job_lock(
                run_id=run_id,
                job_id=job_id,
                job_token=job_token,
                ttl=ttl,
            )
            if not ok:
                log.warning(
                    "[LOCK] Job lock renewal failed — lock may have expired",
                    run_id=run_id,
                    job_id=job_id,
                )
    except CancelledError:
        log.info("[LOCK] Job heartbeat cancelled", run_id=run_id, job_id=job_id)
