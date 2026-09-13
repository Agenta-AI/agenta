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

/** Stable class for a refused turn. Never a display string. */
export const SESSION_TURN_IN_USE_CODE: RunErrorCode = "session_turn_in_use";

/**
 * Product copy. The reader is the person in the chat, so it says what happened to THEIR message
 * and what to do next, with no lock, turn, or session-id mechanics. It must stay ONE line: the
 * SDK's `sanitize_runner_error` keeps only the first line of a runner error.
 */
export const SESSION_TURN_IN_USE_MESSAGE =
  "This session is already running a turn. Your message was not sent. Wait for the reply, or stop the turn, then send again.";
