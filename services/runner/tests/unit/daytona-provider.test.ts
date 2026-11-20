import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, it, vi } from "vitest";
import { DEFAULT_DAYTONA_SNAPSHOT } from "../../src/config/runner-config.ts";
import {
  DaytonaReconnectTerminalError,
  daemonStartCommand,
  daytonaWithLifecycle,
} from "../../src/engines/sandbox_agent/daytona-provider.ts";
import {
  resetCreatedSandboxIds,
  sandboxSnapshotOf,
} from "../../src/engines/sandbox_agent/created-sandboxes.ts";

function buildProvider(sandbox: Record<string, any>, getError?: unknown) {
  return daytonaWithLifecycle({}, {
    client: {
      get: async () => {
        if (getError) throw getError;
        return sandbox as any;
      },
    } as any,
  });
}

/** A fake Daytona sandbox that records its daemon starts and preview link fetches. */
function fakeSandbox(id: string, overrides: Record<string, any> = {}) {
  const calls: string[] = [];
  let links = 0;
  const sandbox = {
    id,
    state: "started",
    calls,
    process: {
      executeCommand: async (command: string) => {
        calls.push(`exec:${command}`);
      },
    },
    getPreviewLink: async (port: number) => {
      links += 1;
      calls.push(`link:${port}`);
      return { url: `https://${port}-${id}.proxy.test`, token: `token-${links}` };
    },
    delete: async () => {
      calls.push("delete");
    },
    ...overrides,
  };
  return sandbox;
}

/** A fake client whose `create` returns `sandbox` and whose `get` counts calls. */
function fakeClient(sandbox: Record<string, any>) {
  const client = {
    gets: 0,
    created: [] as unknown[],
    get: async () => {
      client.gets += 1;
      return sandbox as any;
    },
    create: async (params: unknown) => {
      client.created.push(params);
      return sandbox as any;
    },
  };
  return client;
}

describe("Daytona provider create", () => {
  afterEach(() => resetCreatedSandboxIds());

  it("reports the snapshot and build command when the snapshot is missing", async () => {
    const provider = daytonaWithLifecycle(
      {
        create: {
          snapshot: DEFAULT_DAYTONA_SNAPSHOT,
        } as any,
      },
      {
        client: {
          create: async () => {
            throw { statusCode: 404 };
          },
        } as any,
        target: "eu",
      },
    );

    await assert.rejects(
      () => provider.create(),
      new RegExp(
        `Daytona snapshot '${DEFAULT_DAYTONA_SNAPSHOT}' was not found.*` +
          `DAYTONA_API_KEY=\\.\\.\\. DAYTONA_TARGET=eu uv run build_snapshot\\.py`,
      ),
    );
  });

  it("creates with the run's fields, then starts the daemon and fetches the preview link", async () => {
    const sandbox = fakeSandbox("sb-new");
    const client = fakeClient(sandbox);
    const provider = daytonaWithLifecycle(
      {
        agentPort: 3000,
        create: { snapshot: "agenta-agent-sandbox-v9", image: undefined, autoStopInterval: 15 } as any,
      },
      { client: client as any },
    );

    assert.equal(await provider.create(), "sb-new");

    assert.deepEqual(client.created, [
      { autoStopInterval: 15, snapshot: "agenta-agent-sandbox-v9", image: undefined },
    ]);
    assert.deepEqual(sandbox.calls.sort(), [`exec:${daemonStartCommand(3000)}`, "link:3000"]);
  });

  it("hands out the preview link it fetched at create without another Daytona get", async () => {
    const sandbox = fakeSandbox("sb-new");
    const client = fakeClient(sandbox);
    const provider = daytonaWithLifecycle({}, { client: client as any });
    await provider.create();

    assert.equal(await provider.getUrl("sb-new"), "https://3000-sb-new.proxy.test");
    assert.equal(client.gets, 0);
    assert.equal(provider.previewToken("3000-sb-new.proxy.test")?.value, "token-1");

    // The issued URL is handed out once; a later call fetches a new link.
    assert.equal(await provider.getUrl("sb-new"), "https://3000-sb-new.proxy.test");
    assert.equal(client.gets, 1);
    assert.equal(provider.previewToken("3000-sb-new.proxy.test")?.value, "token-2");
  });

  it("keeps the daemon start command equal to sandbox-agent's own", async () => {
    // sandbox-agent does not export `buildServerStartCommand`, so load it from its dist chunk.
    const dist = join(import.meta.dirname, "../../node_modules/sandbox-agent/dist");
    let found: ((port: number) => string) | undefined;
    for (const file of readdirSync(dist).filter((name) => /^chunk-.*\.js$/.test(name))) {
      const chunk = await import(pathToFileURL(join(dist, file)).href);
      if (typeof chunk.buildServerStartCommand === "function") {
        found = chunk.buildServerStartCommand;
      }
    }
    assert.ok(found, "sandbox-agent still has buildServerStartCommand");
    assert.equal(daemonStartCommand(3000), found(3000));
    assert.equal(daemonStartCommand(4123), found(4123));
  });
});

describe("Daytona provider preview token", () => {
  it("shares one fetch between concurrent refreshes of the same stale token", async () => {
    const sandbox = fakeSandbox("sb-1");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetches = 0;
    const provider = daytonaWithLifecycle({}, { client: fakeClient(sandbox) as any });
    await provider.getUrl("sb-1");
    sandbox.getPreviewLink = async () => {
      fetches += 1;
      await gate;
      return { url: "https://3000-sb-1.proxy.test", token: "fresh" };
    };
    const token = provider.previewToken("3000-sb-1.proxy.test")!;

    const refreshes = [token.refresh("token-1"), token.refresh("token-1"), token.refresh("token-1")];
    release();

    assert.deepEqual(await Promise.all(refreshes), ["fresh", "fresh", "fresh"]);
    assert.equal(fetches, 1);
    // A late 401 for the replaced token gets the new one without another fetch.
    assert.equal(await token.refresh("token-1"), "fresh");
    assert.equal(fetches, 1);
    assert.equal(token.value, "fresh");
  });

  it("forgets the tokens of a destroyed sandbox and deletes it with the injected client", async () => {
    const sandbox = fakeSandbox("sb-1");
    const client = fakeClient(sandbox);
    const provider = daytonaWithLifecycle({}, { client: client as any });
    await provider.getUrl("sb-1");

    await provider.destroy("sb-1");

    assert.ok(sandbox.calls.includes("delete"));
    assert.equal(provider.previewToken("3000-sb-1.proxy.test"), undefined);
  });
});

describe("Daytona provider snapshot record (capability probe key)", () => {
  afterEach(() => resetCreatedSandboxIds());

  it("records the configured snapshot for a sandbox this process created", async () => {
    const provider = daytonaWithLifecycle(
      { create: { snapshot: "agenta-agent-sandbox-v9" } as any },
      { client: fakeClient(fakeSandbox("sb-new")) as any },
    );
    await provider.create();
    assert.equal(sandboxSnapshotOf("daytona/sb-new"), "agenta-agent-sandbox-v9");
    assert.equal(sandboxSnapshotOf("sb-new"), "agenta-agent-sandbox-v9");
  });

  it("records nothing for an image build", async () => {
    const provider = daytonaWithLifecycle(
      { create: {} as any },
      { client: fakeClient(fakeSandbox("sb-image")) as any },
    );
    await provider.create();
    assert.equal(sandboxSnapshotOf("sb-image"), undefined);
  });

  it("records the snapshot Daytona reports on reconnect, not the configured one", async () => {
    const provider = daytonaWithLifecycle(
      { create: { snapshot: "agenta-agent-sandbox-v9" } as any },
      {
        client: { get: async () => ({ state: "started", snapshot: "agenta-agent-sandbox-v8" }) } as any,
      },
    );
    await provider.reconnect("sb-parked");
    assert.equal(sandboxSnapshotOf("sb-parked"), "agenta-agent-sandbox-v8");
  });

  it("forgets a stale record when the reconnected sandbox reports no snapshot", async () => {
    const created = daytonaWithLifecycle(
      { create: { snapshot: "agenta-agent-sandbox-v9" } as any },
      { client: fakeClient(fakeSandbox("sb-1")) as any },
    );
    await created.create();
    const reconnected = buildProvider({ state: "started" });
    await reconnected.reconnect("sb-1");
    assert.equal(sandboxSnapshotOf("sb-1"), undefined);
  });
});

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
  it("strips the provider prefix and refreshes sandbox activity", async () => {
    const ids: string[] = [];
    let refreshCalls = 0;

    const provider = daytonaWithLifecycle({}, {
      client: {
        get: async (id: string) => {
          ids.push(id);

          return {
            async refreshActivity() {
              refreshCalls += 1;
            },
          } as any;
        },
      } as any,
    });

    await provider.refreshActivity("daytona/sandbox-1");

    assert.deepEqual(ids, ["sandbox-1"]);
    assert.equal(refreshCalls, 1);
  });

  it("swallows a missing sandbox", async () => {
    const provider = buildProvider({}, { statusCode: 404 });

    await assert.doesNotReject(() =>
      provider.refreshActivity("daytona/missing"),
    );
  });

  it("swallows an activity refresh failure", async () => {
    const provider = buildProvider({
      async refreshActivity() {
        throw new Error("temporary activity refresh failure");
      },
    });

    await assert.doesNotReject(() =>
      provider.refreshActivity("daytona/sandbox-1"),
    );
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
