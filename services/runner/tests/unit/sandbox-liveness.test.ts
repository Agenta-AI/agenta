/**
 * A sandbox that dies under a running turn must end the turn, not hang it.
 *
 * The ACP prompt the turn is parked on can never settle once the sandbox process is gone: the
 * transport's read loop swallows the severed stream and never rejects the pending request. The
 * existing run limits do not save it either — `notePaused()` retires all of them the moment the
 * turn parks for a human, which is exactly when a long turn is most likely to outlive its
 * sandbox. So the runner probes the sandbox's own HTTP surface, independently of the wedged ACP
 * channel. These tests hold the probe's contract: it tolerates a blip, it declares death once,
 * and it never fires after the turn released it. Issue #6418.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  DEFAULT_PROBE_FAILURES,
  DEFAULT_PROBE_INTERVAL_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  PROBE_FAILURES_ENV,
  PROBE_INTERVAL_ENV,
  resolveSandboxLivenessLimits,
  startSandboxLivenessProbe,
  type Clock,
  type SandboxLivenessLimits,
} from "../../src/engines/sandbox_agent/sandbox-liveness.ts";
import { SANDBOX_GONE_MARKER } from "../../src/engines/sandbox_agent/errors.ts";

/** A clock whose timers only run when the test says so, in scheduled order. */
function fakeClock(): Clock & { tick(): Promise<void>; pending(): number } {
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let now = 0;

  const clock = {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id as unknown as NodeJS.Timeout;
    },
    clearTimeout(handle: NodeJS.Timeout) {
      timers.delete(handle as unknown as number);
    },
    pending: () => timers.size,
    /** Run the earliest pending timer, then drain the microtask queue. */
    async tick() {
      const entries = [...timers.entries()].sort((a, b) => a[1].at - b[1].at);
      const next = entries[0];
      if (!next) return;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
  return clock;
}

const limits: SandboxLivenessLimits = {
  intervalMs: 1_000,
  timeoutMs: 500,
  failureThreshold: 3,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sandbox liveness probe", () => {
  it("declares the sandbox gone after the threshold of consecutive failures", async () => {
    const onGone = vi.fn();
    const probe = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const clock = fakeClock();

    const handle = startSandboxLivenessProbe({ probe, limits, onGone, clock });

    // Each pass is one interval timer, then the probe's own timeout timer.
    for (let i = 0; i < 3; i++) {
      await clock.tick(); // interval fires, probe rejects
      await clock.tick(); // the (already settled) probe timeout is cleared/drained
    }

    expect(probe).toHaveBeenCalledTimes(3);
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(onGone.mock.calls[0][0]).toContain(SANDBOX_GONE_MARKER);
    handle.dispose();
  });

  it("tolerates a blip: one failure between successes is not a death", async () => {
    const onGone = vi.fn();
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ id: "session-1" });
    const clock = fakeClock();

    const handle = startSandboxLivenessProbe({ probe, limits, onGone, clock });

    for (let i = 0; i < 8; i++) await clock.tick();

    expect(onGone).not.toHaveBeenCalled();
    expect(handle.failures()).toBe(0);
    handle.dispose();
  });

  it("counts a probe that hangs as a failure, so a vanished host is not waited on forever", async () => {
    const onGone = vi.fn();
    // The exact #6418 shape: the request neither answers nor refuses.
    const probe = vi.fn().mockImplementation(() => new Promise(() => {}));
    const clock = fakeClock();

    const handle = startSandboxLivenessProbe({ probe, limits, onGone, clock });

    // interval -> probe hangs -> its timeout fires, three times over.
    for (let i = 0; i < 6; i++) await clock.tick();

    expect(onGone).toHaveBeenCalledTimes(1);
    expect(onGone.mock.calls[0][0]).toContain("probe timed out");
    handle.dispose();
  });

  it("fires at most once, and never after dispose", async () => {
    const onGone = vi.fn();
    const probe = vi.fn().mockRejectedValue(new Error("gone"));
    const clock = fakeClock();

    const handle = startSandboxLivenessProbe({ probe, limits, onGone, clock });
    handle.dispose();

    for (let i = 0; i < 10; i++) await clock.tick();

    expect(probe).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });
});

describe("sandbox liveness limits", () => {
  it("defaults to one probe per heartbeat interval and three strikes", () => {
    expect(resolveSandboxLivenessLimits()).toEqual({
      intervalMs: DEFAULT_PROBE_INTERVAL_MS,
      timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
      failureThreshold: DEFAULT_PROBE_FAILURES,
    });
  });

  it("takes an operator override", () => {
    vi.stubEnv(PROBE_INTERVAL_ENV, "5000");
    vi.stubEnv(PROBE_FAILURES_ENV, "2");

    const resolved = resolveSandboxLivenessLimits();

    expect(resolved.intervalMs).toBe(5_000);
    expect(resolved.failureThreshold).toBe(2);
  });
});
