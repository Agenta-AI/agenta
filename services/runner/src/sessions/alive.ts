/**
 * Runner-side alive-lock ownership + heartbeat.
 *
 * When a run is session-owned (request carries `sessionId` + `turnId`), the runner
 * acquires the `alive` Redis lock and self-refreshes it for the turn's lifetime so the
 * coordination plane sees the session as live independent of any client connection.
 *
 * Two distinct ids ride the heartbeat (multi-container correctness):
 *  - `replica_id` — this runner CONTAINER's stable id (minted once per process). The API binds
 *    each turn to the first replica that beats it and refuses every other replica for that turn.
 *  - `turn_id`    — the current TURN's id (one per execution). Proves alive-lock ownership.
 * Every beat also carries `replica_address` and the runner token, so the API can send a Stop
 * for the turn straight to this pod.
 *
 * Uses the HTTP API instead of direct Redis (the API is the single Redis writer).
 *
 * Key contract constants mirror `sessions/contract.ts`; do not duplicate them.
 */

import { fetchControlPlane, type ControlPlaneRetry } from "./control-plane-fetch.ts";
import { envTimerMs } from "../env.ts";
import { apiBase } from "../apiBase.ts";
import { randomUUID } from "node:crypto";

import { HEARTBEAT_INTERVAL_SECONDS } from "./contract.ts";

const REFRESH_INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1000;

export const HEARTBEAT_TIMEOUT_ENV = "AGENTA_RUNNER_HEARTBEAT_TIMEOUT_MS";
/**
 * A beat that never answers must not outlive its interval.
 *
 * The beat used a bare `fetch` with no signal, so a stalled socket never settled: beats piled
 * up behind it, and the final `is_running: false` beat in `release()` could hold the request
 * open after the turn had already ended. Half an interval keeps at most one beat in flight.
 */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = Math.floor(REFRESH_INTERVAL_MS / 2);

function heartbeatTimeoutMs(): number {
  return envTimerMs(HEARTBEAT_TIMEOUT_ENV, DEFAULT_HEARTBEAT_TIMEOUT_MS);
}

/**
 * This runner container's stable id, minted once per process. An orchestrator can inject a
 * meaningful id (pod/container name) via `AGENTA_RUNNER_REPLICA_ID`; otherwise a random
 * uuid per process. Distinct from any turn id — many turns share one replica_id, and with 2+
 * containers each must hold its own, or two pods could both be admitted to one turn.
 */
export const REPLICA_ID =
  process.env.AGENTA_RUNNER_REPLICA_ID?.trim() || randomUUID();

/**
 * The URL that reaches THIS process directly (on Kubernetes, `http://<pod IP>:<port>`), so a
 * Stop for one of its turns reaches it rather than whichever pod the Service URL picks. Empty
 * on compose and Railway, where the API reads empty as "use the Service URL".
 */
export const REPLICA_ADDRESS =
  process.env.AGENTA_RUNNER_REPLICA_ADDRESS?.trim() ?? "";

import { startPlatformCredentialLease } from "./auth.ts";
import type { TypedReference } from "./interactions.ts";

/**
 * Fill-once session facts this run proposes alongside the beat. The server writes each only
 * while the stored value is NULL, so every beat may carry them: a beat can fill a NULL field
 * once, never change an existing one, and the "heartbeats don't churn headers" invariant holds.
 */
export interface SessionProposal {
  /** A name for an otherwise-untitled session (see `sessions/name.ts`). */
  name?: string;
  /** The run's workflow references, so the stream row is openable without a turn append. */
  references?: TypedReference[];
}

/** A turn's admission waits for a throttled or restarting platform as every control-plane call does. */
const ADMISSION_RETRY: ControlPlaneRetry = {};

function log(msg: string): void {
  process.stderr.write(`[sessions/alive] ${msg}\n`);
}

/**
 * Send one heartbeat to keep the `alive` lock and the `session_streams` row live. Carries the
 * container `replica_id` (the turn binds to it) and the `turn_id` (proves alive ownership).
 * Authenticates AS the invoke caller (the run credential) — project scope is resolved server-side
 * from that credential, so no `project_id` rides the request. The runner token rides next to it
 * on its own header: the API stores `replica_address` only from a beat that carries it, because
 * a Stop later sends that same token to the address.
 *
 * Returns the signals the one response body carries: `streamId` (the `session_streams` row
 * uuid — the free gift of a call the runner already makes every turn, no new round-trip) and
 * `interrupted: true` when the API reports `is_current_turn: false` (a cancel/steer/kill took
 * this turn's alive/running lock since the last beat — W7.4, the control-signal path). A
 * network/HTTP failure is unconfirmed and unowned. Initial admission fails closed, and a durable
 * continuation additionally requires an explicit ownership response before reporting `started`.
 */
async function sendHeartbeat(
  sessionId: string,
  turnId: string,
  authorization: string,
  isRunning = true,
  proposal?: SessionProposal,
  /** Only the admission beat is retried; for a periodic beat the next beat is the retry. */
  retry?: ControlPlaneRetry,
): Promise<{
  streamId: string | undefined;
  interrupted: boolean;
  confirmed: boolean;
  owned: boolean;
}> {
  try {
    const url = `${apiBase()}/sessions/streams/heartbeat`;
    const runnerToken = process.env.AGENTA_RUNNER_TOKEN?.trim();
    const beat = (signal?: AbortSignal) =>
        fetch(url, {
          method: "POST",
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(heartbeatTimeoutMs())]) : AbortSignal.timeout(heartbeatTimeoutMs()),
          headers: {
            "content-type": "application/json",
            authorization,
            ...(runnerToken ? { "x-agenta-runner-token": runnerToken } : {}),
          },
          body: JSON.stringify({
            session_id: sessionId,
            replica_id: REPLICA_ID,
            replica_address: REPLICA_ADDRESS,
            turn_id: turnId,
            is_running: isRunning,
            ...(proposal?.name ? { name: proposal.name } : {}),
            ...(proposal?.references?.length
              ? { references: proposal.references }
              : {}),
          }),
        });
    const res = retry ? await fetchControlPlane(beat, retry) : await beat();
    if (!res.ok) {
      log(`heartbeat HTTP ${res.status} session=${sessionId} turn=${turnId}`);
      return {
        streamId: undefined,
        interrupted: false,
        confirmed: false,
        owned: false,
      };
    }
    const body = (await res.json()) as {
      stream?: { id?: unknown } | null;
      is_current_turn?: unknown;
    };
    const rawStreamId = body.stream?.id;
    const streamId =
      typeof rawStreamId === "string" && rawStreamId.length > 0
        ? rawStreamId
        : undefined;
    const interrupted = body.is_current_turn === false;
    log(
      `heartbeat OK session=${sessionId} turn=${turnId} running=${isRunning}${interrupted ? " INTERRUPTED" : ""}`,
    );
    const owned = body.is_current_turn === true;
    return { streamId, interrupted, confirmed: true, owned };
  } catch (err) {
    log(
      `heartbeat failed session=${sessionId} turn=${turnId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return {
      streamId: undefined,
      interrupted: false,
      confirmed: false,
      owned: false,
    };
  }
}

/**
 * Start the alive-lock watchdog for a session-owned turn.
 *
 * The lock was acquired by the API (in `_start_turn`) before the turn started — the runner
 * inherits ownership via `turnId`. This watchdog heartbeats the API on the contract interval,
 * keeping the lock's TTL refreshed and the stream row `running`.
 *
 * `onInterrupted` (W7.4) fires AT MOST ONCE, the first time a beat reports the lock was taken
 * by a cancel/steer/kill since the last beat — the caller wires this to `controller.abort()` so
 * a control-plane cancel actually reaches the in-flight run. Before this, losing the alive lock
 * was invisible to the runner process: a heartbeat's nx=True re-acquire silently re-armed the
 * same lock under the same turn_id and the run continued as if nothing happened.
 *
 * Awaits the FIRST heartbeat (only) so its response's `stream_id` is ready before the caller
 * starts the turn — every later heartbeat stays fire-and-forget. Returns a `release()` function
 * the caller MUST await in the run's `finally` so the heartbeat stops and the row is marked
 * `ended`.
 *
 * That first beat is also this turn's ADMISSION request, and `admitted` reports its answer. The
 * beat's `nx` acquire of the `alive` lock is the platform's single atomic arbiter of "who runs
 * this session" (`api/oss/src/core/sessions/streams/service.py`), and it already refuses a turn
 * that arrives while a different turn holds `running`, and the same turn when another replica
 * already beat it. Reading that answer BEFORE the caller
 * touches the sandbox is what makes at-most-one-execution-per-session true: a refused turn stops
 * at the edge instead of reaching the keepalive pool and destroying the live turn's environment.
 *
 * Initial admission fails closed unless the coordination plane confirms this turn owns the lock.
 * Later heartbeat failures remain best effort and do not abort an already-admitted healthy turn.
 *
 * `proposal` rides EVERY beat rather than only the first. The server fills each field once, so
 * repeating them is a no-op, and one payload for all beats beats a "was this the first?" flag.
 */
export async function startAliveWatchdog(
  sessionId: string,
  turnId: string,
  authorization: string,
  onInterrupted?: () => void,
  proposal?: SessionProposal,
): Promise<{
  release: () => Promise<void>;
  /** Stop heartbeating without publishing turn-end; used before durable admission. */
  abandon: () => void;
  credential: () => string;
  streamId: () => string | undefined;
  /** False when the FIRST beat reported `is_current_turn: false` — another turn owns the session. */
  admitted: boolean;
  /** True when the platform never answered the first beat: nothing is known about ownership. */
  admissionUnconfirmed: boolean;
  /** True only when the awaited first heartbeat confirmed this turn owns the session. */
  firstBeatOwned: boolean;
}> {
  // Session coordination and standalone turns share this lease. The watchdog owns it here so
  // heartbeat, persistence, and trace export all observe the same current credential.
  const credentialLease = startPlatformCredentialLease(
    apiBase(),
    authorization,
  );
  let interruptedFired = false;
  let streamId: string | undefined;

  const handleBeat = (result: {
    streamId: string | undefined;
    interrupted: boolean;
    owned: boolean;
  }): void => {
    if (result.streamId) streamId = result.streamId;
    if (result.interrupted && !interruptedFired) {
      interruptedFired = true;
      log(`interrupted session=${sessionId} turn=${turnId} -> aborting`);
      onInterrupted?.();
    }
  };

  // Await the FIRST beat so streamId is ready before the caller starts the turn. It is this
  // turn's admission, so a throttled or restarting platform is asked again rather than read as
  // a refusal.
  const first = await sendHeartbeat(
    sessionId,
    turnId,
    credentialLease.credential(),
    true,
    proposal,
    ADMISSION_RETRY,
  );
  handleBeat(first);

  // One beat in flight at a time. `setInterval` fires unconditionally, so without this a
  // slow API stacks a new request every 30s on top of every request already waiting.
  let beatInFlight = false;
  const interval = setInterval(() => {
    if (beatInFlight) {
      log(`heartbeat skipped (previous still in flight) session=${sessionId}`);
      return;
    }
    beatInFlight = true;
    void (async () => {
      try {
        handleBeat(
          await sendHeartbeat(
            sessionId,
            turnId,
            credentialLease.credential(),
            true,
            proposal,
          ),
        );
      } finally {
        beatInFlight = false;
      }
    })();
  }, REFRESH_INTERVAL_MS);

  // Allow the Node process to exit even if the interval is still running.
  if ((interval as unknown as { unref?: () => void }).unref) {
    (interval as unknown as { unref: () => void }).unref();
  }

  return {
    // Read from the FIRST beat only. Later interruptions travel the abort path instead.
    admitted: first.confirmed && !first.interrupted,
    admissionUnconfirmed: !first.confirmed,
    async release() {
      clearInterval(interval);
      credentialLease.release();
      // Mark the stream row ended (best-effort; the orphan sweep catches a miss).
      await sendHeartbeat(
        sessionId,
        turnId,
        credentialLease.credential(),
        false,
        proposal,
      );
    },
    abandon() {
      clearInterval(interval);
      credentialLease.release();
    },
    credential: credentialLease.credential,
    streamId: () => streamId,
    firstBeatOwned: first.owned,
  };
}
