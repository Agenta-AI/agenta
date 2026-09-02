/**
 * Which executions this runner process is running right now.
 *
 * WHY IT EXISTS. The abort controller for a session-owned run was a local variable inside the
 * request handler in `server.ts`. Nothing outside that closure could reach it, so the only way
 * to stop a turn was to take the session's Redis lock away and wait up to 30 seconds for the
 * heartbeat to notice. A control command has to reach the running turn directly, and that needs
 * a lookup keyed by something the API knows.
 *
 * THE KEY IS THE POOL KEY. `<projectId>:<sessionId>`, the same shape `poolKeyFor` builds, so a
 * command that names a project and a session finds the execution the same way the keep-alive
 * pool finds an environment. `session_id` alone is not enough: two projects may use the same
 * one, and the project segment is the tenant boundary.
 *
 * `startedAt` is the field that makes a late Stop safe. The API pins the target turn at
 * admission and compares its own clock, but the runner's comparison against its OWN memory is
 * exact: a command created before an execution started cannot have been meant for it.
 *
 * Entries are removed in the same `finally` that releases the alive watchdog, so a run that
 * threw still leaves the registry clean.
 */

export interface LiveExecution {
  projectId: string;
  sessionId: string;
  /** The execution id, which is the runner's `turn_id`. */
  turnId: string;
  /** When this process started the run, in epoch milliseconds. */
  startedAt: number;
  /** Stop the run. Aborting is what makes the turn end `cancelled`. */
  abort: () => void;
}

const executions = new Map<string, LiveExecution>();

export function executionKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

/**
 * Register a run as live. A second registration for the same key REPLACES the first, because
 * the pool's own supersede path has already torn the previous environment down by the time a
 * replacement turn starts.
 */
export function registerExecution(execution: LiveExecution): void {
  executions.set(
    executionKey(execution.projectId, execution.sessionId),
    execution,
  );
}

/**
 * Remove a run, but only if it is still the one registered. A turn that finishes after its
 * successor registered must not unregister the successor.
 */
export function unregisterExecution(
  projectId: string,
  sessionId: string,
  turnId: string,
): void {
  const key = executionKey(projectId, sessionId);
  const current = executions.get(key);
  if (current && current.turnId === turnId) executions.delete(key);
}

/** The live execution for a session, whatever its turn id. */
export function findExecution(
  projectId: string,
  sessionId: string,
): LiveExecution | undefined {
  return executions.get(executionKey(projectId, sessionId));
}

/** Test/inspection snapshot. */
export function liveExecutions(): LiveExecution[] {
  return [...executions.values()];
}

/** Test seam: drop everything. Never called by the server. */
export function resetExecutionsForTest(): void {
  executions.clear();
}
