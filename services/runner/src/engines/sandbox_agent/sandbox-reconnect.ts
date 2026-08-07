/**
 * Daytona sandbox reconnect: read the latest turn's stored sandbox id so a resumed session
 * restarts the parked (stopped/archived) sandbox instead of provisioning a fresh one.
 * Best-effort throughout: a missing/unreadable id, or a failed reconnect, degrades to a fresh
 * create (the dead rung), never a hard error.
 *
 * The live id is written forward as a field on the turn-append row (see
 * `session-continuity-durable.ts` `appendSessionTurn`), not through a separate pointer PUT: the
 * turns table is append-only, so "the latest turn's sandbox_id" IS the current pointer — a late
 * lower-index write can never win `ORDER BY turn_index DESC`, dissolving the old atomic
 * staleness guard.
 */
import { fetchLatestSessionTurn } from "./session-continuity-durable.ts";

/**
 * Sandbox ids this runner process has DELETED.
 *
 * LIFECYCLE MIGRATION, STEP 1. The stored pointer is the latest turn's `sandbox_id`, and the turns
 * table is append-only, so there is no pointer row to clear when a destroy deletes the sandbox.
 * The dead id therefore stays readable until the next turn appends its own row. Reconnecting to it
 * fails and falls through to a fresh create, which is safe but spends a provider round trip on a
 * sandbox we ourselves deleted moments earlier.
 *
 * This set closes that window inside one runner process: `markSandboxDestroyed` records the id at
 * the moment of deletion, and `readStoredSandboxPointer` refuses to hand it back.
 *
 * What it deliberately does NOT do: it is per-process and in-memory, so another replica, or this
 * replica after a restart, still reads the stale id and still falls through to a fresh create.
 * That path was always correct and stays correct. This is a latency fix with a correctness-shaped
 * name, and treating it as a durable guarantee would be wrong.
 */
const destroyedSandboxIds = new Set<string>();

/** Cap the set so a long-lived replica cannot grow it without bound. */
const DESTROYED_SANDBOX_ID_MAX = 512;

/** Record that this process deleted `sandboxId`, so it never reconnects to it. */
export function markSandboxDestroyed(sandboxId: string | undefined): void {
  if (!sandboxId) return;
  if (destroyedSandboxIds.size >= DESTROYED_SANDBOX_ID_MAX) {
    // Drop the oldest entry. Losing one only costs the failed-reconnect round trip it saved.
    const oldest = destroyedSandboxIds.values().next().value;
    if (oldest !== undefined) destroyedSandboxIds.delete(oldest);
  }
  destroyedSandboxIds.add(sandboxId);
}

/** Test seam: forget every recorded id. */
export function resetDestroyedSandboxIds(): void {
  destroyedSandboxIds.clear();
}

export interface SandboxPointerDeps {
  apiBase?: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/**
 * The stored sandbox instance id for this session, or undefined when none is recorded (first
 * turn, storage disabled, or unreachable). The id is a provider-scoped handle, so reconnect is
 * only attempted for the same provider that wrote it.
 */
export interface StoredSandboxPointer {
  sandboxId: string;
}

export async function readStoredSandboxPointer(
  sessionId: string,
  deps: SandboxPointerDeps,
): Promise<StoredSandboxPointer | undefined> {
  const latest = await fetchLatestSessionTurn(sessionId, undefined, deps);
  const id = latest?.sandbox_id;
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (destroyedSandboxIds.has(id)) {
    // This process deleted that sandbox. Reconnecting would fail, so skip straight to a fresh
    // create. See `destroyedSandboxIds`.
    deps.log?.(`ignoring pointer to sandbox=${id} destroyed by this runner`);
    return undefined;
  }
  return { sandboxId: id };
}
