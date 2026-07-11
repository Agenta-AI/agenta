/**
 * Daytona sandbox reconnect: read the stored sandbox id back so a resumed session restarts the
 * parked (stopped/archived) sandbox instead of provisioning a fresh one, and write the live id
 * forward after start. Best-effort throughout: a missing/unreadable id, or a failed reconnect,
 * degrades to a fresh create (the dead rung), never a hard error.
 */
import { apiBase } from "../../apiBase.ts";

export interface SandboxPointerDeps {
  apiBase?: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

function defaultLog(msg: string): void {
  process.stderr.write(`[sandbox-reconnect] ${msg}\n`);
}

/**
 * The stored sandbox instance id for this session, or undefined when none is recorded (first
 * turn, storage disabled, or unreachable). The id is a provider-scoped handle, so reconnect is
 * only attempted for the same provider that wrote it.
 */
export interface StoredSandboxPointer {
  sandboxId: string;
  fingerprint: string | undefined;
}

export interface SandboxPointerWrite {
  sandboxId: string;
  fingerprint: string | undefined;
  turnIndex: number;
}

export type SandboxPointerWriteOutcome = "applied" | "rejected" | "failed";

export async function readStoredSandboxPointer(
  sessionId: string,
  deps: SandboxPointerDeps,
): Promise<StoredSandboxPointer | undefined> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const res = await doFetch(
      `${base}/sessions/states/?session_id=${encodeURIComponent(sessionId)}`,
      { method: "GET", headers: { authorization: deps.authorization } },
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      session_state?: {
        sandbox_id?: string | null;
        sandbox_fingerprint?: string | null;
      } | null;
    };
    const id = body.session_state?.sandbox_id;
    if (typeof id !== "string" || id.length === 0) return undefined;
    const fingerprint = body.session_state?.sandbox_fingerprint;
    return {
      sandboxId: id,
      fingerprint:
        typeof fingerprint === "string" && fingerprint.length > 0
          ? fingerprint
          : undefined,
    };
  } catch (err) {
    log(
      `read failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return undefined;
  }
}

/**
 * Write the live sandbox instance id forward (best-effort) so the next turn can reconnect it.
 * A local run records the literal "local"; a remote run records the provisioned instance id.
 */
export async function writeSandboxPointer(
  sessionId: string,
  pointer: SandboxPointerWrite,
  deps: SandboxPointerDeps,
): Promise<SandboxPointerWriteOutcome> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const res = await doFetch(
      `${base}/sessions/states/?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: deps.authorization },
        body: JSON.stringify({
          sandbox_id: pointer.sandboxId,
          sandbox_fingerprint: pointer.fingerprint ?? null,
          sandbox_turn_index: pointer.turnIndex,
        }),
      },
    );
    if (!res.ok) {
      log(`write HTTP ${res.status} session=${sessionId} sandbox=${pointer.sandboxId}`);
      return "failed";
    }
    const body = (await res.json()) as {
      session_state?: { sandbox_id?: string | null } | null;
    };
    return body.session_state?.sandbox_id === pointer.sandboxId ? "applied" : "rejected";
  } catch (err) {
    log(
      `write failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return "failed";
  }
}

/** Clear a terminal sandbox pointer under the same turn-index guard as pointer writes. */
export async function clearSandboxPointer(
  sessionId: string,
  turnIndex: number,
  deps: SandboxPointerDeps,
): Promise<SandboxPointerWriteOutcome> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const res = await doFetch(
      `${base}/sessions/states/?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: deps.authorization },
        body: JSON.stringify({
          sandbox_id: null,
          sandbox_fingerprint: null,
          sandbox_turn_index: turnIndex,
        }),
      },
    );
    if (!res.ok) {
      log(`clear HTTP ${res.status} session=${sessionId}`);
      return "failed";
    }
    const body = (await res.json()) as {
      session_state?: { sandbox_id?: string | null } | null;
    };
    return body.session_state?.sandbox_id == null ? "applied" : "rejected";
  } catch (err) {
    log(
      `clear failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return "failed";
  }
}
