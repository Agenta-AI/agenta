/** Per-session memory accounting and admission (decision 8, Codex R4 P0.7/P1.4). */
import { describe, expect, it } from "vitest";
import { classifyRunError } from "../../../src/engines/sandbox_agent/errors.ts";
import { RUNNER_AT_CAPACITY_MESSAGE, SessionLedger } from "../../../src/engines/inprocess/session-ledger.ts";

describe("session admission", () => {
  it("refuses a session past the maximum, with a sentence and a retryable code", () => {
    const ledger = new SessionLedger({ maxSessions: 2, heapPressureRatio: 0.9, heap: () => ({ used: 1, limit: 100 }) });
    ledger.admit("a");
    ledger.admit("b");
    const err = (() => {
      try {
        ledger.admit("c");
      } catch (e) {
        return e;
      }
    })();
    expect(classifyRunError(err, "pi")).toEqual({ message: RUNNER_AT_CAPACITY_MESSAGE, code: "runner_capacity" });
    ledger.close("a");
    expect(() => ledger.admit("c")).not.toThrow();
  });

  it("never lets sessions opening at the same time pass the cap together (Codex R5 P1-3)", async () => {
    const ledger = new SessionLedger({ maxSessions: 1, heapPressureRatio: 0.9, heap: () => ({ used: 1, limit: 100 }) });
    // Three opens, each awaiting its setup after admission, as the host does.
    const open = async (id: string) => {
      ledger.admit(id);
      await new Promise((resolve) => setTimeout(resolve, 20));
    };
    const results = await Promise.allSettled([open("a"), open("b"), open("c")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(ledger.snapshot().sessions).toBe(1);
  });

  it("refuses a session under heap pressure", () => {
    let used = 50;
    const ledger = new SessionLedger({ maxSessions: 100, heapPressureRatio: 0.8, heap: () => ({ used, limit: 100 }) });
    expect(() => ledger.admit("a")).not.toThrow();
    used = 81;
    expect(() => ledger.admit("b")).toThrow(RUNNER_AT_CAPACITY_MESSAGE);
  });
});

describe("memory accounting", () => {
  it("counts each session's transcript and the output buffers of its running commands", () => {
    const ledger = new SessionLedger({ maxSessions: 10, heapPressureRatio: 1, heap: () => ({ used: 0, limit: 1 }) });
    ledger.admit("s");
    ledger.setTranscriptBytes("s", 1200);
    const output = { bufferedBytes: 4096 };
    const release = ledger.trackOutput("s", output);
    expect(ledger.footprint("s")!.transcriptBytes).toBeGreaterThan(1000);
    expect(ledger.footprint("s")!.outputBytes).toBe(4096);
    release();
    expect(ledger.footprint("s")!.outputBytes).toBe(0);
    expect(ledger.snapshot().sessions).toBe(1);
  });
});
