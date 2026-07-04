/**
 * The shared client-tool seam.
 *
 * A `client` tool (e.g. `request_connection`) is browser-fulfilled across a turn boundary: the
 * model calls it, the runner emits a `client_tool` interaction_request so the frontend renders a
 * widget, the turn ends `paused`, and the next turn resumes with the browser's result. Two
 * delivery channels reach this same pause:
 *   - Pi loads tools through its bundled extension and pauses via the runner's file relay
 *     (`tools/relay.ts` -> `startToolRelay`).
 *   - Claude takes tools over the internal loopback MCP server and pauses inside its
 *     `tools/call` handler (`tools/tool-mcp-http.ts`).
 *
 * Both consume the `ClientToolRelay` built here, so the pause decision (the responder's verdict
 * ladder), the single `client_tool` payload shape, the pause-latch bookkeeping, and the
 * ACP-tool-call correlation live in ONE place instead of being re-derived per path.
 */
import type { AgentEvent, RenderHint } from "../../protocol.ts";
import type { GateDescriptor } from "../../permission-plan.ts";
import { approvedCallKey, type Responder } from "../../responder.ts";
import type {
  ClientToolRelay,
  ClientToolRelayRequest,
} from "../../tools/relay.ts";

type EmitRun = { emitEvent: (event: AgentEvent) => void };

/**
 * Correlates an MCP `tools/call` (which carries only name + arguments) to the real ACP
 * tool-call id Claude surfaced on the event stream, so the paused `client_tool` interaction
 * attaches to Claude's actual tool-call bubble (and `markPausedToolCall` suppresses that
 * bubble's late teardown frames, the F-024 lineage). Populated from `session.onEvent`
 * `tool_call` updates; the MCP-minted id / name+args is the cold-replay fallback when the
 * stream had no matching call. Best-effort and first-write-wins (a later identical call never
 * re-homes an id).
 */
export interface ToolCallCorrelationIndex {
  record(update: unknown): void;
  lookup(toolName: string | undefined, input: unknown): string | undefined;
}

export function createToolCallCorrelationIndex(): ToolCallCorrelationIndex {
  const byArgsKey = new Map<string, string>();
  const byName = new Map<string, string>();
  return {
    record(update) {
      const u = update as
        | {
            sessionUpdate?: unknown;
            toolCallId?: unknown;
            title?: unknown;
            kind?: unknown;
            rawInput?: unknown;
          }
        | undefined;
      if (!u || u.sessionUpdate !== "tool_call") return;
      const toolCallId =
        typeof u.toolCallId === "string" && u.toolCallId ? u.toolCallId : undefined;
      if (!toolCallId) return;
      const name =
        typeof u.title === "string" && u.title
          ? u.title
          : typeof u.kind === "string" && u.kind
            ? u.kind
            : undefined;
      const argsKey = approvedCallKey(name, u.rawInput);
      if (argsKey && !byArgsKey.has(argsKey)) byArgsKey.set(argsKey, toolCallId);
      if (name && !byName.has(name)) byName.set(name, toolCallId);
    },
    lookup(toolName, input) {
      const argsKey = approvedCallKey(toolName, input);
      if (argsKey) {
        const hit = byArgsKey.get(argsKey);
        if (hit) return hit;
      }
      if (toolName) {
        const hit = byName.get(toolName);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

export interface ClientToolInteractionParams {
  /** The interaction id (the FE matches a reply by it). */
  id: string;
  /** The runner/relay-minted tool-call id; overridden by the correlated ACP id when one exists. */
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  render?: RenderHint;
}

/**
 * THE single definition of the `interaction_request kind=client_tool` payload. Emits both the
 * top-level fields and a synthesized `toolCall` sub-object the Vercel egress reads (it tolerates
 * either), and substitutes the correlated ACP tool-call id when the index has one.
 */
export function emitClientToolInteraction(
  run: EmitRun,
  params: ClientToolInteractionParams,
  toolCallIndex?: ToolCallCorrelationIndex,
): void {
  const correlatedId =
    toolCallIndex?.lookup(params.toolName, params.input) ?? params.toolCallId;
  run.emitEvent({
    type: "interaction_request",
    id: params.id,
    kind: "client_tool",
    payload: {
      toolCallId: correlatedId,
      toolName: params.toolName,
      input: params.input,
      render: params.render,
      toolCall: {
        id: correlatedId,
        toolCallId: correlatedId,
        name: params.toolName,
        rawInput: params.input,
        input: params.input,
        kind: "client",
      },
    },
  });
}

/** The one-pause-per-turn latch surface the seam needs (see `PendingApprovalLatch`). */
interface LatchLike {
  tryAcquire(): boolean;
}

/** The pause-controller surface the seam needs (see `PendingApprovalPauseController`). */
interface PauseLike {
  markPausedToolCall(toolCallId: string): void;
  pause(): void;
}

export interface BuildClientToolRelayInput {
  responder: Responder;
  run: EmitRun;
  /** One pause per turn: only the first pending gate emits its interaction and pauses. */
  latch: LatchLike;
  /** The turn-ender: `pause()` cancels the prompt; `markPausedToolCall` suppresses late frames. */
  pause: PauseLike;
  /** Seeds the durable interactions plane for the pending call (fire-and-forget). */
  recordPendingInteraction: (
    token: string,
    toolName: string | undefined,
    toolArgs: unknown,
    kind: "user_approval" | "client_tool",
  ) => void;
  /** Claude only: maps the call to its real ACP tool-call id. Omit for Pi (relay id is exact). */
  toolCallIndex?: ToolCallCorrelationIndex;
  log?: (message: string) => void;
}

/**
 * Build the `ClientToolRelay` both delivery paths use. `onClientTool` asks the responder
 * (consuming a stored browser output when one exists) and, on `pendingApproval`, emits the
 * `client_tool` interaction under the latch; `onPause` ends the turn. The consumer (relay loop
 * or MCP handler) calls `onClientTool` then, on a `pendingApproval` outcome, `onPause` — exactly
 * the previous inline engine behavior, so Pi is unchanged.
 */
export function buildClientToolRelay({
  responder,
  run,
  latch,
  pause,
  recordPendingInteraction,
  toolCallIndex,
  log = () => {},
}: BuildClientToolRelayInput): ClientToolRelay {
  return {
    onClientTool: async (request: ClientToolRelayRequest) => {
      const gate: GateDescriptor = {
        executor: "client",
        toolName: request.spec.name,
        specPermission: request.spec.permission,
        readOnlyHint: request.spec.readOnly,
        args: request.input,
      };
      const verdict = await responder.onClientTool(
        {
          id: request.id,
          toolCallId: request.toolCallId,
          gate,
          raw: { spec: request.spec },
        },
        { consume: true },
      );
      if (process.env.AGENTA_RUNNER_DEBUG_TOOLS) {
        log(
          `[client-tool] ${request.toolName} id=${request.toolCallId} kind=${request.spec.kind} ` +
            `decision=${JSON.stringify(verdict).slice(0, 200)}`,
        );
      }
      if (verdict.kind === "deny") return "deny";
      if (verdict.kind === "fulfilled") return { output: verdict.output };
      // Pending: pause the browser-fulfilled call. Correlate to the real ACP tool-call id when
      // an index is wired (Claude MCP) so the widget attaches to Claude's tool bubble and its
      // late teardown frames are suppressed; Pi's relay-minted id is already exact.
      const correlatedId =
        toolCallIndex?.lookup(request.toolName, request.input) ??
        request.toolCallId;
      if (latch.tryAcquire()) {
        pause.markPausedToolCall(correlatedId);
        emitClientToolInteraction(run, {
          id: request.id,
          toolCallId: correlatedId,
          toolName: request.toolName,
          input: request.input,
          render: request.spec.render,
        });
        recordPendingInteraction(
          request.id,
          request.toolName,
          request.input,
          "client_tool",
        );
      }
      return "pendingApproval";
    },
    onPause: () => pause.pause(),
  };
}
