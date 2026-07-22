/**
 * Reconstruct a conversation's `ChatMessage[]` from the durable session record log — the
 * server-side inverse of `buildPersistingEmitter`'s coalescing. This is what lets the client
 * send only the newest user message: the runner rebuilds prior turns from records instead of
 * trusting a full inbound history.
 *
 * The fold is chronological (records already arrive ordered by ingest time, then per-turn
 * `record_index`) and keyed on `record_source`: a "user" record flushes the assistant turn in
 * progress and starts a user turn; "agent" records accumulate into the current assistant turn as
 * ACP content blocks. The output matches the vercel adapter's `ChatMessage`/`ContentBlock` shape
 * exactly (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py`), so `buildTurnText`,
 * `priorMessages`, and the responder's tool_call↔tool_result binding consume it unchanged.
 *
 * Completeness: records store the coalesced text/tool events, so reconstruction covers text,
 * tool calls, and tool results (incl. still-parked calls, so a HITL answer arriving on the last
 * message binds to its reconstructed tool_call). Reasoning, usage, and one-way UI events are not
 * conversation context and are dropped. User attachments are NOT in the durable log (only the
 * prompt text is persisted), so a reconstructed user turn is text-only — a known v1 gap.
 */

import type { AgentEvent, ChatMessage, ContentBlock } from "../protocol.ts";

/** One durable record row as `POST /sessions/records/query` returns it. `attributes` is the
 * coalesced `AgentEvent`; `record_source` is the author ("user" | "agent"). */
export interface SessionRecordRow {
  record_source?: string | null;
  record_type?: string | null;
  attributes?: unknown;
  turn_id?: string | null;
  record_index?: number | null;
  created_at?: string | null;
}

function eventOf(row: SessionRecordRow): AgentEvent | null {
  const attrs = row?.attributes;
  if (!attrs || typeof attrs !== "object") return null;
  if (typeof (attrs as { type?: unknown }).type !== "string") return null;
  return attrs as AgentEvent;
}

/** One agent `AgentEvent` → an assistant content block, or null when it carries no conversation
 * context (reasoning/usage/done/data/file/interaction lifecycle). `callNames` carries tool names
 * forward from the call so a later result (which stores only the id) can label itself. */
function eventToBlock(
  event: AgentEvent,
  callNames: Map<string, string>,
): ContentBlock | null {
  switch (event.type) {
    case "message":
      return event.text ? { type: "text", text: event.text } : null;
    case "tool_call": {
      if (event.id && event.name) callNames.set(event.id, event.name);
      return {
        type: "tool_call",
        toolCallId: event.id,
        toolName: event.name,
        input: event.input,
      };
    }
    case "tool_result":
      return {
        type: "tool_result",
        toolCallId: event.id,
        toolName: event.id ? callNames.get(event.id) : undefined,
        output: event.output ?? event.data,
        isError: event.isError,
      };
    case "error":
      return { type: "text", text: `[error: ${event.message}]` };
    default:
      return null;
  }
}

/** Collapse an assistant turn's blocks to a `ChatMessage` — an all-text turn becomes a plain
 * string (mirrors the vercel adapter), otherwise the block array is kept. */
function finalizeAssistant(blocks: ContentBlock[]): ChatMessage {
  if (blocks.every((b) => b.type === "text")) {
    return { role: "assistant", content: blocks.map((b) => b.text ?? "").join("") };
  }
  return { role: "assistant", content: blocks };
}

/**
 * Fold ordered session records into the conversation's `ChatMessage[]`. Pure; no I/O. Records
 * MUST be in conversation order (the query endpoint returns them by `created_at`, then
 * `record_index`) — this fold preserves that order and does not re-sort.
 */
export function reconstructMessages(
  records: readonly SessionRecordRow[],
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const callNames = new Map<string, string>();
  let assistant: ContentBlock[] | null = null;

  const flushAssistant = (): void => {
    if (assistant && assistant.length) messages.push(finalizeAssistant(assistant));
    assistant = null;
  };

  for (const row of records) {
    const event = eventOf(row);
    if (!event) continue;

    if (row.record_source === "user") {
      flushAssistant();
      const text = event.type === "message" ? (event.text ?? "") : "";
      messages.push({ role: "user", content: text });
      continue;
    }

    const block = eventToBlock(event, callNames);
    if (block) (assistant ??= []).push(block);
  }
  flushAssistant();
  return messages;
}
