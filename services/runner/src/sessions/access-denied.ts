/**
 * A turn whose caller lost access to the project while it ran.
 *
 * The platform rechecks the run credential on every call the runner makes for a turn. When an
 * owner removes a member, lowers their role, or deletes their key, the next session call of that
 * member's running turn (a record write, a heartbeat, the record-log read) answers 403. That is
 * not a platform outage and not data loss: the principal is no longer allowed to run. The turn
 * ends at once with `access_denied` and a sentence that says so.
 *
 * Before this, a 403 on a record write counted as a lost record, which marked the session's
 * record log incomplete, and a 403 on the record-log read read as "the record log is unreadable".
 * The person saw a data-loss error for what was an access change.
 *
 * The state is per turn, and it exists only while `server.ts` watches the turn
 * (`watchAccessDenied`). A 403 that arrives after the turn ended (a late record of an abandoned
 * run) is logged and dropped, so it cannot leak into a later turn of the same session, which may
 * run under another person's credential.
 *
 * Version skew: an API that does not recheck access mid-turn never sends this 403, so the runner
 * behaves as before against it.
 */

import {
  isPublicError,
  withPublicCode,
  type RunErrorCode,
} from "../engines/sandbox_agent/errors.ts";
import type { AgentErrorDetail } from "../protocol.ts";

/** Stable class for the turn. Never a display string. */
export const ACCESS_DENIED_CODE: RunErrorCode = "access_denied";

/** The line the person reads. One line: the SDK keeps only the first line of a runner error. */
export const ACCESS_DENIED_MESSAGE =
  "You no longer have access to this project, so the agent run was stopped.";

/**
 * The `signal.reason` the turn is aborted with. Not a cooperative cancel (`stop-signal.ts`), so
 * the environment is torn down, never parked for the next turn.
 */
export const ACCESS_DENIED_ABORT_REASON = Object.freeze({
  agentaAbort: "access-denied",
} as const);

/** The status the platform answers a session call with when the credential lost access. */
export function isAccessDeniedStatus(status: number): boolean {
  return status === 403;
}

/** Where the 403 came from, for the log line. */
export type AccessDeniedSource = "records-ingest" | "heartbeat" | "records-query";

interface WatchedTurn {
  denied: boolean;
  onDenied: () => void;
}

const watched = new Map<string, WatchedTurn>();

function turnKey(sessionId: string, turnId: string | undefined): string {
  return `${sessionId}\u0000${turnId ?? ""}`;
}

function log(msg: string): void {
  process.stderr.write(`[sessions/access] ${msg}\n`);
}

/**
 * Watch one turn. `onDenied` runs at most once, on the first 403 any session call of the turn
 * gets. Call the returned function when the turn has its outcome: it stops the watch and forgets
 * the state.
 */
export function watchAccessDenied(
  sessionId: string,
  turnId: string | undefined,
  onDenied: () => void,
): () => void {
  const key = turnKey(sessionId, turnId);
  const entry: WatchedTurn = { denied: false, onDenied };
  watched.set(key, entry);
  return () => {
    if (watched.get(key) === entry) watched.delete(key);
  };
}

/** Record that a session call of this turn got 403. */
export function noteAccessDenied(
  sessionId: string,
  turnId: string | undefined,
  source: AccessDeniedSource,
): void {
  const entry = watched.get(turnKey(sessionId, turnId));
  if (!entry) {
    log(`403 from ${source} for an unwatched turn session=${sessionId} turn=${turnId ?? "-"}; ignored`);
    return;
  }
  if (entry.denied) return;
  entry.denied = true;
  log(`ACCESS_DENIED from ${source} session=${sessionId} turn=${turnId ?? "-"}; ending the turn`);
  try {
    entry.onDenied();
  } catch (err) {
    log(`onDenied threw: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
  }
}

/** Whether a session call of this (watched) turn got 403. */
export function accessDenied(sessionId: string, turnId: string | undefined): boolean {
  return watched.get(turnKey(sessionId, turnId))?.denied === true;
}

/** The error a step of the turn throws when the platform refused it with 403. */
export function accessDeniedError(): Error {
  return withPublicCode(new Error(ACCESS_DENIED_MESSAGE), ACCESS_DENIED_CODE);
}

/** True for the error `accessDeniedError` builds. */
export function isAccessDeniedError(err: unknown): boolean {
  return isPublicError(err) && err.publicCode === ACCESS_DENIED_CODE;
}

/** The structured form for the terminal result. Not retryable: sending again fails the same way. */
export function accessDeniedDetail(): AgentErrorDetail {
  return {
    code: ACCESS_DENIED_CODE,
    message: ACCESS_DENIED_MESSAGE,
    retryable: false,
  };
}
