import {
  effectivePermission,
  type GateDescriptor,
  type PermissionPlan,
} from "../../permission-plan.ts";
import {
  declinedByUserText,
  deniedByPolicyText,
} from "../../tools/denial-text.ts";
import type { ApprovedExecutionGrants, Responder } from "../../responder.ts";
import type {
  ExecutableToolGate,
  ExecutableToolGateRequest,
} from "../../tools/executable-tool-gate.ts";
import type { ToolCallCorrelationIndex } from "./client-tools.ts";
import {
  raiseApproval,
  type EmitRun,
  type PauseLike,
  type RecordPendingInteraction,
} from "./seam-approval.ts";

export interface BuildExecutableToolGateInput {
  responder: Responder;
  run: EmitRun;
  pause: PauseLike;
  recordPendingInteraction: RecordPendingInteraction;
  toolCallIndex?: ToolCallCorrelationIndex;
  /**
   * The run's permission plan, used ONLY to word a refusal.
   *
   * `decide` collapses two different facts into one `deny`: the policy refuses the tool, or the
   * human already declined this call and the answer is being replayed out of the conversation. A
   * deny under an `ask` permission can only be the second, because the decision store is the only
   * other thing `decide` consults. The model needs to know which, or it retries a decision.
   */
  permissionPlan?: PermissionPlan;
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
  permissionPlan,
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
        const byPolicy =
          !permissionPlan ||
          effectivePermission(gate, permissionPlan) === "deny";
        return {
          kind: "deny",
          reason: byPolicy
            ? deniedByPolicyText(request.toolName)
            : declinedByUserText(request.toolName),
        };
      }

      raiseApproval({
        run,
        pause,
        recordPendingInteraction,
        toolCallIndex,
        id: request.id,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        args: request.input,
      });
      return { kind: "pendingApproval" };
    },
    onPause: () => pause.pause(),
  };
}
