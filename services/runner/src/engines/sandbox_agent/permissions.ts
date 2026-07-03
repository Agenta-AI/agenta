import type { AgentEvent } from "../../protocol.ts";
import {
  decisionToReply,
  specOf,
  type ClientToolOutcome,
  type Responder,
} from "../../responder.ts";

export interface AttachPermissionResponderInput {
  session: any;
  run: { emitEvent: (event: AgentEvent) => void; events?: () => AgentEvent[] };
  responder: Responder;
  /**
   * Called when the responder PARKS a gate (cross-turn HITL). The orchestration loop uses
   * this to END the turn gracefully: a parked Claude turn never resolves `session.prompt()`
   * on its own (the harness does not end the turn on an unanswered gate), so without this the
   * prompt blocks forever, the sandbox leaks, and the egress never emits a `finish` frame
   * (F-040). The runner cancels the in-flight prompt (via `destroySession`) so the turn ends
   * paused and the resume cold-replays. Fires at most once per turn (the first park wins).
   */
  onPark?: () => void;
  /** Diagnostic sink for the raw ACP permission ground truth (name/spec/args the harness sends). */
  log?: (msg: string) => void;
  /** Called on park to record the parked gate as an interaction (fire-and-forget). */
  onCreateInteraction?: (
    token: string,
    toolName: string | undefined,
    toolArgs: unknown,
  ) => void;
  /**
   * Called when the runner consumes a stored decision and forwards it to the harness — the
   * gate is resolved. Transitions the interaction (pending|responded -> resolved). Covers
   * both planes: a `/interactions` answer (responded -> resolved) and a messages answer
   * (pending -> resolved). Fire-and-forget.
   */
  onResolveInteraction?: (token: string) => void;
}

/**
 * Wire ACP permission reverse-RPC into the runner's event stream and responder policy.
 *
 * The default engine responder is headless today, but this boundary keeps future cross-turn
 * human approval from changing the sandbox-agent session plumbing.
 */
export function attachPermissionResponder({
  session,
  run,
  responder,
  onPark,
  log,
  onCreateInteraction,
  onResolveInteraction,
}: AttachPermissionResponderInput): void {
  session.onPermissionRequest((req: any) => {
    const id = String(req?.id ?? "");
    const availableReplies: string[] = req?.availableReplies ?? [];
    const toolCall = req?.toolCall;
    // NAME ANCHOR (the HITL resume-loop root cause): Claude-over-ACP names the SAME tool call
    // differently across frames — the `session/update` tool_call titles it by category ("Terminal"),
    // the permission request titles it by the specific invocation ("cat ~/.claude/settings.json ...").
    // Neither carries a stable `name`/`spec`. The transcript (and thus the stored approval key)
    // records the tool_call name, so the cross-turn key must ALSO use it — not the permission
    // frame's own drifting title. Recover the recorded tool_call name for THIS id (same id within a
    // turn) and stamp it as `resolvedName`, which `permissionToolName` (responder) and
    // `_approval_tool_name` (egress) both prefer, so the live re-raised key equals the stored key.
    if (toolCall && typeof toolCall === "object" && !toolCall.resolvedName) {
      const recorded = recordedToolName(run, toolCall.toolCallId);
      if (recorded) toolCall.resolvedName = recorded;
    }
    // GROUND TRUTH: exactly what the harness hands us for this gate — the resolved spec (and its
    // stable name) if any, the drift-prone display fields, and the arg shape. This is the earliest
    // and most authoritative HITL log; everything downstream keys off these fields.
    if (log) {
      const spec =
        toolCall?.spec ??
        toolCall?.toolSpec ??
        toolCall?.resolvedTool ??
        toolCall?.tool;
      const args = toolCall?.rawInput ?? toolCall?.input;
      log(
        `[HITL] ACP permission id=${id} ` +
          JSON.stringify({
            toolCallId: toolCall?.toolCallId,
            specName: spec && typeof spec === "object" ? spec.name : undefined,
            specKind: spec && typeof spec === "object" ? spec.kind : undefined,
            name: toolCall?.name,
            title: toolCall?.title,
            kind: toolCall?.kind,
            argKeys:
              args && typeof args === "object"
                ? Object.keys(args)
                : typeof args,
            availableReplies,
          }),
      );
    }
    // The harness raises a permission request before running ANY gated tool. We branch on the
    // tool's resolved spec: a `kind: "client"` tool is not really a sandbox permission gate — it
    // is a tool whose execution belongs to the browser (e.g. `request_connection`, which renders a
    // connect widget the user interacts with). So instead of approving/denying it in the sandbox,
    // we forward it to the frontend as a `client_tool` interaction_request and let the responder
    // decide: PARK it for a cross-turn round-trip (the browser fulfills the call, the next turn
    // resumes with its result) or reply inline. Every other tool falls through to the normal
    // permission gate below.
    const spec = specOf(toolCall) as any;
    if (spec?.kind === "client") {
      const toolCallId =
        typeof toolCall?.toolCallId === "string"
          ? toolCall.toolCallId
          : undefined;
      const toolName = clientToolName(toolCall, spec);
      const input = toolCall?.rawInput ?? toolCall?.input;
      run.emitEvent({
        type: "interaction_request",
        id,
        kind: "client_tool",
        payload: {
          toolCallId,
          toolCall,
          toolName,
          input,
          render: spec.render,
        },
      });
      void responder
        .onClientTool({ id, toolCallId, toolName, input, raw: req })
        .then((decision) => {
          if (decision === "park") {
            onPark?.();
            return;
          }
          if (!req?.id) return;
          return session.respondPermission(
            req.id,
            clientToolReply(decision, availableReplies) as any,
          );
        })
        .catch(() => {});
      return;
    }

    run.emitEvent({
      type: "interaction_request",
      id, // ACP permission id -> Vercel approvalId
      kind: "user_approval",
      payload: {
        // toolCallId of the gated tool, so the cross-turn approval reply correlates back to
        // its tool call (and the #6 resume finds it). `toolCall` is the ACP ToolCallUpdate.
        toolCallId: req?.toolCall?.toolCallId,
        toolCall: req?.toolCall,
        availableReplies,
        options: req?.options,
      },
    });
    void responder
      .onPermission({ id, availableReplies, raw: req })
      .then((decision) => {
        // PARK (cross-turn HITL): send NO reply. The `interaction_request` above is the last
        // word on this tool call; the next turn's stored decision resolves it. Replying
        // `reject` here would make Claude emit a failed tool call ("User refused permission")
        // that clobbers the approval prompt on the same tool-call id (F-024) — do NOT map park
        // onto a reply. Instead signal the orchestration loop to end the turn gracefully:
        // Claude never ends a turn on an unanswered gate, so the prompt would otherwise hang.
        if (decision === "park") {
          const toolName: string | undefined =
            req?.toolCall?.name ?? req?.toolCall?.title ?? req?.toolCall?.kind;
          const toolArgs: unknown =
            req?.toolCall?.rawInput ?? req?.toolCall?.input;
          onCreateInteraction?.(id, toolName, toolArgs);
          onPark?.();
          return;
        }
        if (!req?.id) return;
        // A stored decision is being forwarded to the harness: the gate is resolved.
        onResolveInteraction?.(id);
        return session.respondPermission(
          req.id,
          decisionToReply(decision, availableReplies) as any,
        );
      })
      .catch(() => {});
  });
}

/**
 * The name the runner already recorded for this tool-call id via the `session/update` `tool_call`
 * event — the SAME value the transcript folds into the stored approval key. Used to key the live
 * permission gate so it matches the stored decision across the cold-replay resume (the ACP
 * permission frame's own title drifts from the tool_call's, breaking the key otherwise).
 */
function recordedToolName(
  run: { events?: () => AgentEvent[] },
  toolCallId: unknown,
): string | undefined {
  if (typeof toolCallId !== "string" || !toolCallId || !run.events)
    return undefined;
  // Last match wins: a later tool_call for the same id (an arg-refresh) carries the same name.
  let name: string | undefined;
  for (const event of run.events()) {
    if (event.type === "tool_call" && event.id === toolCallId && event.name) {
      name = event.name;
    }
  }
  return name;
}

function clientToolName(toolCall: any, spec: any): string | undefined {
  for (const candidate of [
    spec?.name,
    toolCall?.name,
    toolCall?.title,
    toolCall?.kind,
  ]) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return undefined;
}

function clientToolReply(
  decision: ClientToolOutcome,
  availableReplies: string[],
): string {
  if (decision === "deny") {
    return availableReplies.find((r) => r === "reject") ?? "reject";
  }
  return availableReplies.find((r) => r === "once") ?? "once";
}
