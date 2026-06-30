import {
  type AgentRunRequest,
  type ChatMessage,
  type ContentBlock,
  messageText,
  resolvePromptText,
} from "../../protocol.ts";

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
export function messageTranscript(content: string | ContentBlock[] | undefined): string {
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
      const body = safeJson(block.output);
      parts.push(`[${block.toolName ?? "tool"} ${block.isError ? "error" : "returned"}: ${body}]`);
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
  const history = priorMessages(request).filter((m) => messageTranscript(m.content));
  if (history.length === 0) return latest;

  const maxChars = Number(process.env.AGENTA_AGENT_HISTORY_MAX_CHARS ?? 24000);
  let transcript = history.map((m) => `${m.role}: ${messageTranscript(m.content)}`).join("\n");
  if (transcript.length > maxChars) transcript = transcript.slice(-maxChars);
  return (
    `Conversation so far:\n${transcript}\n\n` +
    `Continue the conversation. The user now says:\n${latest}`
  );
}
