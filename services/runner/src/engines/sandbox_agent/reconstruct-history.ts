/**
 * Seam that lets the runner rebuild prior conversation from the durable record log instead of
 * trusting a full inbound history — the server side of "client sends only the last message".
 *
 * Flag-gated (`AGENTA_SESSIONS_RECONSTRUCT`) and a strict no-op until BOTH the flag is on AND the
 * client sent exactly its trailing user message: a full inbound history (more than one message, or
 * a non-user tail) is left untouched. Best-effort — any miss (no session, no records, fetch
 * failure) leaves the inbound history untouched.
 *
 * Called from the server handler BEFORE the turn's prompt is persisted and before the keep-alive
 * history fingerprint, so the record log holds only prior turns (no self-duplication) and the
 * fingerprint sees the same full history a full-history client would have sent.
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
  // Reconstruct only for a fresh turn that is exactly its trailing user message. A full inbound
  // history (client sent the conversation) needs no rebuild; an empty or assistant-only inbound
  // (e.g. an approval resume) must not be rebuilt, or `resolvePromptText` could replay a historical
  // prompt as the current turn.
  if (inbound.length !== 1 || inbound[0]?.role !== "user") return null;

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
