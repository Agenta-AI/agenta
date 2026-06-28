/**
 * Redis coordination plane contract — TypeScript implementation.
 *
 * Mirrors api/oss/src/dbs/redis/sessions/contract.py exactly.
 * The Python side is the canonical source of truth; keep these in sync.
 * The golden-fixture contract test (tests/unit/session-redis-contract.test.ts)
 * asserts both sides agree on key names, TTLs, and payload shapes.
 */

// ---------------------------------------------------------------------------
// TTL constants (seconds)
// ---------------------------------------------------------------------------

export const ALIVE_TTL_SECONDS = 3600;
export const ATTACHED_TTL_SECONDS = 60;
export const OWNER_TTL_SECONDS = 120;
export const HEARTBEAT_INTERVAL_SECONDS = 30;
export const HEARTBEAT_WRITE_THRESHOLD_SECONDS = 60;

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

export function aliveKey(sessionId: string): string {
  return `alive:session:${sessionId}`;
}

export function attachedKey(sessionId: string): string {
  return `attached:session:${sessionId}`;
}

export function ownerKey(sessionId: string): string {
  return `owner:session:${sessionId}`;
}

export function displacedChannel(sessionId: string): string {
  return `displaced:session:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Displacement channel payload shape
// ---------------------------------------------------------------------------

export const DISPLACEMENT_REASON_STOLEN = "stolen";

export interface DisplacementPayload {
  reason: string;
  by: string;
}

export function makeDisplacementPayload(by: string): DisplacementPayload {
  return { reason: DISPLACEMENT_REASON_STOLEN, by };
}

// ---------------------------------------------------------------------------
// Release-if-owner Lua script (canonical — must match the Python side exactly)
// ---------------------------------------------------------------------------

export const RELEASE_IF_OWNER_LUA = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
`.trim();

// ---------------------------------------------------------------------------
// Concurrency cap
// ---------------------------------------------------------------------------

export const CONCURRENCY_CAP = 1000;

// ---------------------------------------------------------------------------
// Session id validation
// ---------------------------------------------------------------------------

export const SESSION_ID_MAX_LEN = 128;
export const SESSION_ID_PATTERN = /^[a-zA-Z0-9_\-]{1,128}$/;

export function validateSessionId(sessionId: string): boolean {
  if (sessionId.length > SESSION_ID_MAX_LEN) return false;
  return SESSION_ID_PATTERN.test(sessionId);
}
