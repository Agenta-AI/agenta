"""Redis coordination plane — Python implementation.

Implements the contract in contract.py for the API side.
The runner (TypeScript) has its own parallel implementation that must agree on
every key name, TTL, and wire shape.
"""

import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, List, Optional, Tuple
from uuid import uuid4

from oss.src.utils.logging import get_module_logger
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.contract import (
    ALIVE_TTL_SECONDS,
    ACQUIRE_ALIVE_WITH_START_LUA,
    ATTACHED_TTL_SECONDS,
    DISPLACE_TURNS_LUA,
    RECONCILE_STOPPED_TURN_LUA,
    RELEASE_IF_OWNER_LUA,
    RUNNING_TTL_SECONDS,
    SUPERSEDED_TTL_SECONDS,
    TURN_BOUND_TTL_SECONDS,
    TURN_STARTED_TTL_SECONDS,
    WATCHDOG_RELEASE_TURN_LUA,
    TurnBinding,
    alive_key,
    attached_key,
    displaced_channel,
    make_displacement_payload,
    make_turn_binding_value,
    parse_turn_binding_value,
    running_key,
    superseded_key,
    turn_bound_key,
    turn_started_key,
    validate_session_id,  # noqa: F401 — re-exported for callers that import from locks
)

log = get_module_logger(__name__)

_RENEW_IF_OWNER_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
"""


class SessionHeartbeatGuardLost(RuntimeError):
    pass


@dataclass
class SessionHeartbeatGuardLease:
    session_id: str
    lost: bool = False

    def ensure_held(self) -> None:
        if self.lost:
            raise SessionHeartbeatGuardLost(
                f"heartbeat guard lease was lost for session {self.session_id}"
            )


# ---------------------------------------------------------------------------
# Alive lock — global run lock (at most one in-flight run per session)
# ---------------------------------------------------------------------------


@asynccontextmanager
async def session_heartbeat_guard(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    lease_seconds: int = 30,
    renewal_seconds: float = 10.0,
    wait_seconds: float = 5.0,
) -> AsyncIterator[SessionHeartbeatGuardLease]:
    """Serialize heartbeat ownership changes with watchdog fencing for one session."""
    key = f"heartbeat-guard:{project_id}:session:{session_id}"
    token = str(uuid4()).encode()
    loop = asyncio.get_running_loop()
    deadline = loop.time() + wait_seconds
    while await engine.set(key, token, nx=True, ex=lease_seconds) is None:
        if asyncio.get_running_loop().time() >= deadline:
            raise TimeoutError(f"heartbeat guard timed out for session {session_id}")
        await asyncio.sleep(0.01)

    lease = SessionHeartbeatGuardLease(session_id=session_id)
    renewed_at = loop.time()

    async def renew() -> None:
        nonlocal renewed_at
        while True:
            await asyncio.sleep(renewal_seconds)
            try:
                renewed = await engine.eval(
                    _RENEW_IF_OWNER_LUA,
                    1,
                    key.encode(),
                    token,
                    str(lease_seconds).encode(),
                )
            except Exception:
                log.warning(
                    "heartbeat guard renewal failed; retrying before lease expiry",
                    session_id=session_id,
                    exc_info=True,
                )
                if loop.time() - renewed_at >= lease_seconds:
                    lease.lost = True
                    return
                continue
            if renewed != 1:
                lease.lost = True
                return
            renewed_at = loop.time()

    renewal = asyncio.create_task(renew())
    try:
        yield lease
    finally:
        renewal.cancel()
        await asyncio.gather(renewal, return_exceptions=True)
        try:
            await engine.eval(RELEASE_IF_OWNER_LUA, 1, key.encode(), token)
        except Exception:
            log.warning(
                "heartbeat guard release failed; lease will expire",
                session_id=session_id,
                exc_info=True,
            )


async def acquire_alive(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> bool:
    """Attempt to acquire the alive lock for session_id, owned by turn_id.

    Returns True on success, False if already held.
    """
    key = alive_key(project_id, session_id)
    result = await engine.set(
        key,
        turn_id.encode(),
        nx=True,
        ex=ALIVE_TTL_SECONDS,
    )
    return result is not None


async def acquire_alive_with_start(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> bool:
    """Atomically acquire `alive` and record its first start on the Redis clock."""
    result = await engine.eval(
        ACQUIRE_ALIVE_WITH_START_LUA,
        2,
        alive_key(project_id, session_id).encode(),
        turn_started_key(project_id, session_id, turn_id).encode(),
        turn_id.encode(),
        ALIVE_TTL_SECONDS,
        TURN_STARTED_TTL_SECONDS,
    )
    return result == 1


async def refresh_alive(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> bool:
    """Refresh the alive TTL only if turn_id still owns it."""
    key = alive_key(project_id, session_id)
    current = await engine.get(key)
    if current and current.decode() == turn_id:
        await engine.expire(key, ALIVE_TTL_SECONDS)
        return True
    return False


async def release_alive(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> bool:
    """Release the alive lock if turn_id is still the owner."""
    key = alive_key(project_id, session_id)
    result = await engine.eval(
        RELEASE_IF_OWNER_LUA,
        1,
        key.encode(),
        turn_id.encode(),
    )
    return result == 1


async def force_cancel_alive(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> Optional[str]:
    """Forcibly delete the alive lock. Returns the previous owner, or None."""
    key = alive_key(project_id, session_id)
    current = await engine.get(key)
    await engine.delete(key)
    return current.decode() if current else None


async def get_alive_owner(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> Optional[str]:
    """Return the current alive lock owner (turn_id), or None."""
    key = alive_key(project_id, session_id)
    current = await engine.get(key)
    return current.decode() if current else None


# ---------------------------------------------------------------------------
# Turn supersession tombstones — "this turn lost the nest; it is dead forever"
#
# `alive` outlives its turn and a parked turn holds no `running`, so the state
# "`alive` held by another turn + no `running`" cannot, from the locks alone, tell a
# lapsed previous turn (a legitimate handover) from a live-but-parked one. Rather than
# guess, we record the one thing that IS knowable at the moment it happens: a turn that
# was displaced. A displaced turn's later beats are refused outright, so a zombie beat
# can never re-take a nest it already lost — which is what made the ambiguity reachable.
# ---------------------------------------------------------------------------


async def mark_turn_superseded(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> None:
    """Tombstone turn_id: it was displaced (handover, cancel, steer, kill, sweep)."""
    key = superseded_key(project_id, session_id, turn_id)
    await engine.set(key, b"1", ex=SUPERSEDED_TTL_SECONDS)


async def is_turn_superseded(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> bool:
    """True if turn_id was displaced. Refreshes the TTL on every hit so a long-lived
    zombie that keeps beating stays dead instead of outliving its own tombstone."""
    key = superseded_key(project_id, session_id, turn_id)
    current = await engine.get(key)
    if current is None:
        return False
    await engine.expire(key, SUPERSEDED_TTL_SECONDS)
    return True


async def release_watchdog_turn(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: Optional[str],
) -> Tuple[bool, bool]:
    """Atomically release only the swept turn's `alive` and `running`, and tombstone it."""
    result = await engine.eval(
        WATCHDOG_RELEASE_TURN_LUA,
        3,
        alive_key(project_id, session_id).encode(),
        running_key(project_id, session_id).encode(),
        superseded_key(project_id, session_id, turn_id or "").encode(),
        (turn_id or "").encode(),
        SUPERSEDED_TTL_SECONDS,
    )
    return bool(int(result[0])), bool(int(result[1]))


# ---------------------------------------------------------------------------
# Turn start times — "when did this turn first take the session?"
#
# A cancel that is applied after the turn it meant has ended tombstones whichever turn holds
# the nest, which can be the NEXT turn (the stop-then-send race behind #6417). Refusing that
# needs one thing the coordination plane never recorded: when the holding turn started. It
# cannot be derived. `session_turns.start_time` is written by the runner after the fact, and a
# browser turn's id is a runner-minted uuid4, so it carries no time.
# ---------------------------------------------------------------------------


async def record_turn_start(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
    started_at_ms: Optional[int] = None,
) -> int:
    """Record this turn's start once, then keep the record alive for as long as `alive` is.

    Write-once (nx): a turn that re-takes its own lock after a raced beat keeps its FIRST
    start time, which is the one the guard must compare against. Returns the recorded start,
    which is the stored one when a record already exists.
    """
    key = turn_started_key(project_id, session_id, turn_id)
    now_ms = await redis_time_ms(engine) if started_at_ms is None else started_at_ms
    written = await engine.set(
        key,
        str(now_ms).encode(),
        nx=True,
        ex=TURN_STARTED_TTL_SECONDS,
    )
    if written is not None:
        return now_ms
    current = await engine.get(key)
    await engine.expire(key, TURN_STARTED_TTL_SECONDS)
    try:
        return int(current.decode()) if current else now_ms
    except ValueError:
        return now_ms


async def redis_time_ms(engine: LockEngine) -> int:
    """Read the shared Redis clock in epoch milliseconds."""
    seconds, microseconds = await engine.time()
    return int(seconds) * 1000 + int(microseconds) // 1000


async def displace_turns(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    expected_turn_id: Optional[str] = None,
    arrived_at_ms: Optional[int] = None,
    running_only: bool = False,
) -> Tuple[bool, Optional[str], List[str]]:
    """Atomically validate, tombstone, and clear the alive/running owners."""
    result = await engine.eval(
        DISPLACE_TURNS_LUA,
        2,
        alive_key(project_id, session_id).encode(),
        running_key(project_id, session_id).encode(),
        (expected_turn_id or "").encode(),
        "" if arrived_at_ms is None else str(arrived_at_ms),
        superseded_key(project_id, session_id, "").encode(),
        turn_started_key(project_id, session_id, "").encode(),
        SUPERSEDED_TTL_SECONDS,
        "1" if running_only else "0",
    )

    def _decode(value) -> str:
        return value.decode() if isinstance(value, (bytes, bytearray)) else str(value)

    accepted = bool(result) and int(result[0]) == 1
    if not accepted:
        return False, _decode(result[1]) if len(result) > 1 else None, []
    turn_ids = list(
        dict.fromkeys(_decode(value) for value in result[1:] if _decode(value))
    )
    return True, None, turn_ids


async def reconcile_stopped_turn(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> bool:
    """Atomically tombstone a stopped turn and release only its `running` generation."""
    result = await engine.eval(
        RECONCILE_STOPPED_TURN_LUA,
        2,
        running_key(project_id, session_id).encode(),
        superseded_key(project_id, session_id, turn_id).encode(),
        turn_id.encode(),
        SUPERSEDED_TTL_SECONDS,
    )
    return result == 1


async def get_turn_start(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> Optional[int]:
    """This turn's start in epoch milliseconds, or None when nothing recorded one.

    None means "unknown", never "old". Every caller must treat it as unknown and fall back to
    the behavior it had before this key existed: a turn from before this code shipped, or one
    whose record outlived its TTL, must not become uncancellable.
    """
    key = turn_started_key(project_id, session_id, turn_id)
    current = await engine.get(key)
    if current is None:
        return None
    try:
        return int(current.decode())
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Running lock — "a turn is actively executing right now"
# Nested under alive: a session can be alive-but-idle (running absent) between turns.
# ---------------------------------------------------------------------------


async def acquire_running(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> None:
    """Mark the session as running this turn (overwrites — steer/send own the turn)."""
    key = running_key(project_id, session_id)
    await engine.set(key, turn_id.encode(), ex=RUNNING_TTL_SECONDS)


async def refresh_running(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> bool:
    """Refresh the running TTL only if turn_id still owns it."""
    key = running_key(project_id, session_id)
    current = await engine.get(key)
    if current and current.decode() == turn_id:
        await engine.expire(key, RUNNING_TTL_SECONDS)
        return True
    return False


async def release_running(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> bool:
    """Clear the running lock only if turn_id still owns it.

    The unconditional `clear_running` is right for displacement and the orphan sweep, which
    mean to evict whoever holds it. It is wrong for a turn reporting its own end: a stale
    turn's final beat would delete the live turn's lock and publish `ended` underneath it.
    Atomic, so the owner cannot change between the read and the delete.
    """
    key = running_key(project_id, session_id)
    result = await engine.eval(
        RELEASE_IF_OWNER_LUA,
        1,
        key.encode(),
        turn_id.encode(),
    )
    return result == 1


async def clear_running(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> Optional[str]:
    """Unconditionally clear the running lock (displacement/sweep). Returns prior turn."""
    key = running_key(project_id, session_id)
    current = await engine.get(key)
    await engine.delete(key)
    return current.decode() if current else None


async def get_running_owner(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> Optional[str]:
    """Return the current running lock owner (turn_id), or None."""
    key = running_key(project_id, session_id)
    current = await engine.get(key)
    return current.decode() if current else None


# ---------------------------------------------------------------------------
# Attached lock — "a client is watching this session's live view"
# ---------------------------------------------------------------------------


async def steal_attached(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    watcher_id: str,
) -> None:
    """Unconditionally claim the attached lock and displace any prior watcher.

    Publishes a displacement message on the session's displaced channel before
    overwriting so the prior watcher can tear down cleanly.
    """
    key = attached_key(project_id, session_id)
    channel = displaced_channel(project_id, session_id)

    payload = json.dumps(make_displacement_payload(by=watcher_id))
    await engine.publish(channel, payload.encode())

    await engine.set(key, watcher_id.encode(), ex=ATTACHED_TTL_SECONDS)


async def refresh_attached(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    watcher_id: str,
) -> bool:
    """Refresh the attached TTL only if watcher_id still owns it."""
    key = attached_key(project_id, session_id)
    current = await engine.get(key)
    if current and current.decode() == watcher_id:
        await engine.expire(key, ATTACHED_TTL_SECONDS)
        return True
    return False


async def release_attached(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    watcher_id: str,
) -> bool:
    """Release attached lock if watcher_id owns it. Never cancels the run."""
    key = attached_key(project_id, session_id)
    result = await engine.eval(
        RELEASE_IF_OWNER_LUA,
        1,
        key.encode(),
        watcher_id.encode(),
    )
    return result == 1


async def get_attached_owner(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> Optional[str]:
    """Return the current attached lock owner (watcher_id), or None."""
    key = attached_key(project_id, session_id)
    current = await engine.get(key)
    return current.decode() if current else None


# ---------------------------------------------------------------------------
# Turn binding — "which runner pod holds this turn"
#
# Written by the heartbeat, read by Stop delivery. A turn never moves between pods, so the
# binding is write-once: the first pod to beat a turn holds it for the turn's life, and any
# other pod beating the same turn id is refused.
# ---------------------------------------------------------------------------


async def bind_turn(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
    replica_id: str,
    replica_address: str,
) -> Tuple[TurnBinding, bool]:
    """Bind turn_id to the calling replica unless one is bound already.

    Returns the stored binding and whether this call wrote it. Only the bound replica's beat
    refreshes the TTL, so a refused replica cannot keep a binding alive that is not its own.

    No script: SET NX is atomic across api processes, so exactly one caller writes the key and
    every other caller reads back the winner. A key that expires between the failed NX and the
    read-back gets one more NX attempt, so the turn is never left unbound.
    """
    key = turn_bound_key(project_id, session_id, turn_id)
    proposed = TurnBinding(replica_id=replica_id, replica_address=replica_address)
    value = make_turn_binding_value(
        replica_id=replica_id, replica_address=replica_address
    ).encode()
    current = None
    for _ in range(2):
        if await engine.set(key, value, nx=True, ex=TURN_BOUND_TTL_SECONDS) is not None:
            return proposed, True
        current = await engine.get(key)
        if current is not None:
            break
    if current is None:
        return proposed, False
    binding = parse_turn_binding_value(current.decode())
    if binding.replica_id == replica_id:
        await engine.expire(key, TURN_BOUND_TTL_SECONDS)
    return binding, False


async def get_turn_binding(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> Optional[TurnBinding]:
    """The runner pod that holds turn_id, or None when no pod has beaten it yet."""
    current = await engine.get(turn_bound_key(project_id, session_id, turn_id))
    return parse_turn_binding_value(current.decode()) if current else None


# ---------------------------------------------------------------------------
# Liveness snapshot — used for 409 response body
# ---------------------------------------------------------------------------


async def get_session_liveness(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> dict:
    """Return the {alive, running, attached} nest snapshot.

    The three primitive bools; resumable/reattachable are derived client-side.
    """
    alive = await get_alive_owner(engine, project_id=project_id, session_id=session_id)
    running = await get_running_owner(
        engine, project_id=project_id, session_id=session_id
    )
    attached = await get_attached_owner(
        engine, project_id=project_id, session_id=session_id
    )
    return {
        "alive": alive is not None,
        "running": running is not None,
        "attached": attached is not None,
    }
