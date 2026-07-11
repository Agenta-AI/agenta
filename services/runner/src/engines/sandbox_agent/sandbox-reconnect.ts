/**
 * Daytona sandbox reconnect: read the stored sandbox id back so a resumed session restarts the
 * parked (stopped/archived) sandbox instead of provisioning a fresh one, and write the live id
 * forward after start. Best-effort throughout: a missing/unreadable id, or a failed reconnect,
 * degrades to a fresh create (the dead rung), never a hard error.
 */
import { apiBase } from "../../apiBase.ts";

export interface SandboxIdDeps {
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
export async function readStoredSandboxId(
  sessionId: string,
  deps: SandboxIdDeps,
): Promise<string | undefined> {
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
      session_state?: { sandbox_id?: string | null } | null;
    };
    const id = body.session_state?.sandbox_id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
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
export async function writeSandboxId(
  sessionId: string,
  sandboxId: string,
  deps: SandboxIdDeps,
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const res = await doFetch(
      `${base}/sessions/states/?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: deps.authorization },
        body: JSON.stringify({ sandbox_id: sandboxId }),
      },
    );
    log(`write ${res.ok ? "OK" : `HTTP ${res.status}`} session=${sessionId} sandbox=${sandboxId}`);
  } catch (err) {
    log(
      `write failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
  }
}
