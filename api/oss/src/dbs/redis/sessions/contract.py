"""Redis coordination plane contract — canonical source of truth.

Key names, TTLs, payload shapes, and the release-if-owner Lua script.
The TypeScript runner implementation must mirror every constant here exactly.
The golden-fixture contract test asserts both sides agree on wire shapes.

Key namespace:
  alive:session:<session_id>      — global run lock (at most one in-flight run)
  attached:session:<session_id>   — attach lock (client watching live view)
  owner:session:<session_id>      — which replica currently owns this session
  displaced:session:<session_id>  — pub/sub channel for attach-steal notifications
"""

# ---------------------------------------------------------------------------
# TTL constants (seconds)
# ---------------------------------------------------------------------------

ALIVE_TTL_SECONDS: int = 3600  # 1h — long-running agents; refreshed by heartbeat
ATTACHED_TTL_SECONDS: int = 60  # 1min — client must refresh while watching
OWNER_TTL_SECONDS: int = 120  # 2min — affinity; refreshed by heartbeat
HEARTBEAT_INTERVAL_SECONDS: int = 30  # how often the runner sends a heartbeat
HEARTBEAT_WRITE_THRESHOLD_SECONDS: int = (
    60  # min gap between Postgres last_seen_at writes
)

# ---------------------------------------------------------------------------
# Key builders
# ---------------------------------------------------------------------------


def alive_key(session_id: str) -> str:
    return f"alive:session:{session_id}"


def attached_key(session_id: str) -> str:
    return f"attached:session:{session_id}"


def owner_key(session_id: str) -> str:
    return f"owner:session:{session_id}"


def displaced_channel(session_id: str) -> str:
    return f"displaced:session:{session_id}"


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

# ---------------------------------------------------------------------------
# Concurrency cap
# ---------------------------------------------------------------------------

CONCURRENCY_CAP: int = 1000  # per replica; over-limit → HTTP 429

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
