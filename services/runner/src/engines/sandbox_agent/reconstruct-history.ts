/**
 * Seam that lets the runner rebuild prior conversation from the durable record log instead of
 * trusting a full inbound history — the server side of "client sends only the last message".
 *
 * Flag-gated (`AGENTA_SESSIONS_RECONSTRUCT`, ON unless set to the literal "false") and a strict
 * no-op until BOTH the flag is on AND the client actually sent a minimal history
 * (`carriesMinimalHistory`). When it does not apply, the inbound history is left untouched.
 *
 * When it DOES apply it is no longer best-effort, because the client kept no copy of the
 * conversation: an unreadable log, or one known to have dropped a record, fails the turn rather
 * than letting the agent answer as though the conversation had just started.
 *
 * The record log already contains the CURRENT turn by the time this runs: the runner persists the
 * inbound user message before it starts the engine, and acquiring a sandbox takes seconds. Its
 * records are therefore dropped by `turn_id` here, or the current prompt would be reconstructed
 * as a prior turn and then appended again from the inbound history.
 */

import type { AgentRunRequest } from "../../protocol.ts";
import { fetchSessionRecords } from "../../sessions/records-query.ts";
import { recordsIncomplete } from "../../sessions/persist.ts";
import { reconstructMessages } from "../../sessions/reconstruct.ts";
import { carriesMinimalHistory } from "./session-identity.ts";

// ON unless the literal "false"; absent AND empty both mean on (compose passes `${VAR:-}`,
// which sets an empty string when the shell has no value).
function reconstructEnabled(): boolean {
  return (
    String(process.env.AGENTA_SESSIONS_RECONSTRUCT ?? "").trim().toLowerCase() !== "false"
  );
}

/**
 * Returns a request whose `messages` are `[...reconstructed prior turns, ...inbound]` when
 * reconstruction applies, else `null` to keep the inbound history as-is.
 */
export async function reconstructHistoryIfNeeded(
  request: AgentRunRequest,
  sessionId: string | undefined,
  auth: () => string,
  log?: (msg: string) => void,
): Promise<AgentRunRequest | null> {
  if (!reconstructEnabled() || !sessionId) return null;
  const inbound = request.messages ?? [];
  // The client still asserts the conversation itself — nothing to rebuild.
  if (!carriesMinimalHistory(request)) return null;

  // The client kept no copy of the conversation, so there is no history to fall back to. Answering
  // anyway would silently produce an agent that forgot everything, which reads as a correct reply.
  // Fail the turn instead: `runTurn`'s catch turns this into an error result the caller can see.
  if (recordsIncomplete(sessionId)) {
    throw new Error(
      `session ${sessionId} lost a durable record; refusing to rebuild an incomplete conversation`,
    );
  }

  const records = await fetchSessionRecords(sessionId, auth);
  if (!records) {
    throw new Error(
      `session ${sessionId} record log is unreadable; cannot rebuild the conversation`,
    );
  }

  // Drop this turn's own records: the inbound message already carries the current prompt.
  const currentTurnId = request.turnId?.trim();
  const prior = currentTurnId
    ? records.filter((row) => row.turn_id !== currentTurnId)
    : records;
  if (prior.length === 0) return null;

  const reconstructed = reconstructMessages(prior);
  if (reconstructed.length === 0) return null;

  log?.(
    `[reconstruct] session=${sessionId} records=${records.length} ` +
      `prior=${prior.length} priorMessages=${reconstructed.length} ` +
      `inbound=${inbound.length}`,
  );
  return { ...request, messages: [...reconstructed, ...inbound] };
}
