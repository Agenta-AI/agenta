/**
 * Seam that lets the runner rebuild prior conversation from the durable record log instead of
 * trusting a full inbound history — the server side of "client sends only the last message".
 *
 * Flag-gated (`AGENTA_SESSIONS_RECONSTRUCT`) and a strict no-op until BOTH the flag is on AND the
 * client actually sent a minimal history: when the client still sends the whole conversation
 * (`messages.length > 1`), reconstruction is skipped and behaviour is unchanged. Best-effort — any
 * miss (no session, no records, fetch failure) leaves the inbound history untouched.
 */

import type { AgentRunRequest } from "../../protocol.ts";
import { fetchSessionRecords } from "../../sessions/records-query.ts";
import { reconstructMessages } from "../../sessions/reconstruct.ts";

function reconstructEnabled(): boolean {
  return (
    String(process.env.AGENTA_SESSIONS_RECONSTRUCT ?? "").toLowerCase() === "true"
  );
}

/**
 * Returns a request whose `messages` are `[...reconstructed prior turns, ...inbound]` when
 * reconstruction applies, else `null` to keep the inbound history as-is.
 *
 * MUST be called before the current turn's user message is persisted, so the record log holds
 * only prior turns (no duplication of the incoming prompt).
 */
export async function reconstructHistoryIfNeeded(
  request: AgentRunRequest,
  sessionId: string | undefined,
  auth: () => string,
  log?: (msg: string) => void,
): Promise<AgentRunRequest | null> {
  if (!reconstructEnabled() || !sessionId) return null;
  const inbound = request.messages ?? [];
  // The client already sent the conversation — nothing to rebuild.
  if (inbound.length > 1) return null;

  const records = await fetchSessionRecords(sessionId, auth);
  if (!records || records.length === 0) return null;

  const reconstructed = reconstructMessages(records);
  if (reconstructed.length === 0) return null;

  log?.(
    `[reconstruct] session=${sessionId} records=${records.length} ` +
      `priorMessages=${reconstructed.length} inbound=${inbound.length}`,
  );
  return { ...request, messages: [...reconstructed, ...inbound] };
}
