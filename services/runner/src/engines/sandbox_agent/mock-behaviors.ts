/** name -> behaviour for `harness: "mock"`; each emits the real ACP `session/update` shapes. */

export interface MockToolCall {
  toolCallId: string;
  name: string;
}

export interface MockBehaviorContext {
  /** Emit one ACP `session/update` payload to the session's event listener. */
  emit: (update: Record<string, unknown>) => void;
  /** Raise a permission gate and resolve once `respondPermission` answers it — parks until then. */
  requestPermission: (toolCall: MockToolCall) => Promise<string>;
  nextToolCallId: () => string;
}

export type MockBehaviorFn = (
  kwargs: Record<string, unknown>,
  ctx: MockBehaviorContext,
) => Promise<{ stopReason: string }>;

function requiredText(
  kwargs: Record<string, unknown>,
  field: string,
  behavior: string,
): string {
  const value = kwargs[field];
  if (typeof value !== "string" || !value) {
    throw new Error(
      `mock behaviour '${behavior}' requires a non-empty '${field}' kwarg`,
    );
  }
  return value;
}

async function replyBehavior(
  kwargs: Record<string, unknown>,
  ctx: MockBehaviorContext,
): Promise<{ stopReason: string }> {
  const text = requiredText(kwargs, "text", "reply");
  ctx.emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  return { stopReason: "end_turn" };
}

async function thinkingBehavior(
  kwargs: Record<string, unknown>,
  ctx: MockBehaviorContext,
): Promise<{ stopReason: string }> {
  const thought = requiredText(kwargs, "thought", "thinking");
  const text = requiredText(kwargs, "text", "thinking");
  ctx.emit({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: thought },
  });
  ctx.emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  return { stopReason: "end_turn" };
}

async function toolBehavior(
  kwargs: Record<string, unknown>,
  ctx: MockBehaviorContext,
): Promise<{ stopReason: string }> {
  const tool = requiredText(kwargs, "tool", "tool");
  const text = requiredText(kwargs, "text", "tool");
  const toolCallId = ctx.nextToolCallId();
  ctx.emit({
    sessionUpdate: "tool_call",
    toolCallId,
    name: tool,
    title: tool,
    kind: tool,
    rawInput: {},
  });
  ctx.emit({
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: "completed",
    content: [{ type: "text", text: `${tool} completed` }],
  });
  ctx.emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  return { stopReason: "end_turn" };
}

/** Announces the call and parks on the permission gate; the reply decides the closing status. */
async function approvalBehavior(
  kwargs: Record<string, unknown>,
  ctx: MockBehaviorContext,
): Promise<{ stopReason: string }> {
  const tool = requiredText(kwargs, "tool", "approval");
  const toolCallId = ctx.nextToolCallId();
  ctx.emit({
    sessionUpdate: "tool_call",
    toolCallId,
    name: tool,
    title: tool,
    kind: tool,
    rawInput: {},
  });
  const reply = await ctx.requestPermission({ toolCallId, name: tool });
  const approved = reply === "once" || reply === "always";
  ctx.emit({
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: approved ? "completed" : "failed",
    content: [{ type: "text", text: approved ? `${tool} approved` : `${tool} denied` }],
  });
  return { stopReason: "end_turn" };
}

async function slowBehavior(
  kwargs: Record<string, unknown>,
  ctx: MockBehaviorContext,
): Promise<{ stopReason: string }> {
  const ms = kwargs.ms;
  if (typeof ms !== "number" || ms < 0) {
    throw new Error("mock behaviour 'slow' requires a non-negative numeric 'ms' kwarg");
  }
  const then = requiredText(kwargs, "then", "slow");
  // Guarded so a malformed config cannot wedge the turn in an infinite delay chain.
  if (then === "slow") {
    throw new Error("mock behaviour 'slow' cannot chain into itself via 'then'");
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
  return runMockBehavior(then, kwargs, ctx);
}

async function errorBehavior(
  kwargs: Record<string, unknown>,
): Promise<{ stopReason: string }> {
  const message = requiredText(kwargs, "message", "error");
  throw new Error(message);
}

async function multiBehavior(
  kwargs: Record<string, unknown>,
  ctx: MockBehaviorContext,
): Promise<{ stopReason: string }> {
  const texts = kwargs.texts;
  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    !texts.every((t) => typeof t === "string" && t)
  ) {
    throw new Error("mock behaviour 'multi' requires a non-empty 'texts' array of strings");
  }
  for (const text of texts) {
    ctx.emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  }
  return { stopReason: "end_turn" };
}

/** name -> behaviour. The only place a new mock behaviour is registered. */
export const MOCK_BEHAVIORS: Record<string, MockBehaviorFn> = {
  reply: replyBehavior,
  thinking: thinkingBehavior,
  tool: toolBehavior,
  approval: approvalBehavior,
  slow: slowBehavior,
  error: errorBehavior,
  multi: multiBehavior,
};

export async function runMockBehavior(
  name: string,
  kwargs: Record<string, unknown>,
  ctx: MockBehaviorContext,
): Promise<{ stopReason: string }> {
  const behavior = MOCK_BEHAVIORS[name];
  if (!behavior) {
    throw new Error(`unknown mock behaviour '${name}'`);
  }
  return behavior(kwargs, ctx);
}
