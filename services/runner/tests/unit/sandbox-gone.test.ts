/**
 * A REMOTE sandbox does not refuse the socket when it dies.
 *
 * Daytona keeps the proxy host up after the sandbox is deleted and answers every request for it
 * with `404` + `x-daytona-error-code: SANDBOX_NOT_FOUND`. The liveness probe reads any HTTP answer
 * as alive on purpose, so that answer used to mean "still there": on 2026-09-04 a turn whose
 * sandbox was deleted under it kept heartbeating `running=true` for five minutes and only stopped
 * because the runner process was terminated.
 *
 * These tests hold the recognition rule. It has to be narrow in both directions: it must catch the
 * provider's verdict, and it must not read a healthy answer, an unrelated error, or a 200 body that
 * merely quotes the prose as a death.
 */

import { describe, it, expect, vi } from "vitest";

import {
  createSandboxGoneLatch,
  sandboxGoneReason,
} from "../../src/engines/sandbox_agent/sandbox-gone.ts";

/** The shape the probe and the ACP transport both hand to the predicate. */
function answer(status: number, headers: Record<string, string> = {}) {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    status,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
  };
}

/** The exact answer Daytona gave for the deleted sandbox on 2026-09-04. */
const DAYTONA_BODY =
  "not found: sandbox a476c238-dfdb-492c-bb4a-0ca15f42fddf not found, " +
  "it may have been deleted or stopped - inspect audit logs for more info";

describe("sandboxGoneReason", () => {
  it("reads the provider's own error code as a death", () => {
    const reason = sandboxGoneReason(
      answer(404, { "x-daytona-error-code": "SANDBOX_NOT_FOUND" }),
    );

    expect(reason).toBeTruthy();
    expect(reason).toContain("SANDBOX_NOT_FOUND");
  });

  it("reads the provider's prose as a death when no code header rides along", () => {
    expect(sandboxGoneReason(answer(404), DAYTONA_BODY)).toBeTruthy();
  });

  it("keeps a bare 404 alive: the health route may simply not exist", () => {
    expect(sandboxGoneReason(answer(404), "Not Found")).toBeUndefined();
  });

  it("keeps 401 alive: unauthorised proves something is listening", () => {
    expect(sandboxGoneReason(answer(401))).toBeUndefined();
  });

  it("keeps a 502 alive: a proxy blip is not a deleted sandbox", () => {
    expect(sandboxGoneReason(answer(502), "")).toBeUndefined();
  });

  it("ignores the prose in a SUCCESSFUL answer, which proves the sandbox answered", () => {
    expect(sandboxGoneReason(answer(200), DAYTONA_BODY)).toBeUndefined();
  });

  it("ignores an unrelated provider error code", () => {
    expect(
      sandboxGoneReason(answer(400, { "x-daytona-error-code": "BAD_REQUEST" })),
    ).toBeUndefined();
  });

  /*
   * A stopped or archived sandbox is a RESUMABLE state the provider itself handles, and the
   * reconnect ladder can legitimately meet either one while it brings a parked sandbox back.
   * Reading them as death would end a turn on a sandbox that is about to answer.
   */
  it("keeps a stopped sandbox alive: the provider can resume it", () => {
    expect(
      sandboxGoneReason(
        answer(404, { "x-daytona-error-code": "SANDBOX_STOPPED" }),
      ),
    ).toBeUndefined();
  });

  it("keeps an archived sandbox alive, for the same reason", () => {
    expect(
      sandboxGoneReason(
        answer(404, { "x-daytona-error-code": "SANDBOX_ARCHIVED" }),
      ),
    ).toBeUndefined();
  });
});

/** An armed latch, which is what every caller past acquire holds. */
function armedLatch() {
  const latch = createSandboxGoneLatch();
  latch.arm();
  return latch;
}

describe("sandbox gone latch", () => {
  it("delivers the first reason to a listener that subscribed earlier", () => {
    const latch = armedLatch();
    const listener = vi.fn();

    latch.subscribe(listener);
    latch.note("deleted");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("deleted");
    expect(latch.reason()).toBe("deleted");
  });

  it("delivers to a listener that subscribed after the death", () => {
    const latch = armedLatch();
    const listener = vi.fn();

    latch.note("deleted");
    latch.subscribe(listener);

    expect(listener).toHaveBeenCalledWith("deleted");
  });

  it("keeps one death for one sandbox, however many requests observe it", () => {
    const latch = armedLatch();
    const listener = vi.fn();
    latch.subscribe(listener);

    latch.note("first");
    latch.note("second");
    latch.note("third");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(latch.reason()).toBe("first");
  });

  it("reports nothing while the sandbox still answers", () => {
    expect(armedLatch().reason()).toBeUndefined();
  });

  it("drops a listener that unsubscribed, so a warm sandbox keeps no dead turns", () => {
    const latch = armedLatch();
    const finishedTurn = vi.fn();
    const currentTurn = vi.fn();

    const unsubscribe = latch.subscribe(finishedTurn);
    unsubscribe();
    latch.subscribe(currentTurn);
    latch.note("deleted");

    expect(finishedTurn).not.toHaveBeenCalled();
    expect(currentTurn).toHaveBeenCalledTimes(1);
  });

  it("survives a listener that throws, and still tells the others", () => {
    const latch = armedLatch();
    const other = vi.fn();
    latch.subscribe(() => {
      throw new Error("listener fault");
    });
    latch.subscribe(other);

    latch.note("deleted");

    expect(other).toHaveBeenCalledTimes(1);
    expect(latch.reason()).toBe("deleted");
  });
});

/*
 * The startup window. The same fetch carries the SDK's health wait during acquire, which polls a
 * sandbox that is still coming up and tolerates a provider error by design. On a warm resume the
 * proxy can lag its own control plane and answer "not found" for a sandbox it has not finished
 * re-exposing. The latch is one-way, so a report from that window must be discarded, or the first
 * turn on a healthy sandbox is killed.
 */
describe("sandbox gone latch before it is armed", () => {
  it("discards a gone report seen before acquire resolves", () => {
    const latch = createSandboxGoneLatch();
    const listener = vi.fn();
    latch.subscribe(listener);

    latch.note("provider reports the sandbox is gone (HTTP 404)");

    expect(listener).not.toHaveBeenCalled();
    expect(latch.reason()).toBeUndefined();
  });

  it("latches the SAME report once acquire has resolved", () => {
    const latch = createSandboxGoneLatch();
    const listener = vi.fn();
    latch.subscribe(listener);

    latch.note("provider reports the sandbox is gone (HTTP 404)");
    latch.arm();
    latch.note("provider reports the sandbox is gone (HTTP 404)");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(latch.reason()).toBe(
      "provider reports the sandbox is gone (HTTP 404)",
    );
  });

  it("does not remember a discarded report: arming alone declares nothing", () => {
    const latch = createSandboxGoneLatch();

    latch.note("seen during acquire");
    latch.arm();

    expect(latch.reason()).toBeUndefined();
  });
});
