import type { LatestTurnIndexRead } from "../../src/lifecycle/session-coordinator.ts";

/**
 * A fake engine's answer to the warm-path turn-log read: no other runner wrote a turn since the
 * entry parked. Fake environments carry no `continuityTurnIndex`, so "no row" is the match.
 */
export async function turnLogUnmoved(): Promise<LatestTurnIndexRead> {
  return { ok: true, turnIndex: undefined };
}
