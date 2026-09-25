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
 * conversation context and are dropped. User attachments ride the user message event and rebuild
 * as attachment blocks followed by exactly one text block.
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
  return foldMessages(withoutFailedTurns(records));
}

function isErrorRecord(row: SessionRecordRow): boolean {
  return row.record_source !== "user" && eventOf(row)?.type === "error";
}

/** What a failed turn leaves out: everything but the person's message. */
function isDroppedOnFailure(row: SessionRecordRow): boolean {
  return row.record_source !== "user";
}

/**
 * From a turn that ended in an error, keep the person's message and drop what the agent did (its
 * text, tool calls, tool results and the error). Replaying a failed turn whole made one refusal
 * permanent: the content the provider refused (usually a tool result) went out again on every
 * later turn, together with the refusal text, and was refused again. The question stays, so a
 * "continue" after a timeout or a lost turn still has something to continue. An in-process Pi
 * session applies the same rule to its own transcript (`InProcessAcpSession.rollbackFailedTurn`),
 * where a tool call cannot stay without its result.
 *
 * A turn is its records' shared `turn_id`. Rows without one (older logs) fall back to the span
 * from a user message to the next one.
 */
function withoutFailedTurns(
  records: readonly SessionRecordRow[],
): readonly SessionRecordRow[] {
  const failedTurnIds = new Set<string>();
  for (const row of records) {
    if (row.turn_id && isErrorRecord(row)) failedTurnIds.add(row.turn_id);
  }
  const out: SessionRecordRow[] = [];
  let span: SessionRecordRow[] = [];
  let spanFailed = false;
  const flush = (): void => {
    out.push(...(spanFailed ? span.filter((row) => !isDroppedOnFailure(row)) : span));
    span = [];
    spanFailed = false;
  };
  for (const row of records) {
    if (row.turn_id) {
      flush();
      if (!(failedTurnIds.has(row.turn_id) && isDroppedOnFailure(row))) out.push(row);
      continue;
    }
    if (row.record_source === "user") flush();
    span.push(row);
    if (isErrorRecord(row)) spanFailed = true;
  }
  flush();
  return out;
}

function foldMessages(records: readonly SessionRecordRow[]): ChatMessage[] {
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
      const attachments =
        event.type === "message" && Array.isArray(event.attachments)
          ? event.attachments.filter(
              (attachment) =>
                attachment && typeof attachment.attachmentId === "string",
            )
          : [];
      const content: string | ContentBlock[] =
        attachments.length > 0
          ? [
              ...attachments.map((attachment) => ({
                type: "attachment",
                attachmentId: attachment.attachmentId,
                filename: attachment.filename,
                mimeType: attachment.mediaType,
                size: attachment.size,
              })),
              { type: "text", text },
            ]
          : text;
      messages.push({ role: "user", content });
      continue;
    }

    const block = eventToBlock(event, callNames);
    if (block) (assistant ??= []).push(block);
  }
  flushAssistant();
  return messages;
}
