"""Redis coordination plane — Python implementation.

Implements the contract in contract.py for the API side.
The runner (TypeScript) has its own parallel implementation that must agree on
every key name, TTL, and wire shape.
"""

import json
from typing import Optional

from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.contract import (
    ALIVE_TTL_SECONDS,
    ATTACHED_TTL_SECONDS,
    CLAIM_OWNER_LUA,
    OWNER_TTL_SECONDS,
    RELEASE_IF_OWNER_LUA,
    RUNNING_TTL_SECONDS,
    alive_key,
    attached_key,
    displaced_channel,
    make_displacement_payload,
    owner_key,
    running_key,
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


async def clear_running(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
) -> Optional[str]:
    """Unconditionally clear the running lock (turn ended/cancelled). Returns prior turn."""
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
    key = owner_key(project_id, session_id)
    current = await engine.get(key)
    return current.decode() if current else None


async def claim_owner(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    replica_id: str,
) -> str:
    """Atomically claim ownership iff unowned or already ours, and return the actual owner.

    Never steals from a live different owner: if another replica holds it, its id is
    returned so the caller can refuse to serve a local session on the wrong host.
    """
    key = owner_key(project_id, session_id)
    result = await engine.eval(
        CLAIM_OWNER_LUA,
        1,
        key.encode(),
        replica_id.encode(),
        str(OWNER_TTL_SECONDS).encode(),
    )
    return result.decode() if isinstance(result, (bytes, bytearray)) else str(result)


async def clear_owner(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    replica_id: str,
) -> bool:
    """Remove the owner key if replica_id is still the owner."""
    key = owner_key(project_id, session_id)
    result = await engine.eval(
        RELEASE_IF_OWNER_LUA,
        1,
        key.encode(),
        replica_id.encode(),
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
    return current.decode() if current else None


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
