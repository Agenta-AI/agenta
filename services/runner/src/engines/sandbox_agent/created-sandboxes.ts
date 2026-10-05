/**
 * Daytona sandbox ids this runner process CREATED.
 *
 * A pod reconnects only to a sandbox it created, and never deletes one it did not create. The
 * stored pointer (the latest turn's `sandbox_id`) is shared by every replica, so it can name a
 * sandbox that another pod created and may still be serving from its pool. Reconnecting to that
 * id would share the sandbox with that pod, whose pool timer later stops it under this pod's
 * turn; deleting it would kill the other pod's turn. This set is the only proof of ownership the
 * process has: the Secrets wrapper's registry covers only the opaque-Secrets path, and nothing on
 * Daytona names the creating pod.
 *
 * Per-process and in-memory on purpose. After a restart the set is empty, so every
 * conversation's next turn creates a fresh sandbox once, and the old one is left to Daytona's
 * autostop and autodelete.
 *
 * Ids are kept in their RAW form. The sandbox-agent handle, and therefore the stored pointer,
 * carries `"daytona/<rawId>"`; the provider's create returns `<rawId>`. Both are accepted.
 */
const createdSandboxIds = new Set<string>();

/**
 * Cap the set so a long-lived replica cannot grow it without bound. Losing the oldest id costs
 * one fresh create on that conversation's next cold turn, never a wrong reconnect.
 */
const CREATED_SANDBOX_ID_MAX = 10_000;

const DAYTONA_PREFIX = "daytona/";

function rawSandboxId(sandboxId: string): string {
  return sandboxId.startsWith(DAYTONA_PREFIX)
    ? sandboxId.slice(DAYTONA_PREFIX.length)
    : sandboxId;
}

/** Record that this process created `sandboxId`. */
export function markSandboxCreated(sandboxId: string | undefined): void {
  if (!sandboxId) return;
  const id = rawSandboxId(sandboxId);
  if (createdSandboxIds.has(id)) return;
  if (createdSandboxIds.size >= CREATED_SANDBOX_ID_MAX) {
    const oldest = createdSandboxIds.values().next().value;
    if (oldest !== undefined) createdSandboxIds.delete(oldest);
  }
  createdSandboxIds.add(id);
}

/** Whether this process created `sandboxId`, in either the raw or the prefixed form. */
export function wasSandboxCreatedHere(sandboxId: string): boolean {
  return createdSandboxIds.has(rawSandboxId(sandboxId));
}

/** Test seam: forget every recorded id, as a process restart does. */
export function resetCreatedSandboxIds(): void {
  createdSandboxIds.clear();
}
