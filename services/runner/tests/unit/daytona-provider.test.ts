import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import {
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

  it("treats a destroyed sandbox as success but throws for the error state", async () => {
    await assert.doesNotReject(() =>
      buildProvider({ state: "destroyed" }).pause("sandbox-1"),
    );
    await assert.rejects(
      () => buildProvider({ state: "error" }).pause("sandbox-1"),
      /Cannot pause Daytona sandbox 'sandbox-1' from state 'error'/,
    );
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

  it("retries when Daytona starts changing state between refresh and start", async () => {
    vi.useFakeTimers();
    let starts = 0;
    const sandbox = {
      state: "stopped",
      async refreshData() {
        this.state = "stopped";
      },
      async start() {
        starts += 1;
        if (starts === 1) {
          this.state = "stopping";
          throw new Error("Sandbox state change in progress");
        }
        this.state = "started";
      },
    };
    const reconnect = buildProvider(sandbox).reconnect("sandbox-1");

    await vi.advanceTimersByTimeAsync(500);
    await reconnect;

    assert.equal(starts, 2);
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

describe("Daytona provider reconnect network policy sync", () => {
  function providerWithPolicy(
    create: Record<string, unknown>,
    sandbox: Record<string, any>,
    getError?: unknown,
  ) {
    return daytonaWithLifecycle({ create } as any, {
      client: {
        get: async () => {
          if (getError) throw getError;
          return sandbox as any;
        },
      } as any,
      buildBaseProvider: fakeProvider,
    });
  }

  it("converges a running sandbox whose live policy differs from the plan", async () => {
    const calls: any[] = [];
    const sandbox = {
      state: "started",
      networkBlockAll: false,
      networkAllowList: undefined,
      async refreshData() {},
      async updateNetworkSettings(settings: any) {
        calls.push(settings);
      },
    };
    const provider = providerWithPolicy({ networkAllowList: "10.0.0.0/8" }, sandbox);

    await provider.reconnect("sandbox-1");

    assert.deepEqual(calls, [
      { networkBlockAll: false, networkAllowList: "10.0.0.0/8" },
    ]);
  });

  it("skips the update when the live policy already matches the plan", async () => {
    const calls: any[] = [];
    const sandbox = {
      state: "started",
      networkAllowList: "10.0.0.0/8",
      async refreshData() {},
      async updateNetworkSettings(settings: any) {
        calls.push(settings);
      },
    };
    const provider = providerWithPolicy({ networkAllowList: "10.0.0.0/8" }, sandbox);

    await provider.reconnect("sandbox-1");

    assert.equal(calls.length, 0);
  });

  it("ignores allow-list order and spacing when comparing", async () => {
    const calls: any[] = [];
    const sandbox = {
      state: "started",
      networkAllowList: "192.168.0.0/16,10.0.0.0/8",
      async refreshData() {},
      async updateNetworkSettings(settings: any) {
        calls.push(settings);
      },
    };
    const provider = providerWithPolicy(
      { networkAllowList: "10.0.0.0/8, 192.168.0.0/16" },
      sandbox,
    );

    await provider.reconnect("sandbox-1");

    assert.equal(calls.length, 0);
  });

  it("converges after starting a stopped sandbox", async () => {
    const calls: any[] = [];
    let starts = 0;
    const sandbox = {
      state: "stopped",
      networkBlockAll: false,
      async refreshData() {},
      async start() {
        starts += 1;
      },
      async updateNetworkSettings(settings: any) {
        calls.push(settings);
      },
    };
    const provider = providerWithPolicy({ networkBlockAll: true }, sandbox);

    await provider.reconnect("sandbox-1");

    assert.equal(starts, 1);
    assert.deepEqual(calls, [{ networkBlockAll: true }]);
  });

  it("does not abort reconnect when the policy update fails", async () => {
    const sandbox = {
      state: "started",
      networkBlockAll: false,
      async refreshData() {},
      async updateNetworkSettings() {
        throw new Error("update boom");
      },
    };
    const provider = providerWithPolicy({ networkBlockAll: true }, sandbox);

    await assert.doesNotReject(() => provider.reconnect("sandbox-1"));
  });

  it("compares against the fetched fields when refreshData fails", async () => {
    const calls: any[] = [];
    const sandbox = {
      state: "started",
      networkBlockAll: true,
      async refreshData() {
        throw new Error("stale handle");
      },
      async updateNetworkSettings(settings: any) {
        calls.push(settings);
      },
    };
    // Live is block-all, plan is open, so reconnect must still converge to open.
    const provider = providerWithPolicy({}, sandbox);

    await provider.reconnect("sandbox-1");

    assert.deepEqual(calls, [{ networkBlockAll: false }]);
  });
});
