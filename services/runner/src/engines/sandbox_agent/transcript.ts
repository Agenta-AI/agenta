import {
  type AgentRunRequest,
  type ChatMessage,
  type ContentBlock,
  messageText,
  resolvePromptText,
} from "../../protocol.ts";
import { approvalDecisionOf } from "../../responder.ts";

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
    if (messages[i].role === "user" && messageText(messages[i].content) === latest) {
      lastMatch = i;
      break;
    }
  }
  return lastMatch === -1 ? messages : messages.filter((_, i) => i !== lastMatch);
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
      parts.push(`[called ${block.toolName ?? "tool"}(${safeJson(block.input)})]`);
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

/**
 * An approval resume carries no NEW user text: the newest meaningful content is the
 * approval-decision envelope, and `resolvePromptText` falls back to a STALE earlier user
 * message. Closing the frame with that stale command makes a fresh model restart the whole
 * task instead of re-issuing the approved call (cold-replay failure report, turn 6d34b1ea).
 * Detected conservatively: an unresolved approved call (`lastPending`) sits in a message
 * AFTER the last user message that carries text.
 */
function isApprovalResume(
  request: AgentRunRequest,
  hints: Map<ContentBlock, ApprovalRenderHint>,
): boolean {
  const messages = request.messages ?? [];
  let lastUserTextIndex = -1;
  let lastPendingIndex = -1;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "user" && messageText(message.content)) {
      lastUserTextIndex = i;
    }
    const content = message.content;
    if (!Array.isArray(content)) continue;
    if (content.some((block) => hints.get(block) === "lastPending")) {
      lastPendingIndex = i;
    }
  }
  return lastPendingIndex >= 0 && lastPendingIndex > lastUserTextIndex;
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
  const resume = isApprovalResume(request, approvalRenderHints(messages));
  // Normal turn: drop the prompt user message from the replay (it closes the frame).
  // Approval resume: nothing is re-presented in the frame, so replay every message —
  // including the stale command in place and an approval envelope on a trailing user turn.
  const prior = resume ? messages : priorMessages(request);
  const hints = approvalRenderHints(prior);
  const history = prior
    .map((m) => ({ message: m, text: messageTranscript(m.content, hints) }))
    .filter((entry) => entry.text);
  if (history.length === 0) return latest;

  const maxChars = Number(
    process.env.AGENTA_AGENT_HISTORY_MAX_CHARS ?? DEFAULT_HISTORY_MAX_CHARS,
  );
  const lines = history.map(
    ({ message, text }) => `${message.role}: ${text}`,
  );
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

  const closing = resume
    ? APPROVAL_RESUME_CLOSING
    : `Continue the conversation. The user now says:\n${latest}`;
  const turnText = `Conversation so far:\n${transcript}\n\n${closing}`;
  log?.(
    `[HITL] cold replay: transcript ${full.length}->${transcript.length} chars, ` +
      `evicted ${evicted}/${history.length} messages, ` +
      `pendingNudge=${transcript.includes("has NOT run yet")}, ` +
      `resumeFrame=${resume}, turnText ${turnText.length} chars`,
  );
  return turnText;
}
