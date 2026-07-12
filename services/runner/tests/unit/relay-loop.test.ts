/**
 * Unit tests for the startToolRelay loop's wake-source integration
 * (src/tools/relay.ts + src/tools/relay-watch.ts, event-driven-tool-relay plan
 * decisions 3, 4, 6): with a fake host and a fake activity source, the loop must
 *
 * - handle a request on a wake without waiting out a poll interval,
 * - pin every suspended-mode wait to RELAY_SAFETY_POLL_MS (never relayPollDelayMs),
 * - use relayPollDelayMs for a non-suspending (local) source,
 * - revert to the classic sleep once the source demotes (wait never called again),
 * - resolve stop() promptly out of a held wait (a wait that only resolves on close),
 * - count a safety-poll discovery ("timeout" outcome, then a request found) as a miss,
 * - keep the seen-set dedup across wake and poll pickups,
 * - remove a request file on pickup so a slow execution cannot rearm-storm the
 *   Daytona watch exec (delete-on-pickup, slice-2 review finding 1),
 * - still run a list pass on a "closed" wait outcome while the loop is active,
 * - and stay byte-for-byte classic with no createActivitySource at all.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/relay-loop.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  RELAY_POLL_MS,
  startToolRelay,
  type RelayHost,
} from "../../src/tools/relay.ts";
import {
  RELAY_SAFETY_POLL_MS,
  daytonaRelayActivitySource,
  type RelayActivitySource,
} from "../../src/tools/relay-watch.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function until(
  condition: () => boolean,
  what: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/** In-memory relay host; reads are counted so a dedup test can pin exactly-once. */
function fakeHost(
  source?: RelayActivitySource,
  opts?: { writeDelayMs?: number },
): {
  host: RelayHost;
  files: Map<string, string>;
  readCounts: Map<string, number>;
  removed: string[];
} {
  const files = new Map<string, string>();
  const readCounts = new Map<string, number>();
  const removed: string[] = [];
  const host: RelayHost = {
    list: async (dir) =>
      [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1)),
    read: async (path) => {
      readCounts.set(path, (readCounts.get(path) ?? 0) + 1);
      const contents = files.get(path);
      if (contents === undefined) throw new Error(`missing ${path}`);
      return contents;
    },
    remove: async (path) => {
      removed.push(path);
      files.delete(path);
    },
    write: async (path, contents) => {
      if (opts?.writeDelayMs) await sleep(opts.writeDelayMs);
      files.set(path, contents);
    },
    rename: async (from, to) => {
      const contents = files.get(from);
      if (contents === undefined) throw new Error(`missing ${from}`);
      files.delete(from);
      files.set(to, contents);
    },
    createActivitySource: source ? () => source : undefined,
  };
  return { host, files, readCounts, removed };
}

/**
 * Controllable activity source: waits resolve ONLY via wake()/expire()/close(). Records
 * every wait's timeoutMs so the loop's cadence choice is pinned.
 */
function fakeSource(suspendsPolling: boolean): {
  source: RelayActivitySource;
  wake: () => void;
  expire: () => void;
  demote: () => void;
  waitTimeouts: number[];
  missCount: () => number;
} {
  let waiter: ((o: "activity" | "timeout" | "closed") => void) | undefined;
  let healthy = true;
  let closed = false;
  let misses = 0;
  const waitTimeouts: number[] = [];
  const settle = (outcome: "activity" | "timeout" | "closed"): void => {
    const resolve = waiter;
    waiter = undefined;
    resolve?.(outcome);
  };
  return {
    source: {
      suspendsPolling,
      isHealthy: () => healthy && !closed,
      noteMiss: () => {
        misses += 1;
      },
      wait: ({ timeoutMs }) => {
        waitTimeouts.push(timeoutMs);
        if (closed) return Promise.resolve("closed");
        return new Promise((resolve) => {
          waiter = resolve;
        });
      },
      close: () => {
        closed = true;
        settle("closed");
      },
    },
    wake: () => settle("activity"),
    expire: () => settle("timeout"),
    demote: () => {
      healthy = false;
    },
    waitTimeouts,
    missCount: () => misses,
  };
}

const DIR = "/relay";

/** An unknown-tool request: the loop handles it and writes an ok:false response. */
function putRequest(files: Map<string, string>, id: string): void {
  files.set(
    `${DIR}/${id}.req.json`,
    JSON.stringify({ toolName: "nope", toolCallId: id, args: {} }),
  );
}

describe("startToolRelay with an activity source", () => {
  it("suspended mode: requests are handled on wake, and every wait is the 30 s safety poll", async () => {
    const fake = fakeSource(true);
    const { host, files } = fakeHost(fake.source);
    const relay = startToolRelay(host, DIR, [], undefined);

    // First pass listed (empty) and parked on the source.
    await until(() => fake.waitTimeouts.length === 1, "the first wait");

    putRequest(files, "call-1");
    fake.wake();
    // Handled well before any poll interval could have elapsed: the wake is the pickup.
    await until(
      () => files.has(`${DIR}/call-1.res.json`),
      "the response file",
      RELAY_POLL_MS - 50,
    );

    await until(() => fake.waitTimeouts.length === 2, "the loop re-parked");
    assert.ok(
      fake.waitTimeouts.every((t) => t === RELAY_SAFETY_POLL_MS),
      `suspended waits pinned to RELAY_SAFETY_POLL_MS, got ${fake.waitTimeouts}`,
    );

    await relay.stop();
  });

  it("non-suspending (local) mode: waits use the poll cadence, not the safety poll", async () => {
    const fake = fakeSource(false);
    const { host, files } = fakeHost(fake.source);
    const relay = startToolRelay(host, DIR, [], undefined);

    await until(() => fake.waitTimeouts.length === 1, "the first wait");
    assert.equal(
      fake.waitTimeouts[0],
      RELAY_POLL_MS,
      "local watch only shortens the poll sleep; cadence unchanged",
    );

    putRequest(files, "call-1");
    fake.wake();
    await until(() => files.has(`${DIR}/call-1.res.json`), "the response");

    await relay.stop();
  });

  it("a demoted source reverts the loop to the classic sleep (wait never called again)", async () => {
    const fake = fakeSource(true);
    const { host, files } = fakeHost(fake.source);
    const relay = startToolRelay(host, DIR, [], undefined);

    await until(() => fake.waitTimeouts.length === 1, "the first wait");
    fake.demote();
    fake.expire(); // release the held wait; the next iteration re-checks isHealthy

    // Classic mode still picks requests up (by poll), and never consults the source.
    const waitsAtDemotion = fake.waitTimeouts.length;
    putRequest(files, "call-1");
    await until(() => files.has(`${DIR}/call-1.res.json`), "poll pickup");
    await sleep(RELAY_POLL_MS + 100);
    assert.equal(
      fake.waitTimeouts.length,
      waitsAtDemotion,
      "no wait() after demotion",
    );

    await relay.stop();
  });

  it("stop() during a held wait returns promptly (close resolves the wait)", async () => {
    const fake = fakeSource(true);
    const { host } = fakeHost(fake.source);
    const relay = startToolRelay(host, DIR, [], undefined);

    await until(() => fake.waitTimeouts.length === 1, "the held wait");
    const start = Date.now();
    await relay.stop();
    assert.ok(
      Date.now() - start < 1_000,
      "stop() did not sit out the 30 s safety-poll timer",
    );
  });

  it("a safety-poll discovery (timeout outcome, then a request found) counts as a watch miss", async () => {
    const fake = fakeSource(true);
    const { host, files } = fakeHost(fake.source);
    const relay = startToolRelay(host, DIR, [], undefined);

    await until(() => fake.waitTimeouts.length === 1, "the first wait");
    // The request lands, but the watch never wakes: the safety poll finds it.
    putRequest(files, "call-1");
    fake.expire();
    await until(() => files.has(`${DIR}/call-1.res.json`), "safety pickup");
    assert.equal(fake.missCount(), 1, "the miss fed noteMiss");

    // A request found after a real wake is NOT a miss.
    await until(() => fake.waitTimeouts.length === 2, "re-parked");
    putRequest(files, "call-2");
    fake.wake();
    await until(() => files.has(`${DIR}/call-2.res.json`), "wake pickup");
    assert.equal(fake.missCount(), 1, "an 'activity' pickup is not a miss");

    await relay.stop();
  });

  it("seen-set dedup holds across wake and poll pickups of the same file", async () => {
    const fake = fakeSource(true);
    const { host, files, readCounts } = fakeHost(fake.source);
    const relay = startToolRelay(host, DIR, [], undefined);

    await until(() => fake.waitTimeouts.length === 1, "the first wait");
    putRequest(files, "call-1");
    fake.wake();
    await until(() => files.has(`${DIR}/call-1.res.json`), "first pickup");

    // Delete-on-pickup already removed the file, and even if a stale list still
    // returned it, the seen set dedups: never re-read on later wakes and expiries.
    await until(() => fake.waitTimeouts.length === 2, "re-parked");
    fake.wake();
    await until(() => fake.waitTimeouts.length === 3, "re-parked again");
    fake.expire();
    await until(() => fake.waitTimeouts.length === 4, "and once more");
    assert.equal(readCounts.get(`${DIR}/call-1.req.json`), 1);

    await relay.stop();
  });

  it("delete-on-pickup: a slow execution does not rearm-storm the Daytona watch exec", async () => {
    // End-to-end against the REAL daytonaRelayActivitySource: the fake daemon exec
    // insta-completes while any *.req.json is present (exactly what the in-sandbox
    // watch script does), parks forever otherwise. Before delete-on-pickup, the
    // request file stayed on disk for the whole execution, so every window
    // insta-completed and rearmed at network speed; now the pickup removes it and the
    // window count stays small across a slow (~150 ms) execution.
    const files = new Map<string, string>();
    const removed: string[] = [];
    let runProcessCalls = 0;
    const sandbox = {
      runProcess: (_request: {
        command: string;
        args: string[];
        timeoutMs: number;
      }): Promise<{ exitCode?: number | null; timedOut?: boolean }> => {
        runProcessCalls += 1;
        const hasReq = [...files.keys()].some((path) =>
          path.endsWith(".req.json"),
        );
        if (hasReq)
          return sleep(5).then(() => ({ exitCode: 0, timedOut: false }));
        return new Promise(() => {}); // idle window: parks until stop() abandons it
      },
    };
    const source = daytonaRelayActivitySource(sandbox, DIR, {
      windowMs: 60_000,
    });
    const host: RelayHost = {
      list: async (dir) =>
        [...files.keys()]
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1)),
      read: async (path) => {
        const contents = files.get(path);
        if (contents === undefined) throw new Error(`missing ${path}`);
        return contents;
      },
      remove: async (path) => {
        removed.push(path);
        files.delete(path);
      },
      // The slow part of the execution: the response write takes ~150 ms, so the
      // request's pickup-to-response span covers many potential rearm windows.
      write: async (path, contents) => {
        await sleep(150);
        files.set(path, contents);
      },
      rename: async (from, to) => {
        const contents = files.get(from);
        if (contents === undefined) throw new Error(`missing ${from}`);
        files.delete(from);
        files.set(to, contents);
      },
      createActivitySource: () => source,
    };

    putRequest(files, "call-1");
    const relay = startToolRelay(host, DIR, [], undefined);
    await until(() => files.has(`${DIR}/call-1.res.json`), "the response");

    assert.ok(
      runProcessCalls <= 3,
      `watch exec count stayed small across the execution, got ${runProcessCalls}`,
    );
    assert.deepEqual(
      removed,
      [`${DIR}/call-1.req.json`],
      "pickup removed exactly the request file",
    );
    assert.ok(
      !files.has(`${DIR}/call-1.req.json`),
      "the request file is gone from the fake fs, so later lists never return it",
    );

    await relay.stop();
  });

  it("a 'closed' wait outcome while the loop is active still runs a list pass", async () => {
    const fake = fakeSource(true);
    const { host, files } = fakeHost(fake.source);
    const relay = startToolRelay(host, DIR, [], undefined);

    await until(() => fake.waitTimeouts.length === 1, "the first wait");
    // The request lands and the source closes itself (e.g. the watch subsystem tears
    // down) while the loop is still active: the "closed" outcome must not skip the
    // list pass — the request is still picked up and answered.
    putRequest(files, "call-1");
    fake.source.close();
    await until(
      () => files.has(`${DIR}/call-1.res.json`),
      "post-closed pickup",
    );

    await relay.stop();
  });

  it("no createActivitySource: the classic loop still serves requests (bare-host parity)", async () => {
    const { host, files } = fakeHost(undefined);
    const relay = startToolRelay(host, DIR, [], undefined);

    putRequest(files, "call-1");
    await until(() => files.has(`${DIR}/call-1.res.json`), "classic pickup");
    const res = JSON.parse(files.get(`${DIR}/call-1.res.json`) ?? "{}");
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /unknown tool/);

    await relay.stop();
  });
});
