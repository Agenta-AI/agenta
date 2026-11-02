/**
 * A shutdown ends every running turn with a terminal record: it interrupts the turn, which is
 * abandoned after a short grace, and the shutdown waits for it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { endActiveTurns, registerActiveTurn, resetActiveTurns, activeTurnCount } from "../../src/sessions/active-turns.ts";
import { awaitTurnOrAbandon } from "../../src/sessions/turn-settle.ts";

afterEach(() => resetActiveTurns());

describe("shutdown ends running turns", () => {
  it("abandons a hung run after its grace when the process is shutting down", async () => {
    const turn = registerActiveTurn();
    let aborted = false;
    const outcome = awaitTurnOrAbandon({
      run: new Promise(() => {}),
      abort: () => {
        aborted = true;
      },
      interrupted: turn.shuttingDown,
      limits: { hardDeadlineMs: 3_600_000, abandonGraceMs: 50 },
    });
    const ending = endActiveTurns("the runner is shutting down", 2_000);
    const result = await outcome;
    expect(result).toEqual({ settled: false, reason: "the runner is shutting down" });
    expect(aborted).toBe(true);
    turn.done();
    expect(await ending).toBe(1);
    expect(activeTurnCount()).toBe(0);
  });

  it("does not wait forever for a turn that never reports done", async () => {
    registerActiveTurn();
    const t0 = Date.now();
    await endActiveTurns("bye", 100);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("ends a turn that starts after the shutdown began", async () => {
    await endActiveTurns("bye", 10);
    const late = registerActiveTurn();
    await expect(late.shuttingDown).resolves.toBe("bye");
  });

  it("leaves a run that settles normally alone", async () => {
    const turn = registerActiveTurn();
    const result = await awaitTurnOrAbandon({
      run: Promise.resolve(42),
      abort: () => {},
      interrupted: turn.shuttingDown,
      limits: { hardDeadlineMs: 1_000, abandonGraceMs: 1_000 },
    });
    expect(result).toEqual({ settled: true, value: 42 });
  });
});
