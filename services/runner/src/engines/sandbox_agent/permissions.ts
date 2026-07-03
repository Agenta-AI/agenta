import type { AgentEvent, ToolPermission } from "../../protocol.ts";
import {
  decisionToReply,
  type ClientToolVerdict,
  type PermissionDecision,
  type Responder,
} from "../../responder.ts";
import {
  PendingApprovalLatch,
  type GateDescriptor,
} from "../../permission-plan.ts";

export interface AttachPermissionResponderInput {
  session: any;
  run: { emitEvent: (event: AgentEvent) => void; events?: () => AgentEvent[] };
  responder: Responder;
  latch: PendingApprovalLatch;
  serverPermissions?: ReadonlyMap<string, ToolPermission>;
  /**
   * Called when a gate pauses the turn. The orchestration loop uses this to end the turn
   * gracefully because a paused Claude turn never resolves `session.prompt()` on its own.
   */
  onPark?: () => void;
  log?: (msg: string) => void;
  /** Called on pause to record the pending gate as an interaction (fire-and-forget). */
  onCreateInteraction?: (
    token: string,
    toolName: string | undefined,
    toolArgs: unknown,
  ) => void;
  /** Called after a stored decision was successfully forwarded to the harness. */
  onResolveInteraction?: (token: string) => void;
}

/** Wire ACP permission reverse-RPC into the runner's event stream and responder policy. */
export function attachPermissionResponder({
  session,
  run,
  responder,
  latch,
  serverPermissions = new Map(),
  onPark,
  log,
  onCreateInteraction,
  onResolveInteraction,
}: AttachPermissionResponderInput): void {
  session.onPermissionRequest((req: any) => {
    void handleRequest(req).catch((err) => {
      log?.(`[HITL] permission handling failed: ${errorMessage(err)}`);
      onPark?.();
    });
  });

  // A pause sends NO harness reply, ever. Replying `reject` would make Claude emit a failed
  // tool call ("User refused permission") whose `tool_result {isError}` overwrites the
  // approval prompt on the same tool-call id (the F-024 clobber). The turn instead ends via
  // `onPark` (session teardown resolves the RPC as cancelled, not rejected) and the next
  // turn's stored decision answers the re-raised gate.
  const pauseUserApproval = (req: any, id: string, gate: GateDescriptor): void => {
    if (!latch.tryAcquire()) return;
    const eventId = interactionEventId(id, req?.toolCall?.toolCallId);
    run.emitEvent({
      type: "interaction_request",
      id: eventId,
      kind: "user_approval",
      payload: {
        toolCallId: stringValue(req?.toolCall?.toolCallId),
        toolCall: req?.toolCall,
        availableReplies: stringArray(req?.availableReplies),
        options: req?.options,
      },
    });
    onCreateInteraction?.(eventId, gate.toolName, gate.args);
    onPark?.();
  };

  const pauseClientTool = (
    req: any,
    id: string,
    gate: GateDescriptor,
    spec: ToolSpecLike,
  ): void => {
    if (!latch.tryAcquire()) return;
    const toolCallId = stringValue(req?.toolCall?.toolCallId);
    const eventId = interactionEventId(id, toolCallId);
    run.emitEvent({
      type: "interaction_request",
      id: eventId,
      kind: "client_tool",
      payload: {
        toolCallId,
        toolCall: req?.toolCall,
        toolName: gate.toolName,
        input: gate.args,
        render: spec.render,
      },
    });
    onPark?.();
  };

  const replyPermission = async (
    id: string,
    decision: PermissionDecision,
    availableReplies: string[],
  ): Promise<void> => {
    try {
      await session.respondPermission(
        id,
        decisionToReply(decision, availableReplies) as any,
      );
    } catch (err) {
      log?.(`[HITL] reply failed id=${id} decision=${decision}: ${errorMessage(err)}`);
      onPark?.();
      return;
    }
    onResolveInteraction?.(id);
  };

  const replyClientTool = async (
    id: string,
    verdict: Exclude<ClientToolVerdict, { kind: "pendingApproval" }>,
    availableReplies: string[],
  ): Promise<void> => {
    try {
      await session.respondPermission(
        id,
        clientToolReply(verdict, availableReplies) as any,
      );
    } catch (err) {
      log?.(`[HITL] reply failed id=${id} decision=${verdict.kind}: ${errorMessage(err)}`);
      onPark?.();
    }
  };

  async function handleRequest(req: any): Promise<void> {
    const id = stringValue(req?.id) ?? "";
    const availableReplies = stringArray(req?.availableReplies);
    const toolCall = req?.toolCall;
    const spec = resolvedSpecOf(toolCall);
    const gate = buildGateDescriptor(toolCall, run, serverPermissions);
    // Ground truth for HITL debugging: exactly what the harness handed us for this gate.
    // The stable anchor (gate.toolName) vs the drift-prone display fields is what a live
    // session needs to diagnose a resume-key mismatch; keep this greppable via `[HITL]`.
    if (log) {
      const args = toolCall?.rawInput ?? toolCall?.input;
      log(
        `[HITL] ACP gate id=${id} ` +
          JSON.stringify({
            toolCallId: toolCall?.toolCallId,
            anchor: gate.toolName,
            specName: spec?.name,
            title: toolCall?.title,
            kind: toolCall?.kind,
            executor: gate.executor,
            argKeys: args && typeof args === "object" ? Object.keys(args) : typeof args,
          }),
      );
    }

    if (spec?.kind === "client") {
      const verdict = await responder.onClientTool({
        id,
        toolCallId: stringValue(toolCall?.toolCallId),
        gate,
        raw: req,
      });
      if (verdict.kind === "pendingApproval" || !id) {
        pauseClientTool(req, id, gate, spec);
        return;
      }
      await replyClientTool(id, verdict, availableReplies);
      return;
    }

    const verdict = await responder.onPermission({
      id,
      availableReplies,
      gate,
      raw: req,
    });
    if (verdict.kind === "pendingApproval" || !id) {
      pauseUserApproval(req, id, gate);
      return;
    }
    await replyPermission(id, verdict.kind, availableReplies);
  }
}

/**
 * The name the runner already recorded for this tool-call id via the `session/update`
 * `tool_call` event. Used to key a harness gate so it matches the stored decision across a
 * cold-replay resume when the ACP permission frame's own title drifts.
 */
function recordedToolName(
  run: { events?: () => AgentEvent[] },
  toolCallId: unknown,
): string | undefined {
  if (typeof toolCallId !== "string" || !toolCallId || !run.events) return undefined;
  let name: string | undefined;
  for (const event of run.events()) {
    if (event.type === "tool_call" && event.id === toolCallId && event.name) {
      name = event.name;
    }
  }
  return name;
}

function buildGateDescriptor(
  toolCall: any,
  run: { events?: () => AgentEvent[] },
  serverPermissions: ReadonlyMap<string, ToolPermission>,
): GateDescriptor {
  const spec = resolvedSpecOf(toolCall);
  const toolName = firstString([
    spec?.name,
    recordedToolName(run, toolCall?.toolCallId),
    toolCall?.name,
    toolCall?.title,
    toolCall?.kind,
  ]);
  const specPermission = toolPermission(spec?.permission);
  const args = toolCall?.rawInput ?? toolCall?.input;
  return {
    executor: spec?.kind === "client" ? "client" : spec ? "relay" : "harness",
    toolName,
    specPermission,
    serverPermission: spec ? undefined : serverPermissionFor(toolName, serverPermissions),
    readOnlyHint: typeof spec?.readOnly === "boolean" ? spec.readOnly : undefined,
    args,
  };
}

function serverPermissionFor(
  toolName: string | undefined,
  serverPermissions: ReadonlyMap<string, ToolPermission>,
): ToolPermission | undefined {
  if (!toolName?.startsWith("mcp__")) return undefined;
  const rest = toolName.slice("mcp__".length);
  const separator = rest.indexOf("__");
  if (separator <= 0) return undefined;
  return serverPermissions.get(rest.slice(0, separator));
}

type ToolSpecLike = {
  name?: unknown;
  kind?: unknown;
  permission?: unknown;
  readOnly?: unknown;
  render?: unknown;
};

function resolvedSpecOf(toolCall: any): ToolSpecLike | undefined {
  const spec = toolCall?.spec ?? toolCall?.toolSpec ?? toolCall?.resolvedTool ?? toolCall?.tool;
  return spec && typeof spec === "object" ? (spec as ToolSpecLike) : undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function toolPermission(value: unknown): ToolPermission | undefined {
  return value === "allow" || value === "ask" || value === "deny" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function interactionEventId(id: string, toolCallId: unknown): string {
  return id || stringValue(toolCallId) || "";
}

function clientToolReply(
  verdict: Exclude<ClientToolVerdict, { kind: "pendingApproval" }>,
  availableReplies: string[],
): string {
  if (verdict.kind === "deny") {
    return availableReplies.find((r) => r === "reject") ?? "reject";
  }
  return availableReplies.find((r) => r === "once") ?? "once";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
