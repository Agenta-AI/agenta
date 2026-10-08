/**
 * `/kill` deletes every sandbox the session's labels list, whichever pod created it.
 *
 * `deleteLabelledSandboxes` is driven with a fake dependency set for the loop rules. The Secrets
 * rule is driven through `daytonaKillDependencies` over a fake Daytona client and the REAL
 * process-local Secrets wrapper, so a sandbox this process created through the wrapper has a real
 * allocation in the registry and a foreign one has none.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/kill-by-label.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";

import { parseRunnerConfig } from "../../src/config/runner-config.ts";
import {
  daytonaKillDependencies,
  deleteLabelledSandboxes,
  sweepSessionSandboxes,
  type DaytonaKillClient,
  type KillSandboxDependencies,
  type LabelledSandbox,
} from "../../src/engines/sandbox_agent/kill-by-label.ts";
import { daytonaWithProcessLocalSecrets } from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
import type { DaytonaSecretPlan } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import type { DaytonaSecretApi } from "../../src/engines/sandbox_agent/daytona-secrets.ts";
import { sessionSandboxLabels } from "../../src/engines/sandbox_agent/sandbox-labels.ts";

const SCOPE = { projectId: "project-1", sessionId: "session-1" };
const LABELS = sessionSandboxLabels(SCOPE.projectId, SCOPE.sessionId);

const labelled = (id: string): LabelledSandbox => ({ id, labels: LABELS });

/** A dependency set whose list returns `sandboxes` and whose deletes are recorded in order. */
function fakeDependencies(
  sandboxes: LabelledSandbox[],
  options: {
    holds?: (id: string) => boolean;
    failDeleteOf?: (id: string) => boolean;
  } = {},
) {
  const events: string[] = [];
  const listed: Array<Record<string, string>> = [];
  const logs: string[] = [];
  const dependencies: KillSandboxDependencies = {
    async *list(labels) {
      listed.push(labels);
      for (const sandbox of sandboxes) yield sandbox;
    },
    async deletePlain(id) {
      events.push(`plain:${id}`);
      if (options.failDeleteOf?.(id)) throw new Error(`daytona refused ${id}`);
    },
    holdsSecrets: (id) => options.holds?.(id) ?? false,
    async deleteWithSecrets(id) {
      events.push(`with-secrets:${id}`);
      if (options.failDeleteOf?.(id)) throw new Error(`daytona refused ${id}`);
    },
    log: (message) => logs.push(message),
  };
  return { dependencies, events, listed, logs };
}

describe("deleteLabelledSandboxes", () => {
  it("a pod with no pool entry deletes every sandbox the label list returns", async () => {
    const { dependencies, events, listed } = fakeDependencies([
      labelled("sbx-a"),
      labelled("sbx-b"),
      labelled("sbx-c"),
    ]);

    const result = await deleteLabelledSandboxes(SCOPE, dependencies);

    assert.deepEqual(listed, [
      { "agenta.project": "project-1", "agenta.conversation": "session-1" },
    ]);
    assert.deepEqual([...events].sort(), [
      "plain:sbx-a",
      "plain:sbx-b",
      "plain:sbx-c",
    ]);
    assert.deepEqual(result, { listed: 3, deleted: 3, failed: 0 });
  });

  it("deletes nothing the list returned without both labels of this session", async () => {
    const { dependencies, events } = fakeDependencies([
      labelled("sbx-ours"),
      { id: "sbx-other-session", labels: { ...LABELS, "agenta.conversation": "session-2" } },
      { id: "sbx-other-project", labels: { ...LABELS, "agenta.project": "project-2" } },
      { id: "sbx-no-labels" },
    ]);

    await deleteLabelledSandboxes(SCOPE, dependencies);

    assert.deepEqual(events, ["plain:sbx-ours"]);
  });

  it.each([
    ["an empty project id", { projectId: "", sessionId: "session-1" }],
    ["a blank project id", { projectId: "  ", sessionId: "session-1" }],
    ["an empty session id", { projectId: "project-1", sessionId: "" }],
    ["a blank session id", { projectId: "project-1", sessionId: " " }],
  ])("refuses %s without listing or deleting", async (_name, scope) => {
    const { dependencies, events, listed, logs } = fakeDependencies([labelled("sbx-a")]);

    const result = await deleteLabelledSandboxes(scope, dependencies);

    assert.deepEqual(listed, []);
    assert.deepEqual(events, []);
    assert.deepEqual(result, { listed: 0, deleted: 0, failed: 0 });
    assert.equal(logs.length, 1);
  });

  it("skips a sandbox that is already being destroyed", async () => {
    const { dependencies, events } = fakeDependencies([
      { ...labelled("sbx-live"), state: "started" },
      { ...labelled("sbx-stopped"), state: "stopped" },
      { ...labelled("sbx-destroying"), state: "destroying" },
      { ...labelled("sbx-destroyed"), state: "destroyed" },
    ]);

    const result = await deleteLabelledSandboxes(SCOPE, dependencies);

    assert.deepEqual([...events].sort(), ["plain:sbx-live", "plain:sbx-stopped"]);
    assert.deepEqual(result, { listed: 2, deleted: 2, failed: 0 });
  });

  it("a failed delete is logged and does not stop the others", async () => {
    const { dependencies, events, logs } = fakeDependencies(
      [labelled("sbx-a"), labelled("sbx-b"), labelled("sbx-c")],
      { failDeleteOf: (id) => id === "sbx-a" },
    );

    const result = await deleteLabelledSandboxes(SCOPE, dependencies);

    assert.deepEqual([...events].sort(), [
      "plain:sbx-a",
      "plain:sbx-b",
      "plain:sbx-c",
    ]);
    assert.deepEqual(result, { listed: 3, deleted: 2, failed: 1 });
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /sandbox=sbx-a/);
  });

  it("routes a sandbox whose allocation this pod holds through the Secret-aware delete", async () => {
    const { dependencies, events } = fakeDependencies(
      [labelled("sbx-held"), labelled("sbx-foreign")],
      { holds: (id) => id === "sbx-held" },
    );

    await deleteLabelledSandboxes(SCOPE, dependencies);

    assert.deepEqual([...events].sort(), [
      "plain:sbx-foreign",
      "with-secrets:sbx-held",
    ]);
  });

  it("a list that answers after the signal aborts starts no delete", async () => {
    const { dependencies, events } = fakeDependencies([]);
    const controller = new AbortController();
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    dependencies.list = async function* () {
      await answered;
      yield labelled("sbx-a");
      yield labelled("sbx-b");
    };

    const sweep = deleteLabelledSandboxes(SCOPE, dependencies, controller.signal);
    controller.abort();
    answer();

    await assert.rejects(sweep, { name: "AbortError" });
    assert.deepEqual(events, []);
  });

  it("a signal that aborted before the sweep starts no list and no delete", async () => {
    const { dependencies, events, listed } = fakeDependencies([labelled("sbx-a")]);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      deleteLabelledSandboxes(SCOPE, dependencies, controller.signal),
      { name: "AbortError" },
    );
    assert.deepEqual(listed, []);
    assert.deepEqual(events, []);
  });

  it("reads no further list page after the signal aborts", async () => {
    const { dependencies, events } = fakeDependencies([]);
    const controller = new AbortController();
    let secondPageRead = false;
    let iteratorClosed = false;
    dependencies.list = async function* () {
      try {
        yield labelled("sbx-a");
        controller.abort();
        yield labelled("sbx-b");
        secondPageRead = true;
        yield labelled("sbx-c");
      } finally {
        iteratorClosed = true;
      }
    };

    await assert.rejects(
      deleteLabelledSandboxes(SCOPE, dependencies, controller.signal),
      { name: "AbortError" },
    );
    assert.equal(secondPageRead, false);
    assert.equal(iteratorClosed, true);
    assert.deepEqual(events, []);
  });

  it("a list that ends after the signal aborts starts no delete", async () => {
    const { dependencies, events } = fakeDependencies([]);
    const controller = new AbortController();
    let end!: () => void;
    const ended = new Promise<void>((resolve) => (end = resolve));
    dependencies.list = async function* () {
      yield labelled("sbx-a");
      await ended;
    };

    const sweep = deleteLabelledSandboxes(SCOPE, dependencies, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    end();

    await assert.rejects(sweep, { name: "AbortError" });
    assert.deepEqual(events, []);
  });

  it("a delete started before the signal aborts still completes", async () => {
    const { dependencies, events } = fakeDependencies([labelled("sbx-a")]);
    const controller = new AbortController();
    let deleteStarted!: () => void;
    const started = new Promise<void>((resolve) => (deleteStarted = resolve));
    let finish!: () => void;
    dependencies.deletePlain = async (id) => {
      deleteStarted();
      await new Promise<void>((resolve) => (finish = resolve));
      events.push(`plain:${id}`);
    };

    const sweep = deleteLabelledSandboxes(SCOPE, dependencies, controller.signal);
    await started;
    controller.abort();
    finish();

    assert.deepEqual(await sweep, { listed: 1, deleted: 1, failed: 0 });
    assert.deepEqual(events, ["plain:sbx-a"]);
  });
});

describe("sweepSessionSandboxes", () => {
  it("deletes every listed sandbox before the deadline and logs the counts", async () => {
    const { dependencies, events, logs } = fakeDependencies([
      labelled("sbx-a"),
      labelled("sbx-b"),
    ]);

    await sweepSessionSandboxes(SCOPE, dependencies, AbortSignal.timeout(1_000));

    assert.deepEqual([...events].sort(), ["plain:sbx-a", "plain:sbx-b"]);
    assert.deepEqual(logs, [
      "kill: session=session-1 listed=2 deleted=2 failed=0",
    ]);
  });

  it("a list that answers after the deadline starts no delete", async () => {
    const { dependencies, events, logs } = fakeDependencies([]);
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    dependencies.list = async function* () {
      await answered;
      yield labelled("sbx-late");
    };

    await sweepSessionSandboxes(SCOPE, dependencies, AbortSignal.timeout(30));
    answer();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(events, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /deadline passed during the label sweep.*starts no further delete/);
  });

  it("returns at the deadline when the list does not answer, and logs it", async () => {
    const { dependencies, logs } = fakeDependencies([]);
    dependencies.list = () => ({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
    });

    const started = Date.now();
    await sweepSessionSandboxes(SCOPE, dependencies, AbortSignal.timeout(30));

    assert.ok(Date.now() - started < 1_000);
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /deadline passed during the label sweep/);
  });

  it("lets a delete that started before the deadline finish in the background", async () => {
    const { dependencies, events } = fakeDependencies([labelled("sbx-slow")]);
    let finish!: () => void;
    dependencies.deletePlain = async (id) => {
      await new Promise<void>((resolve) => (finish = resolve));
      events.push(`plain:${id}`);
    };

    await sweepSessionSandboxes(SCOPE, dependencies, AbortSignal.timeout(30));
    assert.deepEqual(events, []);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(events, ["plain:sbx-slow"]);
  });

  it("a deadline that passed before the sweep lists nothing, deletes nothing, and logs it", async () => {
    const { dependencies, events, listed, logs } = fakeDependencies([
      labelled("sbx-new-turn"),
    ]);
    const controller = new AbortController();
    controller.abort();

    await sweepSessionSandboxes(SCOPE, dependencies, controller.signal);

    assert.deepEqual(listed, []);
    assert.deepEqual(events, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /deadline passed before the label sweep session=session-1/);
  });

  it("logs a failed list and does not throw", async () => {
    const { dependencies, logs } = fakeDependencies([]);
    dependencies.list = () => {
      throw new Error("list refused");
    };

    await sweepSessionSandboxes(SCOPE, dependencies, AbortSignal.timeout(1_000));

    assert.match(logs.join("\n"), /label inventory failed.*list refused/);
  });

  it("does nothing without Daytona dependencies", async () => {
    await sweepSessionSandboxes(SCOPE, undefined, AbortSignal.timeout(30));
  });
});

/** A fake vault; `events` is where the order of sandbox and Secret deletes is read. */
function secretApi(events: string[]): DaytonaSecretApi {
  let count = 0;
  return {
    async create(input) {
      count += 1;
      return {
        id: `secret-${count}`,
        name: input.name,
        placeholder: `dtn_secret_${count}`,
        hosts: input.hosts,
      };
    },
    async update(id) {
      return { id, placeholder: "unused" };
    },
    async delete(id) {
      events.push(`secret:delete:${id}`);
    },
  };
}

const plan: DaytonaSecretPlan = {
  environment: {},
  candidates: [
    {
      ordinal: 0,
      consumer: { kind: "model" },
      binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
      allowedHost: "api.anthropic.com",
      value: "model-plaintext",
    },
  ],
};

describe("daytonaKillDependencies over the Daytona client", () => {
  const ambient = {
    key: process.env.DAYTONA_API_KEY,
    url: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET,
  };
  beforeEach(() => {
    delete process.env.DAYTONA_API_KEY;
  });
  afterEach(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("DAYTONA_API_KEY", ambient.key);
    restore("DAYTONA_API_URL", ambient.url);
    restore("DAYTONA_TARGET", ambient.target);
  });

  const daytonaConfig = () =>
    parseRunnerConfig({
      AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "daytona",
      AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona",
      AGENTA_RUNNER_DAYTONA_API_KEY: "test-key",
    });

  /** A fake Daytona account: `existing` are the sandboxes it knows; get and delete record calls. */
  function fakeClient(existing: string[], events: string[], secrets: DaytonaSecretApi) {
    const known = new Set(existing);
    const listQueries: unknown[] = [];
    const client = {
      async get(id: string) {
        if (!known.has(id)) throw { statusCode: 404 };
        return {
          id,
          async delete() {
            if (!known.delete(id)) throw { statusCode: 404 };
            events.push(`sandbox:delete:${id}`);
          },
        };
      },
      async *list(query: unknown) {
        listQueries.push(query);
        for (const id of existing) yield { id, labels: LABELS };
      },
      secret: secrets,
    } as unknown as DaytonaKillClient;
    return { client, listQueries };
  }

  it("returns nothing when this runner has no Daytona (local only)", () => {
    assert.equal(
      daytonaKillDependencies(parseRunnerConfig({}), () => {}, () => {
        throw new Error("no client may be built without Daytona");
      }),
      undefined,
    );
  });

  it("returns dependencies for a runner with only local and inprocess, which holds the Daytona key", () => {
    const config = parseRunnerConfig({
      AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,inprocess",
      AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "local",
      AGENTA_RUNNER_DAYTONA_API_KEY: "test-key",
    });
    assert.ok(!config.providers.enabled.includes("daytona"));
    assert.ok(
      daytonaKillDependencies(config, () => {}, () => fakeClient([], [], secretApi([])).client),
    );
  });

  it("lists by both labels and counts a sandbox that is already gone as deleted", async () => {
    const events: string[] = [];
    const { client, listQueries } = fakeClient(["sbx-live", "sbx-gone"], events, secretApi(events));
    // `sbx-gone` is listed, then vanishes before the delete lands.
    const dependencies = daytonaKillDependencies(daytonaConfig(), () => {}, () => ({
      ...client,
      get: async (id: string) => {
        if (id === "sbx-gone") throw { statusCode: 404 };
        return client.get(id);
      },
    }) as DaytonaKillClient)!;

    const result = await deleteLabelledSandboxes(SCOPE, dependencies);

    assert.deepEqual(listQueries, [{ labels: LABELS }]);
    assert.deepEqual(events, ["sandbox:delete:sbx-live"]);
    assert.deepEqual(result, { listed: 2, deleted: 2, failed: 0 });
  });

  it("deletes Secrets only for a sandbox whose allocation this pod holds", async () => {
    const events: string[] = [];
    const secrets = secretApi(events);
    const { client } = fakeClient(["sbx-held", "sbx-foreign"], events, secrets);
    // This process creates `sbx-held` through the wrapper: it now holds that allocation.
    const creator = daytonaWithProcessLocalSecrets(
      () => ({
        name: "daytona",
        create: async () => "sbx-held",
        destroy: async () => {
          throw new Error("the creator is not used to delete");
        },
      }),
      plan,
      secrets,
      { createFingerprint: "generation", cleanupDelayMilliseconds: 60_000 },
    );
    assert.equal(await creator.create(), "sbx-held");

    const dependencies = daytonaKillDependencies(daytonaConfig(), () => {}, () => client)!;
    const result = await deleteLabelledSandboxes(SCOPE, dependencies);

    assert.deepEqual(result, { listed: 2, deleted: 2, failed: 0 });
    // The held sandbox is deleted first and then its Secret. The foreign one has no Secret delete.
    assert.deepEqual(
      events.filter((event) => event.includes("sbx-held") || event.startsWith("secret:")),
      ["sandbox:delete:sbx-held", "secret:delete:secret-1"],
    );
    assert.ok(events.includes("sandbox:delete:sbx-foreign"));
    assert.equal(events.filter((event) => event.startsWith("secret:")).length, 1);
  });
});
