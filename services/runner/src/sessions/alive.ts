/**
 * Runner-side alive-lock ownership + heartbeat.
 *
 * When a run is session-owned (request carries `sessionId` + `turnId`), the runner
 * acquires the `alive` Redis lock and self-refreshes it for the turn's lifetime so the
 * coordination plane sees the session as live independent of any client connection.
 *
 * Two distinct ids ride the heartbeat (multi-container correctness):
 *  - `replica_id` — this runner CONTAINER's stable id (minted once per process). Drives the
 *    `owner:session:<id>` affinity key so control signals route to the box running the turn.
 *  - `turn_id`    — the current TURN's id (one per execution). Proves alive-lock ownership.
 *
 * Uses the HTTP API instead of direct Redis (the API is the single Redis writer).
 *
 * Key contract constants mirror `sessions/contract.ts`; do not duplicate them.
 */

import { apiBase } from "../apiBase.ts";
import { randomUUID } from "node:crypto";

import { HEARTBEAT_INTERVAL_SECONDS, OWNER_TTL_SECONDS } from "./contract.ts";

const REFRESH_INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1000;

/**
 * This runner container's stable id, minted once per process. An orchestrator can inject a
 * meaningful id (pod/container name) via `AGENTA_RUNNER_REPLICA_ID`; otherwise a random
 * uuid per process. Distinct from any turn id — many turns share one replica_id, and with 2+
 * containers each holds its own, so affinity routing can find the box running a session.
 */
export const REPLICA_ID =
  process.env.AGENTA_RUNNER_REPLICA_ID?.trim() || randomUUID();

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

function log(msg: string): void {
  process.stderr.write(`[sessions/alive] ${msg}\n`);
}

// --- owner-claim registry -------------------------------------------------- //
//
// WHY THIS EXISTS. `owner:session:<id>` is claimed by every beat and released by nothing, and
// the API's `claim_owner` deliberately never steals from a live owner. So a runner that exits
// while holding claims leaves each of those sessions unusable by the replacement replica until
// the lease expires — measured at 112 to 123 s against a 120 s TTL, on every restart. The
// registry is the smallest thing that makes the shutdown handler able to hand them back: which
// sessions this process claimed, and a credential that can still speak for each one.
//
// The credential is the run's own ephemeral platform token, the same one every beat already
// carries; it never leaves this process and is never logged. An entry that outlives its token
// simply fails its release call and falls back to the lease, exactly as a killed runner does.
//
// BOUNDED BY THE LEASE ITSELF. Every beat records, so without a bound a long-lived runner would
// accumulate one entry per session it ever served, hold each of their credentials for the
// process lifetime, and fire a useless release for every one of them at shutdown. An entry
// whose last beat is older than `OWNER_TTL_SECONDS` cannot still hold the key, so it is pruned:
// the registry holds only what this replica can plausibly still own.

interface OwnedSession {
  authorization: string;
  /** When the API last confirmed this replica owns the session. */
  claimedAt: number;
}

const ownedSessions = new Map<string, OwnedSession>();

/** Drop entries whose affinity lease cannot still be held. */
function pruneExpiredClaims(now: number): void {
  const cutoff = now - OWNER_TTL_SECONDS * 1000;
  for (const [sessionId, entry] of ownedSessions) {
    if (entry.claimedAt < cutoff) ownedSessions.delete(sessionId);
  }
}

/**
 * Note that this replica holds (or has just refreshed) the affinity key for `sessionId`, so
 * the shutdown handler can release it. Called from every beat that the API confirmed we own.
 * Overwrites the stored credential, which keeps the freshest token per session.
 */
export function recordOwnedSession(
  sessionId: string,
  authorization: string,
  now: number = Date.now(),
): void {
  if (!sessionId || !authorization) return;
  pruneExpiredClaims(now);
  ownedSessions.set(sessionId, { authorization, claimedAt: now });
}

/** Forget a session (a test hook, and the successful-release path). */
export function forgetOwnedSession(sessionId: string): void {
  ownedSessions.delete(sessionId);
}

/** How many sessions this replica could still own. Test/inspection hook. */
export function ownedSessionCount(now: number = Date.now()): number {
  pruneExpiredClaims(now);
  return ownedSessions.size;
}

/**
 * Send one heartbeat to keep the `alive` lock and the `session_streams` row live. Carries the
 * container `replica_id` (refreshes `owner` affinity) and the `turn_id` (proves alive ownership).
 * Authenticates AS the invoke caller (the run credential) — project scope is resolved server-side
 * from that credential, so no `project_id` rides the request.
 *
 * Returns both signals the one response body carries: `streamId` (the `session_streams` row
 * uuid — the free gift of a call the runner already makes every turn, no new round-trip) and
 * `interrupted: true` when the API reports `is_current_turn: false` (a cancel/steer/kill took
 * this turn's alive/running lock since the last beat — W7.4, the control-signal path). A
 * network/HTTP failure yields `{ streamId: undefined, interrupted: false }` (fail-open: a
 * transient API blip must neither abort a healthy run nor fabricate a stream id).
 */
async function sendHeartbeat(
  sessionId: string,
  turnId: string,
  authorization: string,
  isRunning = true,
  proposal?: SessionProposal,
): Promise<{ streamId: string | undefined; interrupted: boolean }> {
  try {
    const url = `${apiBase()}/sessions/streams/heartbeat`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization,
      },
      body: JSON.stringify({
        session_id: sessionId,
        replica_id: REPLICA_ID,
        turn_id: turnId,
        is_running: isRunning,
        ...(proposal?.name ? { name: proposal.name } : {}),
        ...(proposal?.references?.length
          ? { references: proposal.references }
          : {}),
      }),
    });
    if (!res.ok) {
      log(`heartbeat HTTP ${res.status} session=${sessionId} turn=${turnId}`);
      return { streamId: undefined, interrupted: false };
    }
    const body = (await res.json()) as {
      stream?: { id?: unknown } | null;
      is_current_turn?: unknown;
      replica_id?: unknown;
    };
    const rawStreamId = body.stream?.id;
    const streamId =
      typeof rawStreamId === "string" && rawStreamId.length > 0
        ? rawStreamId
        : undefined;
    const interrupted = body.is_current_turn === false;
    // Record ONLY what the API says we own. The beat claims affinity as a side effect, so this
    // is the one place that learns the claim happened; a beat this replica lost records nothing
    // and the shutdown release skips it.
    if (body.replica_id === REPLICA_ID) {
      recordOwnedSession(sessionId, authorization);
    }
    log(
      `heartbeat OK session=${sessionId} turn=${turnId} running=${isRunning}${interrupted ? " INTERRUPTED" : ""}`,
    );
    return { streamId, interrupted };
  } catch (err) {
    log(
      `heartbeat failed session=${sessionId} turn=${turnId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return { streamId: undefined, interrupted: false };
  }
}

/**
 * Claim (or read) this session's owner affinity before serving it, and return the ACTUAL owner
 * replica id (single-runner-local guard). Sends one heartbeat with no `turn_id` — the API
 * claims the `owner` key without stealing from a live different owner and reports the winner in
 * `replica_id`, but establishes no alive/running lock (that needs a turn_id). Returns
 * `{replicaId, ownerReplicaId}`; `ownerReplicaId` is undefined only when the call itself fails
 * (network/HTTP error) — a fail-open, matching "never worse than today" (no silent WRONG-host
 * start, but a transient API blip does not block a legitimate owner).
 */
export async function claimSessionOwnership(
  sessionId: string,
  authorization: string,
): Promise<{ replicaId: string; ownerReplicaId: string | undefined }> {
  try {
    const url = `${apiBase()}/sessions/streams/heartbeat`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify({
        session_id: sessionId,
        replica_id: REPLICA_ID,
        is_running: true,
      }),
    });
    if (!res.ok) {
      log(`ownership claim HTTP ${res.status} session=${sessionId}`);
      return { replicaId: REPLICA_ID, ownerReplicaId: undefined };
    }
    const body = (await res.json()) as { replica_id?: unknown };
    const owner =
      typeof body.replica_id === "string" ? body.replica_id : undefined;
    if (owner === REPLICA_ID) recordOwnedSession(sessionId, authorization);
    return { replicaId: REPLICA_ID, ownerReplicaId: owner };
  } catch (err) {
    log(
      `ownership claim failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return { replicaId: REPLICA_ID, ownerReplicaId: undefined };
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
  credential: () => string;
  streamId: () => string | undefined;
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
  }): void => {
    if (result.streamId) streamId = result.streamId;
    if (result.interrupted && !interruptedFired) {
      interruptedFired = true;
      log(`interrupted session=${sessionId} turn=${turnId} -> aborting`);
      onInterrupted?.();
    }
  };

  // Await the FIRST beat so streamId is ready before the caller starts the turn.
  const first = await sendHeartbeat(
    sessionId,
    turnId,
    credentialLease.credential(),
    true,
    proposal,
  );
  handleBeat(first);

  const interval = setInterval(() => {
    void (async () => {
      handleBeat(
        await sendHeartbeat(
          sessionId,
          turnId,
          credentialLease.credential(),
          true,
          proposal,
        ),
      );
    })();
  }, REFRESH_INTERVAL_MS);

  // Allow the Node process to exit even if the interval is still running.
  if ((interval as unknown as { unref?: () => void }).unref) {
    (interval as unknown as { unref: () => void }).unref();
  }

  return {
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
    credential: credentialLease.credential,
    streamId: () => streamId,
  };
}

/**
 * Hand this replica's affinity key for one session back to the coordination plane.
 *
 * The inverse beat: `release_owner: true`, no turn id, no liveness claim. The API releases
 * `owner:session:<id>` only while this replica still holds it, so the call can never take a
 * session from a live runner and is safe to repeat.
 *
 * Never throws. A failure leaves the key to expire on its own lease, which is exactly the
 * behaviour a killed (SIGKILL) runner already has.
 */
export async function releaseSessionOwnership(
  sessionId: string,
  authorization: string,
  timeoutMs?: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/sessions/streams/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify({
        session_id: sessionId,
        replica_id: REPLICA_ID,
        release_owner: true,
      }),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (!res.ok) {
      log(`ownership release HTTP ${res.status} session=${sessionId}`);
      return false;
    }
    forgetOwnedSession(sessionId);
    log(`ownership released session=${sessionId}`);
    return true;
  } catch (err) {
    log(
      `ownership release failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return false;
  }
}

/** How long the whole shutdown release may take before the process stops waiting for it. */
export const DEFAULT_OWNERSHIP_RELEASE_TIMEOUT_MS = 5_000;

/**
 * Release every affinity key this replica holds. Called from the shutdown handler, so it is
 * bounded and never rejects: a runner that cannot reach the API must still exit promptly, and
 * the 120-second owner lease is the fallback for that case and for a SIGKILL, which reaches no
 * handler at all.
 *
 * The releases run concurrently because they are independent single-key deletes, and the whole
 * set races one deadline rather than each call carrying its own budget.
 */
export async function releaseOwnedSessions(
  timeoutMs: number = DEFAULT_OWNERSHIP_RELEASE_TIMEOUT_MS,
): Promise<void> {
  pruneExpiredClaims(Date.now());
  const held = [...ownedSessions.entries()];
  if (held.length === 0) return;
  log(`releasing ${held.length} session ownership claim(s) on shutdown`);
  const releases = Promise.all(
    held.map(([sessionId, entry]) =>
      releaseSessionOwnership(sessionId, entry.authorization, timeoutMs),
    ),
  );
  const deadline = new Promise<void>((resolve) => {
    const handle = setTimeout(resolve, timeoutMs);
    handle.unref?.();
  });
  await Promise.race([releases.then(() => undefined), deadline]);
}
