/**
 * Commands this process has already acted on.
 *
 * WHY IT MUST OUTLIVE THE DELIVERY PATH. Delivery is at-least-once by design: a lost
 * acknowledgement, a retried admission, or a re-armed claim can all bring the same command back.
 * Applying a Stop a second time is not harmless — by then the session may be running a NEWER
 * turn, and a second abort would kill work the user never asked to stop.
 *
 * So the set lives at module scope, beside the session pool, not inside a request or a poll
 * loop. A loop restart with an empty set would be exactly the bug this prevents.
 *
 * An already-applied command is a NO-OP THAT STILL ACKNOWLEDGES. It aborts nothing and it
 * reports the stored outcome, so a lost acknowledgement is repaired without a second abort.
 *
 * The entry is written when the command is ACCEPTED, not when the cancel finishes. A duplicate
 * that arrives while the first is still cancelling must also be a no-op.
 */

export interface AppliedCommand {
  commandId: string;
  /** What this process reported, so a duplicate can repeat the same answer. */
  executionState: string;
  executionId: string | null;
  result: "applied" | "obsolete";
  appliedAt: number;
  /** Duplicate deliveries must respect the original execution's teardown boundary. */
  settled?: Promise<void>;
}

/**
 * How long an applied command is remembered. Long enough to cover every redelivery path (the
 * claim lease is 90 seconds and the sweep runs inside two minutes), short enough that the map
 * cannot grow without bound on a long-lived process.
 */
export const APPLIED_COMMAND_TTL_MS = 30 * 60 * 1000;

/** Hard cap, so a burst cannot grow the map faster than the TTL prunes it. */
const MAX_APPLIED_COMMANDS = 5000;

const applied = new Map<string, AppliedCommand>();

function prune(now: number): void {
  for (const [id, entry] of applied) {
    if (now - entry.appliedAt > APPLIED_COMMAND_TTL_MS) applied.delete(id);
  }
  while (applied.size > MAX_APPLIED_COMMANDS) {
    const oldest = applied.keys().next();
    if (oldest.done) break;
    applied.delete(oldest.value);
  }
}

/** What this process already did with `commandId`, if anything. */
export function recallCommand(
  commandId: string,
  now: number = Date.now(),
): AppliedCommand | undefined {
  const entry = applied.get(commandId);
  if (!entry) return undefined;
  if (now - entry.appliedAt > APPLIED_COMMAND_TTL_MS) {
    applied.delete(commandId);
    return undefined;
  }
  return entry;
}

/** Record what this process did with a command. Insertion order is the prune order. */
export function rememberCommand(
  entry: Omit<AppliedCommand, "appliedAt">,
  now: number = Date.now(),
): AppliedCommand {
  const stored: AppliedCommand = { ...entry, appliedAt: now };
  applied.delete(entry.commandId);
  applied.set(entry.commandId, stored);
  prune(now);
  return stored;
}

/** Revise the outcome of a command already accepted, once the cancel settles. */
export function updateCommandOutcome(
  commandId: string,
  patch: Pick<AppliedCommand, "executionState" | "result">,
): void {
  const entry = applied.get(commandId);
  if (!entry) return;
  entry.executionState = patch.executionState;
  entry.result = patch.result;
}

/** Test seam. */
export function resetAppliedCommandsForTest(): void {
  applied.clear();
}
