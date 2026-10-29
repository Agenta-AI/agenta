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
  return { sandboxId: id };
}
