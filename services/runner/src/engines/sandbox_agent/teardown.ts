/**
 * Map why an environment is torn down to whether its sandbox is stopped or deleted.
 * The destroy path escalates a failed stop to delete.
 *
 * LIFECYCLE MIGRATION, STEP 1. The old single `compatibility-mismatch` reason could not say WHAT
 * was incompatible, so every incompatibility deleted the sandbox. That is right for some causes
 * and wasteful for others. The reason set now names the LAYER that failed, and only the layers
 * whose sandbox is still sound may park.
 *
 * One rule drives the split: a sandbox may park only when nothing inside its DAEMON is stale.
 *
 *  - `session-incompatible`  The harness SESSION is wrong. An example is a parked approval gate
 *                            the runner can no longer answer. The sandbox, the daemon, and the
 *                            installed credentials are all sound, so park it.
 *  - `continuity-invalid`    The CONVERSATION is wrong. An example is an edited transcript. This
 *                            says nothing about the environment, so park it.
 *  - `tool-timeout`          A per-tool-call deadline tripped mid-turn. The sandbox daemon is
 *                            healthy -- only the one tool call overran its clock. Installed
 *                            dependencies, credentials, and the filesystem are all intact.
 *                            Park it so the next turn inherits that disk state.
 *  - `runtime-incompatible`  Something baked into the DAEMON is stale. Examples are model or MCP
 *                            credentials, the process environment, and Pi's runtime assets. A
 *                            parked sandbox would resume with that stale material installed.
 *                            Delete it.
 *  - `sandbox-incompatible`  The sandbox itself is wrong. Examples are the provider, the image,
 *                            the snapshot, and the network policy. There is nothing worth
 *                            parking. Delete it.
 *
 * `compatibility-mismatch` stays in the union as a DEPRECATED alias that still deletes. It keeps
 * an unclassified call site safe, because delete is always sound and only costs a rebuild. Name
 * one of the four reasons above instead.
 */

export type TeardownReason =
  | "kill"
  | "failed-turn"
  | "aborted"
  /** @deprecated Name the failing layer instead. Kept so an unclassified call site fails safe. */
  | "compatibility-mismatch"
  | "session-incompatible"
  | "runtime-incompatible"
  | "sandbox-incompatible"
  | "continuity-invalid"
  | "tool-timeout"
  | "clean-resumable"
  | "idle-expiry"
  | "capacity-eviction"
  | "shutdown-in-flight"
  | "shutdown-idle";

export type TeardownDisposition = "delete" | "stop";

// Clean resumable Daytona turns now stop (park) instead of delete, as does idle shutdown.
// Slice 5's E3 live verification gates this default in the merged feature.
export const PARK_CLEAN_RESUMABLE_TURNS = true;

/**
 * The reasons that may park the sandbox. Every other reason deletes.
 *
 * This is an allowlist, and it must stay one. A new reason therefore deletes until somebody
 * proves its sandbox is safe to reuse. A denylist would make a new reason park by accident, and
 * that is the failure mode that leaves stale credentials inside a resumed daemon.
 */
const PARKABLE_REASONS: ReadonlySet<TeardownReason> = new Set<TeardownReason>([
  "clean-resumable",
  "idle-expiry",
  "capacity-eviction",
  "shutdown-idle",
  // The two incompatibilities whose daemon is still sound. See the module comment.
  "session-incompatible",
  "continuity-invalid",
  // A per-tool-call timeout: only one tool overran its clock; the daemon and the filesystem are
  // intact. Park so the next turn can reuse all installed dependencies. See module comment.
  "tool-timeout",
]);

export function teardownDisposition(
  reason: TeardownReason,
  parkCleanResumableTurns = PARK_CLEAN_RESUMABLE_TURNS,
): TeardownDisposition {
  if (parkCleanResumableTurns && PARKABLE_REASONS.has(reason)) {
    return "stop";
  }
  return "delete";
}
