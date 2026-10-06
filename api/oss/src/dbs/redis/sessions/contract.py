"""Redis coordination plane contract — canonical source of truth.

Key names, TTLs, payload shapes, and the release-if-owner Lua script.
The TypeScript runner implementation must mirror every constant here exactly.
The golden-fixture contract test asserts both sides agree on wire shapes.

Key namespace — every key is project-scoped:
  alive:<project_id>:session:<session_id>      — session claimed; runner owns it
  running:<project_id>:session:<session_id>    — a turn is actively executing right now
  attached:<project_id>:session:<session_id>   — attach lock (client watching live view)
  displaced:<project_id>:session:<session_id>  — pub/sub for attach-steal notifications
  watch:<project_id>:session:<session_id>      — pub/sub for the live relay (SSE watch)
  superseded:<project_id>:session:<session_id>:turn:<turn_id>
                                               — tombstone: this turn lost the nest and is
                                                 dead forever (API-side only; the runner
                                                 learns it through `is_current_turn`)
  started:<project_id>:session:<session_id>:turn:<turn_id>
                                               — when this turn first took `alive`, in epoch
                                                 milliseconds (API-side only; see below)
  bound:<project_id>:session:<session_id>:turn:<turn_id>
                                               — the runner pod that holds this turn:
                                                 `<replica_id>\\x1f<replica_address>`
                                                 (API-side only; see below)

`session_id` is caller-supplied and Postgres uniqueness is (project_id, session_id), so two
projects may legitimately hold the same one. The `project_id` segment is the tenant boundary:
without it a caller authorized in project A can kill, steal, or read project B's live turn by
guessing its session_id. It comes from the auth scope (`request.state.project_id` — the same
value `check_action_access` authorizes), never from a request body. Never add a key builder
that omits it.

The nest: alive ⊇ running ⊇ attached. attached ⟹ running ⟹ alive.
"""

from typing import Any, Dict, List, NamedTuple, Optional

from oss.src.utils.env import env

# ---------------------------------------------------------------------------
# TTL constants (seconds) — sourced from env.py; defaults match the golden
# fixture (services/runner/tests/fixtures/sessions/redis_contract.json).
# Changing a default requires updating that fixture and the TS side too.
# ---------------------------------------------------------------------------

ALIVE_TTL_SECONDS: int = env.sessions.alive_ttl_seconds
RUNNING_TTL_SECONDS: int = env.sessions.running_ttl_seconds
ATTACHED_TTL_SECONDS: int = env.sessions.attached_ttl_seconds
HEARTBEAT_INTERVAL_SECONDS: int = env.sessions.heartbeat_interval_seconds
HEARTBEAT_WRITE_THRESHOLD_SECONDS: int = env.sessions.heartbeat_write_threshold_seconds

# API-side only — the runner never reads the tombstone key, so this constant is
# deliberately absent from the shared golden fixture (like `watch_heartbeat_seconds`).
SUPERSEDED_TTL_SECONDS: int = env.sessions.superseded_ttl_seconds

# The turn-start key lives exactly as long as `alive` can: it answers "did this turn start
# before that cancel arrived?", and a turn with no `alive` cannot be cancelled. Reusing
# ALIVE_TTL keeps the two in step without a new setting.
TURN_STARTED_TTL_SECONDS: int = ALIVE_TTL_SECONDS

# The turn binding follows the same rule for the same reason: it routes a Stop to the pod that
# holds the turn, and a parked turn holds `alive` without beating, so the binding must last as
# long as `alive` can.
TURN_BOUND_TTL_SECONDS: int = ALIVE_TTL_SECONDS

# The heartbeat refuses a replica id that holds a control character, so the first Unit
# Separator always ends the id and the split is unambiguous.
TURN_BINDING_SEPARATOR = "\x1f"


class TurnBinding(NamedTuple):
    """The runner pod that holds a turn.

    `replica_id` is the pod's identity. `replica_address` is the URL that reaches that pod, or
    empty when the pod reported none or could not prove it is runner infrastructure; empty means
    "use the Service URL".
    """

    replica_id: str
    replica_address: str


def make_turn_binding_value(*, replica_id: str, replica_address: str) -> str:
    return f"{replica_id}{TURN_BINDING_SEPARATOR}{replica_address}"


def parse_turn_binding_value(value: str) -> TurnBinding:
    replica_id, _, replica_address = value.partition(TURN_BINDING_SEPARATOR)
    return TurnBinding(replica_id=replica_id, replica_address=replica_address)


# ---------------------------------------------------------------------------
# Key builders
# ---------------------------------------------------------------------------


def alive_key(project_id: str, session_id: str) -> str:
    return f"alive:{project_id}:session:{session_id}"


def running_key(project_id: str, session_id: str) -> str:
    return f"running:{project_id}:session:{session_id}"


def attached_key(project_id: str, session_id: str) -> str:
    return f"attached:{project_id}:session:{session_id}"


def superseded_key(project_id: str, session_id: str, turn_id: str) -> str:
    return f"superseded:{project_id}:session:{session_id}:turn:{turn_id}"


def turn_started_key(project_id: str, session_id: str, turn_id: str) -> str:
    """When this turn first took the alive lock, in epoch milliseconds.

    API-side only, like the tombstone above: the runner never reads it, so it stays out of
    the shared golden fixture. It exists because nothing else records a turn's start early
    enough to be useful. `session_turns.start_time` is written by the runner some time after
    the turn begins, and a browser turn's id is a runner-minted uuid4
    (`services/runner/src/server.ts:188`), so no timestamp can be read out of the id either.
    """
    return f"started:{project_id}:session:{session_id}:turn:{turn_id}"


def turn_bound_key(project_id: str, session_id: str, turn_id: str) -> str:
    """Which runner pod holds this turn, as a `make_turn_binding_value` string.

    API-side only, like `started`: the runner reports its id and address on the heartbeat and
    never reads this key. A sibling of `started` rather than a second value inside it, because
    two readers parse `started` as a number.
    """
    return f"bound:{project_id}:session:{session_id}:turn:{turn_id}"


def displaced_channel(project_id: str, session_id: str) -> str:
    return f"displaced:{project_id}:session:{session_id}"


# ---------------------------------------------------------------------------
# Displacement channel payload shape
# {"reason": "stolen", "by": "<new_owner_id>"}
# ---------------------------------------------------------------------------

DISPLACEMENT_REASON_STOLEN = "stolen"


def make_displacement_payload(*, by: str) -> dict:
    return {"reason": DISPLACEMENT_REASON_STOLEN, "by": by}


# ---------------------------------------------------------------------------
# Watch channels — change notifications, never record payloads.
# Published on the DURABLE Redis plane (the SSE endpoint subscribes there via
# get_streams_engine(); publisher and subscriber must share one plane — the
# displaced channel above lives on the volatile plane instead).
# Per-session channels carry high-frequency in-session traffic; the project
# channel carries low-frequency entity changes for list pages.
# Payload shapes:
#   {"type": "records-changed", "session_id": s}
#   {"type": "lifecycle",       "session_id": s, "state": "running"|"ended"}
#   {"type": "interaction",     "session_id": s, "status": "pending"|"resolved",
#                                    "interactions": [...]?}
#   {"type": "<entity>-changed", "entity": entity, "id": id}
# ---------------------------------------------------------------------------

WATCH_EVENT_RECORDS_CHANGED = "records-changed"
WATCH_EVENT_LIFECYCLE = "lifecycle"
WATCH_EVENT_INTERACTION = "interaction"
# Emitted by the SSE endpoint itself, never published: it marks the point where the Redis
# subscription is live, so a client can revalidate without racing the events it is about to
# start receiving.
WATCH_EVENT_READY = "ready"

WATCH_LIFECYCLE_RUNNING = "running"
WATCH_LIFECYCLE_ENDED = "ended"

WATCH_INTERACTION_PENDING = "pending"
WATCH_INTERACTION_RESOLVED = "resolved"


def watch_channel(project_id: str, session_id: str) -> str:
    return f"watch:{project_id}:session:{session_id}"


def project_watch_channel(project_id: str) -> str:
    return f"watch:{project_id}:project"


def live_events_channel(project_id: str, session_id: str) -> str:
    return f"events:{project_id}:session:{session_id}"


def make_watch_records_changed_payload(*, session_id: str) -> dict:
    return {"type": WATCH_EVENT_RECORDS_CHANGED, "session_id": session_id}


def make_watch_lifecycle_payload(*, session_id: str, state: str) -> dict:
    return {"type": WATCH_EVENT_LIFECYCLE, "session_id": session_id, "state": state}


def make_watch_interaction_payload(
    *, session_id: str, status: str, interactions: Optional[List[Dict[str, Any]]] = None
) -> dict:
    payload = {
        "type": WATCH_EVENT_INTERACTION,
        "session_id": session_id,
        "status": status,
    }
    if interactions is not None:
        payload["interactions"] = interactions
    return payload


def make_watch_entity_changed_payload(*, entity: str, id: str) -> dict:
    return {"type": f"{entity}-changed", "entity": entity, "id": id}


# ---------------------------------------------------------------------------
# Coordination Lua scripts
# These are the canonical scripts; both Python and TS implementations must
# use the same logic (same key/argv layout; different runtime bindings).
#
# release_if_owner_script:
#   KEYS[1] = the lock key
#   ARGV[1] = the owner value to check
#   Returns 1 if deleted, 0 if not owner or key gone.
# ---------------------------------------------------------------------------

RELEASE_IF_OWNER_LUA = """
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
""".strip()

# Atomically release only the generation the watchdog swept. A new Send or Steer may install
# another turn after the database commit, so every destructive Redis action must compare against
# the swept turn. The swept turn is tombstoned regardless of whether its old lock keys still exist.
WATCHDOG_RELEASE_TURN_LUA = """
-- AGENTA_WATCHDOG_RELEASE_TURN
local expected_turn = ARGV[1]
local superseded_ttl = tonumber(ARGV[2])
local alive = redis.call('GET', KEYS[1]) or ''
local running = redis.call('GET', KEYS[2]) or ''
local released_alive = 0
local released_running = 0

if expected_turn ~= '' and alive == expected_turn then
    released_alive = redis.call('DEL', KEYS[1])
end
if expected_turn ~= '' and running == expected_turn then
    released_running = redis.call('DEL', KEYS[2])
end

if expected_turn ~= '' then
    redis.call('SET', KEYS[3], '1', 'EX', superseded_ttl)
end

return {released_alive, released_running}
""".strip()

ACQUIRE_ALIVE_WITH_START_LUA = """
-- AGENTA_ACQUIRE_ALIVE_WITH_START
if redis.call('GET', KEYS[1]) then
    return 0
end
local now = redis.call('TIME')
local now_ms = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
if redis.call('SET', KEYS[2], tostring(now_ms), 'NX', 'EX', ARGV[3]) == false then
    redis.call('EXPIRE', KEYS[2], ARGV[3])
end
return 1
""".strip()

DISPLACE_TURNS_LUA = """
-- AGENTA_DISPLACE_TURNS
local alive = redis.call('GET', KEYS[1]) or ''
local running = redis.call('GET', KEYS[2]) or ''
local expected = ARGV[1]
local arrived_at_ms = tonumber(ARGV[2])
local superseded_prefix = ARGV[3]
local started_prefix = ARGV[4]
local superseded_ttl = tonumber(ARGV[5])
local running_only = ARGV[6] == '1'

local function is_mismatch(owner)
    if owner == '' then
        return false
    end
    if expected ~= '' then
        return owner ~= expected
    end
    if arrived_at_ms then
        local started_at_ms = tonumber(redis.call('GET', started_prefix .. owner))
        return started_at_ms and started_at_ms > arrived_at_ms
    end
    return false
end

if not running_only and is_mismatch(alive) then
    return {0, alive}
end
if (running_only or running ~= alive) and is_mismatch(running) then
    return {0, running}
end

local seen = {}
local function supersede(turn_id)
    if turn_id ~= '' and not seen[turn_id] then
        redis.call('SET', superseded_prefix .. turn_id, '1', 'EX', superseded_ttl)
        seen[turn_id] = true
    end
end

if not running_only then
    supersede(alive)
end
supersede(running)
supersede(expected)
if running_only then
    if alive == running and running ~= '' then
        redis.call('DEL', KEYS[1])
    end
    redis.call('DEL', KEYS[2])
else
    redis.call('DEL', KEYS[1], KEYS[2])
end
local returned_alive = alive
if running_only then
    returned_alive = ''
end
return {1, returned_alive, running, expected}
""".strip()

# Atomically tombstone a durably stopped execution and release `running` only if that exact
# generation still owns it. `alive` deliberately survives so the native harness stays warm.
RECONCILE_STOPPED_TURN_LUA = """
-- AGENTA_RECONCILE_STOPPED_TURN
local expected = ARGV[1]
redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[2]))
if redis.call('GET', KEYS[1]) == expected then
    return redis.call('DEL', KEYS[1])
end
return 0
""".strip()

# ---------------------------------------------------------------------------
# Concurrency cap
# ---------------------------------------------------------------------------

CONCURRENCY_LIMIT: int = (
    env.sessions.concurrency_limit
)  # per replica; over-limit → HTTP 429

# ---------------------------------------------------------------------------
# Session id validation
# Simple length cap + character allowlist to guard against path/key injection.
# ---------------------------------------------------------------------------

SESSION_ID_MAX_LEN: int = 128
SESSION_ID_PATTERN: str = r"^[a-zA-Z0-9_\-]{1,128}$"


def validate_session_id(session_id: str) -> bool:
    """Return True if session_id matches the contract's allowlist pattern."""
    import re

    if not session_id or len(session_id) > SESSION_ID_MAX_LEN:
        return False
    return bool(re.match(SESSION_ID_PATTERN, session_id))
