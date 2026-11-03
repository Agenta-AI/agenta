/**
 * A pod reconnects only to a Daytona sandbox it created, and never touches one it did not.
 *
 * Drives `SandboxLifecycle.acquire` and `teardown` over the REAL Daytona lifecycle provider, with
 * and without the process-local Secrets wrapper, against a fake Daytona API. The fake start
 * mirrors the patched sandbox-agent client: an id in the options reconnects, no id creates.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/sandbox-created-here.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";

import {
  createdSandboxState,
  markSandboxCreated,
  markSandboxDeleted,
  resetCreatedSandboxIds,
  wasSandboxCreatedHere,
} from "../../src/engines/sandbox_agent/created-sandboxes.ts";
import { daytonaWithLifecycle } from "../../src/engines/sandbox_agent/daytona-provider.ts";
import {
  daytonaWithProcessLocalSecrets,
  type DaytonaProviderLike,
} from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
import type { DaytonaSecretApi } from "../../src/engines/sandbox_agent/daytona-secrets.ts";
import {
  acquire,
  teardown,
  type SandboxTeardownInput,
} from "../../src/environment/sandbox-lifecycle.ts";

/** A fake Daytona account shared by every "pod" in a test. Records every call by sandbox id. */
function fakeDaytonaAccount() {
  const sandboxes = new Map<string, { state: string }>();
  const calls = {
    creates: [] as string[],
    gets: [] as string[],
    starts: [] as string[],
    stops: [] as string[],
    deletes: [] as string[],
  };
  let count = 0;
  const client = {
    async get(id: string) {
      calls.gets.push(id);
      const record = sandboxes.get(id);
      if (!record) throw { statusCode: 404 };
      return {
        id,
        get state() {
          return record.state;
        },
        async refreshData() {},
        async start() {
          calls.starts.push(id);
          record.state = "started";
        },
        async stop() {
          calls.stops.push(id);
          record.state = "stopped";
        },
        async delete() {
          calls.deletes.push(id);
          sandboxes.delete(id);
        },
        async updateNetworkSettings() {},
      };
    },
  };
  const baseProvider = () => ({
    name: "daytona",
    async create() {
      count += 1;
      const id = `sbx-${count}`;
      sandboxes.set(id, { state: "started" });
      calls.creates.push(id);
      return id;
    },
    async destroy(id: string) {
      calls.deletes.push(id);
      sandboxes.delete(id);
    },
    async getUrl() {
      return "http://sandbox.local";
    },
    async ensureServer() {},
  });
  /** A sandbox another pod created: it exists on Daytona, but not in this process's set. */
  const seedForeign = (id: string, state: string) => {
    sandboxes.set(id, { state });
  };
  return { sandboxes, calls, client, baseProvider, seedForeign };
}

type Account = ReturnType<typeof fakeDaytonaAccount>;

const noSecrets: DaytonaSecretApi = {
  async create() {
    throw new Error("a zero-candidate plan allocates no Secret");
  },
  async update() {
    throw new Error("unused");
  },
  async delete() {
    throw new Error("unused");
  },
};

/**
 * The provider one acquire builds, as `buildSandboxProvider` does: the plain lifecycle provider
 * with opaque Secrets off, or the wrapper over it with them on. The registry outlives a single
 * acquire, as the module-level one does in a running process.
 */
function buildProvider(
  account: Account,
  opaqueSecrets: boolean,
  registry: Map<string, any>,
): DaytonaProviderLike {
  const buildDaytona = () =>
    daytonaWithLifecycle(
      {},
      { client: account.client as any, buildBaseProvider: account.baseProvider as any },
    ) as unknown as DaytonaProviderLike;
  if (!opaqueSecrets) return buildDaytona();
  return daytonaWithProcessLocalSecrets(
    buildDaytona,
    { environment: {}, candidates: [] },
    noSecrets,
    {
      registry,
      createFingerprint: "generation-a",
      cleanupDelayMilliseconds: 60 * 60_000,
    },
  );
}

/** The patched sandbox-agent client's start, reduced to the provider calls it makes. */
function startSandboxAgentOver(provider: DaytonaProviderLike) {
  return async (options: Record<string, unknown>) => {
    const stored = options.sandboxId as string | undefined;
    const rawId = stored ? stored.replace(/^daytona\//, "") : await provider.create();
    if (stored) await provider.reconnect?.(rawId);
    return {
      sandboxId: `daytona/${rawId}`,
      pauseSandbox: () => provider.pause!(rawId),
      destroySandbox: () => provider.destroy(rawId),
    };
  };
}

/** One turn on one pod: acquire against the stored pointer, then park or delete. */
async function runTurn(
  account: Account,
  options: {
    opaqueSecrets: boolean;
    registry: Map<string, any>;
    storedSandboxId: string | undefined;
    reason: "idle-expiry" | "failed-turn";
  },
) {
  const provider = buildProvider(account, options.opaqueSecrets, options.registry);
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);
  const acquired = await acquire(
    {
      startOptions: {},
      isDaytona: true,
      harness: "claude",
      sessionForMount: "sess-1",
      runCred: "ApiKey abc",
      log,
      timingLog: () => {},
    },
    {
      startSandboxAgent: startSandboxAgentOver(provider),
      readStoredSandboxPointer: async () =>
        options.storedSandboxId ? { sandboxId: options.storedSandboxId } : undefined,
    },
  );
  const sandbox = acquired.sandbox as SandboxTeardownInput["sandbox"];
  await teardown({
    sandbox,
    plannedSandboxId: undefined,
    isDaytona: true,
    harness: "claude",
    reason: options.reason,
    log,
  });
  return { mode: acquired.mode, sandboxId: sandbox?.sandboxId, logs };
}

beforeEach(() => {
  resetCreatedSandboxIds();
});

describe("created sandbox ids", () => {
  it("accepts the raw and the prefixed form of the same id", () => {
    markSandboxCreated("sbx-1");
    assert.equal(wasSandboxCreatedHere("sbx-1"), true);
    assert.equal(wasSandboxCreatedHere("daytona/sbx-1"), true);
    assert.equal(wasSandboxCreatedHere("sbx-2"), false);
  });

  it("drops the oldest id once the cap is reached", () => {
    for (let index = 0; index < 10_000; index += 1) markSandboxCreated(`sbx-${index}`);
    assert.equal(wasSandboxCreatedHere("sbx-0"), true);

    markSandboxCreated("sbx-10000");

    assert.equal(wasSandboxCreatedHere("sbx-0"), false, "the oldest id is dropped");
    assert.equal(wasSandboxCreatedHere("sbx-1"), true);
    assert.equal(wasSandboxCreatedHere("sbx-10000"), true);
  });

  it("records every create that passes through the Daytona lifecycle provider", async () => {
    const account = fakeDaytonaAccount();
    const provider = buildProvider(account, false, new Map());
    const id = await provider.create();
    assert.equal(wasSandboxCreatedHere(`daytona/${id}`), true);
  });

  it("marks a created id deleted in either form, and ignores an id it did not create", () => {
    markSandboxCreated("sbx-1");
    assert.equal(createdSandboxState("daytona/sbx-1"), "live");

    markSandboxDeleted("daytona/sbx-1");
    assert.equal(createdSandboxState("sbx-1"), "deleted");
    assert.equal(wasSandboxCreatedHere("sbx-1"), true, "a deleted id is still one this process created");

    markSandboxDeleted("sbx-foreign");
    assert.equal(createdSandboxState("sbx-foreign"), undefined);
    assert.equal(wasSandboxCreatedHere("sbx-foreign"), false, "marking never grants a delete");
  });

  it("never reconnects to an id it deleted, even when the delete threw", async () => {
    markSandboxCreated("sbx-1");
    const logs: string[] = [];
    const log = (message: string) => logs.push(message);
    await teardown({
      sandbox: {
        sandboxId: "daytona/sbx-1",
        destroySandbox: async () => {
          throw new Error("Daytona answered 500");
        },
      },
      plannedSandboxId: undefined,
      isDaytona: true,
      harness: "claude",
      reason: "failed-turn",
      log,
    });
    assert.ok(logs.some((line) => line.startsWith("sandbox delete failed sandbox=daytona/sbx-1")));

    const starts: Array<Record<string, unknown>> = [];
    const acquired = await acquire(
      {
        startOptions: {},
        isDaytona: true,
        harness: "claude",
        sessionForMount: "sess-1",
        runCred: "ApiKey abc",
        log,
        timingLog: () => {},
      },
      {
        startSandboxAgent: async (options) => {
          starts.push(options);
          return { sandboxId: "daytona/sbx-2" };
        },
        readStoredSandboxPointer: async () => ({ sandboxId: "daytona/sbx-1" }),
      },
    );

    assert.equal(acquired.mode, "create");
    assert.deepEqual(starts, [{}], "one start, with no sandbox id");
    assert.ok(
      logs.some((line) => line.includes("stored sandbox=daytona/sbx-1 was deleted by this runner")),
    );
    assert.equal(
      logs.some((line) => line.includes("not created by this runner")),
      false,
    );
  });
});

for (const opaqueSecrets of [true, false]) {
  const label = opaqueSecrets ? "opaque Secrets on" : "opaque Secrets off";

  describe(`reconnect only to a sandbox this process created (${label})`, () => {
    it("creates fresh for a stored id another pod created, and never gets, starts, or deletes it", async () => {
      const account = fakeDaytonaAccount();
      for (const state of ["started", "stopped"]) {
        const foreignId = `sbx-foreign-${state}`;
        account.seedForeign(foreignId, state);

        const turn = await runTurn(account, {
          opaqueSecrets,
          registry: new Map(),
          storedSandboxId: `daytona/${foreignId}`,
          reason: "idle-expiry",
        });

        assert.equal(turn.mode, "create");
        assert.notEqual(turn.sandboxId, `daytona/${foreignId}`);
        assert.equal(account.calls.gets.includes(foreignId), false, "no get");
        assert.equal(account.calls.starts.includes(foreignId), false, "no start");
        assert.equal(account.calls.stops.includes(foreignId), false, "no stop");
        assert.equal(account.calls.deletes.includes(foreignId), false, "no delete");
        assert.equal(account.sandboxes.get(foreignId)?.state, state, "left as its owner had it");
        assert.ok(
          turn.logs.some((line) => line.includes(`was not created by this runner`)),
        );
      }
    });

    it("parks its own sandbox, then reconnects to it on the next turn", async () => {
      const account = fakeDaytonaAccount();
      const registry = new Map();

      const first = await runTurn(account, {
        opaqueSecrets,
        registry,
        storedSandboxId: undefined,
        reason: "idle-expiry",
      });
      assert.equal(first.mode, "create");
      assert.equal(first.sandboxId, "daytona/sbx-1");
      assert.equal(account.sandboxes.get("sbx-1")?.state, "stopped", "parked to stopped");

      const second = await runTurn(account, {
        opaqueSecrets,
        registry,
        storedSandboxId: first.sandboxId,
        reason: "idle-expiry",
      });
      assert.equal(second.mode, "reconnect");
      assert.equal(second.sandboxId, "daytona/sbx-1");
      assert.deepEqual(account.calls.creates, ["sbx-1"], "no second create");
      assert.deepEqual(account.calls.starts, ["sbx-1"], "the stopped sandbox is started");
      assert.deepEqual(account.calls.deletes, []);
    });

    it("after a restart, creates fresh rather than reconnecting, and leaves the old sandbox alone", async () => {
      const account = fakeDaytonaAccount();
      const first = await runTurn(account, {
        opaqueSecrets,
        registry: new Map(),
        storedSandboxId: undefined,
        reason: "idle-expiry",
      });

      const getsBefore = account.calls.gets.length;

      // A new process: an empty set and an empty Secrets registry.
      resetCreatedSandboxIds();
      const second = await runTurn(account, {
        opaqueSecrets,
        registry: new Map(),
        storedSandboxId: first.sandboxId,
        reason: "idle-expiry",
      });

      assert.equal(second.mode, "create");
      assert.equal(second.sandboxId, "daytona/sbx-2");
      assert.equal(account.calls.gets.slice(getsBefore).includes("sbx-1"), false, "no get");
      assert.equal(account.calls.starts.includes("sbx-1"), false, "no start");
      assert.equal(account.calls.deletes.includes("sbx-1"), false, "no delete");
      assert.equal(account.sandboxes.get("sbx-1")?.state, "stopped", "Daytona reclaims it");
    });

    it("still deletes its own sandbox on a deleting teardown", async () => {
      const account = fakeDaytonaAccount();
      await runTurn(account, {
        opaqueSecrets,
        registry: new Map(),
        storedSandboxId: undefined,
        reason: "failed-turn",
      });
      assert.deepEqual(account.calls.deletes, ["sbx-1"]);
    });
  });
}
