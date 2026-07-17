import {
  type AgentRunRequest,
  type ChatMessage,
  type ContentBlock,
  messageText,
  resolvePromptText,
} from "../../protocol.ts";
import { approvalDecisionOf, isDeferredNotExecuted } from "../../responder.ts";

export type ApprovalRenderHint = "executed" | "lastPending" | "stalePending";

/**
 * Cap for ONE rendered tool RESULT body inside the replayed transcript. Without it a single
 * large tool output (a discover_tools dump renders at 30-60 KB) fills the tail-sliced window
 * and evicts the conversation's beginning, so the model loses the original goal (cold-replay
 * failure report, turn 6d34b1ea). Tool CALL args are NEVER capped: the approval replay nudge
 * tells the model to re-issue the call "with the same arguments", so args must stay complete.
 */
export const TOOL_RESULT_RENDER_MAX_CHARS = 4000;

/** Default tail-slice window for the replayed transcript (env-overridable). */
export const DEFAULT_HISTORY_MAX_CHARS = 100_000;

/** Prior turns (everything before the latest user message) for trace + history. */
export function priorMessages(request: AgentRunRequest): ChatMessage[] {
  const messages = request.messages ?? [];
  const latest = resolvePromptText(request);
  // Drop the trailing user turn (it is the prompt we send) to avoid double-counting.
  if (messages.length && messages[messages.length - 1].role === "user") {
    return messages.slice(0, -1);
  }
  // No trailing user message (prompt came in explicitly): drop only the LAST user turn
  // whose text matches the prompt being sent, not every matching turn.
  let lastMatch = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (
      messages[i].role === "user" &&
      messageText(messages[i].content) === latest
    ) {
      lastMatch = i;
      break;
    }
  }
  return lastMatch === -1
    ? messages
    : messages.filter((_, i) => i !== lastMatch);
}

/**
 * Approval envelopes are replayed as plain text to a cold model. Without a history-wide view,
 * every old `{approved:true}` envelope keeps saying "call this again now", even after a later
 * real result proves the tool executed, or after duplicate stale envelopes pile up. This pre-pass
 * marks approval-result blocks with the least confusing rendering for the whole prior transcript.
 */
export function approvalRenderHints(
  history: readonly {
    content: string | ContentBlock[] | undefined;
  }[],
): Map<ContentBlock, ApprovalRenderHint> {
  const toolResults: {
    block: ContentBlock;
    toolName: string | undefined;
    decision: ReturnType<typeof approvalDecisionOf>;
  }[] = [];

  for (const message of history) {
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_result") continue;
      toolResults.push({
        block,
        toolName: block.toolName,
        decision: approvalDecisionOf(block),
      });
    }
  }

  const hints = new Map<ContentBlock, ApprovalRenderHint>();
  const unresolved = new Map<
    string | undefined,
    { block: ContentBlock; index: number }[]
  >();

  for (let index = 0; index < toolResults.length; index++) {
    const entry = toolResults[index];
    if (entry.decision !== "allow") continue;

    // Rendering only: use tool-name proximity to suppress stale nudges. The actual approval
    // decision store still matches on name + canonical args and never consumes by name alone.
    const hasLaterRealResult = toolResults
      .slice(index + 1)
      .some(
        (later) =>
          later.toolName === entry.toolName && later.decision === undefined,
      );
    if (hasLaterRealResult) {
      hints.set(entry.block, "executed");
      continue;
    }

    const list = unresolved.get(entry.toolName) ?? [];
    list.push({ block: entry.block, index });
    unresolved.set(entry.toolName, list);
  }

  for (const list of unresolved.values()) {
    let lastIndex = -1;
    for (const entry of list) {
      if (entry.index > lastIndex) lastIndex = entry.index;
    }
    for (const entry of list) {
      hints.set(
        entry.block,
        entry.index === lastIndex ? "lastPending" : "stalePending",
      );
    }
  }

  return hints;
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Truncate a rendered tool RESULT body with an explicit elision marker. */
function capToolResultBody(body: string): string {
  if (body.length <= TOOL_RESULT_RENDER_MAX_CHARS) return body;
  const omitted = body.length - TOOL_RESULT_RENDER_MAX_CHARS;
  return `${body.slice(0, TOOL_RESULT_RENDER_MAX_CHARS)} [... ${omitted} chars omitted]`;
}

/**
 * Render one message for the replayed transcript, including resolved tool turns. Under
 * the cold model, ACP prompt content blocks cannot carry tool calls/results, so resolved
 * interactions are encoded as text.
 */
export function messageTranscript(
  content: string | ContentBlock[] | undefined,
  hints?: Map<ContentBlock, ApprovalRenderHint>,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "tool_call") {
      parts.push(
        `[called ${block.toolName ?? "tool"}(${safeJson(block.input)})]`,
      );
    } else if (block.type === "tool_result") {
      const decision = approvalDecisionOf(block);
      if (decision !== undefined) {
        const toolName = block.toolName ?? "tool";
        if (decision === "allow") {
          const hint = hints?.get(block) ?? "lastPending";
          if (hint === "executed") {
            parts.push(`[user APPROVED ${toolName}; executed below]`);
          } else if (hint === "stalePending") {
            parts.push(`[user approved ${toolName} earlier.]`);
          } else {
            parts.push(
              `[user APPROVED ${toolName}; the call has NOT run yet. Call the tool again with the same arguments now to execute it.]`,
            );
          }
        } else {
          parts.push(`[user DENIED ${toolName}; the call was not executed.]`);
        }
      } else if (isDeferredNotExecuted(block)) {
        // A sibling of a parallel tool batch: the turn paused on ANOTHER call's approval, so this
        // one was skipped this turn — NOT denied, NOT failed. On the generic path below it renders
        // as `[<tool> error: DEFERRED_NOT_EXECUTED …]`, and the model reads that "error" as a
        // refusal and abandons the call. Render it instead as the same "call it again now" nudge
        // an approved-but-unexecuted call gets (they are the same situation to the model: the call
        // has not run yet and must be re-issued), so the model retries and its fresh gate surfaces.
        const toolName = block.toolName ?? "tool";
        parts.push(
          `[${toolName} was NOT run — the turn paused for another approval first, so it was skipped, not denied. Call ${toolName} again with the same arguments now to run it.]`,
        );
      } else {
        const body = capToolResultBody(safeJson(block.output));
        parts.push(
          `[${block.toolName ?? "tool"} ${block.isError ? "error" : "returned"}: ${body}]`,
        );
      }
    } else if (block.type === "image") {
      parts.push("[image]");
    } else if (block.type === "resource") {
      parts.push(block.uri ? `[resource: ${block.uri}]` : "[resource]");
    }
  }
  return parts.filter(Boolean).join("\n");
}

const APPROVAL_RESUME_CLOSING =
  "The user has responded to the pending approval above. " +
  "If a call is marked APPROVED and not yet run, execute exactly that call now with the " +
  "same arguments; do not restart the task. If it was DENIED, continue without it.";

const CLIENT_RESUME_CLOSING =
  "The user has responded to the request(s) above (for example an input form or a connection " +
  "prompt); the result is shown in the history. Continue the task from where it paused, using " +
  "that result; do not restart the task or ask again for anything the user already provided.";

export type ResumeKind = "approval" | "client";

/** A client-tool settle (elicitation answer, connection reference, decline/cancel) rides back as
 * a non-approval `tool_result`. Approval envelopes carry `{approved}` and are handled separately. */
function isClientToolSettle(block: ContentBlock): boolean {
  return block?.type === "tool_result" && approvalDecisionOf(block) === undefined;
}

/**
 * A resume carries no NEW user text: the newest meaningful content is a settled interaction, and
 * `resolvePromptText` falls back to a STALE earlier user message. Closing the frame with that stale
 * command makes a fresh model restart the whole task instead of continuing from the pause — it
 * re-issues the approved call (cold-replay failure report, turn 6d34b1ea) or, for a client tool,
 * re-asks for input the user just gave (issue #5357).
 *
 * Two shapes, detected conservatively as content AFTER the last user text message:
 *   - approval: an unresolved approved call (`lastPending`) — needs the execute-the-call frame.
 *   - client:  a client-tool settle in an ASSISTANT message — the settled `tool_result` rides back
 *     in the assistant turn it paused on (the Vercel adapter preserves that role), so an executed
 *     server-tool result in a `tool`/user turn is not mistaken for a resume.
 * An approval pending call wins when both are present (it carries the stronger instruction).
 */
function resumeKindFor(
  request: AgentRunRequest,
  hints: Map<ContentBlock, ApprovalRenderHint>,
): ResumeKind | null {
  const messages = request.messages ?? [];
  let lastUserTextIndex = -1;
  let lastPendingApprovalIndex = -1;
  let lastClientSettleIndex = -1;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "user" && messageText(message.content)) {
      lastUserTextIndex = i;
    }
    const content = message.content;
    if (!Array.isArray(content)) continue;
    if (content.some((block) => hints.get(block) === "lastPending")) {
      lastPendingApprovalIndex = i;
    }
    if (message.role === "assistant" && content.some(isClientToolSettle)) {
      lastClientSettleIndex = i;
    }
  }
  if (lastPendingApprovalIndex >= 0 && lastPendingApprovalIndex > lastUserTextIndex) {
    return "approval";
  }
  if (lastClientSettleIndex >= 0 && lastClientSettleIndex > lastUserTextIndex) {
    return "client";
  }
  return null;
}

/**
 * Text sent over ACP for this turn. Each invoke is a cold sandbox, so prior turns are
 * replayed as transcript context ahead of the latest user message. On an approval resume
 * the closing frame instructs the model to execute the approved pending call instead of
 * re-presenting the stale user command; the full history (stale command included, in its
 * original position) is replayed as context.
 */
export function buildTurnText(
  request: AgentRunRequest,
  log?: (msg: string) => void,
): string {
  const latest = resolvePromptText(request);
  const messages = request.messages ?? [];
  const resumeKind = resumeKindFor(request, approvalRenderHints(messages));
  const resume = resumeKind !== null;
  // Normal turn: drop the prompt user message from the replay (it closes the frame).
  // Resume: nothing is re-presented in the frame, so replay every message — including the
  // stale command in place and the settled interaction (approval envelope or client-tool result).
  const prior = resume ? messages : priorMessages(request);
  const hints = approvalRenderHints(prior);
  const history = prior
    .map((m) => ({ message: m, text: messageTranscript(m.content, hints) }))
    .filter((entry) => entry.text);
  if (history.length === 0) return latest;

  const maxChars = Number(
    process.env.AGENTA_AGENT_HISTORY_MAX_CHARS ?? DEFAULT_HISTORY_MAX_CHARS,
  );
  const lines = history.map(({ message, text }) => `${message.role}: ${text}`);
  const full = lines.join("\n");
  let transcript = full;
  let evicted = 0;
  if (full.length > maxChars) {
    transcript = full.slice(-maxChars);
    // Count messages the tail slice fully evicted (their rendered text ends before the cut).
    const cut = full.length - maxChars;
    let offset = 0;
    for (const line of lines) {
      if (offset + line.length <= cut) evicted++;
      offset += line.length + 1; // +1 for the "\n" join separator
    }
  }

  const closing =
    resumeKind === "approval"
      ? APPROVAL_RESUME_CLOSING
      : resumeKind === "client"
        ? CLIENT_RESUME_CLOSING
        : `Continue the conversation. The user now says:\n${latest}`;
  const turnText = `Conversation so far:\n${transcript}\n\n${closing}`;
  log?.(
    `[HITL] cold replay: transcript ${full.length}->${transcript.length} chars, ` +
      `evicted ${evicted}/${history.length} messages, ` +
      `pendingNudge=${transcript.includes("has NOT run yet")}, ` +
      `resumeFrame=${resumeKind ?? "none"}, turnText ${turnText.length} chars`,
  );
  return turnText;
}
