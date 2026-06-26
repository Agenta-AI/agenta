// Per-session concurrency control via TWO independent Redis locks with distinct meanings:
//
//   alive:session:<sid>    — "a run is executing server-side." Held for the whole /run, its
//                            watchdog refreshes the TTL while the run executes. Survives the
//                            client HTTP connection dropping (the sidecar keeps the prompt
//                            running). Governs cancel / take-over (force).
//   attached:session:<sid> — "a client stream is currently connected and watching." Held while
//                            an /invoke->/run HTTP stream is connected; RELEASED the moment the
//                            server sees that client socket close (res 'close'), with the TTL as
//                            a backstop for hard crashes. Governs reattach.
//
// The two compose into the states we care about:
//   alive=no,  attached=no  -> idle: a new run just runs.
//   alive=yes, attached=yes -> running, someone is watching -> 409 (force = cancel+take-over).
//   alive=yes, attached=no  -> running but DETACHED (the driving tab left) -> reattachable.
//
// `force` is the general "do it anyway given the context" knob; cancel+take-over of an alive
// run is its first use.
//
// POC SIMPLIFICATIONS (would change for production):
//  1. Redis is used DIRECTLY from the sidecar — no FastAPI lock API, no separate lock service.
//     Eventually the lock surface would likely be a first-class backend API.
//  2. Cancellation is IN-PROCESS: the holder's live Session object lives in THIS sidecar, so
//     force-cancel just calls it locally. Works only because there is a SINGLE rivet sidecar
//     instance; multiple would need a cancel channel (e.g. Redis pub/sub).
import Redis from "ioredis";

const TTL_MS = Number(process.env.RUN_LOCK_TTL_MS || 5 * 60 * 1000); // matches sandbox auto-stop
const REFRESH_MS = Math.floor(TTL_MS / 3); // watchdog heartbeat well under the TTL
// the attached lock tracks a live socket, so it expires fast if the holder dies without a
// clean close; refreshed often while connected.
const ATTACHED_TTL_MS = Number(process.env.ATTACHED_TTL_MS || 20_000);
const ATTACHED_REFRESH_MS = Math.floor(ATTACHED_TTL_MS / 3);
const CANCEL_TIMEOUT_MS = Number(process.env.RUN_LOCK_CANCEL_TIMEOUT_MS || 30_000);

const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379", { maxRetriesPerRequest: 3 });
const aliveKey = (sid) => `alive:session:${sid}`;
const attachedKey = (sid) => `attached:session:${sid}`;

// in-process registry of runs THIS sidecar owns: sid -> { token, cancel() }
const active = new Map();

// act only if we still hold the token (never touch someone else's lock)
const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const REFRESH_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

function randomToken() {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

async function trySet(key, token, ttl) {
  return (await redis.set(key, token, "PX", ttl, "NX")) === "OK";
}
async function releaseToken(key, token) {
  try { await redis.eval(RELEASE_LUA, 1, key, token); } catch {}
}
// a self-refreshing hold on `key`; returns a stop() that clears the timer + releases the key.
function startRefresher(key, token, ttl, every) {
  const iv = setInterval(() => {
    redis.eval(REFRESH_LUA, 1, key, token, String(ttl)).catch(() => {});
  }, every);
  if (iv.unref) iv.unref();
  return async () => { clearInterval(iv); await releaseToken(key, token); };
}

// Acquire the ALIVE lock for `sid`, handling the busy case per `force`.
//   force=false: throw { code: "in_use" } if a run is live.
//   force=true : cancel the current holder, wait up to CANCEL_TIMEOUT_MS to re-acquire;
//                throw { code: "in_use" } if still live at the deadline (no auto-retry).
// Returns a handle: { token, setCancel(), attach(), detach(), release() }.
export async function acquire(sid, { force = false } = {}) {
  const token = randomToken();
  if (await trySet(aliveKey(sid), token, TTL_MS)) return startHold(sid, token);

  if (!force) {
    const e = new Error("session in use");
    e.code = "in_use";
    throw e;
  }

  // force = STEER: cancel the local holder so ITS /run unwinds and releases `alive`, then poll
  // to re-acquire. The cancel makes the holder's in-flight session.prompt() resolve (via
  // destroySession) — that's what frees the lock; the poll just waits for that release to land.
  const holder = active.get(sid);
  if (holder) {
    try { await holder.cancel(); } catch (e) { console.warn(`[steer ${sid}] cancel threw: ${e?.message?.slice(0, 80)}`); }
  }
  const deadline = Date.now() + CANCEL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await trySet(aliveKey(sid), token, TTL_MS)) return startHold(sid, token);
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn(`[steer ${sid}] TIMEOUT — holder never released alive`);
  const e = new Error("session still in use after force-cancel timeout");
  e.code = "in_use";
  throw e;
}

function startHold(sid, token) {
  const stopAlive = startRefresher(aliveKey(sid), token, TTL_MS, REFRESH_MS);
  let stopAttached = null;
  const handle = {
    token,
    // the run registers how to cancel its live session here so a force-takeover can reach it
    setCancel(fn) { active.set(sid, { token, cancel: fn }); },
    // mark this run as actively watched by a connected client stream (own token, own TTL).
    async attach() {
      const atok = randomToken();
      // take the attached lock; if someone else holds it, steal it (the alive lock is the real
      // gate — attached is just "who is watching", and this run owns the alive lock).
      await redis.set(attachedKey(sid), atok, "PX", ATTACHED_TTL_MS);
      stopAttached = startRefresher(attachedKey(sid), atok, ATTACHED_TTL_MS, ATTACHED_REFRESH_MS);
    },
    // client socket closed -> drop attached but KEEP live (the run keeps executing server-side).
    async detach() {
      if (stopAttached) { await stopAttached(); stopAttached = null; }
    },
    async release() {
      if (stopAttached) { await stopAttached(); stopAttached = null; }
      if (active.get(sid)?.token === token) active.delete(sid);
      await stopAlive();
    },
  };
  return handle;
}

// CANCEL the alive run for `sid` WITHOUT taking it over (no re-prompt). Cancels the local
// holder's session; the holder's own /run unwinds and releases the alive lock in its finally.
// Returns whether a holder was found to cancel (false = nothing live in this sidecar).
export async function cancel(sid) {
  const holder = active.get(sid);
  if (!holder) return false;
  try { await holder.cancel(); } catch {}
  return true;
}

// read-only snapshot of both locks for a session.
export async function status(sid) {
  const [alive, attached] = await redis.mget(aliveKey(sid), attachedKey(sid));
  return { alive: alive !== null, attached: attached !== null };
}

export { CANCEL_TIMEOUT_MS };
