/**
 * Seam that lets the runner rebuild prior conversation from the durable record log instead of
 * trusting a full inbound history — the server side of "client sends only the last message".
 *
 * Flag-gated (`AGENTA_SESSIONS_RECONSTRUCT`) and a strict no-op until BOTH the flag is on AND the
 * client actually sent a minimal history (`carriesMinimalHistory`). Best-effort — any miss (no
 * session, no records, fetch failure) leaves the inbound history untouched.
 *
 * The record log already contains the CURRENT turn by the time this runs: the runner persists the
 * inbound user message before it starts the engine, and acquiring a sandbox takes seconds. Its
 * records are therefore dropped by `turn_id` here, or the current prompt would be reconstructed
 * as a prior turn and then appended again from the inbound history.
 */

import type { AgentRunRequest } from "../../protocol.ts";
import { fetchSessionRecords } from "../../sessions/records-query.ts";
import { reconstructMessages } from "../../sessions/reconstruct.ts";
import { carriesMinimalHistory } from "./session-identity.ts";

function reconstructEnabled(): boolean {
  return (
    String(process.env.AGENTA_SESSIONS_RECONSTRUCT ?? "").toLowerCase() === "true"
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

  const records = await fetchSessionRecords(sessionId, auth);
  if (!records) return null;

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
