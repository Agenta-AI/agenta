import {
  type AgentRunRequest,
  type ChatMessage,
  type ContentBlock,
  messageText,
  resolvePromptText,
} from "../../protocol.ts";
import { approvalDecisionOf } from "../../responder.ts";

export type ApprovalRenderHint = "executed" | "lastPending" | "stalePending";

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
        const body = safeJson(block.output);
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

/**
 * Text sent over ACP for this turn. Each invoke is a cold sandbox, so prior turns are
 * replayed as transcript context ahead of the latest user message.
 */
export function buildTurnText(request: AgentRunRequest): string {
  const latest = resolvePromptText(request);
  const prior = priorMessages(request);
  const hints = approvalRenderHints(prior);
  const history = prior
    .map((m) => ({ message: m, text: messageTranscript(m.content, hints) }))
    .filter((entry) => entry.text);
  if (history.length === 0) return latest;

  const maxChars = Number(process.env.AGENTA_AGENT_HISTORY_MAX_CHARS ?? 24000);
  let transcript = history
    .map(({ message, text }) => `${message.role}: ${text}`)
    .join("\n");
  if (transcript.length > maxChars) transcript = transcript.slice(-maxChars);
  return (
    `Conversation so far:\n${transcript}\n\n` +
    `Continue the conversation. The user now says:\n${latest}`
  );
}
