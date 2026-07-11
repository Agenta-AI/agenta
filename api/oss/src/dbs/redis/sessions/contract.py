"""Redis coordination plane contract — canonical source of truth.

Key names, TTLs, payload shapes, and the release-if-owner Lua script.
The TypeScript runner implementation must mirror every constant here exactly.
The golden-fixture contract test asserts both sides agree on wire shapes.

Key namespace — every key is project-scoped:
  alive:<project_id>:session:<session_id>      — session claimed; runner owns it
  running:<project_id>:session:<session_id>    — a turn is actively executing right now
  attached:<project_id>:session:<session_id>   — attach lock (client watching live view)
  owner:<project_id>:session:<session_id>      — which replica currently owns this session
  displaced:<project_id>:session:<session_id>  — pub/sub for attach-steal notifications

`session_id` is caller-supplied and Postgres uniqueness is (project_id, session_id), so two
projects may legitimately hold the same one. The `project_id` segment is the tenant boundary:
without it a caller authorized in project A can kill, steal, or read project B's live turn by
guessing its session_id. It comes from the auth scope (`request.state.project_id` — the same
value `check_action_access` authorizes), never from a request body. Never add a key builder
that omits it.

The nest: alive ⊇ running ⊇ attached. attached ⟹ running ⟹ alive.
"""

# ---------------------------------------------------------------------------
# TTL constants (seconds)
# ---------------------------------------------------------------------------

ALIVE_TTL_SECONDS: int = 3600  # 1h — long-running agents; refreshed by heartbeat
RUNNING_TTL_SECONDS: int = 3600  # = alive; set on turn start, cleared on turn end
ATTACHED_TTL_SECONDS: int = 60  # 1min — client must refresh while watching
OWNER_TTL_SECONDS: int = 120  # 2min — affinity; refreshed by heartbeat
HEARTBEAT_INTERVAL_SECONDS: int = 30  # how often the runner sends a heartbeat
HEARTBEAT_WRITE_THRESHOLD_SECONDS: int = (
    60  # min gap between Postgres last_seen_at writes
)

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

# Atomic claim-or-read: take ownership iff the key is absent or already ours (refreshing the
# TTL), never steal it from another replica. Returns the actual owner after the operation, so
# the caller learns who won without a second racy read.
CLAIM_OWNER_LUA = """
local current = redis.call('GET', KEYS[1])
if current == false or current == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    return ARGV[1]
end
return current
""".strip()

# ---------------------------------------------------------------------------
# Concurrency cap
# ---------------------------------------------------------------------------

CONCURRENCY_LIMIT: int = 1000  # per replica; over-limit → HTTP 429

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
