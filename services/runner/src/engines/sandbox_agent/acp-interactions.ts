import type {
  AgentEvent,
  ResolvedToolSpec,
  ToolPermission,
} from "../../protocol.ts";
import {
  decisionToReply,
  type ClientToolVerdict,
  type PermissionDecision,
  type Responder,
} from "../../responder.ts";
import {
  piBuiltinIdentity,
  type GateDescriptor,
} from "../../permission-plan.ts";
import {
  parsePiGateEnvelope,
  type PiGateEnvelope,
} from "./pi-gate-envelope.ts";
import { redactContextBoundArgs } from "../../tools/relay.ts";
import { bareToolName } from "./client-tools.ts";

/** The parkable gate types a paused turn can record (the Claude ACP and Pi ACP gates). */
export type ParkedApprovalGateType =
  "claude-acp-permission" | "pi-acp-permission";

/** The permission metadata the runner recovers per tool for a Pi gate (the identity-only
 *  envelope carries no policy). Keyed by resolved tool name. */
export interface PiToolSpecMeta {
  permission?: ToolPermission;
  readOnly?: boolean;
  /** Present only for callRef tools; drives approval-args redaction (bound paths are overwritten
   *  from runContext at execution, so the card and decision keys must not show the model's values). */
  contextBindings?: Record<string, string>;
}

export interface AttachPermissionResponderInput {
  session: any;
  run: {
    emitEvent: (event: AgentEvent) => void;
    events?: () => AgentEvent[];
    /** Flag the gated call as a deny so its closing failed result projects `tool-output-denied`. */
    markToolCallDenied?: (toolCallId: string | undefined) => void;
  };
  responder: Responder;
  serverPermissions?: ReadonlyMap<string, ToolPermission>;
  /**
   * Called when a gate pauses the turn. The orchestration loop uses this to end the turn
   * gracefully because a paused Claude turn never resolves `session.prompt()` on its own.
   */
  onPause?: () => void;
  log?: (msg: string) => void;
  /** Called with the ACP tool-call id when a gate pauses the turn. */
  onPausedToolCall?: (id: string) => void;
  /** Called before an allow reply can release the harness to execute this tool call. */
  onAllowedExecution?: (id: string) => void;
  /** Called before a deny reply so its failed terminal frame remains authoritative. */
  onAnsweredDeny?: (id: string) => void;
  /**
   * Called when a NON-parkable pause happens this turn (a client-tool ACP gate, which cannot be
   * answered across a turn boundary on the live session). The keep-alive dispatch reads this to
   * keep a turn that mixes an approval gate with a client-tool pause on the cold path, since only
   * the cold path can multiplex that mixed set. An approval gate does NOT fire it.
   */
  onNonParkablePause?: () => void;
  /** Called on pause to record the pending gate as an interaction (fire-and-forget). */
  onCreateInteraction?: (
    token: string,
    toolName: string | undefined,
    toolArgs: unknown,
    kind: "user_approval" | "client_tool",
  ) => void;
  /** Called after a stored decision was successfully forwarded to the harness. */
  onResolveInteraction?: (
    token: string,
    verdict?: { approved: boolean; toolCallId: string },
  ) => void;
  /**
   * Fires for EVERY parkable permission gate (a Claude ACP gate or a Pi ACP gate) that
   * resolves to pendingApproval. Keep-alive uses it to record every parked permission id /
   * tool-call id (for a live resume via `respondPermission`, keyed by tool-call id) and to count
   * how many gates are pending this turn. It never fires for a client-tool gate
   * (`pauseClientTool`), which fires `onNonParkablePause` instead and stays on the cold path.
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
  /** Fires when a Pi CUSTOM-TOOL gate resolves to allow (author/policy/stored-decision). The
   *  runner records an execution grant so the relay guard accepts exactly this approved call;
   *  builtins never reach the relay, so they do not fire it. */
  onPiGateAllowed?: (info: { toolName: string; args: unknown }) => void;
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
  /**
   * The run's REAL resolved tool specs, by bare spec name, for every harness (Claude and Pi
   * alike). This is the only source of a tool's true `permission`/`readOnly`: the ACP tool-call
   * object the harness hands back carries no spec field the runner ever populates (`spec`,
   * `toolSpec`, `resolvedTool`, `tool` were a vestigial probe — nothing sets them), so without
   * this map a harness gate's approval card silently fell back to the plan default instead of
   * showing the tool's actual permission.
   */
  toolSpecsByName?: ReadonlyMap<string, ResolvedToolSpec>;
}

/** Wire ACP permission reverse-RPC into the runner's event stream and responder policy. */
export function attachPermissionResponder({
  session,
  run,
  responder,
  serverPermissions = new Map(),
  onPause,
  log,
  onPausedToolCall,
  onAllowedExecution,
  onAnsweredDeny,
  onNonParkablePause,
  onCreateInteraction,
  onResolveInteraction,
  onUserApprovalGate,
  onPiGateAllowed,
  piToolSpecsByName,
  toolSpecsByName,
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
  // is the Pi gate's id/args normalization in `handlePiGate`, which must happen in place so
  // every downstream read sees the envelope's real identity — with `rawInput` set to the
  // gate's REDACTED args, never the model's values for context-bound paths.)
  const stampResolvedName = (toolCall: any, gate: GateDescriptor): any => {
    if (!toolCall || typeof toolCall !== "object" || !gate.toolName)
      return toolCall;
    return { ...toolCall, resolvedName: gate.toolName };
  };

  // Only a paused gate creates a durable row; resolving an auto-allowed gate's id would 404.
  const createdInteractionIds = new Set<string>();

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
    // Signal the parkable gate so a keep-alive resume can record the pending permission id and
    // count every pending gate. Each gate emits its own card: there is no per-turn cap, so N
    // gated calls in one turn all render and all park (the plural approval path).
    const toolCallId = stringValue(req?.toolCall?.toolCallId);
    onUserApprovalGate?.({
      permissionId: id,
      toolCallId: toolCallId ?? "",
      toolName: gate.toolName,
      args: gate.args,
      interactionToken: interactionEventId(id, toolCallId),
      gateType,
    });
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
    createdInteractionIds.add(eventId);
    onCreateInteraction?.(eventId, gate.toolName, gate.args, "user_approval");
    onPause?.();
  };

  const pauseClientTool = (
    req: any,
    id: string,
    gate: GateDescriptor,
    spec: ResolvedToolSpec,
  ): void => {
    // A client-tool ACP pause cannot be answered on the live session across a turn boundary, so
    // flag the turn non-parkable: a turn that mixes this with an approval gate stays cold.
    onNonParkablePause?.();
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
    createdInteractionIds.add(eventId);
    onCreateInteraction?.(eventId, gate.toolName, gate.args, "client_tool");
    onPause?.();
  };

  // A cold responder has no local creation set, so its stored decision carries the original token.
  const resolveAfterReply = (
    id: string,
    verdict?: { approved: boolean; toolCallId: string },
    interactionToken?: string,
  ): void => {
    const token = createdInteractionIds.delete(id) ? id : interactionToken;
    if (!token) return;
    onResolveInteraction?.(token, verdict);
  };

  const replyPermission = async (
    id: string,
    decision: PermissionDecision,
    availableReplies: string[],
    toolCallId?: string,
    interactionToken?: string,
  ): Promise<void> => {
    // A deny replies `reject`, which makes the harness close the call as a FAILED tool call. Flag
    // the id first so the closing result carries `denied` and the egress renders a decline, not a
    // breakage. (A malformed-envelope / unknown-builtin fail-closed reject goes through
    // `rejectRequest`, not here, so it stays a plain error — it is not a user/policy denial.)
    if (decision === "deny") {
      run.markToolCallDenied?.(toolCallId);
      if (toolCallId) onAnsweredDeny?.(toolCallId);
    }
    // Mark before replying because an allow can release the harness synchronously and its first
    // execution frame must already be protected from a concurrently active pause sweep.
    if (decision === "allow" && toolCallId) onAllowedExecution?.(toolCallId);
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
    resolveAfterReply(
      id,
      {
        approved: decision === "allow",
        toolCallId: toolCallId ?? id,
      },
      interactionToken,
    );
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
      return;
    }
    resolveAfterReply(id);
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
   * park record all key on it); the emitted card's `rawInput` is set to the gate's REDACTED
   * args (bound paths stripped for a contextBindings tool, verbatim otherwise) so it renders
   * like a relay-gate card without showing model values the execution will overwrite.
   */
  const handlePiGate = async (
    req: any,
    id: string,
    availableReplies: string[],
    envelope: PiGateEnvelope,
  ): Promise<void> => {
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
    const toolCall = req?.toolCall;
    if (toolCall && typeof toolCall === "object") {
      toolCall.toolCallId = envelope.toolCallId;
      toolCall.rawInput = gate.args;
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
    // The grant must exist BEFORE the harness reply: the extension writes the execute record
    // the moment the confirm resolves, and the relay guard consumes the grant to accept it.
    if (verdict.kind === "allow" && envelope.gate === "pi-custom-tool") {
      onPiGateAllowed?.({ toolName: gate.toolName!, args: gate.args });
    }
    await replyPermission(
      id,
      verdict.kind,
      availableReplies,
      envelope.toolCallId,
      verdict.interactionToken,
    );
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
    const { gate, spec } = buildGateDescriptor(
      toolCall,
      run,
      serverPermissions,
      toolSpecsByName,
    );
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
    await replyPermission(
      id,
      verdict.kind,
      availableReplies,
      stringValue(toolCall?.toolCallId),
      verdict.interactionToken,
    );
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
    // Context-bound paths are overwritten from runContext at execution; the approval card and
    // the stored-decision key must not carry the model's values for them.
    args: redactContextBoundArgs(envelope.input, spec?.contextBindings),
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

/**
 * Resolve the gate AND the real spec it was resolved against (needed by the client-tool pause,
 * which reads `spec.render`). The ACP tool-call carries no spec field the runner ever populates
 * — resolve the harness's own display name first (same anchor priority as before), then look up
 * the real spec by its bare name (a Claude MCP title arrives as `mcp__agenta-tools__<name>`;
 * strip that prefix so the lookup hits). This is the ONLY source of a tool's true
 * `permission`/`readOnly`, so both the approval card and this descriptor come from one lookup.
 */
export function buildGateDescriptor(
  toolCall: any,
  run: { events?: () => AgentEvent[] },
  serverPermissions: ReadonlyMap<string, ToolPermission>,
  toolSpecsByName: ReadonlyMap<string, ResolvedToolSpec> | undefined,
): { gate: GateDescriptor; spec: ResolvedToolSpec | undefined } {
  const displayName = firstString([
    recordedToolName(run, toolCall?.toolCallId),
    toolCall?.name,
    toolCall?.title,
    toolCall?.kind,
  ]);
  const spec = displayName
    ? toolSpecsByName?.get(bareToolName(displayName))
    : undefined;
  const toolName = spec?.name ?? displayName;
  const specPermission = toolPermission(spec?.permission);
  const args = toolCall?.rawInput ?? toolCall?.input;
  const gate: GateDescriptor = {
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
  return { gate, spec };
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
