/**
 * The platform's admission of one turn that may run a sandbox on its own provider account, and
 * what the turn holds while it runs: a slot in its organization's count of running turns, the
 * plan's turn limit, and the billing window of its session's sandboxes.
 *
 * A refused turn never starts: the person reads the platform's own sentence and its stable class.
 * An admitted turn runs to its end, or to the plan's turn limit; its balance never stops it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { runWithTurnLimit } from "../engines/sandbox_agent/run-limits.ts";
import type { AgentRunRequest, AgentRunResult, EmitEvent } from "../protocol.ts";
import {
  admitSandboxTurn,
  beginMeteredTurn,
  holdTurnSlot,
  meteredTurnKey,
  meteringCredentialForRequest,
} from "./sandbox-usage.ts";

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
  const turn: AdmittedTurn = { sessionId: request.sessionId?.trim() };
  const end = (): void => {
    if (openTurns.get(turnId) === end) openTurns.delete(turnId);
    turn.ended = true;
    turn.endWindow?.();
    slot?.release();
  };
  openTurns.set(turnId, end);
  try {
    return await admittedTurnStorage.run(turn, () => runWithTurnLimit(admission.turnLimit, run));
  } finally {
    end();
  }
}

interface AdmittedTurn {
  sessionId?: string;
  endWindow?: () => void;
  ended?: boolean;
}

const admittedTurnStorage = new AsyncLocalStorage<AdmittedTurn>();

/**
 * The session pool resolved this turn's project: open its billing window under the pool's own
 * key, so the warm sandbox it reuses or parks is billed only while this turn runs. Called once
 * per dispatch, before the sandbox is acquired.
 */
export function noteTurnScope(projectId: string): void {
  const turn = admittedTurnStorage.getStore();
  if (!turn || turn.ended || turn.endWindow) return;
  const key = meteredTurnKey(projectId, turn.sessionId);
  if (key) turn.endWindow = beginMeteredTurn(key);
}

/** Each admitted turn's ending, until it runs; both endings below are idempotent. */
const openTurns = new Map<string, () => void>();

/**
 * End an admitted turn whose run never settled: the runner closed it without its result
 * (`awaitTurnOrAbandon`). Its billing window closes and its slot goes back now; whatever the
 * abandoned run still does is not this turn's any more.
 */
export function endAbandonedTurn(turnId: string | undefined): void {
  if (turnId) openTurns.get(turnId)?.();
}
