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

from pydantic import ValidationError

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.utils.logging import get_module_logger
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.contract import (
    ALIVE_TTL_SECONDS,
    ACQUIRE_ALIVE_WITH_START_LUA,
    ATTACHED_TTL_SECONDS,
    BEAT_BIND_TURN_LUA,
    BIND_TURN_LUA,
    CURRENT_TURN_ADMISSION_LUA,
    DISPLACE_TURNS_LUA,
    RECONCILE_STOPPED_TURN_LUA,
    RELEASE_IF_OWNER_LUA,
    RUNNING_TTL_SECONDS,
    SUPERSEDED_TTL_SECONDS,
    TURN_BINDING_SEPARATOR,
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
    turn_admitted_key,
    turn_bound_key,
    turn_started_key,
    validate_session_id,  # noqa: F401 — re-exported for callers that import from locks
)

log = get_module_logger(__name__)


@dataclass(frozen=True)
class TurnAdmission:
    """Who a turn's checked heartbeat admitted: the principal and the signed run origin
    it ran with. A shortcut counts only for the same principal AND origin, so a person's
    server run (origin subscription, child, evaluation) never opens its turn to the same
    person's browser or web run."""

    principal: PrincipalRef
    origin: Optional[str] = None

    def admits(self, *, principal: PrincipalRef, origin: Optional[object]) -> bool:
        value = getattr(origin, "value", origin)
        return (
            self.origin is not None
            and self.principal == principal
            and self.origin == (str(value) if value is not None else None)
        )


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
    """
    written, stored = await engine.eval(
        BIND_TURN_LUA,
        1,
        turn_bound_key(project_id, session_id, turn_id).encode(),
        make_turn_binding_value(
            replica_id=replica_id, replica_address=replica_address
        ).encode(),
        f"{replica_id}{TURN_BINDING_SEPARATOR}".encode(),
        TURN_BOUND_TTL_SECONDS,
    )
    return parse_turn_binding_value(stored.decode()), int(written) == 1


async def bind_turn_for_beat(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
    replica_id: str,
    replica_address: str,
    admitted: Optional[TurnAdmission] = None,
) -> Optional[Tuple[TurnBinding, bool]]:
    """A beat's supersession check, `bind_turn` and admission record in one script.

    None when the turn was displaced (its tombstone is renewed, nothing is bound). Else
    the stored binding and whether this call wrote it, as `bind_turn`; `admitted`, when
    given, is recorded (as `record_turn_admission` would) when this replica holds the
    binding.
    """
    written, stored = await engine.eval(
        BEAT_BIND_TURN_LUA,
        3,
        superseded_key(project_id, session_id, turn_id).encode(),
        turn_bound_key(project_id, session_id, turn_id).encode(),
        turn_admitted_key(project_id, session_id, turn_id).encode(),
        make_turn_binding_value(
            replica_id=replica_id, replica_address=replica_address
        ).encode(),
        f"{replica_id}{TURN_BINDING_SEPARATOR}".encode(),
        TURN_BOUND_TTL_SECONDS,
        SUPERSEDED_TTL_SECONDS,
        _admission_value(admitted) if admitted is not None else b"",
        TURN_BOUND_TTL_SECONDS,
    )
    if int(written) == -1:
        return None
    return parse_turn_binding_value(stored.decode()), int(written) == 1


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


async def get_routable_turn_binding(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> Optional[TurnBinding]:
    """The binding of turn_id when it carries an address, else None (use the Service URL).

    Never raises: the address is a routing hint, so a failed read costs a cold turn, never the
    read or the delivery it rides on.
    """
    try:
        binding = await get_turn_binding(
            engine, project_id=project_id, session_id=session_id, turn_id=turn_id
        )
    except Exception as error:  # noqa: BLE001 - the address is optional
        log.warning(
            "could not read the turn binding for session=%s turn=%s: %s",
            session_id,
            turn_id,
            error,
        )
        return None
    return binding if binding and binding.replica_address else None


# ---------------------------------------------------------------------------
# Turn admission — "which principal this turn's heartbeat admitted"
#
# Written after a heartbeat passed `RunAdmission`, read by the next running beat of the same
# turn and by the runner write routes: when it names the caller's principal, the check is
# skipped (verified continuity). It counts only while its turn holds the session's `running`
# lock, read at the same instant (one script, or one `MGET`), so an old turn's id never
# reuses it. Same TTL as the turn binding; every verified heartbeat renews it, like
# `bind_turn` renews the binding, so a long turn is not rechecked only because the record
# expired. A runner write reads it with `running` in the request's one cache read and never
# renews it: a turn whose beats stopped loses the free path when the record expires. The turn's end beat, its displacement and its
# stop delete it. Any Redis failure reads as "no record", which means a full check, never
# continuity.
# ---------------------------------------------------------------------------


def _admission_value(admission: TurnAdmission) -> bytes:
    principal = admission.principal
    return f"{principal.kind.value}:{principal.id}:{admission.origin or ''}".encode()


def _parse_admission_value(raw: Optional[bytes]) -> Optional[TurnAdmission]:
    """`<kind>:<id>:<origin>`. A record an earlier build wrote (`<kind>:<id>`, no origin)
    reads with no origin, which no shortcut accepts: that turn's next beat is checked."""
    if not raw:
        return None
    value = raw.decode() if isinstance(raw, (bytes, bytearray)) else str(raw)
    kind, _, rest = value.partition(":")
    principal_id, _, origin = rest.partition(":")
    try:
        return TurnAdmission(
            principal=PrincipalRef(kind=PrincipalKind(kind), id=principal_id),
            origin=origin or None,
        )
    except (ValueError, ValidationError):
        return None


async def record_turn_admission(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
    admission: TurnAdmission,
) -> None:
    """Record that this turn's heartbeat admitted `admission`. A Redis error is logged and
    swallowed: the beat already passed, and the next beat is checked again."""
    try:
        await engine.set(
            turn_admitted_key(project_id, session_id, turn_id),
            _admission_value(admission),
            ex=TURN_BOUND_TTL_SECONDS,
        )
    except Exception as error:  # noqa: BLE001 - a lost record only costs a check
        log.warning(
            "[sharing] admission record not written",
            project_id=project_id,
            session_id=session_id,
            turn_id=turn_id,
            error=type(error).__name__,
        )


async def get_turn_admission(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
) -> Optional[TurnAdmission]:
    """What this turn's heartbeat admitted, when the turn is the session's current
    one (it holds `running`), renewing the record's TTL in the same round trip (one
    script). `None` when there is no record, the turn is not current, or Redis fails
    (logged): the caller then runs the full check."""
    try:
        raw = await engine.eval(
            CURRENT_TURN_ADMISSION_LUA,
            2,
            running_key(project_id, session_id).encode(),
            turn_admitted_key(project_id, session_id, turn_id).encode(),
            turn_id.encode(),
            TURN_BOUND_TTL_SECONDS,
        )
    except Exception as error:  # noqa: BLE001 - fail closed: a full check
        log.warning(
            "[sharing] admission record unavailable",
            project_id=project_id,
            session_id=session_id,
            turn_id=turn_id,
            error=type(error).__name__,
        )
        return None
    return _parse_admission_value(raw)


def turn_admission_entries(
    *, project_id: str, session_id: str, turn_id: str
) -> Tuple[dict, dict]:
    """The two plain keys a runner write reads for its turn's admission: the session's
    `running` key and the turn's `admitted` key, as raw `get_cache_many` entries. A
    route registers them before its access decision, so its one `MGET` reads them
    (an `MGET` reads both keys at one instant, as the script does)."""

    return (
        {"raw": running_key(project_id, session_id)},
        {"raw": turn_admitted_key(project_id, session_id, turn_id)},
    )


def admission_from_values(
    *, running: Optional[bytes], admitted: Optional[bytes], turn_id: str
) -> Optional[TurnAdmission]:
    """What `CURRENT_TURN_ADMISSION_LUA` answers, from the two keys read at one instant:
    the admitted principal only while `running` holds this turn. A missing key, another
    turn, or an unreadable value is None (the caller runs the full check). No renewal:
    the turn's heartbeats renew the record (every steady beat, through
    `get_turn_admission`)."""

    if running is None or admitted is None:
        return None
    value = (
        running.decode() if isinstance(running, (bytes, bytearray)) else str(running)
    )
    if value != turn_id:
        return None
    return _parse_admission_value(admitted)


async def forget_turn_admissions(
    engine: LockEngine,
    *,
    project_id: str,
    session_id: str,
    turn_ids: List[str],
) -> None:
    """Delete the admission records of turns that ended, were displaced or stopped. A
    Redis error is logged and swallowed: a surviving record no longer counts once its
    turn does not hold `running`."""
    keys = [
        turn_admitted_key(project_id, session_id, turn_id).encode()
        for turn_id in dict.fromkeys(turn_ids)
        if turn_id
    ]
    if not keys:
        return
    try:
        await engine.delete(*keys)
    except Exception as error:  # noqa: BLE001 - the record is inert without `running`
        log.warning(
            "[sharing] admission records not deleted",
            project_id=project_id,
            session_id=session_id,
            error=type(error).__name__,
        )


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
