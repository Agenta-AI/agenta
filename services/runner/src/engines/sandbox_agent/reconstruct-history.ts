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
 * than letting the agent answer as though the conversation had just started. For an approval
 * reply, which carries no task of its own, "nothing to rebuild" is itself such a failure.
 *
 * The record log already contains the CURRENT turn by the time this runs: the runner persists the
 * inbound user message before it starts the engine, and acquiring a sandbox takes seconds. Its
 * records are therefore dropped by `turn_id` here, or the current prompt would be reconstructed
 * as a prior turn and then appended again from the inbound history.
 */

import type { AgentRunRequest, ChatMessage } from "../../protocol.ts";
import { fetchSessionRecords } from "../../sessions/records-query.ts";
import { recordsIncomplete } from "../../sessions/persist.ts";
import { reconstructMessages } from "../../sessions/reconstruct.ts";
import {
  carriesApprovalReplyOnly,
  carriesMinimalHistory,
} from "./session-identity.ts";

export interface ReconstructHistoryOptions {
  restore?: (messages: ChatMessage[]) => Promise<ChatMessage[]>;
}

function isTruncatedRecord(row: { attributes?: unknown }): boolean {
  return (
    !!row.attributes &&
    typeof row.attributes === "object" &&
    "_truncated" in row.attributes
  );
}

// Compose passes `${AGENTA_SESSIONS_RECONSTRUCT:-}`, so an empty value must mean on just like an
// absent value. Only the literal "false" disables reconstruction.
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
  options: ReconstructHistoryOptions = {},
): Promise<AgentRunRequest | null> {
  const inbound = request.messages ?? [];
  // An approval reply carries no task of its own, only the answered gate. Returning null for it
  // is not "keep the inbound history", it is "run with no conversation at all": `buildRunPlan`
  // spares this shape the empty-prompt check, so the turn would go out as the approval-resume
  // frame alone — no task, no context — and report success. A prior turn exists by construction
  // for an approval reply, so every no-history path below is an anomaly for this shape and fails
  // the turn instead. On a live resume `runTurn` catches this and continues on the inbound
  // request, because the harness there still holds the conversation.
  const approvalReplyOnly = carriesApprovalReplyOnly(request);
  const refuse = (why: string): never => {
    throw new Error(
      `session ${sessionId ?? "(none)"}: cannot resume an approval reply with ` +
        `no conversation to rebuild (${why})`,
    );
  };

  if (!reconstructEnabled() || !sessionId) {
    if (approvalReplyOnly) {
      refuse(!sessionId ? "no session id" : "reconstruction is disabled");
    }
    return null;
  }
  // The client still asserts the conversation itself — nothing to rebuild. Two shapes assert
  // nothing: a last-message-only client (a fresh user turn alone) and an out-of-band approval
  // reply built from the durable interaction row (an approval envelope alone). Both need the
  // prior turns rebuilt here or the agent answers as though the conversation had just started.
  if (!carriesMinimalHistory(request) && !approvalReplyOnly) {
    return null;
  }

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
  if (prior.some(isTruncatedRecord)) {
    throw new Error(
      `session ${sessionId} contains a truncated durable record; refusing to rebuild an incomplete conversation`,
    );
  }
  // Reachable in practice: a caller that builds its answer from the durable interaction row can
  // echo the row's stored `turn_id`, which drops exactly the turn that parked.
  if (prior.length === 0) {
    if (approvalReplyOnly) {
      refuse(
        `the log holds no turn other than ${currentTurnId ?? "the current one"}`,
      );
    }
    return null;
  }

  let reconstructed = reconstructMessages(prior);
  if (reconstructed.length === 0) {
    if (approvalReplyOnly) {
      refuse(`${prior.length} prior record(s) rebuilt into no messages`);
    }
    return null;
  }

  if (options.restore) {
    reconstructed = await options.restore(reconstructed);
  }

  log?.(
    `[reconstruct] session=${sessionId} records=${records.length} ` +
      `prior=${prior.length} priorMessages=${reconstructed.length} ` +
      `inbound=${inbound.length}`,
  );
  return { ...request, messages: [...reconstructed, ...inbound] };
}
