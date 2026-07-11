/**
 * Map why an environment is torn down to whether its sandbox is stopped or deleted.
 * The destroy path escalates a failed stop to delete.
 */

export type TeardownReason =
  | "kill"
  | "failed-turn"
  | "aborted"
  | "compatibility-mismatch"
  | "clean-resumable"
  | "idle-expiry"
  | "capacity-eviction"
  | "shutdown-in-flight"
  | "shutdown-idle";

export type TeardownDisposition = "delete" | "stop";

// Clean resumable Daytona turns now stop (park) instead of delete, as does idle shutdown.
// Slice 5's E3 live verification gates this default in the merged feature.
export const PARK_CLEAN_RESUMABLE_TURNS = true;

export function teardownDisposition(
  reason: TeardownReason,
  parkCleanResumableTurns = PARK_CLEAN_RESUMABLE_TURNS,
): TeardownDisposition {
  if (
    parkCleanResumableTurns &&
    (reason === "clean-resumable" ||
      reason === "idle-expiry" ||
      reason === "capacity-eviction" ||
      reason === "shutdown-idle")
  ) {
    return "stop";
  }
  return "delete";
}
