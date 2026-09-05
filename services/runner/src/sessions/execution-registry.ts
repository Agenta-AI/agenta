/**
 * Which executions this runner process is running right now.
 *
 * WHY IT EXISTS. The abort controller for a session-owned run was a local variable inside the
 * request handler in `server.ts`. Nothing outside that closure could reach it, so the only way
 * to stop a turn was to take the session's Redis lock away and wait up to 30 seconds for the
 * heartbeat to notice. A control command has to reach the running turn directly, and that needs
 * a lookup keyed by something the API knows.
 *
 * THE KEY IS THE SESSION ID, AND THE PROJECT IS CHECKED SEPARATELY. Keying by
 * `<projectId>:<sessionId>` would be tidier, but the project scope is NOT known when a run
 * starts: `runContext.project.id` is empty on the live invoke path, and the scope actually used
 * for the pool key comes from the signed mount, which the coordinator resolves after the run is
 * already in flight (`session-coordinator.ts`, `poolKeyFor(request, signed?.projectId)`).
 * Registering under a key that does not exist yet is what made the first version of this
 * registry answer "I do not hold that session" for every Stop.
 *
 * So the entry goes in under the session id at once, and `noteExecutionProject` fills the
 * project in as soon as the coordinator knows it. A lookup matches only when the stored project
 * agrees, so a Stop from another tenant is REFUSED rather than misrouted. Until the project is
 * known the entry matches any project: that window is a few hundred milliseconds at the very
 * start of a run, and refusing every Stop in it would reintroduce the bug this comment
 * describes.
 *
 * The limit worth knowing: one entry per session id per process. Two projects running the same
 * session id on one runner at the same time keep only the later entry, and the earlier one's
 * Stop is then refused with a 404. Refusal is the safe direction, and the keep-alive pool has
 * the same shape of key.
 *
 * `startedAt` is the field that makes a late Stop safe. The API pins the target turn at
 * admission and compares its own clock, but the runner's comparison against its OWN memory is
 * exact: a command created before an execution started cannot have been meant for it.
 *
 * Entries are removed in the same `finally` that releases the alive watchdog, so a run that
 * threw still leaves the registry clean.
 */

export interface LiveExecution {
  /** Undefined until the coordinator resolves the run's project scope. */
  projectId: string | undefined;
  sessionId: string;
  /** The execution id, which is the runner's `turn_id`. */
  turnId: string;
  /** When this process started the run, in epoch milliseconds. */
  startedAt: number;
  /**
   * True once the harness prompt has settled, whatever it settled as.
   *
   * The entry stays registered through teardown, which writes the transcript, exports the
   * trace and decides whether to park, and that takes hundreds of milliseconds. A Stop that
   * arrives in that window has nothing left to abort, and aborting anyway is actively harmful:
   * the abort makes teardown read the run as cancelled-but-unsettled and DESTROY a healthy
   * environment that was about to be parked. So the applier reads this flag and does nothing.
   */
  settled?: boolean;
  /** Resolves after teardown and the final ownership release, not merely prompt settlement. */
  released?: Promise<boolean>;
  /** Stop the run. Aborting is what makes the turn end `cancelled`. */
  abort: () => void;
}

const executions = new Map<string, LiveExecution>();
const releases = new Map<
  string,
  { promise: Promise<boolean>; resolve: (safeToContinue: boolean) => void }
>();
const releaseKey = (sessionId: string, turnId: string) =>
  JSON.stringify([sessionId, turnId]);

/**
 * Register a run as live. A second registration for the same session REPLACES the first,
 * because the pool's own supersede path has already torn the previous environment down by the
 * time a replacement turn starts.
 */
export function registerExecution(execution: LiveExecution): void {
  const key = releaseKey(execution.sessionId, execution.turnId);
  let completion = releases.get(key);
  if (!completion) {
    let resolve!: (safeToContinue: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    completion = { promise, resolve };
    releases.set(key, completion);
  }
  execution.released = completion.promise;
  executions.set(execution.sessionId, execution);
}

/**
 * Fill in the project scope once the coordinator has resolved it. Scoped to the turn id, so a
 * late callback from a finished run cannot relabel its successor.
 */
export function noteExecutionProject(
  sessionId: string,
  turnId: string,
  projectId: string,
): void {
  const current = executions.get(sessionId);
  if (current && current.turnId === turnId) current.projectId = projectId;
}

/**
 * Mark a run's own work as finished, the moment the harness prompt settles and before teardown
 * begins. Scoped to the turn id for the same reason `noteExecutionProject` is: a late callback
 * from a finished run must not relabel its successor.
 *
 * Set from inside the turn, not from the request handler that awaits it, because the harmful
 * window is exactly the teardown that runs between those two points.
 */
export function noteExecutionSettled(sessionId: string, turnId: string): void {
  const current = executions.get(sessionId);
  if (current && current.turnId === turnId) current.settled = true;
}

/**
 * Remove a run, but only if it is still the one registered. A turn that finishes after its
 * successor registered must not unregister the successor.
 */
export function unregisterExecution(
  sessionId: string,
  turnId: string,
  safeToContinue = true,
): void {
  const key = releaseKey(sessionId, turnId);
  releases.get(key)?.resolve(safeToContinue);
  releases.delete(key);
  const current = executions.get(sessionId);
  if (current && current.turnId === turnId) executions.delete(sessionId);
}

/**
 * The live execution for a session, when it belongs to the asking project.
 *
 * A stored project that DISAGREES yields nothing, so a Stop from another tenant is refused.
 * A stored project that is not known yet matches, because the run has genuinely not been
 * scoped at that point and refusing would drop every Stop in the first moments of a run.
 */
export function findExecution(
  projectId: string,
  sessionId: string,
): LiveExecution | undefined {
  const current = executions.get(sessionId);
  if (!current) return undefined;
  if (current.projectId !== undefined && current.projectId !== projectId) {
    return undefined;
  }
  return current;
}

/** Test/inspection snapshot. */
export function liveExecutions(): LiveExecution[] {
  return [...executions.values()];
}

/** Test seam: drop everything. Never called by the server. */
export function resetExecutionsForTest(): void {
  for (const completion of releases.values()) completion.resolve(false);
  releases.clear();
  executions.clear();
}
