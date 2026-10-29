/**
 * Single-turn admission: at most one execution runs per session, decided in one place.
 *
 * The decision is NOT made here. It is made by the platform API's atomic `nx` acquire of the
 * `alive` Redis lock, which the runner asks for on a turn's first heartbeat
 * (`sessions/alive.ts` -> `POST /sessions/streams/heartbeat` ->
 * `api/oss/src/core/sessions/streams/service.py`). This module holds only what the runner needs
 * to REPORT that decision: the stable code and the one line the user reads.
 *
 * Why the runner has to stop rather than continue: before this, a second turn that lost the
 * acquire still walked into the keepalive pool, found the first turn's environment busy, and
 * destroyed it (`lifecycle/session-coordinator.ts`, the old `supersede-busy` branch). Both turns
 * then died and the session stayed locked under a dead turn's lease. Refusing at the edge is what
 * makes the first turn survive.
 */

import type { RunErrorCode } from "../engines/sandbox_agent/errors.ts";
import type { AgentErrorDetail } from "../protocol.ts";

/** Stable class for a refused turn. Never a display string. */
export const SESSION_TURN_IN_USE_CODE: RunErrorCode = "session_turn_in_use";

/**
 * Product copy. The reader is the person in the chat, so it says what happened to THEIR message
 * and what to do next, with no lock, turn, or session-id mechanics. It must stay ONE line: the
 * SDK's `sanitize_runner_error` keeps only the first line of a runner error.
 */
export const SESSION_TURN_IN_USE_MESSAGE =
  "This session is already running a turn. Your message was not sent. Wait for the reply, or stop the turn, then send again.";

/**
 * The platform never answered this turn's admission (it throttled or restarted past the retry
 * budget), so nothing is known about who owns the session. Same class as a refused turn, because
 * the client's handling is the same: nothing was sent, keep the text, send it again.
 */
export const SESSION_ADMISSION_UNCONFIRMED_MESSAGE =
  "The platform is busy and could not start this turn. Your message was not sent. Send it again in a moment.";

/**
 * The platform answered the admission beat with a request error (400, 401, 403, 404, 422): it
 * read the beat and refused it. That is not a busy platform, and sending the same turn again
 * fails the same way, so it gets its own class and does not ask the user to retry.
 */
export const SESSION_ADMISSION_REJECTED_CODE: RunErrorCode =
  "session_admission_rejected";

export const SESSION_ADMISSION_REJECTED_MESSAGE =
  "The platform refused to start this turn because the request was not valid. Your message was not sent.";

/** Why a turn was refused at admission. */
export type AdmissionRefusal =
  | { kind: "in_use" }
  | { kind: "unconfirmed" }
  | { kind: "rejected"; status: number };

/**
 * The structured form of a refusal, for the terminal result's `errorDetail`. The event `code`
 * stays `session_turn_in_use` for both "busy" cases because every client keys its "not sent, keep
 * the text" state on it. `errorDetail.code` is what tells the two apart, so the SDK can answer an
 * owned session with 409 and an unanswered admission with 503 and `Retry-After`.
 */
export function admissionRefusal(refusal: AdmissionRefusal): {
  code: RunErrorCode;
  message: string;
  detail: AgentErrorDetail;
} {
  switch (refusal.kind) {
    case "in_use":
      return {
        code: SESSION_TURN_IN_USE_CODE,
        message: SESSION_TURN_IN_USE_MESSAGE,
        detail: {
          code: "session_turn_in_use",
          message: SESSION_TURN_IN_USE_MESSAGE,
          retryable: true,
        },
      };
    case "unconfirmed":
      return {
        code: SESSION_TURN_IN_USE_CODE,
        message: SESSION_ADMISSION_UNCONFIRMED_MESSAGE,
        detail: {
          code: "session_admission_unconfirmed",
          message: SESSION_ADMISSION_UNCONFIRMED_MESSAGE,
          retryable: true,
        },
      };
    case "rejected":
      return {
        code: SESSION_ADMISSION_REJECTED_CODE,
        message: SESSION_ADMISSION_REJECTED_MESSAGE,
        detail: {
          code: SESSION_ADMISSION_REJECTED_CODE,
          message: SESSION_ADMISSION_REJECTED_MESSAGE,
          retryable: false,
          details: { status: refusal.status },
        },
      };
  }
}
