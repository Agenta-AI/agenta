/**
 * Runner-side relay execution guard, built for EVERY harness.
 *
 * The relay dir is sandbox-writable, so any in-sandbox process can forge an `<id>.req.json`
 * execute record without ever passing an approval dialog. This guard is the runner-side
 * re-check the dialog cannot provide (plan Security section: "a forged file cannot run a
 * denied tool"). `allow` passes and `deny` refuses identically on every harness; `ask`
 * splits by harness:
 *
 *  - Pi: the ask dialog is the extension's `ctx.ui.confirm`, decided runner-side, and every
 *    approved call is recorded as an execution grant (`onPiGateAllowed` / the parked-approval
 *    resume). The guard consumes exactly one grant per record, so a forged or replayed record
 *    for an `ask` tool fails closed. Byte-identical to the pre-factoring inline guard.
 *  - Non-Pi MCP harnesses (Claude, and future MCP clients): the ask dialog is enforced by the
 *    harness itself — the rendered `mcp__agenta-tools__<tool>` ask rules plus the ACP
 *    permission flow gate a call BEFORE it reaches the shim — so the runner records no grant
 *    for a legitimately approved call, and requiring one would refuse every approved call.
 *    The guard therefore passes `ask` and enforces only the hard deny boundary against forged
 *    files. Residual, stated honestly: on this path a forged request file can still trigger
 *    an ask-tool WITHOUT a dialog; full ask-grant parity for MCP harnesses (reflecting the
 *    harness approval into the grant ledger) is a documented follow-up.
 *
 * The deny reason becomes the tool's result text (same shape as a dialog deny), so the model
 * loop continues instead of crashing.
 */
import { decide, type PermissionPlan } from "../../permission-plan.ts";
import {
  ConversationDecisions,
  type ApprovedExecutionGrants,
} from "../../responder.ts";
import {
  redactContextBoundArgs,
  type RelayExecutionGuard,
} from "../../tools/relay.ts";

export interface RelayExecutionGuardInput {
  /** True for a Pi run (grant-consuming `ask`); false for a non-Pi MCP harness (see above). */
  isPi: boolean;
  permissionPlan: PermissionPlan;
  /**
   * The turn's approval-equivalent allow ledger. Consulted ONLY on the Pi `ask` branch —
   * the non-Pi branch never consumes a grant (its dialog runs in the harness, which records
   * nothing here), so a Pi resume's pre-seeded grant stays untouched on Claude.
   */
  executionGrants: ApprovedExecutionGrants;
}

/**
 * Build the guard `startToolRelay` re-checks every execute record with. Factored out of
 * `runTurn` so the composed behavior (decide + an EMPTY stored-decision store + the grant
 * ledger + context-binding redaction) is testable without faking the whole engine.
 */
export function buildRelayExecutionGuard(
  input: RelayExecutionGuardInput,
): RelayExecutionGuard {
  const { isPi, permissionPlan, executionGrants } = input;
  // The guard's decide() must never consume the turn's stored decisions — the DIALOG is their
  // consumer (it runs first). An empty store makes every `ask` fall through to the split below.
  const relayGuardDecisions = new ConversationDecisions(new Map());
  return (spec, req) => {
    const verdict = decide(
      {
        executor: "relay",
        toolName: spec.name,
        specPermission: spec.permission,
        readOnlyHint: spec.readOnly,
        args: req.args,
      },
      permissionPlan,
      relayGuardDecisions,
    );
    if (verdict.kind === "allow") return { allow: true };
    if (verdict.kind === "deny") {
      return {
        allow: false,
        reason: `Tool '${spec.name}' is denied by the permission policy.`,
      };
    }
    // `ask`. Non-Pi: the harness's own dialog is the ask gate (see the module comment for the
    // rationale and the stated residual); pass without touching the grant ledger.
    if (!isPi) return { allow: true };
    // Pi: only a dialog-approved (or policy-allowed) call ever executes from the relay dir.
    return executionGrants.consume(
      spec.name,
      redactContextBoundArgs(
        req.args,
        spec.callRef ? spec.contextBindings : undefined,
      ),
    )
      ? { allow: true }
      : {
          allow: false,
          reason: `Tool '${spec.name}' was not approved via the permission dialog.`,
        };
  };
}
