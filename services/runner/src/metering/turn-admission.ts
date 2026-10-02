/**
 * The platform's admission of one turn that may run a sandbox on its own provider account, and
 * what the turn holds while it runs: a slot in its organization's count of running turns, the
 * plan's turn limit, and the billing window of its session's sandboxes.
 *
 * A refused turn never starts: the person reads the platform's own sentence and its stable class.
 * An admitted turn runs to its end, or to the plan's turn limit; its balance never stops it.
 */
import { runWithTurnLimit } from "../engines/sandbox_agent/run-limits.ts";
import type { AgentRunRequest, AgentRunResult, EmitEvent } from "../protocol.ts";
import { admitSandboxTurn, beginMeteredTurn, holdTurnSlot, meteringCredentialForRequest } from "./sandbox-usage.ts";

export async function runAdmittedTurn(
  request: AgentRunRequest,
  turnId: string,
  emit: EmitEvent | undefined,
  run: () => Promise<AgentRunResult>,
  deps: { admit?: typeof admitSandboxTurn; holdSlot?: typeof holdTurnSlot } = {},
): Promise<AgentRunResult> {
  const authorization = meteringCredentialForRequest(request);
  const admission = await (deps.admit ?? admitSandboxTurn)(authorization, turnId);
  if (!admission.admitted) {
    emit?.({ type: "error", message: admission.message, code: admission.code });
    return { ok: false, error: admission.message };
  }
  const slot = admission.slotHeld ? (deps.holdSlot ?? holdTurnSlot)(authorization, turnId) : undefined;
  const endMeteredTurn = beginMeteredTurn(request.sessionId?.trim());
  try {
    return await runWithTurnLimit(admission.turnLimit, run);
  } finally {
    endMeteredTurn();
    slot?.release();
  }
}
