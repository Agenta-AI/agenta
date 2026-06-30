/**
 * The shared client-tool seam.
 *
 * A `client` tool (e.g. `request_connection`) is browser-fulfilled across a turn boundary: the
 * model calls it, the runner emits a `client_tool` interaction_request so the frontend renders a
 * widget, the turn ends `paused`, and the next turn resumes with the browser's result. Two
 * delivery channels reach this same park:
 *   - Pi loads tools through its bundled extension and parks via the runner's file relay
 *     (`tools/relay.ts` -> `startToolRelay`).
 *   - Claude takes tools over the internal loopback MCP server and parks inside its `tools/call`
 *     handler (`tools/tool-mcp-http.ts`).
 *
 * Both build their `ClientToolRelay` here, so the park decision, the single `client_tool` payload
 * shape, and the ACP-tool-call correlation live in ONE place instead of being re-derived per path.
 */
import type { AgentEvent, RenderHint } from "../../protocol.ts";
import {
  parkedCallKey,
  type ClientToolRelay,
  type ClientToolRelayRequest,
  type Responder,
} from "../../responder.ts";

type EmitRun = { emitEvent: (event: AgentEvent) => void };

/**
 * Correlates an MCP `tools/call` (which carries only name + arguments) to the real ACP
 * tool-call id Claude surfaced on the event stream, so the parked `client_tool` interaction
 * attaches to Claude's actual tool-call bubble. Populated from `session.onEvent` `tool_call`
 * updates; the MCP-minted id / name+args is the cold-replay fallback when the stream had no
 * matching call. Best-effort and first-write-wins (a later identical call never re-homes an id).
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
      const argsKey = parkedCallKey(name, u.rawInput);
      if (argsKey && !byArgsKey.has(argsKey)) byArgsKey.set(argsKey, toolCallId);
      if (name && !byName.has(name)) byName.set(name, toolCallId);
    },
    lookup(toolName, input) {
      const argsKey = parkedCallKey(toolName, input);
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

export interface BuildClientToolRelayInput {
  responder: Responder;
  run: EmitRun;
  /** First-park-wins turn-ender (the engine's `destroySession`-based onPark; idempotent). */
  onPark: () => void;
  /** Claude only: maps the call to its real ACP tool-call id. Omit for Pi (relay id is exact). */
  toolCallIndex?: ToolCallCorrelationIndex;
}

/**
 * Build the `ClientToolRelay` both delivery paths use. `onClientTool` asks the responder, and on
 * `park` emits the `client_tool` interaction; `onPark` is the engine's turn-ender. The consumer
 * (relay loop or MCP handler) calls `onClientTool` then, on a `park` outcome, `onPark` — exactly
 * the previous inline behavior, so Pi is unchanged.
 */
export function buildClientToolRelay({
  responder,
  run,
  onPark,
  toolCallIndex,
}: BuildClientToolRelayInput): ClientToolRelay {
  return {
    onClientTool: async (request: ClientToolRelayRequest) => {
      const decision = await responder.onClientTool({
        id: request.id,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        input: request.input,
        raw: { spec: request.spec },
      });
      if (decision === "park") {
        emitClientToolInteraction(
          run,
          {
            id: request.id,
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            input: request.input,
            render: request.spec.render,
          },
          toolCallIndex,
        );
      }
      return decision;
    },
    onPark: () => onPark(),
  };
}
