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
 * ladder), the single `client_tool` payload shape, the pause bookkeeping, and the
 * ACP-tool-call correlation live in ONE place instead of being re-derived per path.
 */
import type { AgentEvent, RenderHint } from "../../protocol.ts";
import type { GateDescriptor } from "../../permission-plan.ts";
import { approvedCallKey, type Responder } from "../../responder.ts";
import type {
  ClientToolRelay,
  ClientToolRelayRequest,
} from "../../tools/client-tool-relay.ts";

type EmitRun = { emitEvent: (event: AgentEvent) => void };

/**
 * Lifecycle policy for a parked browser-fulfilled client tool: what happens to both the turn and
 * the in-sandbox shim's blocking `tools/call` when it parks. Closed set:
 *   - "pi-native":        Pi parks through its own extension; the relay writes no answer file.
 *   - "cold-acknowledge": the non-Pi shim (Claude on Daytona) blocks on a relay answer file, so the
 *                         relay writes a benign paused answer to end the `tools/call`. The only
 *                         disposition that writes an answer.
 *   - "warm-hold":        RESERVED, not built — keep the `tools/call` open inside the live turn (the
 *                         way an ACP approval holds on a warm session). See #5384.
 */
export type ClientToolPauseDisposition =
  | "pi-native"
  | "cold-acknowledge"
  | "warm-hold";

/**
 * Whether the relay loop writes the benign paused answer for this disposition — the single derived
 * switch the relay consumes. Exhaustive on purpose: a new disposition (the warm hold) forces a
 * decision here rather than silently falling through to the cold behavior.
 */
export function relayWritesPausedAnswer(
  disposition: ClientToolPauseDisposition,
): boolean {
  switch (disposition) {
    case "cold-acknowledge":
      return true;
    case "pi-native":
      // Pi parks through its extension; the shim answer file is a non-Pi concept.
      return false;
    case "warm-hold":
      // The warm hold keeps the call open inside the live turn, so it writes no cold answer.
      return false;
    default: {
      const unreachable: never = disposition;
      return unreachable;
    }
  }
}

/**
 * Correlates an MCP `tools/call` (which carries only name + arguments) to the real ACP
 * tool-call id Claude surfaced on the event stream, so the paused `client_tool` interaction
 * attaches to Claude's actual tool-call bubble (and `markPausedToolCall` suppresses that
 * bubble's late teardown frames, the F-024 lineage). Populated from `session.onEvent`
 * `tool_call` updates. Claude's ACP adapter titles an internal-MCP tool
 * `mcp__agenta-tools__<name>` while `lookup()` is called with the bare spec name, so `record()`
 * strips that prefix and indexes under the bare name. A `lookup()` match CONSUMES the id
 * (per-key FIFO): a duplicate identical call correlates to its OWN recorded id, never re-homing
 * a first, already-settled call's id. Best-effort; the MCP-minted id / name+args is the
 * cold-replay fallback when the stream had no matching call.
 */
export interface ToolCallCorrelationIndex {
  record(update: unknown): void;
  lookup(toolName: string | undefined, input: unknown): string | undefined;
}

/**
 * Strip the harness's MCP tool prefix (`mcp__<server>__`) so an ACP title indexes under the
 * bare spec name `lookup()` receives. The lazy match ends the prefix at the FIRST `__` after
 * the server name, so a TOOL name that itself contains `__` survives intact (our server name,
 * `agenta-tools`, contains no `__`; a server name that did would truncate ambiguously).
 *
 * Exported: `acp-interactions.ts` reuses it to resolve the real `ResolvedToolSpec` for an ACP
 * gate by the same bare name this index correlates on.
 */
export function bareToolName(title: string): string {
  return title.replace(/^mcp__.+?__/, "");
}

export function createToolCallCorrelationIndex(): ToolCallCorrelationIndex {
  // One entry object is shared by both maps, so consuming a match via either key retires it
  // everywhere at once (no stale id left behind in the other queue).
  type Entry = { id: string; consumed: boolean };
  const byArgsKey = new Map<string, Entry[]>();
  const byName = new Map<string, Entry[]>();
  const recordedIds = new Set<string>();
  const push = (map: Map<string, Entry[]>, key: string, entry: Entry): void => {
    const queue = map.get(key);
    if (queue) queue.push(entry);
    else map.set(key, [entry]);
  };
  const take = (
    map: Map<string, Entry[]>,
    key: string | undefined,
  ): string | undefined => {
    if (!key) return undefined;
    for (const entry of map.get(key) ?? []) {
      if (!entry.consumed) {
        entry.consumed = true;
        return entry.id;
      }
    }
    return undefined;
  };
  return {
    record(update) {
      const u = update as
        | {
            sessionUpdate?: unknown;
            toolCallId?: unknown;
            title?: unknown;
            rawInput?: unknown;
          }
        | undefined;
      if (!u || u.sessionUpdate !== "tool_call") return;
      const toolCallId =
        typeof u.toolCallId === "string" && u.toolCallId
          ? u.toolCallId
          : undefined;
      // Each ACP call is recorded once (a re-sent frame for the same id must not enqueue twice).
      if (!toolCallId || recordedIds.has(toolCallId)) return;
      // The name comes from the ACP `title` only. ACP `kind` is a CATEGORY (read/fetch/execute/
      // other), not a name — indexing under it could mis-correlate unrelated calls.
      const name =
        typeof u.title === "string" && u.title
          ? bareToolName(u.title)
          : undefined;
      if (!name) return;
      recordedIds.add(toolCallId);
      const entry: Entry = { id: toolCallId, consumed: false };
      const argsKey = approvedCallKey(name, u.rawInput);
      if (argsKey) push(byArgsKey, argsKey, entry);
      push(byName, name, entry);
    },
    lookup(toolName, input) {
      return (
        take(byArgsKey, approvedCallKey(toolName, input)) ??
        take(byName, toolName ? toolName : undefined)
      );
    },
  };
}

export interface ClientToolInteractionParams {
  /** The interaction id (the FE matches a reply by it). */
  id: string;
  /** The tool-call id to attach to — already correlated by the caller (`buildClientToolRelay`
   *  resolves the real ACP id when an index is wired; otherwise the channel-minted id). */
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  render?: RenderHint;
}

/**
 * The `interaction_request kind=client_tool` emit for the RELAY/MCP delivery paths (Pi file
 * relay + Claude internal MCP), owned by this seam. The ACP-gate path has its OWN emit site
 * with a richer ACP-native payload (`acp-interactions.ts` `pauseClientTool`, which forwards the
 * harness's toolCall object) — two sites, one per gate. This one emits both the top-level
 * fields and a synthesized `toolCall` sub-object the Vercel egress reads (it tolerates either).
 */
export function emitClientToolInteraction(
  run: EmitRun,
  params: ClientToolInteractionParams,
): void {
  run.emitEvent({
    type: "interaction_request",
    id: params.id,
    kind: "client_tool",
    payload: {
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      input: params.input,
      render: params.render,
      toolCall: {
        id: params.toolCallId,
        toolCallId: params.toolCallId,
        name: params.toolName,
        rawInput: params.input,
        input: params.input,
        kind: "client",
      },
    },
  });
}

/** The pause-controller surface the seam needs (see `PendingApprovalPauseController`). */
interface PauseLike {
  markPausedToolCall(toolCallId: string): void;
  pause(): void;
}

export interface BuildClientToolRelayInput {
  responder: Responder;
  run: EmitRun;
  /** The turn-ender: `pause()` cancels the prompt; `markPausedToolCall` suppresses late frames. */
  pause: PauseLike;
  /**
   * Flag the turn non-parkable when a browser-fulfilled client tool pauses: it cannot be answered
   * on the live session across a turn boundary, so a turn that mixes it with an approval gate must
   * stay on the cold path. Fires once per pending client tool (idempotent counter on the caller).
   */
  onNonParkablePause?: () => void;
  /** Seeds the durable interactions plane for the pending call (fire-and-forget). */
  recordPendingInteraction: (
    token: string,
    toolName: string | undefined,
    toolArgs: unknown,
    kind: "user_approval" | "client_tool",
  ) => void;
  /** Non-Pi harness (Claude): maps the call to its real ACP tool-call id. Omit for Pi (the
   *  relay-minted id is already exact). The relay resolves the id ONCE per pending call and
   *  hands the result to `markPausedToolCall` and the emit — the single correlation owner. */
  toolCallIndex?: ToolCallCorrelationIndex;
  log?: (message: string) => void;
}

/**
 * Build the `ClientToolRelay` both delivery paths use. `onClientTool` asks the responder
 * (consuming a stored browser output when one exists) and, on `pendingApproval`, emits the
 * `client_tool` interaction (a widget) for EACH pending call so several connections requested in
 * one turn all render; `onPause` ends the turn once (idempotent). The consumer (relay loop or MCP
 * handler) calls `onClientTool` then, on a `pendingApproval` outcome, `onPause`.
 */
export function buildClientToolRelay({
  responder,
  run,
  pause,
  recordPendingInteraction,
  toolCallIndex,
  onNonParkablePause,
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
      // Every pending client tool parks its OWN widget: browser-fulfilled client tools are
      // independent surfaces — an agent may request several connections in one turn, and each must
      // render. Approval gates now behave the same way (no per-turn cap). The turn still ends
      // exactly once: `pause.pause()` (via `onPause`) is idempotent, so N emits pause the turn
      // once, and `markPausedToolCall` keeps each parked call from being force-settled as a sibling.
      pause.markPausedToolCall(correlatedId);
      // A client-tool pause keeps the whole turn on the cold path: the warm resume cannot answer
      // a browser-fulfilled call, so a turn that also holds an approval gate must not park.
      onNonParkablePause?.();
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
      return "pendingApproval";
    },
    onPause: () => pause.pause(),
  };
}
