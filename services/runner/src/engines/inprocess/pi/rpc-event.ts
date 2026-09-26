/**
 * A Pi session event in the shape Pi's RPC mode writes it to stdout (Pi 0.87.1
 * `modes/json-event.js`, which the package does not export). pi-acp's mapping was written against
 * that shape, and it differs from the in-memory event in one way that shows in the chat: streamed
 * message updates carry no `partial` message, so pi-acp announces a tool call at `toolcall_end`,
 * not at `toolcall_start`. Converting here keeps an in-process session's event stream identical to
 * a Pi subprocess's.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export type RpcEvent = Record<string, unknown> & { type: string };

export function toRpcEvent(event: AgentSessionEvent): RpcEvent {
  if (event.type !== "message_update") return { ...event };
  const update = event.assistantMessageEvent;
  let assistantMessageEvent: Record<string, unknown>;
  if (update.type === "toolcall_start") {
    const { partial, ...delta } = update;
    const toolCall = partial.content[update.contentIndex];
    assistantMessageEvent = toolCall?.type === "toolCall" ? { ...delta, id: toolCall.id, toolName: toolCall.name } : delta;
  } else if ("partial" in update) {
    const { partial: _partial, ...delta } = update;
    assistantMessageEvent = delta;
  } else {
    assistantMessageEvent = { ...update };
  }
  return { type: "message_update", usage: event.message.role === "assistant" ? event.message.usage : undefined, assistantMessageEvent };
}
