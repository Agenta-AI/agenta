// Backend choice, and the local backend's child-process lifecycle with a fake controller script.
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  createBrowserLifecycle,
  LocalBrowserLifecycle,
} from "../../src/browser/lifecycle.ts";
import { parseRunnerConfig } from "../../src/config/runner-config.ts";

const FAKE_CONTROLLER = fileURLToPath(
  new URL("../utils/fake-browser-controller.cjs", import.meta.url),
);
const KEY = {
  projectId: "proj-1",
  scope: "session",
  ref: "sess-1",
  profileId: "prof-1",
} as const;
const OTHER = { ...KEY, ref: "sess-2" } as const;

describe("createBrowserLifecycle", () => {
  it("runs browsers in the runner when the local provider is enabled", () => {
    const config = parseRunnerConfig({
      AGENTA_RUNNER_TOKEN: "t",
      AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,daytona",
      AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona",
      AGENTA_RUNNER_DAYTONA_API_KEY: "k",
    });
    assert.ok(createBrowserLifecycle(config) instanceof LocalBrowserLifecycle);
  });

  it("uses Daytona when only Daytona is enabled", () => {
    const config = parseRunnerConfig({
      AGENTA_RUNNER_TOKEN: "t",
      AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "daytona",
      AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona",
      AGENTA_RUNNER_DAYTONA_API_KEY: "k",
    });
    assert.ok(
      !(createBrowserLifecycle(config) instanceof LocalBrowserLifecycle),
    );
  });
});

describe("LocalBrowserLifecycle", () => {
  let lifecycle: LocalBrowserLifecycle | undefined;
  afterEach(async () => {
    await lifecycle?.remove({ projectId: "proj-1", profileId: "prof-1" });
  });

  it("starts one controller per key and returns a URL the token opens", async () => {
    lifecycle = new LocalBrowserLifecycle("127.0.0.1", FAKE_CONTROLLER);
    const [a, b] = await Promise.all([
      lifecycle.ensure(KEY),
      lifecycle.ensure(KEY),
    ]);
    assert.deepEqual(a, b);
    assert.match(a.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const opened = await fetch(`${a.url}/health`, { headers: a.headers });
    assert.equal(opened.status, 200);
    const refused = await fetch(`${a.url}/health`);
    assert.equal(refused.status, 401);

    const other = await lifecycle.ensure(OTHER);
    assert.notEqual(other.url, a.url);
    assert.deepEqual(await lifecycle.find(KEY), a);
    assert.equal(a.profileId, "prof-1");
  });

  it("keeps one browser per owner of a session and removes only the named one", async () => {
    lifecycle = new LocalBrowserLifecycle("127.0.0.1", FAKE_CONTROLLER);
    const mine = await lifecycle.ensure(KEY);
    const theirs = await lifecycle.ensure({ ...KEY, profileId: "prof-2" });
    assert.notEqual(theirs.url, mine.url);
    assert.deepEqual(await lifecycle.find(KEY), mine);

    await lifecycle.remove({
      projectId: KEY.projectId,
      scope: KEY.scope,
      ref: KEY.ref,
      profileId: "prof-2",
    });

    assert.deepEqual(await lifecycle.find(KEY), mine);
    assert.equal(
      await lifecycle.find({ ...KEY, profileId: "prof-2" }),
      undefined,
    );
  });
  it("forgets a removed browser", async () => {
    lifecycle = new LocalBrowserLifecycle("127.0.0.1", FAKE_CONTROLLER);
    const endpoint = await lifecycle.ensure(KEY);
    await lifecycle.remove({
      projectId: "proj-1",
      scope: "session",
      ref: "sess-1",
    });
    assert.equal(await lifecycle.find(KEY), undefined);
    await assert.rejects(
      fetch(`${endpoint.url}/health`, { headers: endpoint.headers }),
    );
  });
});
