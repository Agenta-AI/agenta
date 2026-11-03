/**
 * Raising one approval card from a runner-side seam.
 *
 * Two seams park a call for a human: the loopback MCP gate (`executable-tools.ts`) and the
 * gateway gate (`gateway-gate.ts`). What they do at the moment of parking is the same, and it
 * has to STAY the same, because the fields below are not presentation — the Vercel egress reads
 * them to build the tool part the frontend persists, and the next turn folds that part back into
 * the stored approval key.
 *
 * That contract is fragile in a specific way, which is the reason this lives in one place:
 * `_approval_tool_name` in `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py` prefers
 * `resolvedName`, then a nested spec's `name`, then `name`, `title`, `kind`; `_tool_call_input`
 * prefers `rawInput`, then `input`. So `toolName` and `args` here must be the values the gate
 * KEYED ON, and anything a card wants to display instead belongs in `payloadExtras` or
 * `toolCallExtras` — never in a field on that list, and never under a nested object named
 * `spec`, `toolSpec`, `resolvedTool`, or `tool`, all of which the egress reads as a tool spec.
 *
 * Written down twice, this drifts the first time `stream.py` changes and only one copy is found.
 */
import type { AgentEvent } from "../../protocol.ts";
import type { ToolCallCorrelationIndex } from "./client-tools.ts";

export type EmitRun = { emitEvent: (event: AgentEvent) => void };

/** The pause-controller surface a seam needs (see `PendingApprovalPauseController`). */
export interface PauseLike {
  markPausedToolCall(toolCallId: string): void;
  pause(): void;
}

/** Seeds the durable interactions plane for a pending call (fire-and-forget). */
export type RecordPendingInteraction = (
  token: string,
  toolName: string | undefined,
  toolArgs: unknown,
  kind: "user_approval" | "client_tool",
  toolCallId?: string,
) => void;

export interface RaiseApprovalInput {
  run: EmitRun;
  pause: PauseLike;
  recordPendingInteraction: RecordPendingInteraction;
  /** Non-Pi harnesses: maps the call to the real ACP tool-call id the card attaches to. */
  toolCallIndex?: ToolCallCorrelationIndex;
  /** The interaction token the reply is matched by. */
  id: string;
  /** The channel-minted tool-call id, used when no correlation is available. */
  toolCallId: string;
  /** IDENTITY. The name the gate keyed on — never a display name. */
  toolName: string;
  /** IDENTITY. The arguments the gate keyed on — never a narrowed view of them. */
  args: unknown;
  /** Presentation-only fields merged into the interaction payload. */
  payloadExtras?: Record<string, unknown>;
  /** Presentation-only fields merged into the payload's `toolCall` object. */
  toolCallExtras?: Record<string, unknown>;
}

/**
 * Emit the approval card, mark the call paused, and seed the durable row. Returns the correlated
 * tool-call id the card attached to, which the caller may need for its own bookkeeping.
 */
export function raiseApproval(input: RaiseApprovalInput): string {
  const {
    run,
    pause,
    recordPendingInteraction,
    toolCallIndex,
    id,
    toolName,
    args,
    payloadExtras,
    toolCallExtras,
  } = input;

  const correlatedId =
    toolCallIndex?.lookup(toolName, args) ?? input.toolCallId;
  pause.markPausedToolCall(correlatedId);
  run.emitEvent({
    type: "interaction_request",
    id,
    kind: "user_approval",
    payload: {
      toolCallId: correlatedId,
      ...payloadExtras,
      toolCall: {
        id: correlatedId,
        toolCallId: correlatedId,
        name: toolName,
        resolvedName: toolName,
        rawInput: args,
        input: args,
        kind: "execute",
        ...toolCallExtras,
      },
      availableReplies: ["once", "reject"],
    },
  });
  // The 5th argument keys the durable interaction row by the harness's tool-call id, so
  // server.ts can match an out-of-band approval reply by tool_call_id.
  recordPendingInteraction(id, toolName, args, "user_approval", correlatedId);
  return correlatedId;
}
