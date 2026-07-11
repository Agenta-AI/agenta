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
  | "shutdown-in-flight"
  | "shutdown-idle";

export type TeardownDisposition = "delete" | "stop";

// Slice 2 flips this constant after the park-to-stopped path is enabled end to end.
export const PARK_CLEAN_RESUMABLE_TURNS = false;

export function teardownDisposition(
  reason: TeardownReason,
  parkCleanResumableTurns = PARK_CLEAN_RESUMABLE_TURNS,
): TeardownDisposition {
  if (
    parkCleanResumableTurns &&
    (reason === "clean-resumable" || reason === "shutdown-idle")
  ) {
    return "stop";
  }
  return "delete";
}
