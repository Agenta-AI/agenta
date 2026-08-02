import type { AgentEvent } from "../../protocol.ts";
import type { GateDescriptor } from "../../permission-plan.ts";
import type { ApprovedExecutionGrants, Responder } from "../../responder.ts";
import type {
  ExecutableToolGate,
  ExecutableToolGateRequest,
} from "../../tools/executable-tool-gate.ts";
import type { ToolCallCorrelationIndex } from "./client-tools.ts";

type EmitRun = { emitEvent: (event: AgentEvent) => void };

interface PauseLike {
  markPausedToolCall(toolCallId: string): void;
  pause(): void;
}

export interface BuildExecutableToolGateInput {
  responder: Responder;
  run: EmitRun;
  pause: PauseLike;
  recordPendingInteraction: (
    token: string,
    toolName: string | undefined,
    toolArgs: unknown,
    kind: "user_approval" | "client_tool",
    toolCallId?: string,
  ) => void;
  toolCallIndex?: ToolCallCorrelationIndex;
  /**
   * Per-turn ledger of approval-equivalent allows. A harness that runs its OWN permission gates
   * (Claude always; Codex since the full-access preset was patched to `on-request`) already
   * decided this call before issuing it, and records a grant. This seam consumes the grant so
   * one approval prompts the human once, not twice. No grant means no prior approval, so the
   * seam decides from scratch and an unapproved `ask` still parks — the check is fail closed.
   */
  executionGrants?: ApprovedExecutionGrants;
  log?: (message: string) => void;
}

export function buildExecutableToolGate({
  responder,
  run,
  pause,
  recordPendingInteraction,
  toolCallIndex,
  executionGrants,
  log = () => {},
}: BuildExecutableToolGateInput): ExecutableToolGate {
  return {
    onExecutableTool: async (request: ExecutableToolGateRequest) => {
      const gate: GateDescriptor = {
        executor: "relay",
        toolName: request.spec.name,
        specPermission: request.spec.permission,
        readOnlyHint: request.spec.readOnly,
        args: request.input,
      };
      const verdict = await responder.onPermission({
        id: request.id,
        availableReplies: ["once", "reject"],
        gate,
        raw: { spec: request.spec },
      });
      // Only a call the seam would otherwise park looks for a grant, so a policy allow or deny
      // still wins outright and grants are spent only where they change the outcome.
      const preApproved =
        verdict.kind === "pendingApproval" &&
        Boolean(executionGrants?.consume(request.spec.name, request.input));
      if (process.env.AGENTA_RUNNER_DEBUG_TOOLS) {
        log(
          `[executable-tool] ${request.toolName} id=${request.toolCallId} ` +
            `kind=${request.spec.kind} decision=${verdict.kind}` +
            (preApproved ? " grant=consumed" : ""),
        );
      }
      if (preApproved) return { kind: "allow" };
      if (verdict.kind === "allow") return { kind: "allow" };
      if (verdict.kind === "deny") {
        return {
          kind: "deny",
          reason: `Tool '${request.toolName}' was denied by policy.`,
        };
      }

      const correlatedId =
        toolCallIndex?.lookup(request.toolName, request.input) ??
        request.toolCallId;
      pause.markPausedToolCall(correlatedId);
      run.emitEvent({
        type: "interaction_request",
        id: request.id,
        kind: "user_approval",
        payload: {
          toolCallId: correlatedId,
          toolCall: {
            id: correlatedId,
            toolCallId: correlatedId,
            name: request.toolName,
            resolvedName: request.toolName,
            rawInput: request.input,
            input: request.input,
            kind: "execute",
          },
          availableReplies: ["once", "reject"],
        },
      });
      // The 5th argument keys the durable interaction row by the harness's tool-call id, so
      // server.ts can match an out-of-band approval reply by tool_call_id.
      recordPendingInteraction(
        request.id,
        request.toolName,
        request.input,
        "user_approval",
        correlatedId,
      );
      return { kind: "pendingApproval" };
    },
    onPause: () => pause.pause(),
  };
}
