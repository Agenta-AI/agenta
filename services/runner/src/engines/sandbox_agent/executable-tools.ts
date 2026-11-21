import {
  effectivePermission,
  type GateDescriptor,
  type PermissionPlan,
} from "../../permission-plan.ts";
import {
  declinedByUserText,
  deniedByPolicyText,
  targetNotAllowedText,
} from "../../tools/denial-text.ts";
import type { ApprovedExecutionGrants, Responder } from "../../responder.ts";
import type { AgentChangePreviewFetcher } from "../../tools/agent-change-preview.ts";
import { autoApprovedEvent } from "../../tools/gate-answer.ts";
import type { AttachPermissionResponderInput } from "./acp-interactions.ts";
import type {
  ExecutableToolGate,
  ExecutableToolGateRequest,
} from "../../tools/executable-tool-gate.ts";
import type { ToolCallCorrelationIndex } from "./client-tools.ts";
import {
  claimApprovalCall,
  emitApproval,
  type ParkRun,
  type PauseLike,
  type RecordPendingInteraction,
} from "./seam-approval.ts";

export interface BuildExecutableToolGateInput {
  responder: Responder;
  run: ParkRun;
  pause: PauseLike;
  recordPendingInteraction: RecordPendingInteraction;
  toolCallIndex?: ToolCallCorrelationIndex;
  /** Flag the turn non-parkable when a call the pause already closed is skipped (see `ParkRun`). */
  onNonParkablePause?: () => void;
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
  /** The server preview of an agent write; it never fails the gate (see the fetcher). */
  resolveChangePreview?: AgentChangePreviewFetcher;
  /** Resolves when the turn pauses; a pending preview fetch stops waiting then. */
  pauseSignal?: Promise<unknown>;
  /**
   * Resolves the call's `@ag.file` markers and mints their records, the step a card takes. A
   * server `allow` with no harness gate before takes it here, or the commit check refuses the
   * call with `authorization_missing`. A failure refuses the call.
   */
  resolveApprovedContent?: AttachPermissionResponderInput["onResolveApprovedContent"];
  log?: (message: string) => void;
}

export function buildExecutableToolGate({
  responder,
  run,
  pause,
  recordPendingInteraction,
  toolCallIndex,
  onNonParkablePause,
  permissionPlan,
  executionGrants,
  resolveChangePreview,
  pauseSignal,
  resolveApprovedContent,
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
      let preApproved = false;
      const verdict = await responder.onPermission({
        id: request.id,
        availableReplies: ["once", "reject"],
        gate,
        raw: { spec: request.spec },
        // Only a call the seam would otherwise park looks for a grant, so a policy allow or deny
        // still wins outright and grants are spent only where they change the outcome. A grant
        // also stands for a server allow at the harness gate, so the server is not asked twice.
        takeGrant: () => {
          preApproved = Boolean(
            executionGrants?.consume(request.spec.name, request.input),
          );
          return preApproved;
        },
      });
      if (process.env.AGENTA_RUNNER_DEBUG_TOOLS) {
        log(
          `[executable-tool] ${request.toolName} id=${request.toolCallId} ` +
            `kind=${request.spec.kind} decision=${verdict.kind}` +
            (preApproved ? " grant=consumed" : ""),
        );
      }
      if (verdict.kind === "allow") {
        if (!verdict.byGateAnswer) return { kind: "allow" };
        // The server allowed it here, with no harness gate before: take the step a card takes,
        // under the id the chat's card attaches to, and mark a call the person's approval
        // choice allowed, as the harness gate does.
        const toolCallId =
          toolCallIndex?.lookup(request.spec.name, request.input) ??
          request.toolCallId;
        if (resolveApprovedContent) {
          const outcome = await resolveApprovedContent({
            toolName: request.spec.name,
            toolCallId,
            args: request.input,
          });
          if (!outcome.ok) {
            log(
              `[executable-tool] approved-content resolution failed tool=${request.spec.name}: ` +
                `${outcome.reason}; deny (fail closed)`,
            );
            return { kind: "deny", reason: outcome.reason };
          }
        }
        if (verdict.autoApproved) {
          run.emitEvent(autoApprovedEvent(toolCallId, request.spec.name));
        }
        return { kind: "allow" };
      }
      if (verdict.kind === "deny") {
        // A server deny at the gate refuses one target (D34), not the tool and not a person's
        // answer, so the model may still pick another target.
        if (verdict.byGateAnswer) {
          return {
            kind: "deny",
            reason: targetNotAllowedText(request.toolName),
          };
        }
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

      // Claim the call (mark it paused) before the preview fetch, so a sibling call that pauses
      // the turn meanwhile does not close this one as not executed. The fetch then races the
      // pause: once the turn pauses, the card opens without the preview.
      const toolCallId = claimApprovalCall({
        run,
        pause,
        toolCallIndex,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        args: request.input,
      });
      if (toolCallId === undefined) {
        onNonParkablePause?.();
        return { kind: "pendingApproval" };
      }
      const pending = resolveChangePreview?.({
        toolName: request.spec.name,
        toolCallId: request.toolCallId,
        args: request.input,
      });
      const preview = pending
        ? await Promise.race([
            pending,
            ...(pauseSignal ? [pauseSignal.then(() => undefined)] : []),
          ])
        : undefined;
      emitApproval({
        run,
        recordPendingInteraction,
        id: request.id,
        toolCallId,
        toolName: request.toolName,
        args: request.input,
        ...(preview === undefined ? {} : { payloadExtras: { preview } }),
      });
      return { kind: "pendingApproval" };
    },
    onPause: () => pause.pause(),
  };
}
