import type { AgentEvent, ToolPermission } from "../../protocol.ts";
import {
  decisionToReply,
  type ClientToolVerdict,
  type PermissionDecision,
  type Responder,
} from "../../responder.ts";
import {
  piBuiltinIdentity,
  PendingApprovalLatch,
  type GateDescriptor,
} from "../../permission-plan.ts";
import {
  parsePiGateEnvelope,
  type PiGateEnvelope,
} from "./pi-gate-envelope.ts";

/** The parkable gate types a paused turn can record (the Claude ACP and Pi ACP gates). */
export type ParkedApprovalGateType =
  "claude-acp-permission" | "pi-acp-permission";

/** The permission metadata the runner recovers per tool for a Pi gate (the identity-only
 *  envelope carries no policy). Keyed by resolved tool name. */
export interface PiToolSpecMeta {
  permission?: ToolPermission;
  readOnly?: boolean;
}

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
  onPause?: () => void;
  log?: (msg: string) => void;
  /** Called with the ACP tool-call id when a gate pauses the turn. */
  onPausedToolCall?: (id: string) => void;
  /** Called on pause to record the pending gate as an interaction (fire-and-forget). */
  onCreateInteraction?: (
    token: string,
    toolName: string | undefined,
    toolArgs: unknown,
    kind: "user_approval" | "client_tool",
  ) => void;
  /** Called after a stored decision was successfully forwarded to the harness. */
  onResolveInteraction?: (token: string) => void;
  /**
   * Fires for EVERY parkable permission gate (a Claude ACP gate or a Pi ACP gate) that
   * resolves to pendingApproval, BEFORE the single-pause latch. Keep-alive uses it to record
   * the parked permission id / tool-call id (for a live resume via `respondPermission`) and to
   * count how many gates are pending this turn (a multi-gate pause does not park). It never
   * fires for a client-tool gate (`pauseClientTool`), which stays on the cold path.
   */
  onUserApprovalGate?: (info: {
    permissionId: string;
    toolCallId: string;
    toolName: string | undefined;
    args: unknown;
    interactionToken: string;
    /** Which gate paused, so the park record can resume it on the right plane. */
    gateType: ParkedApprovalGateType;
  }) => void;
  /**
   * Resolved tool specs by name for the Pi gates. PRESENCE marks a Pi run and turns Pi gate
   * envelope detection on; it must stay absent for Claude. The pre-filter is the dialog TITLE,
   * and a Claude gate whose ACP title happens to be the literal dialog title (editing a file
   * named after it, a bash command equal to it) has no envelope and would be auto-rejected
   * where the base path pauses or resolves it normally. The map itself is how the runner
   * recovers `specPermission`/`readOnlyHint` (the envelope carries identity, never policy), so
   * detection and metadata recovery are inseparable by construction.
   */
  piToolSpecsByName?: ReadonlyMap<string, PiToolSpecMeta>;
}

/** Wire ACP permission reverse-RPC into the runner's event stream and responder policy. */
export function attachPermissionResponder({
  session,
  run,
  responder,
  latch,
  serverPermissions = new Map(),
  onPause,
  log,
  onPausedToolCall,
  onCreateInteraction,
  onResolveInteraction,
  onUserApprovalGate,
  piToolSpecsByName,
}: AttachPermissionResponderInput): void {
  session.onPermissionRequest((req: any) => {
    void handleRequest(req).catch((err) => {
      log?.(`[HITL] permission handling failed: ${errorMessage(err)}`);
      onPause?.();
    });
  });

  // The emitted payload carries a COPY of the ACP toolCall stamped with `resolvedName` (the
  // gate's stable anchor). The Vercel egress prefers it over the drift-prone title/kind
  // display fields, so the approval part names the tool exactly as the responder keys it.
  // This stamping never mutates the inbound ACP object. (The one deliberate inbound mutation
  // is the Pi gate's id/args normalization in `handlePiGate`, which must happen in
  // place so every downstream read sees the envelope's real identity.)
  const stampResolvedName = (toolCall: any, gate: GateDescriptor): any => {
    if (!toolCall || typeof toolCall !== "object" || !gate.toolName)
      return toolCall;
    return { ...toolCall, resolvedName: gate.toolName };
  };

  // A pause sends NO harness reply, ever. Replying `reject` would make Claude emit a failed
  // tool call ("User refused permission") whose `tool_result {isError}` overwrites the
  // approval prompt on the same tool-call id (the F-024 clobber). The turn instead ends via
  // `onPause` (session teardown resolves the RPC as cancelled, not rejected) and the next
  // turn's stored decision answers the re-raised gate.
  const pauseUserApproval = (
    req: any,
    id: string,
    gate: GateDescriptor,
    gateType: ParkedApprovalGateType,
  ): void => {
    // Signal the parkable gate BEFORE the latch so a keep-alive resume can record the pending
    // permission id and the multi-gate detector counts every pending gate (not just the first).
    const gateToolCallId = stringValue(req?.toolCall?.toolCallId);
    onUserApprovalGate?.({
      permissionId: id,
      toolCallId: gateToolCallId ?? "",
      toolName: gate.toolName,
      args: gate.args,
      interactionToken: interactionEventId(id, gateToolCallId),
      gateType,
    });
    if (!latch.tryAcquire()) return;
    const toolCallId = stringValue(req?.toolCall?.toolCallId);
    const eventId = interactionEventId(id, toolCallId);
    if (toolCallId) onPausedToolCall?.(toolCallId);
    run.emitEvent({
      type: "interaction_request",
      id: eventId,
      kind: "user_approval",
      payload: {
        toolCallId,
        toolCall: stampResolvedName(req?.toolCall, gate),
        availableReplies: stringArray(req?.availableReplies),
        options: req?.options,
      },
    });
    onCreateInteraction?.(eventId, gate.toolName, gate.args, "user_approval");
    onPause?.();
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
    if (toolCallId) onPausedToolCall?.(toolCallId);
    run.emitEvent({
      type: "interaction_request",
      id: eventId,
      kind: "client_tool",
      payload: {
        toolCallId,
        toolCall: stampResolvedName(req?.toolCall, gate),
        toolName: gate.toolName,
        input: gate.args,
        render: spec.render,
      },
    });
    onCreateInteraction?.(eventId, gate.toolName, gate.args, "client_tool");
    onPause?.();
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
      log?.(
        `[HITL] reply failed id=${id} decision=${decision}: ${errorMessage(err)}`,
      );
      onPause?.();
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
      log?.(
        `[HITL] reply failed id=${id} decision=${verdict.kind}: ${errorMessage(err)}`,
      );
      onPause?.();
    }
  };

  // A bare reject that answers the harness WITHOUT touching the durable interactions plane (no
  // row was created for a request the runner refuses before classifying it). Used for a
  // malformed Pi gate envelope and an unknown builtin name: fail closed so an unapproved tool
  // never runs. A request with no answerable id pauses instead (matching the base path), so the
  // in-sandbox confirm dies with the teardown rather than hanging until the turn timeout.
  const rejectRequest = async (
    id: string,
    availableReplies: string[],
  ): Promise<void> => {
    if (!id) {
      onPause?.();
      return;
    }
    try {
      await session.respondPermission(
        id,
        decisionToReply("deny", availableReplies) as any,
      );
    } catch (err) {
      log?.(`[HITL] reject failed id=${id}: ${errorMessage(err)}`);
      onPause?.();
    }
  };

  /**
   * A Pi gate that rode `ctx.ui.confirm`: classify from the envelope identity, not from the
   * spec-less dialog strings. The tool-call id is normalized to the envelope's REAL id BEFORE
   * anything reads `req.toolCall` (the descriptor, pause bookkeeping, the emitted card, and the
   * park record all key on it); the emitted card's `rawInput` is set to the real args so it
   * renders like a relay-gate card rather than showing the envelope JSON.
   */
  const handlePiGate = async (
    req: any,
    id: string,
    availableReplies: string[],
    envelope: PiGateEnvelope,
  ): Promise<void> => {
    const toolCall = req?.toolCall;
    if (toolCall && typeof toolCall === "object") {
      toolCall.toolCallId = envelope.toolCallId;
      toolCall.rawInput = envelope.input;
    }
    const gate = buildPiGateDescriptor(envelope, piToolSpecsByName);
    // An unrecognized tool name (builtin OR custom) fails closed. The envelope is
    // sandbox-origin and untrusted; letting the raw name through would resolve it against the
    // run's default permission and put a fabricated tool name on the human's approval card.
    if (!gate) {
      log?.(
        `[HITL] pi-gate unknown ${envelope.gate === "pi-builtin" ? "builtin" : "custom tool"} ` +
          `${JSON.stringify(envelope.toolName)} id=${id}; reject (fail closed)`,
      );
      await rejectRequest(id, availableReplies);
      return;
    }
    if (log) {
      log(
        `[HITL] pi-gate id=${id} ` +
          JSON.stringify({
            gate: envelope.gate,
            toolCallId: envelope.toolCallId,
            toolName: gate.toolName,
            executor: gate.executor,
            specPermission: gate.specPermission,
            readOnlyHint: gate.readOnlyHint,
          }),
      );
    }
    const verdict = await responder.onPermission({
      id,
      availableReplies,
      gate,
      raw: req,
    });
    if (verdict.kind === "pendingApproval" || !id) {
      pauseUserApproval(req, id, gate, "pi-acp-permission");
      return;
    }
    await replyPermission(id, verdict.kind, availableReplies);
  };

  async function handleRequest(req: any): Promise<void> {
    const id = stringValue(req?.id) ?? "";
    const availableReplies = stringArray(req?.availableReplies);

    // A Pi gate rides `ctx.ui.confirm` under the fixed dialog title. Detect it FIRST, before the
    // spec-less classification below: without this the gate would key as `agenta-approval` with
    // dialog-string args (wrong identity on cards, the decision map, and policy). Detection runs
    // ONLY on a Pi run (`piToolSpecsByName` present): the pre-filter is the TITLE, so a Claude
    // gate whose title collides with the dialog title must take the base path, not the
    // fail-closed reject. With detection on, a matching title whose envelope does not parse
    // fails closed (reject), never falls through — under a default-allow plan a fallthrough
    // would confirm an unapproved execution.
    if (piToolSpecsByName) {
      const piGate = parsePiGateEnvelope(req);
      if (piGate.matched) {
        if (!piGate.envelope) {
          log?.(
            `[HITL] pi-gate malformed envelope id=${id}; reject (fail closed)`,
          );
          await rejectRequest(id, availableReplies);
          return;
        }
        await handlePiGate(req, id, availableReplies, piGate.envelope);
        return;
      }
    }

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
            argKeys:
              args && typeof args === "object"
                ? Object.keys(args)
                : typeof args,
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
      pauseUserApproval(req, id, gate, "claude-acp-permission");
      return;
    }
    await replyPermission(id, verdict.kind, availableReplies);
  }
}

/**
 * Build the `GateDescriptor` for a Pi gate from the envelope identity plus the runner's own
 * resolved specs (the envelope carries identity, never policy).
 *
 * `pi-builtin` maps to `executor: "harness"` with the builtin's canonical rule name and
 * read-only hint from `piBuiltinIdentity`. `pi-custom-tool` maps to `executor: "relay"` with
 * the spec's author permission and read-only hint recovered by name, so an author-allow tool
 * stays instant-allow, an author-deny tool stays instant-deny, and a read-only builtin
 * auto-allows. An UNKNOWN name (a builtin outside the canonical set, or a custom tool with no
 * resolved spec) returns undefined so the caller rejects it: the sandbox-origin envelope must
 * not resolve a fabricated name against the default permission or put it on the approval card.
 */
export function buildPiGateDescriptor(
  envelope: PiGateEnvelope,
  piToolSpecsByName: ReadonlyMap<string, PiToolSpecMeta> | undefined,
): GateDescriptor | undefined {
  if (envelope.gate === "pi-builtin") {
    const identity = piBuiltinIdentity(envelope.toolName);
    if (!identity) return undefined;
    return {
      executor: "harness",
      toolName: identity.ruleName,
      readOnlyHint: identity.readOnly,
      args: envelope.input,
    };
  }
  // A custom-tool name with no matching resolved spec fails closed too: the envelope is
  // sandbox-origin, and without a spec there is no recovered policy — falling through would
  // resolve a fabricated or mismatched name against the run's default permission.
  if (!piToolSpecsByName?.has(envelope.toolName)) return undefined;
  const spec = piToolSpecsByName.get(envelope.toolName);
  return {
    executor: "relay",
    toolName: envelope.toolName,
    specPermission: toolPermission(spec?.permission),
    readOnlyHint:
      typeof spec?.readOnly === "boolean" ? spec.readOnly : undefined,
    args: envelope.input,
  };
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
  if (typeof toolCallId !== "string" || !toolCallId || !run.events)
    return undefined;
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
    serverPermission: spec
      ? undefined
      : serverPermissionFor(toolName, serverPermissions),
    readOnlyHint:
      typeof spec?.readOnly === "boolean" ? spec.readOnly : undefined,
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
  const spec =
    toolCall?.spec ??
    toolCall?.toolSpec ??
    toolCall?.resolvedTool ??
    toolCall?.tool;
  return spec && typeof spec === "object" ? (spec as ToolSpecLike) : undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function toolPermission(value: unknown): ToolPermission | undefined {
  return value === "allow" || value === "ask" || value === "deny"
    ? value
    : undefined;
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
