"""Redis coordination plane — Python implementation.

Implements the contract in contract.py for the API side.
The runner (TypeScript) has its own parallel implementation that must agree on
every key name, TTL, and wire shape.
"""

import json
from typing import Optional, Tuple

from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.contract import (
    ALIVE_TTL_SECONDS,
    ATTACHED_TTL_SECONDS,
    CLAIM_OWNER_LUA,
    OWNER_TTL_SECONDS,
    RELEASE_IF_OWNER_LUA,
    RUNNING_TTL_SECONDS,
    SUPERSEDED_TTL_SECONDS,
    WATCHDOG_RELEASE_TURN_LUA,
    alive_key,
    attached_key,
    displaced_channel,
    make_displacement_payload,
    make_owner_value,
    owner_replica_id,
    owner_key,
    running_key,
    superseded_key,
    validate_session_id,  # noqa: F401 — re-exported for callers that import from locks
)


# ---------------------------------------------------------------------------
# Alive lock — global run lock (at most one in-flight run per session)
# ---------------------------------------------------------------------------


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
    owner_value: Optional[str],
) -> Tuple[bool, bool, bool]:
    """Atomically release only the swept turn and its observed replica owner."""
    result = await engine.eval(
        WATCHDOG_RELEASE_TURN_LUA,
        4,
        alive_key(project_id, session_id).encode(),
        running_key(project_id, session_id).encode(),
        owner_key(project_id, session_id).encode(),
        superseded_key(project_id, session_id, turn_id or "").encode(),
        (turn_id or "").encode(),
        (owner_value or "").encode(),
        SUPERSEDED_TTL_SECONDS,
    )
    return bool(int(result[0])), bool(int(result[1])), bool(int(result[2]))


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
# Owner key — session → replica affinity
# ---------------------------------------------------------------------------


async def get_owner(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> Optional[str]:
    """Return the replica id currently owning this session, or None."""
    current = await get_owner_value(
        engine, project_id=project_id, session_id=session_id
    )
    return owner_replica_id(current) if current else None


async def get_owner_value(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> Optional[str]:
    """Return the full replica + turn-generation owner value, or None."""
    key = owner_key(project_id, session_id)
    current = await engine.get(key)
    return current.decode() if current else None


async def claim_owner(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    replica_id: str,
    turn_id: Optional[str] = None,
) -> str:
    """Atomically claim ownership iff unowned or already ours, and return the actual owner.

    Never steals from a live different owner: if another replica holds it, its id is
    returned so the caller can refuse to serve a local session on the wrong host.
    """
    key = owner_key(project_id, session_id)
    owner_value = make_owner_value(replica_id=replica_id, turn_id=turn_id)
    result = await engine.eval(
        CLAIM_OWNER_LUA,
        1,
        key.encode(),
        owner_value.encode(),
        str(OWNER_TTL_SECONDS).encode(),
    )
    actual = result.decode() if isinstance(result, (bytes, bytearray)) else str(result)
    return owner_replica_id(actual)


async def clear_owner(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    replica_id: str,
) -> bool:
    """Remove the owner key if replica_id is still the owner."""
    owner_value = await get_owner_value(
        engine, project_id=project_id, session_id=session_id
    )
    if owner_value is None or owner_replica_id(owner_value) != replica_id:
        return False
    key = owner_key(project_id, session_id)
    result = await engine.eval(
        RELEASE_IF_OWNER_LUA,
        1,
        key.encode(),
        owner_value.encode(),
    )
    return result == 1


async def force_clear_owner(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> Optional[str]:
    """Forcibly delete the owner key. Returns the previous owner, or None.

    The unconditional twin of `clear_owner`, for kill: the session is being destroyed, so
    affinity must drop whichever replica held it. Without this the non-stealing `claim_owner`
    would lock the session out of every other replica for the remaining OWNER_TTL_SECONDS.
    """
    key = owner_key(project_id, session_id)
    current = await engine.get(key)
    await engine.delete(key)
    return owner_replica_id(current.decode()) if current else None


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
