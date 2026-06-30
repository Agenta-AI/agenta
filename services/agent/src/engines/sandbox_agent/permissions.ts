import type { AgentEvent } from "../../protocol.ts";
import { decisionToReply, type ClientToolOutcome, type Responder } from "../../responder.ts";

export interface AttachPermissionResponderInput {
  session: any;
  run: { emitEvent: (event: AgentEvent) => void };
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
  onCreateInteraction,
  onResolveInteraction,
}: AttachPermissionResponderInput): void {
  session.onPermissionRequest((req: any) => {
    const id = String(req?.id ?? "");
    const availableReplies: string[] = req?.availableReplies ?? [];
    const toolCall = req?.toolCall;
    process.stderr.write(
      `[hitl-resume] LIVE gate id=${id} ` +
        `name=${JSON.stringify(toolCall?.name)} title=${JSON.stringify(toolCall?.title)} ` +
        `kind=${JSON.stringify(toolCall?.kind)} toolCallId=${JSON.stringify(toolCall?.toolCallId)} ` +
        `rawInput=${JSON.stringify(toolCall?.rawInput)} input=${JSON.stringify(toolCall?.input)}\n`,
    );
    // The harness raises a permission request before running ANY gated tool. We branch on the
    // tool's resolved spec: a `kind: "client"` tool is not really a sandbox permission gate — it
    // is a tool whose execution belongs to the browser (e.g. `request_connection`, which renders a
    // connect widget the user interacts with). So instead of approving/denying it in the sandbox,
    // we forward it to the frontend as a `client_tool` interaction_request and let the responder
    // decide: PARK it for a cross-turn round-trip (the browser fulfills the call, the next turn
    // resumes with its result) or reply inline. Every other tool falls through to the normal
    // permission gate below.
    const spec = clientToolSpecOf(toolCall);
    if (spec?.kind === "client") {
      const toolCallId =
        typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : undefined;
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

function clientToolSpecOf(toolCall: any): any | undefined {
  return toolCall?.spec ?? toolCall?.toolSpec ?? toolCall?.resolvedTool ?? toolCall?.tool;
}

function clientToolName(toolCall: any, spec: any): string | undefined {
  for (const candidate of [spec?.name, toolCall?.name, toolCall?.title, toolCall?.kind]) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return undefined;
}

function clientToolReply(decision: ClientToolOutcome, availableReplies: string[]): string {
  if (decision === "deny") {
    return availableReplies.find((r) => r === "reject") ?? "reject";
  }
  return availableReplies.find((r) => r === "once") ?? "once";
}
