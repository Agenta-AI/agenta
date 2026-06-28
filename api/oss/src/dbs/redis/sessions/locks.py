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
    OWNER_TTL_SECONDS,
    RELEASE_IF_OWNER_LUA,
    alive_key,
    attached_key,
    displaced_channel,
    make_displacement_payload,
    owner_key,
    validate_session_id,  # noqa: F401 — re-exported for callers that import from locks
)


# ---------------------------------------------------------------------------
# Alive lock — global run lock (at most one in-flight run per session)
# ---------------------------------------------------------------------------


async def acquire_alive(
    engine: LockEngine,
    *,
    session_id: str,
    run_id: str,
) -> bool:
    """Attempt to acquire the alive lock for session_id, owned by run_id.

    Returns True on success, False if already held.
    """
    key = alive_key(session_id)
    result = await engine.set(
        key,
        run_id.encode(),
        nx=True,
        ex=ALIVE_TTL_SECONDS,
    )
    return result is not None


async def refresh_alive(
    engine: LockEngine,
    *,
    session_id: str,
    run_id: str,
) -> bool:
    """Refresh the alive TTL only if run_id still owns it."""
    key = alive_key(session_id)
    current = await engine.get(key)
    if current and current.decode() == run_id:
        await engine.expire(key, ALIVE_TTL_SECONDS)
        return True
    return False


async def release_alive(
    engine: LockEngine,
    *,
    session_id: str,
    run_id: str,
) -> bool:
    """Release the alive lock if run_id is still the owner."""
    key = alive_key(session_id)
    result = await engine.eval(
        RELEASE_IF_OWNER_LUA,
        1,
        key.encode(),
        run_id.encode(),
    )
    return result == 1


async def force_cancel_alive(
    engine: LockEngine,
    *,
    session_id: str,
) -> Optional[str]:
    """Forcibly delete the alive lock. Returns the previous owner, or None."""
    key = alive_key(session_id)
    current = await engine.get(key)
    await engine.delete(key)
    return current.decode() if current else None


async def get_alive_owner(
    engine: LockEngine,
    *,
    session_id: str,
) -> Optional[str]:
    """Return the current alive lock owner (run_id), or None."""
    key = alive_key(session_id)
    current = await engine.get(key)
    return current.decode() if current else None


# ---------------------------------------------------------------------------
# Attached lock — "a client is watching this session's live view"
# ---------------------------------------------------------------------------


async def steal_attached(
    engine: LockEngine,
    *,
    session_id: str,
    watcher_id: str,
) -> None:
    """Unconditionally claim the attached lock and displace any prior watcher.

    Publishes a displacement message on the session's displaced channel before
    overwriting so the prior watcher can tear down cleanly.
    """
    key = attached_key(session_id)
    channel = displaced_channel(session_id)

    payload = json.dumps(make_displacement_payload(by=watcher_id))
    await engine.publish(channel, payload.encode())

    await engine.set(key, watcher_id.encode(), ex=ATTACHED_TTL_SECONDS)


async def refresh_attached(
    engine: LockEngine,
    *,
    session_id: str,
    watcher_id: str,
) -> bool:
    """Refresh the attached TTL only if watcher_id still owns it."""
    key = attached_key(session_id)
    current = await engine.get(key)
    if current and current.decode() == watcher_id:
        await engine.expire(key, ATTACHED_TTL_SECONDS)
        return True
    return False


async def release_attached(
    engine: LockEngine,
    *,
    session_id: str,
    watcher_id: str,
) -> bool:
    """Release attached lock if watcher_id owns it. Never cancels the run."""
    key = attached_key(session_id)
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
    session_id: str,
) -> Optional[str]:
    """Return the current attached lock owner (watcher_id), or None."""
    key = attached_key(session_id)
    current = await engine.get(key)
    return current.decode() if current else None


# ---------------------------------------------------------------------------
# Owner key — session → replica affinity
# ---------------------------------------------------------------------------


async def set_owner(
    engine: LockEngine,
    *,
    session_id: str,
    replica_id: str,
) -> None:
    """Record which replica owns this session."""
    key = owner_key(session_id)
    await engine.set(key, replica_id.encode(), ex=OWNER_TTL_SECONDS)


async def refresh_owner(
    engine: LockEngine,
    *,
    session_id: str,
    replica_id: str,
) -> bool:
    """Refresh the owner TTL if replica_id is still the owner."""
    key = owner_key(session_id)
    current = await engine.get(key)
    if current and current.decode() == replica_id:
        await engine.expire(key, OWNER_TTL_SECONDS)
        return True
    return False


async def get_owner(
    engine: LockEngine,
    *,
    session_id: str,
) -> Optional[str]:
    """Return the replica id currently owning this session, or None."""
    key = owner_key(session_id)
    current = await engine.get(key)
    return current.decode() if current else None


async def clear_owner(
    engine: LockEngine,
    *,
    session_id: str,
    replica_id: str,
) -> bool:
    """Remove the owner key if replica_id is still the owner."""
    key = owner_key(session_id)
    result = await engine.eval(
        RELEASE_IF_OWNER_LUA,
        1,
        key.encode(),
        replica_id.encode(),
    )
    return result == 1


# ---------------------------------------------------------------------------
# Liveness snapshot — used for 409 response body
# ---------------------------------------------------------------------------


async def get_session_liveness(
    engine: LockEngine,
    *,
    session_id: str,
) -> dict:
    """Return {alive, attached, reattachable} snapshot for 409 responses."""
    alive = await get_alive_owner(engine, session_id=session_id)
    attached = await get_attached_owner(engine, session_id=session_id)
    return {
        "alive": alive is not None,
        "attached": attached is not None,
        "reattachable": alive is not None,
    }
