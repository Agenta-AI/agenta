/**
 * Daytona sandboxes this runner process CREATED, and whether each is still live.
 *
 * A pod reconnects only to a sandbox it created, and never deletes one it did not create. The
 * stored pointer (the latest turn's `sandbox_id`) is shared by every replica, so it can name a
 * sandbox that another pod created and may still be serving from its pool. Reconnecting to that
 * id would share the sandbox with that pod, whose pool timer later stops it under this pod's
 * turn; deleting it would kill the other pod's turn. This map is the only proof of ownership the
 * process has: the Secrets wrapper's registry covers only the opaque-Secrets path, and nothing on
 * Daytona names the creating pod.
 *
 * A created sandbox is `live` until this process deletes it. The turns table is append-only, so
 * there is no pointer row to clear on delete, and the dead id stays readable until the next turn
 * appends its own row. A `deleted` id is never reconnected: the reconnect would fail and fall
 * through to a fresh create anyway, after a wasted provider round trip.
 *
 * Per-process and in-memory on purpose. After a restart the map is empty, so every
 * conversation's next turn creates a fresh sandbox once, and the old one is left to Daytona's
 * autostop and autodelete.
 *
 * Ids are kept in their RAW form. The sandbox-agent handle, and therefore the stored pointer,
 * carries `"daytona/<rawId>"`; the provider's create returns `<rawId>`. Both are accepted.
 */
export type CreatedSandboxState = "live" | "deleted";

const createdSandboxes = new Map<string, CreatedSandboxState>();

/**
 * Cap the map so a long-lived replica cannot grow it without bound. Losing the oldest id costs
 * one fresh create on that conversation's next cold turn, never a wrong reconnect.
 */
const CREATED_SANDBOX_ID_MAX = 10_000;

const DAYTONA_PREFIX = "daytona/";

/** The provider's own id for a sandbox, from either the raw or the handle's prefixed form. */
export function rawSandboxId(sandboxId: string): string {
  return sandboxId.startsWith(DAYTONA_PREFIX)
    ? sandboxId.slice(DAYTONA_PREFIX.length)
    : sandboxId;
}

/** Record that this process created `sandboxId`. */
export function markSandboxCreated(sandboxId: string | undefined): void {
  if (!sandboxId) return;
  const id = rawSandboxId(sandboxId);
  if (createdSandboxes.has(id)) return;
  if (createdSandboxes.size >= CREATED_SANDBOX_ID_MAX) {
    const oldest = createdSandboxes.keys().next().value;
    if (oldest !== undefined) createdSandboxes.delete(oldest);
  }
  createdSandboxes.set(id, "live");
}

/**
 * Record that this process is deleting `sandboxId`, so it never reconnects to it. Called before
 * the delete and kept when the delete throws: a delete that failed may still have removed the
 * sandbox. An id this process did not create is ignored, so this never grants a delete.
 */
export function markSandboxDeleted(sandboxId: string | undefined): void {
  if (!sandboxId) return;
  const id = rawSandboxId(sandboxId);
  if (createdSandboxes.has(id)) createdSandboxes.set(id, "deleted");
}

/** What this process knows of `sandboxId`; undefined when it did not create it. */
export function createdSandboxState(
  sandboxId: string,
): CreatedSandboxState | undefined {
  return createdSandboxes.get(rawSandboxId(sandboxId));
}

/** Whether this process created `sandboxId`, live or deleted, in either id form. */
export function wasSandboxCreatedHere(sandboxId: string): boolean {
  return createdSandboxes.has(rawSandboxId(sandboxId));
}

/** Test seam: forget every recorded id, as a process restart does. */
export function resetCreatedSandboxIds(): void {
  createdSandboxes.clear();
}
