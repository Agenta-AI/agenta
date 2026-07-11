import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import {
  createSpecFingerprint,
  DaytonaReconnectTerminalError,
  daytonaWithLifecycle,
} from "../../src/engines/sandbox_agent/daytona-provider.ts";

function fakeProvider() {
  return {
    name: "daytona",
    create: async () => "created",
    destroy: async () => {},
    getUrl: async () => "http://sandbox.local",
    ensureServer: async () => {},
  };
}

function buildProvider(sandbox: Record<string, any>, getError?: unknown) {
  return daytonaWithLifecycle({}, {
    client: {
      get: async () => {
        if (getError) throw getError;
        return sandbox as any;
      },
    } as any,
    buildBaseProvider: fakeProvider,
  });
}

describe("Daytona provider pause", () => {
  afterEach(() => vi.useRealTimers());

  it("stops a running sandbox", async () => {
    let stops = 0;
    const provider = buildProvider({ state: "started", stop: async () => { stops += 1; } });

    await provider.pause("sandbox-1");

    assert.equal(stops, 1);
  });

  it("does not stop an already stopped or archived sandbox", async () => {
    for (const state of ["stopped", "archived"]) {
      let stops = 0;
      const provider = buildProvider({ state, stop: async () => { stops += 1; } });
      await provider.pause("sandbox-1");
      assert.equal(stops, 0, `${state} must be an idempotent success`);
    }
  });

  it("treats a missing sandbox as success", async () => {
    const provider = buildProvider({}, { statusCode: 404 });
    await assert.doesNotReject(() => provider.pause("sandbox-1"));
  });

  it("propagates a transient lookup error", async () => {
    const provider = buildProvider({}, new Error("service unavailable"));
    await assert.rejects(() => provider.pause("sandbox-1"), /service unavailable/);
  });

  it("waits through transitional states before stopping", async () => {
    vi.useFakeTimers();
    const states = ["starting", "restoring", "started"];
    let stops = 0;
    const sandbox = {
      state: states[0],
      async refreshData() {
        states.shift();
        this.state = states[0];
      },
      async stop() { stops += 1; },
    };
    const pause = buildProvider(sandbox).pause("sandbox-1");

    await vi.advanceTimersByTimeAsync(500);
    await pause;

    assert.equal(stops, 1);
  });

  it("throws when a transitional state never settles", async () => {
    vi.useFakeTimers();
    const provider = buildProvider({
      state: "starting",
      async refreshData() {},
    });
    const pause = provider.pause("sandbox-1");
    const rejection = assert.rejects(pause, /Timed out waiting to pause/);

    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });
});

describe("Daytona provider reconnect", () => {
  afterEach(() => vi.useRealTimers());

  it("starts only stopped or archived sandboxes", async () => {
    for (const state of ["stopped", "archived"]) {
      let starts = 0;
      const provider = buildProvider({ state, start: async () => { starts += 1; } });
      await provider.reconnect("sandbox-1");
      assert.equal(starts, 1, `${state} must be started`);
    }
  });

  it("reattaches a running sandbox without starting it", async () => {
    let starts = 0;
    const provider = buildProvider({ state: "started", start: async () => { starts += 1; } });
    await provider.reconnect("sandbox-1");
    assert.equal(starts, 0);
  });

  it("waits through transitional states before starting", async () => {
    const states = ["starting", "restoring", "stopped"];
    let starts = 0;
    const sandbox = {
      state: states[0],
      async refreshData() {
        states.shift();
        this.state = states[0];
      },
      async start() { starts += 1; },
    };
    const provider = buildProvider(sandbox);

    await provider.reconnect("sandbox-1");

    assert.equal(starts, 1);
  });

  it("throws the terminal type for missing, failed, and unknown states", async () => {
    const cases = [
      { state: "not-found", provider: buildProvider({}, { statusCode: 404 }) },
      ...["error", "destroyed", "mystery"].map((state) => ({
        state,
        provider: buildProvider({ state }),
      })),
    ];
    for (const { state, provider } of cases) {
      await assert.rejects(
        () => provider.reconnect("sandbox-1"),
        (error: unknown) =>
          error instanceof DaytonaReconnectTerminalError &&
          error.sandboxId === "sandbox-1" &&
          error.state === state,
      );
    }
  });

  it("throws a plain error when a transitional state times out", async () => {
    vi.useFakeTimers();
    const reconnect = buildProvider({
      state: "starting",
      async refreshData() {},
    }).reconnect("sandbox-1");
    const rejection = assert.rejects(
      reconnect,
      (error: unknown) =>
        error instanceof Error && !(error instanceof DaytonaReconnectTerminalError),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });
});

describe("Daytona provider delete", () => {
  it("deletes an existing sandbox and treats not found as success", async () => {
    let deletes = 0;
    const provider = buildProvider({ delete: async () => { deletes += 1; } });
    await provider.deleteSandbox("sandbox-1");
    assert.equal(deletes, 1);

    const missingProvider = buildProvider({}, { statusCode: 404 });
    await assert.doesNotReject(() => missingProvider.deleteSandbox("sandbox-missing"));
  });
});

describe("Daytona provider activity refresh", () => {
  it("strips the provider prefix and performs exactly one lookup", async () => {
    const ids: string[] = [];
    const provider = daytonaWithLifecycle({}, {
      client: { get: async (id: string) => { ids.push(id); return {} as any; } } as any,
      buildBaseProvider: fakeProvider,
    });

    await provider.refreshActivity("daytona/sandbox-1");

    assert.deepEqual(ids, ["sandbox-1"]);
  });

  it("swallows a missing sandbox", async () => {
    const provider = buildProvider({}, { statusCode: 404 });
    await assert.doesNotReject(() => provider.refreshActivity("daytona/missing"));
  });
});

describe("createSpecFingerprint", () => {
  const base = {
    snapshot: "snapshot-1",
    target: "target-1",
    envVars: { BETA: "secret-2", ALPHA: "secret-1" },
    networkAllowList: "10.0.0.0/8",
  };

  it("is stable under key order and ignores environment values", () => {
    const reordered = {
      networkAllowList: "10.0.0.0/8",
      envVars: { ALPHA: "changed", BETA: "also-changed" },
      target: "target-1",
      snapshot: "snapshot-1",
    };
    assert.equal(createSpecFingerprint(base), createSpecFingerprint(reordered));
  });

  it("changes for snapshot, target, environment name, and network policy", () => {
    const fingerprint = createSpecFingerprint(base);
    const variants = [
      { ...base, snapshot: "snapshot-2" },
      { ...base, image: "image-2" },
      { ...base, target: "target-2" },
      { ...base, envVars: { ...base.envVars, GAMMA: "secret-3" } },
      { ...base, networkAllowList: "192.168.0.0/16" },
      { ...base, networkAllowList: undefined, networkBlockAll: true },
    ];
    for (const variant of variants) {
      assert.notEqual(createSpecFingerprint(variant), fingerprint);
    }
  });
});
