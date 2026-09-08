/**
 * Unit tests for materializing a hosted subscription login and pushing a refresh back.
 *
 * The rules under test are the two the design rests on: the newer `expires` always wins, and a
 * write never happens outside Pi's own lock.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-login-materialize.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeLocalSubscriptionLogin,
  mergeSubscriptionAuth,
  pushBackSubscriptionLoginForRun,
  pushSubscriptionLogin,
  readLocalSubscriptionLogin,
  shouldPushSubscriptionLogin,
  subscriptionLoginFrom,
  subscriptionPushState,
} from "../../src/engines/sandbox_agent/subscription-login.ts";
import type { ModelConnectionSubscription } from "../../src/protocol.ts";
import { makeLogin } from "../utils/subscription-login.ts";

// Real-shaped logins, because the runner refuses to publish anything it cannot recognize as a
// ChatGPT credential. `expires` is in the future for the same reason. See tests/utils.
const OLD = makeLogin({ refresh: "old-refresh", expires: Date.now() + 3_600_000 });
const NEW = makeLogin({ refresh: "new-refresh", expires: Date.now() + 7_200_000 });

const SUBSCRIPTION: ModelConnectionSubscription = {
  id: "conn-1",
  slug: "chatgpt",
  provider: "chatgpt",
  version: 3,
  generation: 1,
  login: OLD,
};

const homes: string[] = [];
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "agenta-subscription-test-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

describe("mergeSubscriptionAuth", () => {
  it("writes the delivered login into an empty file", () => {
    const next = mergeSubscriptionAuth("{}", NEW);
    assert.ok(next);
    assert.deepEqual(subscriptionLoginFrom(next), NEW);
  });

  it("replaces a login the delivered one is newer than", () => {
    const current = JSON.stringify({ "openai-codex": OLD });
    const next = mergeSubscriptionAuth(current, NEW);
    assert.deepEqual(subscriptionLoginFrom(next), NEW);
  });

  it("never downgrades a newer login on disk", () => {
    const current = JSON.stringify({ "openai-codex": NEW });
    assert.equal(
      mergeSubscriptionAuth(current, OLD),
      undefined,
      "an older delivered login is not written",
    );
  });

  it("treats an equal expires as nothing to do", () => {
    const current = JSON.stringify({ "openai-codex": NEW });
    assert.equal(mergeSubscriptionAuth(current, { ...NEW }), undefined);
  });

  it("preserves another provider's entry in the same file", () => {
    const current = JSON.stringify({
      anthropic: { type: "oauth", access: "a", refresh: "b", expires: 9 },
      "openai-codex": OLD,
    });
    const next = mergeSubscriptionAuth(current, NEW);
    const parsed = JSON.parse(next!) as Record<string, { access: string }>;
    assert.equal(parsed.anthropic.access, "a");
    assert.equal(parsed["openai-codex"].access, NEW.access);
  });

  it("replaces a half-written file rather than reading it as a newer login", () => {
    const next = mergeSubscriptionAuth('{"openai-codex": {"acce', NEW);
    assert.deepEqual(subscriptionLoginFrom(next), NEW);
  });

  it("refuses a delivered login with no usable expires", () => {
    assert.equal(
      mergeSubscriptionAuth("{}", { ...NEW, expires: undefined as never }),
      undefined,
    );
  });
});

describe("materializeLocalSubscriptionLogin", () => {
  it("writes the login under the lock and leaves the file at mode 0600", async () => {
    const home = tempHome();
    const locked: string[] = [];
    const decision = await materializeLocalSubscriptionLogin(
      home,
      { login: NEW, version: 4, generation: 1 },
      () => {},
      {
        lock: (async (path: string) => {
          locked.push(path);
          return async () => {};
        }) as never,
      },
    );

    assert.equal(decision.write, true);
    assert.deepEqual(
      locked,
      [join(home, "auth.json")],
      "the lock is taken on the auth file itself, the path Pi locks",
    );
    assert.deepEqual(
      subscriptionLoginFrom(readFileSync(join(home, "auth.json"), "utf-8")),
      NEW,
    );
    assert.equal(statSync(join(home, "auth.json")).mode & 0o777, 0o600);
  });

  it("leaves a newer login on disk alone", async () => {
    const home = tempHome();
    writeFileSync(
      join(home, "auth.json"),
      JSON.stringify({ "openai-codex": NEW }),
      { mode: 0o600 },
    );

    const decision = await materializeLocalSubscriptionLogin(
      home,
      { login: OLD, version: 3, generation: 1 },
      () => {},
    );

    assert.equal(decision.write, false);
    assert.equal(decision.reason, "not-newer");
    assert.deepEqual(await readLocalSubscriptionLogin(home), NEW);
  });

  it("takes the real lock, so a concurrent materialize serializes", async () => {
    const home = tempHome();
    // Two writers, the newer one second. Whatever the order, the newer login must survive.
    await Promise.all([
      materializeLocalSubscriptionLogin(
        home,
        { login: NEW, version: 4, generation: 1 },
        () => {},
      ),
      materializeLocalSubscriptionLogin(
        home,
        { login: OLD, version: 3, generation: 1 },
        () => {},
      ),
    ]);
    assert.deepEqual(await readLocalSubscriptionLogin(home), NEW);
  });
});

describe("shouldPushSubscriptionLogin", () => {
  it("pushes a login newer than the delivered one", () => {
    const state = subscriptionPushState(SUBSCRIPTION);
    assert.equal(shouldPushSubscriptionLogin(state, NEW), true);
  });

  it("does not push the login it was handed", () => {
    const state = subscriptionPushState(SUBSCRIPTION);
    assert.equal(shouldPushSubscriptionLogin(state, OLD), false);
  });

  it("does not push the same refresh twice", () => {
    const state = subscriptionPushState(SUBSCRIPTION);
    state.pushedExpires = NEW.expires;
    assert.equal(shouldPushSubscriptionLogin(state, NEW), false);
    assert.equal(
      shouldPushSubscriptionLogin(state, { ...NEW, expires: NEW.expires + 1 }),
      true,
    );
  });

  it("does not push a login with no usable expires", () => {
    const state = subscriptionPushState(SUBSCRIPTION);
    assert.equal(shouldPushSubscriptionLogin(state, undefined), false);
    assert.equal(
      shouldPushSubscriptionLogin(state, { ...NEW, expires: "soon" as never }),
      false,
    );
  });
});

describe("pushSubscriptionLogin", () => {
  it("posts the login with the delivered version and records the returned one", async () => {
    const state = subscriptionPushState(SUBSCRIPTION);
    const calls: Array<{ url: string; body: unknown; auth: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(String(init.body)),
        auth: (init.headers as Record<string, string>).authorization,
      });
      return new Response(JSON.stringify({ version: 4, updated: true }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await pushSubscriptionLogin(SUBSCRIPTION, state, NEW, {
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
    });

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "http://api:8000/secrets/conn-1/subscription-login",
    );
    assert.deepEqual(calls[0].body, {
      login: NEW,
      version: 3,
      generation: 1,
    });
    assert.equal(calls[0].auth, "ApiKey secret");
    assert.equal(state.version, 4);
    assert.equal(state.pushedExpires, NEW.expires);
  });

  it("swallows a failed push and does not mark it pushed", async () => {
    const state = subscriptionPushState(SUBSCRIPTION);
    const fetchImpl = (async () =>
      new Response("nope", { status: 404 })) as unknown as typeof fetch;

    await pushSubscriptionLogin(SUBSCRIPTION, state, NEW, {
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
    });

    assert.equal(state.pushedExpires, undefined);
    assert.equal(state.version, 3);
  });

  it("never puts the login or the API body in the log", async () => {
    const state = subscriptionPushState(SUBSCRIPTION);
    const lines: string[] = [];
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ detail: "account acct_1 mismatch" }), {
        status: 409,
      })) as unknown as typeof fetch;

    await pushSubscriptionLogin(SUBSCRIPTION, state, NEW, {
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: (line) => lines.push(line),
    });

    const joined = lines.join("\n");
    assert.match(joined, /status=409/);
    for (const secret of [NEW.access, NEW.refresh, "acct_1", "ApiKey secret"]) {
      assert.ok(!joined.includes(secret), `log leaked ${secret}`);
    }
  });
});

describe("pushBackSubscriptionLoginForRun", () => {
  it("pushes the refreshed login a local turn left on disk", async () => {
    const home = tempHome();
    writeFileSync(
      join(home, "auth.json"),
      JSON.stringify({ "openai-codex": NEW }),
      { mode: 0o600 },
    );
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ version: 4 }), { status: 200 });
    }) as unknown as typeof fetch;
    const state = subscriptionPushState(SUBSCRIPTION);

    await pushBackSubscriptionLoginForRun({
      plan: {
        isDaytona: false,
        credentials: { subscription: SUBSCRIPTION, subscriptionHome: home },
      },
      state,
      sandbox: undefined,
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
    });

    assert.deepEqual(bodies, [{ login: NEW, version: 3, generation: 1 }]);

    // A second turn that found no newer login must not re-send the same one.
    await pushBackSubscriptionLoginForRun({
      plan: {
        isDaytona: false,
        credentials: { subscription: SUBSCRIPTION, subscriptionHome: home },
      },
      state,
      sandbox: undefined,
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
    });
    assert.equal(bodies.length, 1);
  });

  /**
   * THE LIVE DEFECT, pinned. On Daytona the read-back goes through the sandbox file API, which
   * answers with BYTES. This module's own type said `Promise<string>`, so `subscriptionLoginFrom`
   * ran `raw?.trim()` on a Buffer and threw `TypeError: raw?.trim is not a function` — inside the
   * one catch that exists to keep a push failure from failing a finished turn. The turn stayed
   * green and the token Pi had just refreshed inside the sandbox was silently dropped. Observed on
   * three real product turns on 2026-09-08.
   *
   * The fake therefore returns bytes. A string fake is what let this through every earlier test.
   */
  it("pushes a login the sandbox returns as BYTES, not text", async () => {
    const home = "/home/sandbox/agenta/subscriptions/conn-1";
    const bodies: unknown[] = [];
    const lines: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ version: 4 }), { status: 200 });
    }) as unknown as typeof fetch;
    const sandbox = {
      mkdirFs: async () => undefined,
      writeFsFile: async () => undefined,
      readFsFile: async ({ path }: { path: string }) =>
        path.endsWith("auth.json")
          ? Buffer.from(JSON.stringify({ "openai-codex": NEW }), "utf-8")
          : Buffer.from("{}", "utf-8"),
    };

    await pushBackSubscriptionLoginForRun({
      plan: {
        isDaytona: true,
        credentials: { subscription: SUBSCRIPTION, subscriptionHome: home },
      },
      state: subscriptionPushState(SUBSCRIPTION),
      sandbox,
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: (line) => lines.push(line),
    });

    assert.deepEqual(bodies, [{ login: NEW, version: 3, generation: 1 }]);
    assert.ok(
      !lines.join("\n").includes("read-back failed"),
      "the read-back must not throw on bytes",
    );
  });

  it("survives a sandbox whose read answers something undecodable", async () => {
    // Not a crash and not a coercion: `String(someObject)` would hand plausible garbage to the
    // parser. A miss costs one publish; the turn-end and next-run pushes still cover it.
    const bodies: unknown[] = [];
    const fetchImpl = (async () =>
      new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await pushBackSubscriptionLoginForRun({
      plan: {
        isDaytona: true,
        credentials: {
          subscription: SUBSCRIPTION,
          subscriptionHome: "/home/sandbox/agenta/subscriptions/conn-1",
        },
      },
      state: subscriptionPushState(SUBSCRIPTION),
      sandbox: {
        mkdirFs: async () => undefined,
        writeFsFile: async () => undefined,
        readFsFile: async () => ({ unexpected: true }),
      },
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
    });
    assert.deepEqual(bodies, []);
  });

  it("does nothing for a run that carries no subscription", async () => {
    let called = false;
    await pushBackSubscriptionLoginForRun({
      plan: { isDaytona: false, credentials: {} },
      state: undefined,
      sandbox: undefined,
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      log: () => {
        called = true;
      },
    });
    assert.equal(called, false);
  });
});
