/**
 * The turns this runner process is serving right now, so a shutdown can end each one with a
 * terminal record instead of leaving the client waiting on a turn nobody runs any more.
 *
 * Invariant: a `/stream` turn registers before its run starts and unregisters only after its
 * terminal records were flushed. `endActiveTurns` therefore returns once every turn it
 * interrupted has written its ending, or when its time budget runs out.
 */
interface ActiveTurn {
  end: (reason: string) => void;
  finished: Promise<void>;
}

const active = new Set<ActiveTurn>();
let endingReason: string | undefined;

export interface TurnRegistration {
  /** Resolves with a reason when the process is shutting down. */
  shuttingDown: Promise<string>;
  /** Call once the turn's terminal records are flushed. */
  done: () => void;
}

export function registerActiveTurn(): TurnRegistration {
  let end!: (reason: string) => void;
  let done!: () => void;
  const shuttingDown = new Promise<string>((resolve) => (end = resolve));
  const finished = new Promise<void>((resolve) => (done = resolve));
  const turn: ActiveTurn = { end, finished };
  active.add(turn);
  // A turn that starts while the process is already going away ends at once.
  if (endingReason) end(endingReason);
  return {
    shuttingDown,
    done: () => {
      active.delete(turn);
      done();
    },
  };
}

/** Interrupt every active turn and wait (bounded) for their terminal records. */
export async function endActiveTurns(reason: string, timeoutMs: number): Promise<number> {
  endingReason = reason;
  const turns = [...active];
  for (const turn of turns) turn.end(reason);
  if (turns.length === 0) return 0;
  await Promise.race([
    Promise.allSettled(turns.map((t) => t.finished)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
  ]);
  return turns.length;
}

export function activeTurnCount(): number {
  return active.size;
}

/** Test seam. */
export function resetActiveTurns(): void {
  active.clear();
  endingReason = undefined;
}
