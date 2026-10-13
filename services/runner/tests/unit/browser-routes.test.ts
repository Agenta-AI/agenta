// The `/browser/ensure|find|delete` routes with a fake lifecycle, plus the label and per-key-lock logic.
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  browserLabels,
  oncePerKey,
  setBrowserLifecycle,
  type BrowserDeleteTarget,
  type BrowserKey,
  type BrowserLifecycle,
} from "../../src/browser/lifecycle.ts";
import { createAgentServer, type RunAgent } from "../../src/server.ts";

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const previousToken = process.env[TOKEN_ENV];
const AUTH = {
  authorization: "Bearer test-runner-token",
  "content-type": "application/json",
};

const KEY: BrowserKey = {
  projectId: "proj-1",
  scope: "session",
  ref: "sess-1",
  profileId: "prof-1",
};

describe("browserLabels", () => {
  it("labels a browser by all four ids", () => {
    assert.deepEqual(browserLabels(KEY), {
      "agenta-browser-project": "proj-1",
      "agenta-browser-scope": "session",
      "agenta-browser-ref": "sess-1",
      "agenta-browser-profile": "prof-1",
    });
  });

  it("finds every browser of a profile by project and profile only", () => {
    assert.deepEqual(
      browserLabels({ projectId: "proj-1", profileId: "prof-1" }),
      {
        "agenta-browser-project": "proj-1",
        "agenta-browser-profile": "prof-1",
      },
    );
  });
});

describe("oncePerKey", () => {
  it("runs concurrent calls for one key once, and other keys separately", async () => {
    const calls: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ensure = oncePerKey(async (key: BrowserKey) => {
      calls.push(key.ref);
      await gate;
      return `sandbox-${key.ref}-${calls.length}`;
    });

    const first = ensure(KEY);
    const second = ensure({ ...KEY });
    const other = ensure({ ...KEY, ref: "sess-2" });
    release();

    assert.deepEqual(await Promise.all([first, second, other]), [
      "sandbox-sess-1-2",
      "sandbox-sess-1-2",
      "sandbox-sess-2-2",
    ]);
    assert.deepEqual(calls, ["sess-1", "sess-2"]);
    assert.equal(
      await ensure(KEY),
      "sandbox-sess-1-3",
      "a finished run frees the key",
    );
  });
});

describe("/browser routes", () => {
  let server: Server;
  let base: string;
  let removed: BrowserDeleteTarget[];
  let running: boolean;

  beforeEach(async () => {
    process.env[TOKEN_ENV] = "test-runner-token";
    removed = [];
    running = true;
    const fake: BrowserLifecycle = {
      ensure: async (key) => ({
        sandboxId: `sb-${key.ref}`,
        url: "https://8790-sb.example",
        headers: { "x-daytona-preview-token": "pt" },
      }),
      find: async (key) =>
        running
          ? {
              sandboxId: `sb-${key.ref}`,
              url: "https://8790-sb.example",
              headers: { "x-daytona-preview-token": "pt" },
            }
          : undefined,
      remove: async (target) => {
        removed.push(target);
      },
    };
    setBrowserLifecycle(fake);
    const notUsed: RunAgent = async () =>
      ({ ok: false, error: "not used" }) as never;
    server = createAgentServer(notUsed);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    setBrowserLifecycle(undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousToken === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = previousToken;
  });

  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = AUTH,
  ) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

  it("ensures a browser and returns its endpoint", async () => {
    const res = await post("/browser/ensure", KEY);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), {
      sandboxId: "sb-sess-1",
      url: "https://8790-sb.example",
      headers: { "x-daytona-preview-token": "pt" },
    });
  });

  it("answers find with 404 when no browser runs", async () => {
    running = false;

    const res = await post("/browser/find", KEY);

    assert.equal(res.status, 404);
  });

  it("finds a browser only by its full key, owner included", async () => {
    let seen: unknown;
    setBrowserLifecycle({
      ensure: async () => {
        throw new Error("not used");
      },
      find: async (key) => {
        seen = key;
        return {
          sandboxId: "sb-1",
          url: "https://8790-sb.example",
          headers: {},
          profileId: "user-1",
        };
      },
      remove: async () => {},
    });
    const session = { projectId: "proj-1", scope: "session", ref: "sess-1" };

    assert.equal((await post("/browser/find", session)).status, 400);
    assert.equal((await post("/browser/ensure", session)).status, 400);
    const res = await post("/browser/find", {
      ...session,
      profileId: "user-1",
    });

    assert.equal(res.status, 200);
    assert.deepEqual(seen, { ...session, profileId: "user-1" });
  });

  it("deletes one owner's browser of a key", async () => {
    const res = await post("/browser/delete", {
      projectId: "proj-1",
      scope: "session",
      ref: "sess-1",
      profileId: "user-1",
    });

    assert.equal(res.status, 204);
    assert.deepEqual(removed, [
      {
        projectId: "proj-1",
        scope: "session",
        ref: "sess-1",
        profileId: "user-1",
      },
    ]);
  });

  it("deletes by profile", async () => {
    const res = await post("/browser/delete", {
      projectId: "proj-1",
      profileId: "prof-1",
    });

    assert.equal(res.status, 204);
    assert.deepEqual(removed, [{ projectId: "proj-1", profileId: "prof-1" }]);
  });

  it("refuses a key with a missing or unknown field", async () => {
    assert.equal(
      (await post("/browser/ensure", { ...KEY, scope: "tab" })).status,
      400,
    );
    assert.equal(
      (await post("/browser/find", { ...KEY, profileId: " " })).status,
      400,
    );
    assert.equal(
      (await post("/browser/delete", { projectId: "proj-1", scope: "session" }))
        .status,
      400,
    );
    assert.deepEqual(removed, []);
  });

  it("needs the runner token and POST", async () => {
    assert.equal(
      (
        await post("/browser/ensure", KEY, {
          "content-type": "application/json",
        })
      ).status,
      401,
    );
    assert.equal(
      (await fetch(`${base}/browser/ensure`, { headers: AUTH })).status,
      405,
    );
    assert.equal((await post("/browser/other", KEY)).status, 404);
  });

  it("reports a lifecycle failure as 502", async () => {
    setBrowserLifecycle({
      ensure: async () => {
        throw new Error("Daytona did not answer");
      },
      find: async () => undefined,
      remove: async () => {},
    });

    const res = await post("/browser/ensure", KEY);

    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), {
      ok: false,
      error: "Daytona did not answer",
    });
  });
});
