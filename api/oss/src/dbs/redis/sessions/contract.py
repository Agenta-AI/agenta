"""Redis coordination plane contract — canonical source of truth.

Key names, TTLs, payload shapes, and the release-if-owner Lua script.
The TypeScript runner implementation must mirror every constant here exactly.
The golden-fixture contract test asserts both sides agree on wire shapes.

Key namespace — every key is project-scoped:
  alive:<project_id>:session:<session_id>      — session claimed; runner owns it
  running:<project_id>:session:<session_id>    — a turn is actively executing right now
  attached:<project_id>:session:<session_id>   — attach lock (client watching live view)
  owner:<project_id>:session:<session_id>      — replica + turn generation owning this session
  displaced:<project_id>:session:<session_id>  — pub/sub for attach-steal notifications
  watch:<project_id>:session:<session_id>      — pub/sub for the live relay (SSE watch)
  superseded:<project_id>:session:<session_id>:turn:<turn_id>
                                               — tombstone: this turn lost the nest and is
                                                 dead forever (API-side only; the runner
                                                 learns it through `is_current_turn`)

`session_id` is caller-supplied and Postgres uniqueness is (project_id, session_id), so two
projects may legitimately hold the same one. The `project_id` segment is the tenant boundary:
without it a caller authorized in project A can kill, steal, or read project B's live turn by
guessing its session_id. It comes from the auth scope (`request.state.project_id` — the same
value `check_action_access` authorizes), never from a request body. Never add a key builder
that omits it.

The nest: alive ⊇ running ⊇ attached. attached ⟹ running ⟹ alive.
"""

from oss.src.utils.env import env

# ---------------------------------------------------------------------------
# TTL constants (seconds) — sourced from env.py; defaults match the golden
# fixture (services/runner/tests/fixtures/sessions/redis_contract.json).
# Changing a default requires updating that fixture and the TS side too.
# ---------------------------------------------------------------------------

ALIVE_TTL_SECONDS: int = env.sessions.alive_ttl_seconds
RUNNING_TTL_SECONDS: int = env.sessions.running_ttl_seconds
ATTACHED_TTL_SECONDS: int = env.sessions.attached_ttl_seconds
OWNER_TTL_SECONDS: int = env.sessions.owner_ttl_seconds
HEARTBEAT_INTERVAL_SECONDS: int = env.sessions.heartbeat_interval_seconds
HEARTBEAT_WRITE_THRESHOLD_SECONDS: int = env.sessions.heartbeat_write_threshold_seconds

# API-side only — the runner never reads the tombstone key, so this constant is
# deliberately absent from the shared golden fixture (like `watch_heartbeat_seconds`).
SUPERSEDED_TTL_SECONDS: int = env.sessions.superseded_ttl_seconds

# API-side owner payload. The runner reaches affinity through the heartbeat response and never
# reads this Redis value directly. Unit Separator cannot occur in either UUID-like component and
# keeps legacy bare-replica values unambiguous.
OWNER_VALUE_SEPARATOR = "\x1f"


def make_owner_value(*, replica_id: str, turn_id: str | None) -> str:
    return f"{replica_id}{OWNER_VALUE_SEPARATOR}{turn_id or ''}"


def owner_replica_id(owner_value: str) -> str:
    return owner_value.split(OWNER_VALUE_SEPARATOR, 1)[0]


# ---------------------------------------------------------------------------
# Key builders
# ---------------------------------------------------------------------------


def alive_key(project_id: str, session_id: str) -> str:
    return f"alive:{project_id}:session:{session_id}"


def running_key(project_id: str, session_id: str) -> str:
    return f"running:{project_id}:session:{session_id}"


def attached_key(project_id: str, session_id: str) -> str:
    return f"attached:{project_id}:session:{session_id}"


def owner_key(project_id: str, session_id: str) -> str:
    return f"owner:{project_id}:session:{session_id}"


def superseded_key(project_id: str, session_id: str, turn_id: str) -> str:
    return f"superseded:{project_id}:session:{session_id}:turn:{turn_id}"


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
#   {"type": "interaction",     "session_id": s, "status": "pending"|"resolved"}
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


def make_watch_records_changed_payload(*, session_id: str) -> dict:
    return {"type": WATCH_EVENT_RECORDS_CHANGED, "session_id": session_id}


def make_watch_lifecycle_payload(*, session_id: str, state: str) -> dict:
    return {"type": WATCH_EVENT_LIFECYCLE, "session_id": session_id, "state": state}


def make_watch_interaction_payload(*, session_id: str, status: str) -> dict:
    return {"type": WATCH_EVENT_INTERACTION, "session_id": session_id, "status": status}


def make_watch_entity_changed_payload(*, entity: str, id: str) -> dict:
    return {"type": f"{entity}-changed", "entity": entity, "id": id}


# ---------------------------------------------------------------------------
# Release-if-owner Lua scripts
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
# another turn after the database commit, so every destructive Redis action must compare the
# value captured before the guarded stream update. The swept turn is tombstoned regardless of
# whether its old lock keys still exist.
WATCHDOG_RELEASE_TURN_LUA = """
-- AGENTA_WATCHDOG_RELEASE_TURN
local expected_turn = ARGV[1]
local expected_owner = ARGV[2]
local superseded_ttl = tonumber(ARGV[3])
local alive = redis.call('GET', KEYS[1]) or ''
local running = redis.call('GET', KEYS[2]) or ''
local owner = redis.call('GET', KEYS[3]) or ''
local released_alive = 0
local released_running = 0
local released_owner = 0

if expected_turn ~= '' and alive == expected_turn then
    released_alive = redis.call('DEL', KEYS[1])
end
if expected_turn ~= '' and running == expected_turn then
    released_running = redis.call('DEL', KEYS[2])
end

local foreign_turn = (alive ~= '' and alive ~= expected_turn)
    or (running ~= '' and running ~= expected_turn)
if expected_owner ~= '' and owner == expected_owner and not foreign_turn then
    released_owner = redis.call('DEL', KEYS[3])
end

if expected_turn ~= '' then
    redis.call('SET', KEYS[4], '1', 'EX', superseded_ttl)
end

return {released_alive, released_running, released_owner}
""".strip()

# Atomic claim-or-read: take ownership iff the key is absent or already belongs to this replica,
# refreshing both its TTL and turn generation. Returns the full actual value without a second
# racy read. Bare legacy values compare as their own replica id and are upgraded on refresh.
CLAIM_OWNER_LUA = """
local current = redis.call('GET', KEYS[1])
local separator = string.char(31)
local function replica(value)
    local boundary = string.find(value, separator, 1, true)
    if boundary then
        return string.sub(value, 1, boundary - 1)
    end
    return value
end
if current == false or replica(current) == replica(ARGV[1]) then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    return ARGV[1]
end
return current
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
