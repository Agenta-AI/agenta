/**
 * The pause-capable half of the gateway gate.
 *
 * `tools/gateway-policy.ts` decides what the policy says. This module is what lets the relay
 * seam act on an `ask`: it reaches the turn's responder, emits the approval card, seeds the
 * durable interactions row, and ends the turn — the same machinery every other approval uses.
 *
 * Two things are deliberately NOT new here.
 *
 * The decision ladder is `responder.onPermission`, driven by a gate descriptor whose
 * `specPermission` is the COMPILED gateway permission. That buys the whole order for free:
 * the operator switch (read live inside `effectivePermission`), then the compiled value, then
 * a stored answer from the conversation — and it stays in step with every other tool family
 * when that ladder changes.
 *
 * The approval identity is `approvedCallKey`, unchanged, computed from the coarse tool name
 * plus the FULL outer arguments. Those arguments contain the integration and the tool key, so
 * two integration tools already produce two identities and one integration's approval cannot
 * satisfy another's. A gateway-specific keying scheme would put a second identity beside the
 * one warm-session resume depends on, for no gain.
 *
 * The genuinely new work is the card: a person must approve `github.CREATE_ISSUE` with its
 * arguments, not the word `run_tool`.
 */
import {
  effectivePermission,
  type GateDescriptor,
  type PermissionPlan,
} from "../../permission-plan.ts";
import type { Responder } from "../../responder.ts";
import { declinedByUserText } from "../../tools/denial-text.ts";
import {
  gatewayToolUnavailableText,
  type GatewayGateRequest,
  type GatewayToolGate,
} from "../../tools/gateway-policy.ts";
import type { ToolCallCorrelationIndex } from "./client-tools.ts";
import {
  raiseApproval,
  type EmitRun,
  type PauseLike,
  type RecordPendingInteraction,
} from "./seam-approval.ts";

export interface BuildGatewayToolGateInput {
  responder: Responder;
  run: EmitRun;
  pause: PauseLike;
  recordPendingInteraction: RecordPendingInteraction;
  /** Non-Pi harnesses: maps the relay call to the real ACP tool-call id the card attaches to. */
  toolCallIndex?: ToolCallCorrelationIndex;
  /**
   * The run's permission plan, used ONLY to word a refusal. `decide` collapses "the policy
   * refuses this tool" and "the human already declined this exact call" into one `deny`, and
   * the model must be told which: one is settled for the run, the other is about this change.
   */
  permissionPlan: PermissionPlan;
  /**
   * Flag the turn non-parkable. A gateway approval is raised at the relay seam, so it has no
   * ACP permission id for the live resume to answer; the cold path, where the stored decision
   * is replayed out of the conversation, is the one that works.
   */
  onNonParkablePause?: () => void;
  log?: (message: string) => void;
}

export function buildGatewayToolGate({
  responder,
  run,
  pause,
  recordPendingInteraction,
  toolCallIndex,
  permissionPlan,
  onNonParkablePause,
  log = () => {},
}: BuildGatewayToolGateInput): GatewayToolGate {
  return {
    onGatewayRun: async (request: GatewayGateRequest) => {
      const { plan } = request;
      const gate: GateDescriptor = {
        executor: "relay",
        toolName: request.toolName,
        // The compiled per-tool decision, which the ladder then treats exactly as it treats an
        // authored specification permission — including letting the operator switch beat it.
        specPermission: plan.permission,
        readOnlyHint: plan.readOnly ?? undefined,
        // Whole, so the identity keeps the integration and the tool key inside it.
        args: request.input,
      };
      const verdict = await responder.onPermission({
        id: request.id,
        availableReplies: ["once", "reject"],
        gate,
      });

      if (verdict.kind === "allow") {
        log(`[gateway] approval target=${plan.display} outcome=allow`);
        return { kind: "allow" };
      }
      if (verdict.kind === "deny") {
        // A deny under a compiled `ask` can only be a replayed human answer: the decision store
        // is the only other thing the ladder consults.
        const byPolicy = effectivePermission(gate, permissionPlan) === "deny";
        log(
          `[gateway] approval target=${plan.display} outcome=deny ` +
            `by=${byPolicy ? "policy" : "user"}`,
        );
        return {
          kind: "deny",
          // The policy refusal names no tool and lists none: an unconfigured integration, an
          // unknown key and a compiled deny all answer alike, so a model cannot map the policy
          // by probing. A human declining THIS change is a different fact, and it names it.
          reason: byPolicy
            ? gatewayToolUnavailableText()
            : declinedByUserText(plan.display),
        };
      }

      onNonParkablePause?.();
      // IDENTITY vs PRESENTATION. `raiseApproval` puts `toolName` and `args` into the fields the
      // Vercel egress reads, and the next turn folds those back into the stored approval key —
      // so they carry exactly what the gate keyed on, the coarse tool name and the FULL outer
      // arguments. The semantic display rides the `*Extras` fields, which no replay path reads.
      //
      // Getting that backwards is not a cosmetic slip. The persisted key would become
      // `github.CREATE_ISSUE` + the inner arguments while the gate keeps asking about `run_tool`
      // + the outer arguments, so the answer never resolves this call — it re-prompts every turn
      // — and it DOES match any other tool literally named `github.CREATE_ISSUE` taking those
      // arguments. One approval, spent on a different tool.
      //
      // Nothing is lost by displaying from the identity: the outer arguments carry `integration`
      // and `tool` inside them, so a card renders `github.CREATE_ISSUE` from its own input.
      raiseApproval({
        run,
        pause,
        recordPendingInteraction,
        toolCallIndex,
        id: request.id,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        args: request.input,
        payloadExtras: {
          display: plan.display,
          integration: plan.target.integration,
          tool: plan.target.tool,
          readOnly: plan.readOnly,
        },
        // Deliberately `displayName`, not `spec` / `toolSpec` / `resolvedTool` / `tool`: the
        // egress reads a nested object under any of those as a tool spec and would take its
        // `name` as the identity.
        toolCallExtras: { displayName: plan.display },
      });
      log(`[gateway] approval target=${plan.display} outcome=pending`);
      return { kind: "pendingApproval" };
    },
    onPause: () => pause.pause(),
  };
}
