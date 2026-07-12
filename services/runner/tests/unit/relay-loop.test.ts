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
 * Plus the slice-3 additions:
 *
 * - the orphan-residue snapshot: a request file already present at the FIRST successful
 *   list predates the turn and is cleared, never executed (with the one-line stale log),
 *   and a throwing first list does not count as the snapshot,
 * - stage=relay_pickup telemetry: one log line per executed request, with pickup_ms
 *   from host.statMtimeMs (stat'd BEFORE the delete-on-pickup remove) and the wake tag.
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
    let testDone = false;
    const sandbox = {
      runProcess: (_request: {
        command: string;
        args: string[];
        timeoutMs: number;
      }): Promise<{ exitCode?: number | null; timedOut?: boolean }> => {
        runProcessCalls += 1;
        // Mirrors the in-sandbox watch script's readdir interval: the window
        // completes as soon as ANY *.req.json is present, including one that lands
        // MID-window. (Since the orphan snapshot, the request must be written after
        // the loop starts, so it can no longer be guaranteed present at arm time.)
        // `testDone` drains an idle parked window at the end so no timer chain
        // outlives the test.
        return new Promise((resolve) => {
          const check = (): void => {
            const hasReq = [...files.keys()].some((path) =>
              path.endsWith(".req.json"),
            );
            if (hasReq || testDone) {
              resolve({ exitCode: 0, timedOut: false });
              return;
            }
            setTimeout(check, 5);
          };
          check();
        });
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

    const relay = startToolRelay(host, DIR, [], undefined);
    // Written AFTER the loop starts: the orphan snapshot (slice 3) treats any request
    // already present at the first successful list as pre-turn residue and never
    // executes it. The first list is issued synchronously inside startToolRelay, so
    // this write is reliably post-snapshot — exactly how a real request arrives (the
    // loop starts before the prompt is issued).
    putRequest(files, "call-1");
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

    testDone = true;
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

    // Post-snapshot write (see the delete-on-pickup test): a request seeded before
    // startToolRelay would now be cleared as pre-turn residue instead of served.
    putRequest(files, "call-1");
    await until(() => files.has(`${DIR}/call-1.res.json`), "classic pickup");
    const res = JSON.parse(files.get(`${DIR}/call-1.res.json`) ?? "{}");
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /unknown tool/);

    await relay.stop();
  });
});

/** startToolRelay with only the trailing log option set (positional args unchanged). */
function startRelayWithLog(
  host: RelayHost,
  logs: string[],
): { stop: () => Promise<void> } {
  return startToolRelay(
    host,
    DIR,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    { log: (msg) => logs.push(msg) },
  );
}

describe("startToolRelay orphan-residue snapshot (a turn only executes requests created after it started)", () => {
  it("a request file present at loop start is cleared and never executed; a post-snapshot request is served", async () => {
    const logs: string[] = [];
    const { host, files, readCounts, removed } = fakeHost(undefined);
    // Residue of a crashed prior turn in a reused relay dir (warm continuation skips
    // the cold-build rm -rf): present BEFORE the loop starts.
    putRequest(files, "stale-1");
    const relay = startRelayWithLog(host, logs);

    await until(
      () => removed.includes(`${DIR}/stale-1.req.json`),
      "the stale removal",
    );

    // A request that arrives after the snapshot is served normally.
    putRequest(files, "fresh-1");
    await until(() => files.has(`${DIR}/fresh-1.res.json`), "fresh response");

    assert.equal(
      readCounts.get(`${DIR}/stale-1.req.json`),
      undefined,
      "the stale request was never read (no execution path started)",
    );
    assert.ok(
      !files.has(`${DIR}/stale-1.res.json`),
      "no response was written for the stale request",
    );
    assert.ok(
      !files.has(`${DIR}/stale-1.req.json`),
      "the stale request file was removed",
    );

    await relay.stop();
  });

  it("a throwing first list is not the snapshot: the first SUCCESSFUL list clears the residue", async () => {
    const logs: string[] = [];
    const { host, files, readCounts, removed } = fakeHost(undefined);
    const baseList = host.list;
    let listCalls = 0;
    // The dir does not exist yet when the loop starts (the pre-existing transient
    // branch): the FIRST list rejects; the residue is only visible from the second.
    host.list = async (dir) => {
      listCalls += 1;
      if (listCalls === 1) throw new Error("relay dir not created yet");
      return baseList(dir);
    };
    putRequest(files, "stale-1");
    const relay = startRelayWithLog(host, logs);

    await until(
      () => removed.includes(`${DIR}/stale-1.req.json`),
      "the stale removal on the first successful list",
    );
    assert.ok(listCalls >= 2, "the rejecting list was retried");
    assert.equal(
      readCounts.get(`${DIR}/stale-1.req.json`),
      undefined,
      "still treated as stale: never executed",
    );

    await relay.stop();
  });

  it("the stale log line fires once, with the count", async () => {
    const logs: string[] = [];
    const { host, files, removed } = fakeHost(undefined);
    putRequest(files, "stale-1");
    putRequest(files, "stale-2");
    const relay = startRelayWithLog(host, logs);

    await until(() => removed.length === 2, "both stale removals");
    // Serve one real request so several more list passes have run by the assertion:
    // the stale line must not repeat on later (non-snapshot) passes.
    putRequest(files, "fresh-1");
    await until(() => files.has(`${DIR}/fresh-1.res.json`), "fresh response");

    assert.deepEqual(
      logs.filter((msg) => msg.includes("stale request file")),
      ["[relay] cleared 2 stale request file(s) predating the turn"],
      "exactly one stale line, carrying the count",
    );

    await relay.stop();
  });
});

describe("startToolRelay stage=relay_pickup telemetry", () => {
  /** In-memory host that records the per-path op order and answers statMtimeMs. */
  function telemetryHost(mtimeMs: (path: string) => number | undefined): {
    host: RelayHost;
    files: Map<string, string>;
    ops: Array<{ op: "read" | "stat" | "remove"; path: string }>;
  } {
    const files = new Map<string, string>();
    const ops: Array<{ op: "read" | "stat" | "remove"; path: string }> = [];
    const host: RelayHost = {
      list: async (dir) =>
        [...files.keys()]
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1)),
      read: async (path) => {
        ops.push({ op: "read", path });
        const contents = files.get(path);
        if (contents === undefined) throw new Error(`missing ${path}`);
        return contents;
      },
      remove: async (path) => {
        ops.push({ op: "remove", path });
        files.delete(path);
      },
      write: async (path, contents) => {
        files.set(path, contents);
      },
      rename: async (from, to) => {
        const contents = files.get(from);
        if (contents === undefined) throw new Error(`missing ${from}`);
        files.delete(from);
        files.set(to, contents);
      },
      statMtimeMs: async (path) => {
        ops.push({ op: "stat", path });
        return mtimeMs(path);
      },
    };
    return { host, files, ops };
  }

  it("logs one pickup line per executed request with pickup_ms >= 0 and the wake tag; stat runs BEFORE remove", async () => {
    const logs: string[] = [];
    const { host, files, ops } = telemetryHost(() => Date.now() - 50);
    const relay = startRelayWithLog(host, logs);

    putRequest(files, "call-1");
    await until(() => files.has(`${DIR}/call-1.res.json`), "first response");
    putRequest(files, "call-2");
    await until(() => files.has(`${DIR}/call-2.res.json`), "second response");
    await relay.stop();

    const pickups = logs.filter((msg) => msg.includes("stage=relay_pickup"));
    assert.equal(
      pickups.length,
      2,
      `one pickup line per executed request, got ${JSON.stringify(pickups)}`,
    );
    const match =
      /^\[relay\] stage=relay_pickup id=call-1 pickup_ms=(\d+) wake=poll$/.exec(
        pickups[0],
      );
    assert.ok(match, `pickup line shape: ${pickups[0]}`);
    assert.ok(Number(match?.[1]) >= 0, "a plausible non-negative pickup_ms");

    // Order pin: the stat must run BEFORE the delete-on-pickup remove — afterwards
    // the file is gone and the stat could only miss.
    const reqPath = `${DIR}/call-1.req.json`;
    assert.deepEqual(
      ops.filter((op) => op.path === reqPath).map((op) => op.op),
      ["read", "stat", "remove"],
      "read, then stat, then remove",
    );
  });

  it("a throwing statMtimeMs degrades to pickup_ms=-1 and never fails the execution", async () => {
    const logs: string[] = [];
    const { host, files } = telemetryHost(() => {
      throw new Error("stat failed");
    });
    const relay = startRelayWithLog(host, logs);

    putRequest(files, "call-1");
    await until(() => files.has(`${DIR}/call-1.res.json`), "the response");
    await relay.stop();

    const pickup = logs.find((msg) => msg.includes("stage=relay_pickup"));
    assert.ok(pickup?.includes("pickup_ms=-1"), `degraded line: ${pickup}`);
    assert.ok(pickup?.includes("wake="), "the wake tag is still present");
  });

  it("a wake-driven pickup carries wake=activity (captured at discovery time); no statMtimeMs -> -1", async () => {
    const fake = fakeSource(true);
    const logs: string[] = [];
    // fakeHost has NO statMtimeMs: the optional capability degrades to pickup_ms=-1.
    const { host, files } = fakeHost(fake.source);
    const relay = startToolRelay(
      host,
      DIR,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      { log: (msg) => logs.push(msg) },
    );

    await until(() => fake.waitTimeouts.length === 1, "the first wait");
    putRequest(files, "call-1");
    fake.wake();
    await until(() => files.has(`${DIR}/call-1.res.json`), "wake pickup");

    const pickup = logs.find((msg) =>
      msg.includes("stage=relay_pickup id=call-1"),
    );
    assert.ok(pickup?.includes("wake=activity"), `wake tag: ${pickup}`);
    assert.ok(pickup?.includes("pickup_ms=-1"), `no-stat fallback: ${pickup}`);

    await relay.stop();
  });
});
