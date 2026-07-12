/**
 * Unit tests for the hop 2 wake sources (src/tools/relay-watch.ts), pinning the plan's
 * activity-source invariants (event-driven-tool-relay plan, decisions 3, 4, 7):
 *
 * - The Daytona window loop: single-flight (at most ONE concurrent runProcess, ever),
 *   sticky coalescing, close-abandons-the-window with no unhandled rejection, demotion
 *   after exactly 3 consecutive failures with backoff-gated rearm, wake/failure
 *   classification per completion shape (rejected / nullish result / timedOut /
 *   nonzero-null-or-missing exit / exit 0), the runner-side outer bound abandoning a
 *   never-settling exec, the deferred arm inside a wait that starts during a backoff
 *   gap, and the mid-wait re-arm after a failure lands while a waiter is parked.
 * - Window config parsing and clamping, and the downward-only (−20%..0%) jitter bounds.
 * - The script args builder: the relay dir rides argv only, never the script text.
 * - The watch script AS A REAL PROCESS (execFile, argv, no shell) against temp dirs.
 * - The local fs.watch adapter.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/relay-watch.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RELAY_REMOTE_WATCH_WINDOW_DEFAULT_MS,
  RELAY_REMOTE_WATCH_WINDOW_MAX_MS,
  RELAY_REMOTE_WATCH_WINDOW_MIN_MS,
  RELAY_SAFETY_POLL_MS,
  RELAY_WATCH_SCRIPT,
  applyRelayWatchJitter,
  buildRelayWatchScriptArgs,
  daytonaRelayActivitySource,
  localRelayActivitySource,
  remoteWatchEnabled,
  resolveRemoteWatchWindowMs,
} from "../../src/tools/relay-watch.ts";

const WINDOW_ENV = "AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS";
const ENABLED_ENV = "AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_ENABLED";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
/** Let the source's runProcess .then/.catch handlers run after a fake settles. */
const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

interface FakeExec {
  request: { command: string; args: string[]; timeoutMs: number };
  resolve: (result: { exitCode?: number | null; timedOut?: boolean }) => void;
  reject: (err: unknown) => void;
}

/** Controllable runProcess fake that counts concurrency (pins single-flight). */
function fakeSandbox(): {
  sandbox: {
    runProcess: (request: {
      command: string;
      args: string[];
      timeoutMs: number;
    }) => Promise<{ exitCode?: number | null; timedOut?: boolean }>;
  };
  calls: FakeExec[];
  maxConcurrent: () => number;
} {
  const calls: FakeExec[] = [];
  let concurrent = 0;
  let max = 0;
  return {
    sandbox: {
      runProcess: (request) => {
        concurrent += 1;
        max = Math.max(max, concurrent);
        return new Promise((resolve, reject) => {
          calls.push({
            request,
            resolve: (result) => {
              concurrent -= 1;
              resolve(result);
            },
            reject: (err) => {
              concurrent -= 1;
              reject(err);
            },
          });
        });
      },
    },
    calls,
    maxConcurrent: () => max,
  };
}

afterEach(() => {
  delete process.env[WINDOW_ENV];
  delete process.env[ENABLED_ENV];
});

describe("daytonaRelayActivitySource invariants", () => {
  it("coalesces: a window completing with no waiter resolves the NEXT wait immediately; the one after times out", async () => {
    const { sandbox, calls } = fakeSandbox();
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
    });

    // Arm a window via a wait that times out before the window completes.
    const w1 = await source.wait({ timeoutMs: 20 });
    assert.equal(w1, "timeout");
    assert.equal(calls.length, 1);

    // The window completes while NO waiter is present: sticky bit.
    calls[0].resolve({ exitCode: 0, timedOut: false });
    await tick();

    const w2 = await source.wait({ timeoutMs: 20 });
    assert.equal(w2, "activity", "sticky wake consumed");
    assert.equal(calls.length, 1, "sticky consumption did not arm a window");

    const w3 = await source.wait({ timeoutMs: 20 });
    assert.equal(w3, "timeout", "the sticky bit was consumed exactly once");
    assert.equal(calls.length, 2, "the next wait armed a fresh window");

    source.close();
    calls[1].resolve({ exitCode: 0 });
    await tick();
  });

  it("single-flight: at most ONE concurrent runProcess ever, across many waits and completions", async () => {
    const { sandbox, calls, maxConcurrent } = fakeSandbox();
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
    });

    for (let i = 0; i < 25; i += 1) {
      const wait = source.wait({ timeoutMs: 5_000 });
      assert.equal(calls.length, i + 1, "each idle wait arms exactly one");
      calls[i].resolve({ exitCode: 0, timedOut: false });
      assert.equal(await wait, "activity");
      await tick();
    }
    // Waits while a window is already in flight never arm a second exec.
    const held = source.wait({ timeoutMs: 10 });
    assert.equal(calls.length, 26);
    assert.equal(await held, "timeout");
    const heldAgain = source.wait({ timeoutMs: 10 });
    assert.equal(calls.length, 26, "in-flight window: no second exec");
    assert.equal(await heldAgain, "timeout");

    assert.equal(maxConcurrent(), 1);
    source.close();
    calls[25].resolve({ exitCode: 0 });
    await tick();
  });

  it("close() during a held window resolves 'closed'; the abandoned exec rejection stays handled", async () => {
    const { sandbox, calls } = fakeSandbox();
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
    });

    const held = source.wait({ timeoutMs: 60_000 });
    assert.equal(calls.length, 1);
    source.close();
    assert.equal(await held, "closed");
    assert.equal(source.isHealthy(), false, "closed is not healthy");
    assert.equal(await source.wait({ timeoutMs: 10 }), "closed");

    // Abandon: the in-flight exec cannot be aborted (no per-call signal in the SDK);
    // its late rejection must never become an unhandled rejection.
    const unhandled: unknown[] = [];
    const trap = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", trap);
    try {
      calls[0].reject(new Error("daemon went away"));
      await sleep(20);
    } finally {
      process.off("unhandledRejection", trap);
    }
    assert.equal(unhandled.length, 0);
  });

  it("repeated rejection demotes after exactly 3, with ONE demotion log line; a rejecting exec never rejects wait()", async () => {
    const { sandbox, calls } = fakeSandbox();
    const logs: string[] = [];
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      backoffBaseMs: 1,
      backoffCapMs: 2,
      log: (msg) => logs.push(msg),
    });

    for (let failure = 1; failure <= 3; failure += 1) {
      const wait = source.wait({ timeoutMs: 30 });
      assert.equal(calls.length, failure, "rearm after backoff");
      calls[failure - 1].reject(new Error("no exec for you"));
      // A rejection is NOT a wake: the waiter's own timer resolves "timeout".
      assert.equal(await wait, "timeout");
      assert.equal(source.isHealthy(), failure < 3);
      await sleep(10); // past the tiny injected backoff
    }

    assert.equal(source.isHealthy(), false, "demoted after exactly 3");
    const demotions = logs.filter((line) => line.includes("demoted"));
    assert.equal(demotions.length, 1, "exactly one demotion log line");

    // Demoted: waits never arm again.
    assert.equal(await source.wait({ timeoutMs: 10 }), "timeout");
    assert.equal(calls.length, 3);
    source.close();
  });

  it("backoff gates rearm: a wait inside the backoff window does not arm", async () => {
    const { sandbox, calls } = fakeSandbox();
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      backoffBaseMs: 200,
      backoffCapMs: 400,
    });

    const w1 = source.wait({ timeoutMs: 20 });
    calls[0].reject(new Error("boom"));
    assert.equal(await w1, "timeout");

    // Still inside the ~200 ms (jittered >= 160 ms) backoff: no new exec.
    assert.equal(await source.wait({ timeoutMs: 20 }), "timeout");
    assert.equal(calls.length, 1, "no rearm inside the backoff window");

    await sleep(300);
    const w3 = source.wait({ timeoutMs: 1_000 });
    assert.equal(calls.length, 2, "rearm after the backoff elapsed");
    calls[1].resolve({ exitCode: 0 });
    assert.equal(await w3, "activity");
    source.close();
  });

  it("a nonzero exit is a wake AND a failure: three in a row wake the waiter each time, then demote", async () => {
    const { sandbox, calls } = fakeSandbox();
    const logs: string[] = [];
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      backoffBaseMs: 1,
      backoffCapMs: 2,
      log: (msg) => logs.push(msg),
    });

    for (let i = 0; i < 3; i += 1) {
      const wait = source.wait({ timeoutMs: 5_000 });
      calls[i].resolve({ exitCode: 1, timedOut: false });
      assert.equal(await wait, "activity", "abnormal exit still wakes");
      await sleep(10); // past the tiny injected backoff (every failure backs off now)
    }
    assert.equal(source.isHealthy(), false, "three abnormal exits demote");
    // The demotion line repeats the reason, so count only per-failure lines.
    assert.equal(
      logs.filter((l) => l.includes("watch failure: watch script exited with"))
        .length,
      3,
    );
    assert.equal(logs.filter((l) => l.includes("demoted")).length, 1);
    source.close();
  });

  it("a null exit (signal-killed / OOM) is a wake AND a failure, never a success reset", async () => {
    const { sandbox, calls } = fakeSandbox();
    const logs: string[] = [];
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      backoffBaseMs: 1,
      backoffCapMs: 2,
      log: (msg) => logs.push(msg),
    });

    for (let i = 0; i < 3; i += 1) {
      const wait = source.wait({ timeoutMs: 5_000 });
      calls[i].resolve({ exitCode: null, timedOut: false });
      assert.equal(await wait, "activity", "a killed script still wakes");
      await sleep(10);
    }
    assert.equal(source.isHealthy(), false, "three null exits demote");
    assert.equal(
      logs.filter((l) =>
        l.includes("watch failure: watch script exited with code null"),
      ).length,
      3,
    );
    source.close();
  });

  it("a nullish runProcess RESULT is a failure with NO wake, never a success reset; three demote", async () => {
    // A broken daemon path can insta-resolve runProcess with undefined. If that read
    // as success, the counter would pin at 0 and the source would storm windows
    // forever; it must count as a failure and feed demotion instead.
    const { sandbox, calls } = fakeSandbox();
    const logs: string[] = [];
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      backoffBaseMs: 1,
      backoffCapMs: 2,
      log: (msg) => logs.push(msg),
    });

    for (let i = 0; i < 3; i += 1) {
      const wait = source.wait({ timeoutMs: 30 });
      calls[i].resolve(undefined as unknown as { exitCode?: number | null });
      assert.equal(await wait, "timeout", "a nullish result never wakes");
      await sleep(10);
    }
    assert.equal(source.isHealthy(), false, "three nullish results demote");
    assert.equal(
      logs.filter((l) =>
        l.includes("watch failure: exec resolved with no result"),
      ).length,
      3,
    );
    assert.equal(logs.filter((l) => l.includes("demoted")).length, 1);
    source.close();
  });

  it("timedOut:true is a failure with NO wake; a later success resets the counter", async () => {
    const { sandbox, calls } = fakeSandbox();
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      backoffBaseMs: 1,
      backoffCapMs: 2,
    });

    // Two daemon timeouts: failures, no sticky wake left behind.
    for (let i = 0; i < 2; i += 1) {
      const wait = source.wait({ timeoutMs: 30 });
      calls[i].resolve({ exitCode: null, timedOut: true });
      assert.equal(await wait, "timeout", "a daemon timeout never wakes");
      await sleep(10);
    }
    assert.equal(source.isHealthy(), true, "two failures < threshold");

    // A success resets the counter...
    const w3 = source.wait({ timeoutMs: 5_000 });
    calls[2].resolve({ exitCode: 0, timedOut: false });
    assert.equal(await w3, "activity");
    await tick();

    // ...so two MORE failures still do not demote.
    for (let i = 3; i < 5; i += 1) {
      const wait = source.wait({ timeoutMs: 30 });
      calls[i].resolve({ timedOut: true });
      assert.equal(await wait, "timeout");
      await sleep(10);
    }
    assert.equal(source.isHealthy(), true, "the success reset the counter");
    source.close();
  });

  it("noteMiss() feeds the same demotion counter", () => {
    const { sandbox } = fakeSandbox();
    const logs: string[] = [];
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      log: (msg) => logs.push(msg),
    });

    source.noteMiss?.();
    source.noteMiss?.();
    assert.equal(source.isHealthy(), true);
    source.noteMiss?.();
    assert.equal(source.isHealthy(), false);
    assert.equal(logs.filter((l) => l.includes("demoted")).length, 1);
    // Idempotent after demotion: no second demotion line.
    source.noteMiss?.();
    assert.equal(logs.filter((l) => l.includes("demoted")).length, 1);
    source.close();
  });

  it("a zero exit from the same missed generation does not reset the demotion counter", async () => {
    const { sandbox, calls } = fakeSandbox();
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      backoffBaseMs: 1,
      backoffCapMs: 2,
    });

    for (let generation = 0; generation < 3; generation += 1) {
      const wait = source.wait({ timeoutMs: 5_000 });
      assert.equal(calls.length, generation + 1);
      source.noteMiss?.();
      calls[generation].resolve({ exitCode: 0, timedOut: false });
      assert.equal(await wait, "activity");
      await sleep(10);
    }

    assert.equal(
      source.isHealthy(),
      false,
      "three missed generations demote even though each later exits zero",
    );
    source.close();
  });

  it("outer bound: a never-settling exec counts as a failure, re-arms inside the SAME wait, demotes after three, and late settles change nothing", async () => {
    const settlers: Array<{
      resolve: (r: { exitCode?: number | null; timedOut?: boolean }) => void;
      reject: (err: unknown) => void;
    }> = [];
    const sandbox = {
      runProcess: (): Promise<{
        exitCode?: number | null;
        timedOut?: boolean;
      }> =>
        new Promise((resolve, reject) => settlers.push({ resolve, reject })),
    };
    const logs: string[] = [];
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 40,
      graceMs: 20,
      outerBoundMarginMs: 20,
      backoffBaseMs: 1,
      backoffCapMs: 2,
      log: (msg) => logs.push(msg),
    });

    // ONE long wait: each outer bound (jittered window + grace + margin, ~72-80 ms
    // here) abandons the never-settling exec, counts a failure with NO wake, and the
    // mid-wait re-arm (fix 4) arms the next window after the tiny backoff — all
    // inside this same parked wait, with no safety-poll help. Three abandoned
    // windows demote the source; demotion stops the chain at exactly three.
    const wait = source.wait({ timeoutMs: 600 });
    assert.equal(settlers.length, 1, "wait entry armed the first window");
    assert.equal(await wait, "timeout", "outer-bound expiry never wakes");
    assert.equal(settlers.length, 3, "three windows chained, then demotion");
    assert.equal(source.isHealthy(), false, "demoted after three");
    assert.equal(
      logs.filter((l) => l.includes("watch failure: window outer bound"))
        .length,
      3,
    );
    assert.equal(logs.filter((l) => l.includes("demoted")).length, 1);

    // Late settles from the abandoned execs are IGNORED entirely: no wake, no counter
    // mutation, no rearm, and a late rejection never becomes unhandled.
    const unhandled: unknown[] = [];
    const trap = (reason: unknown): void => void unhandled.push(reason);
    process.on("unhandledRejection", trap);
    try {
      settlers[0].resolve({ exitCode: 0, timedOut: false });
      settlers[1].reject(new Error("daemon woke up late"));
      settlers[2].resolve({ exitCode: 1, timedOut: false });
      await sleep(20);
    } finally {
      process.off("unhandledRejection", trap);
    }
    assert.equal(unhandled.length, 0, "late rejection stays handled");
    assert.equal(source.isHealthy(), false, "still demoted");
    assert.equal(
      await source.wait({ timeoutMs: 10 }),
      "timeout",
      "no sticky wake from a late settle",
    );
    assert.equal(settlers.length, 3, "no window armed by a late settle");
    source.close();
  });

  it("deferred arm: a wait that starts inside a backoff gap arms when the gap ends, within that same wait", async () => {
    const { sandbox, calls } = fakeSandbox();
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      backoffBaseMs: 100,
      backoffCapMs: 100,
    });

    const w1 = source.wait({ timeoutMs: 20 });
    calls[0].reject(new Error("boom"));
    assert.equal(await w1, "timeout");

    // A long wait starting inside the ~80-100 ms backoff gap: the gate blocks the
    // immediate arm, but the deferred arm fires inside this SAME wait once the gap
    // ends — the wait is not left windowless for its whole timeout.
    const w2 = source.wait({ timeoutMs: 2_000 });
    assert.equal(calls.length, 1, "the backoff gate blocked the immediate arm");
    await sleep(300); // well past the <= 100 ms backoff, with load headroom
    assert.equal(calls.length, 2, "the deferred arm fired inside the wait");
    calls[1].resolve({ exitCode: 0, timedOut: false });
    assert.equal(await w2, "activity", "the deferred window wakes the wait");
    source.close();
  });

  it("a failure landing MID-wait re-arms after the backoff inside that same wait (fix 4)", async () => {
    // The gap this closes: an exec that fails 1 s into a 30 s safety wait used to
    // leave the source windowless until the wait's own timer — no deferred arm was
    // scheduled because the wait STARTED with a window in flight, outside any backoff
    // gap. Now countFailure re-enters the arm gate while a waiter is parked.
    const { sandbox, calls } = fakeSandbox();
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 60_000,
      backoffBaseMs: 50,
      backoffCapMs: 50,
    });

    const wait = source.wait({ timeoutMs: 2_000 });
    assert.equal(calls.length, 1, "wait entry armed a window");
    calls[0].reject(new Error("exec died mid-wait"));
    await tick();
    assert.equal(
      calls.length,
      1,
      "no instant rearm: the backoff gates the next window",
    );

    await sleep(200); // well past the <= 50 ms jittered backoff
    assert.equal(
      calls.length,
      2,
      "the failure re-armed inside the SAME parked wait",
    );
    calls[1].resolve({ exitCode: 0, timedOut: false });
    assert.equal(await wait, "activity", "the re-armed window wakes the wait");
    source.close();
  });

  it("suspendsPolling is true and the daemon timeoutMs carries the grace over the jittered window", async () => {
    const { sandbox, calls } = fakeSandbox();
    const source = daytonaRelayActivitySource(sandbox, "/relay", {
      windowMs: 10_000,
    });
    assert.equal(source.suspendsPolling, true);

    const wait = source.wait({ timeoutMs: 10 });
    const request = calls[0].request;
    const scriptWindow = Number(request.args[3]);
    assert.ok(
      scriptWindow >= 8_000 && scriptWindow <= 10_000,
      "downward-only jitter",
    );
    assert.equal(
      request.timeoutMs,
      scriptWindow + 5_000,
      "daemon bound = jittered window + 5 s grace",
    );
    assert.equal(await wait, "timeout");
    source.close();
    calls[0].resolve({ exitCode: 0 });
    await tick();
  });
});

describe("remote watch window config", () => {
  it("unset -> default, no warning", () => {
    const logs: string[] = [];
    delete process.env[WINDOW_ENV];
    assert.equal(
      resolveRemoteWatchWindowMs((m) => logs.push(m)),
      RELAY_REMOTE_WATCH_WINDOW_DEFAULT_MS,
    );
    assert.equal(logs.length, 0);
  });

  it("garbage -> default with one warning", () => {
    const logs: string[] = [];
    process.env[WINDOW_ENV] = "soon";
    assert.equal(
      resolveRemoteWatchWindowMs((m) => logs.push(m)),
      RELAY_REMOTE_WATCH_WINDOW_DEFAULT_MS,
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /unparseable/);
  });

  it("partial numeric garbage -> default with one warning", () => {
    const logs: string[] = [];
    process.env[WINDOW_ENV] = "30000junk";
    assert.equal(
      resolveRemoteWatchWindowMs((m) => logs.push(m)),
      RELAY_REMOTE_WATCH_WINDOW_DEFAULT_MS,
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /unparseable/);
  });

  it("1000 -> clamped to the 5000 floor with one warning", () => {
    const logs: string[] = [];
    process.env[WINDOW_ENV] = "1000";
    assert.equal(
      resolveRemoteWatchWindowMs((m) => logs.push(m)),
      RELAY_REMOTE_WATCH_WINDOW_MIN_MS,
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /clamped/);
  });

  it("500000 -> clamped to the 120000 ceiling with one warning", () => {
    const logs: string[] = [];
    process.env[WINDOW_ENV] = "500000";
    assert.equal(
      resolveRemoteWatchWindowMs((m) => logs.push(m)),
      RELAY_REMOTE_WATCH_WINDOW_MAX_MS,
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /clamped/);
  });

  it("an in-range value passes through unclamped and unwarned", () => {
    const logs: string[] = [];
    process.env[WINDOW_ENV] = "30000";
    assert.equal(
      resolveRemoteWatchWindowMs((m) => logs.push(m)),
      30_000,
    );
    assert.equal(logs.length, 0);
  });

  it("jitter is downward-only (−20%..0%) across many draws", () => {
    // Deliberate deviation from the plan's ±20%: an upward draw would let a jittered
    // 25 s window outlast the 30 s safety wait and read as a false watch miss.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 1_000; i += 1) {
      const drawn = applyRelayWatchJitter(10_000);
      min = Math.min(min, drawn);
      max = Math.max(max, drawn);
    }
    assert.ok(min >= 8_000, `min ${min} >= 8000`);
    assert.ok(
      max <= 10_000,
      `max ${max} <= 10000 (never above the nominal window)`,
    );
    assert.ok(max > min, "jitter actually varies");
  });

  it("remoteWatchEnabled defaults false; only 'true'/'1' enable", () => {
    delete process.env[ENABLED_ENV];
    assert.equal(remoteWatchEnabled(), false);
    for (const value of ["false", "0", "yes", "TRUE", ""]) {
      process.env[ENABLED_ENV] = value;
      assert.equal(remoteWatchEnabled(), false, `'${value}' must not enable`);
    }
    for (const value of ["true", "1"]) {
      process.env[ENABLED_ENV] = value;
      assert.equal(remoteWatchEnabled(), true, `'${value}' enables`);
    }
  });

  it("the safety poll constant is 30 s", () => {
    assert.equal(RELAY_SAFETY_POLL_MS, 30_000);
  });
});

describe("buildRelayWatchScriptArgs", () => {
  const METACHAR_DIR = "we ird\"'`$(rm -rf /);|&\ndir";

  it("the script text never contains the dir; the dir rides argv as one element", () => {
    const { command, args } = buildRelayWatchScriptArgs(
      METACHAR_DIR,
      25_000,
      2_000,
    );
    assert.equal(command, "node");
    assert.deepEqual(args, [
      "-e",
      RELAY_WATCH_SCRIPT,
      METACHAR_DIR,
      "25000",
      "2000",
    ]);
    assert.ok(
      !RELAY_WATCH_SCRIPT.includes(METACHAR_DIR),
      "dir never interpolated into the script source",
    );
  });

  it("the script has no process.exit and writes nothing to stdout", () => {
    assert.ok(!RELAY_WATCH_SCRIPT.includes("process.exit"));
    assert.ok(!RELAY_WATCH_SCRIPT.includes("console."));
    assert.ok(!RELAY_WATCH_SCRIPT.includes("stdout"));
  });
});

describe("the watch script as a real process", () => {
  function runScript(
    dir: string,
    windowMs: number,
    readdirPollMs = 100,
  ): Promise<{ exitCode: number; durationMs: number }> {
    const { command, args } = buildRelayWatchScriptArgs(
      dir,
      windowMs,
      readdirPollMs,
    );
    const start = Date.now();
    return new Promise((resolve) => {
      // argv, no shell: exactly how sandbox.runProcess passes it.
      execFile(command, args, (error) => {
        resolve({
          exitCode:
            error && typeof error.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
          durationMs: Date.now() - start,
        });
      });
    });
  }

  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("a pre-existing .req.json exits immediately (exit 0)", async () => {
    dir = mkdtempSync(join(tmpdir(), "agenta-relay-watch-"));
    writeFileSync(join(dir, "call-1.req.json"), "{}");
    const { exitCode, durationMs } = await runScript(dir, 1_500);
    assert.equal(exitCode, 0);
    assert.ok(
      durationMs < 1_000,
      `exited in ${durationMs}ms, before the window`,
    );
  });

  it("a file created after spawn exits promptly on the watch event", async () => {
    dir = mkdtempSync(join(tmpdir(), "agenta-relay-watch-"));
    const target = dir;
    // Long window and slow readdir poll: only the fs.watch event can explain a fast exit.
    const running = runScript(target, 4_000, 3_500);
    setTimeout(() => {
      writeFileSync(join(target, "call-2.req.json"), "{}");
    }, 100);
    const { exitCode, durationMs } = await running;
    assert.equal(exitCode, 0);
    assert.ok(
      durationMs < 2_000,
      `woke at ${durationMs}ms, well under the window`,
    );
  });

  it("no file: exits at the window bound (exit 0)", async () => {
    dir = mkdtempSync(join(tmpdir(), "agenta-relay-watch-"));
    const { exitCode, durationMs } = await runScript(dir, 1_200);
    assert.equal(exitCode, 0);
    assert.ok(durationMs >= 1_100, `held the full window (${durationMs}ms)`);
    assert.ok(durationMs < 4_000, "and exited at the bound, not later");
  });

  it("a metacharacter-rich dir path still wakes on the event", async () => {
    dir = mkdtempSync(join(tmpdir(), "agenta-relay-watch-"));
    const weird = join(dir, "we ird\"'`$(rm -rf x);|&\ndir");
    mkdirSync(weird);
    const running = runScript(weird, 4_000, 3_500);
    setTimeout(() => {
      writeFileSync(join(weird, "call-3.req.json"), "{}");
    }, 100);
    const { exitCode, durationMs } = await running;
    assert.equal(exitCode, 0);
    assert.ok(durationMs < 2_000, `woke at ${durationMs}ms in the weird dir`);
  });

  it("a nonexistent dir does not crash; it degrades and exits at the window bound", async () => {
    dir = mkdtempSync(join(tmpdir(), "agenta-relay-watch-"));
    const missing = join(dir, "never-created");
    const { exitCode, durationMs } = await runScript(missing, 1_200);
    assert.equal(exitCode, 0);
    assert.ok(
      durationMs >= 1_100,
      `degraded poll held the window (${durationMs}ms)`,
    );
  });
});

describe("localRelayActivitySource", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("a missing dir returns undefined (plain poll fallback)", () => {
    assert.equal(localRelayActivitySource("/definitely/not/a/dir"), undefined);
  });

  it("an event during a wait resolves 'activity'; it does not suspend polling", async () => {
    dir = mkdtempSync(join(tmpdir(), "agenta-relay-local-"));
    const source = localRelayActivitySource(dir);
    assert.ok(source);
    assert.equal(source.suspendsPolling, false);
    assert.equal(source.isHealthy(), true);

    const target = dir;
    const wait = source.wait({ timeoutMs: 5_000 });
    setTimeout(() => {
      writeFileSync(join(target, "call-1.req.json"), "{}");
    }, 30);
    assert.equal(await wait, "activity");
    source.close();
  });

  it("no event resolves 'timeout' at the deadline", async () => {
    dir = mkdtempSync(join(tmpdir(), "agenta-relay-local-"));
    const source = localRelayActivitySource(dir);
    assert.ok(source);
    assert.equal(await source.wait({ timeoutMs: 30 }), "timeout");
    source.close();
  });

  it("close() resolves a held wait 'closed' and later waits 'closed'; isHealthy flips false", async () => {
    dir = mkdtempSync(join(tmpdir(), "agenta-relay-local-"));
    const source = localRelayActivitySource(dir);
    assert.ok(source);

    const held = source.wait({ timeoutMs: 60_000 });
    source.close();
    assert.equal(await held, "closed");
    assert.equal(source.isHealthy(), false);
    assert.equal(await source.wait({ timeoutMs: 10 }), "closed");
  });
});
