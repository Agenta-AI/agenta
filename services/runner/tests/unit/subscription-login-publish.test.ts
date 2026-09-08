/**
 * Unit tests for the one operation that publishes a refreshed subscription login.
 *
 * What these pin is a data-loss rule, not a convenience. Pi refreshes its OAuth token mid-turn and
 * writes the new pair into `auth.json`. That file is then the ONLY copy of a live credential: the
 * delivered refresh token has been spent and the provider rotated it away. So a reconciliation pass
 * publishes anything the API has not acknowledged, it runs again while the session lives, it
 * retries what a failed call left unacknowledged, and it takes one last sample before the agent dir
 * or the sandbox goes.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-login-publish.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  reportSubscriptionLoginFailure,
  startSubscriptionPublisher,
  subscriptionPublishState,
  type SubscriptionPublisher,
  type SubscriptionPublishState,
} from "../../src/engines/sandbox_agent/subscription-login/publisher.ts";
import type { SubscriptionSandboxFs } from "../../src/engines/sandbox_agent/subscription-login/files.ts";
import type {
  ModelConnectionSubscription,
  SubscriptionLogin,
} from "../../src/protocol.ts";
import { makeLogin } from "../utils/subscription-login.ts";

// Real-shaped logins, because the runner refuses to publish anything it cannot recognize as a
// ChatGPT credential. The two carry payloads of IDENTICAL length, which is what a size-and-mtime
// change signal could not tell apart. See tests/utils.
const DELIVERED: SubscriptionLogin = makeLogin({
  refresh: "delivered-refresh",
  expires: Date.now() + 3_600_000,
});
const REFRESHED: SubscriptionLogin = makeLogin({
  refresh: "refreshed-refresh",
  expires: Date.now() + 7_200_000,
});
/** A rotation the provider issued with the SAME expiry. The API accepts it; so must the runner. */
const ROTATED: SubscriptionLogin = makeLogin({
  refresh: "rotated-refreshxx",
  expires: DELIVERED.expires,
});

const SUBSCRIPTION: ModelConnectionSubscription = {
  id: "conn-1",
  slug: "chatgpt",
  provider: "chatgpt",
  version: 3,
  generation: 1,
  login: DELIVERED,
};

const homes: string[] = [];
const running: SubscriptionPublisher[] = [];
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "agenta-subscription-publish-"));
  homes.push(home);
  return home;
}
afterEach(async () => {
  while (running.length) await running.pop()!.stop();
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

function writeLogin(home: string, login: SubscriptionLogin): void {
  writeFileSync(join(home, "auth.json"), JSON.stringify({ "openai-codex": login }), {
    mode: 0o600,
  });
}

/** Every body the API sent back, in order, plus the logins it was asked to store. */
interface FakeApi {
  fetchImpl: typeof fetch;
  pushed: SubscriptionLogin[];
  bodies: Array<Record<string, unknown>>;
}

function fakeApi(
  respond: (call: number) => { status: number; body?: unknown } = () => ({
    status: 200,
    body: { version: 4, updated: true },
  }),
): FakeApi {
  const pushed: SubscriptionLogin[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    pushed.push(body.login as SubscriptionLogin);
    const answer = respond(bodies.length);
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body ?? {},
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, pushed, bodies };
}

function start(input: {
  home: string;
  api: FakeApi;
  intervalMs?: number;
  sandbox?: SubscriptionSandboxFs;
  log?: (line: string) => void;
  /** Pass one in to read it back after the pass; the publisher mutates it in place. */
  state?: SubscriptionPublishState;
}): SubscriptionPublisher {
  const publisher = startSubscriptionPublisher({
    plan: {
      isDaytona: input.sandbox !== undefined,
      credentials: { subscription: SUBSCRIPTION, subscriptionHome: input.home },
    },
    state: input.state ?? subscriptionPublishState(SUBSCRIPTION),
    sandbox: () => input.sandbox,
    apiBase: "https://api.test",
    authorization: "ApiKey test",
    fetchImpl: input.api.fetchImpl,
    log: input.log ?? (() => {}),
    ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
  });
  assert.ok(publisher, "the publisher must start for a wired subscription run");
  running.push(publisher);
  return publisher;
}

/**
 * A failure report asks "was the login I ran on superseded?". It has to name the version the ROW
 * holds, not the one this run was handed, or a session that pushed its own refresh gets its own
 * report called stale, is handed back the login it just reported dead, and spends a turn telling
 * the user that another session changed the sign-in.
 *
 * Learning the version this way is safe because `validateSubscriptionLogin` runs first: the API
 * only ever moves the row to a login that passed the shape check
 * (`subscription-login-validate.test.ts`).
 */
describe("the version an accepted push teaches this session", () => {
  it("moves state.version, so a later failure report is not called stale", async () => {
    const home = tempHome();
    writeLogin(home, REFRESHED);
    const api = fakeApi(() => ({
      status: 200,
      body: { version: 5, updated: true },
    }));
    const state = subscriptionPublishState(SUBSCRIPTION);

    await start({ home, api, intervalMs: 10, state }).reconcile("interval");

    assert.deepEqual(api.bodies[0], {
      login: REFRESHED,
      version: 3,
      generation: 1,
    });
    assert.equal(state.version, 5, "the row moved to 5 and this session knows it");

    const reports: Array<Record<string, unknown>> = [];
    await reportSubscriptionLoginFailure(SUBSCRIPTION, state, "auth_failed", {
      apiBase: "https://api.test",
      authorization: "ApiKey test",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        reports.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ stale: false }), { status: 200 });
      }) as unknown as typeof fetch,
      log: () => {},
    });

    assert.deepEqual(reports[0], {
      version: 5,
      generation: 1,
      reason: "auth_failed",
    });
  });

  /**
   * The API answers `updated: false, stale: false` for two OPPOSITE outcomes: the row already
   * holds this login (a no-op, marked `reason: "same_login"`), and the row REFUSED this login for
   * an older expiry. Only the first means the row holds what this session runs on.
   */
  it("learns the version from a no-op the API marked same_login", async () => {
    const home = tempHome();
    writeLogin(home, REFRESHED);
    const api = fakeApi(() => ({
      status: 200,
      body: { version: 5, updated: false, stale: false, reason: "same_login" },
    }));
    const state = subscriptionPublishState(SUBSCRIPTION);

    await start({ home, api, intervalMs: 10, state }).reconcile("interval");

    assert.equal(state.version, 5);
  });

  it("never learns the version from a login the API REFUSED", async () => {
    // Another session stored a newer rotation at 5; this one's older-expiry push is rejected. The
    // row holds the other credential, so quoting 5 later would claim a login this run never had,
    // and the failure report would mark a healthy connection needs_login.
    const home = tempHome();
    writeLogin(home, REFRESHED);
    const api = fakeApi(() => ({
      status: 200,
      body: { version: 5, updated: false, stale: false, reason: "older_expiry" },
    }));
    const state = subscriptionPublishState(SUBSCRIPTION);

    await start({ home, api, intervalMs: 10, state }).reconcile("interval");

    assert.equal(state.version, 3);
  });

  it("never learns the version from a refusal that carries no reason at all", async () => {
    // An API that predates `same_login` teaches nothing rather than guessing. One stale failure
    // report is recoverable; a wrongly current one costs the user their sign-in.
    const home = tempHome();
    writeLogin(home, REFRESHED);
    const api = fakeApi(() => ({
      status: 200,
      body: { version: 5, updated: false, stale: false },
    }));
    const state = subscriptionPublishState(SUBSCRIPTION);

    await start({ home, api, intervalMs: 10, state }).reconcile("interval");

    assert.equal(state.version, 3);
  });

  it("leaves state.version alone when the API called the push stale", async () => {
    // A stale answer names a row this session is behind on. Adopting that version would claim a
    // login this run never ran on; the recovery path is what adopts a login the API hands back.
    const home = tempHome();
    writeLogin(home, REFRESHED);
    const api = fakeApi(() => ({
      status: 200,
      body: { version: 8, updated: false, stale: true },
    }));
    const state = subscriptionPublishState(SUBSCRIPTION);

    await start({ home, api, intervalMs: 10, state }).reconcile("interval");

    assert.equal(state.version, 3);
  });

  it("leaves state.version alone when the API never answered", async () => {
    const home = tempHome();
    writeLogin(home, REFRESHED);
    const api = fakeApi(() => ({ status: 503 }));
    const state = subscriptionPublishState(SUBSCRIPTION);

    await start({ home, api, intervalMs: 10, state }).reconcile("interval");

    assert.equal(state.version, 3);
  });
});

describe("the reconciliation pass", () => {
  it("publishes a login Pi wrote mid-turn, exactly once, and never the delivered one", async () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const api = fakeApi();
    const publisher = start({ home, api, intervalMs: 10 });

    await publisher.reconcile("interval");
    assert.deepEqual(api.pushed, [], "the delivered login is already at the API");

    writeLogin(home, REFRESHED);
    await publisher.reconcile("interval");
    await publisher.reconcile("interval");
    await publisher.reconcile("interval");

    assert.deepEqual(api.pushed, [REFRESHED], "one publication, not one per pass");
    assert.deepEqual(api.bodies[0], {
      login: REFRESHED,
      version: 3,
      generation: 1,
    });
  });

  it("publishes a rotation the provider issued with the SAME expiry", async () => {
    // An expiry floor drops this one silently. The API accepts it, so the runner must send it.
    const home = tempHome();
    writeLogin(home, ROTATED);
    const api = fakeApi();
    await start({ home, api, intervalMs: 10 }).reconcile("start");
    assert.deepEqual(api.pushed, [ROTATED]);
  });

  it("retries after a publication the API never answered", async () => {
    const home = tempHome();
    writeLogin(home, REFRESHED);
    // A timeout, then a 500, then success. The credential stays unacknowledged until it lands.
    const api = fakeApi((call) => {
      if (call === 1) throw new Error("fetch failed");
      if (call === 2) return { status: 503 };
      return { status: 200, body: { version: 4, updated: true } };
    });
    const publisher = start({ home, api, intervalMs: 10 });

    await publisher.reconcile("interval");
    await publisher.reconcile("interval");
    await publisher.reconcile("interval");
    await publisher.reconcile("interval");

    assert.deepEqual(api.pushed, [REFRESHED, REFRESHED, REFRESHED]);
  });

  it("stops retrying a login the API judged and refused", async () => {
    const home = tempHome();
    writeLogin(home, REFRESHED);
    const api = fakeApi(() => ({ status: 409 }));
    const publisher = start({ home, api, intervalMs: 10 });

    await publisher.reconcile("interval");
    await publisher.reconcile("interval");

    assert.equal(api.pushed.length, 1, "a client error is the API's answer, not a retry");
  });

  it("refuses to send a login it cannot recognize, and does not re-refuse it every pass", async () => {
    const home = tempHome();
    writeLogin(home, {
      type: "oauth",
      access: "not-a-jwt",
      refresh: "junk",
      expires: Date.now() + 3_600_000,
    } as SubscriptionLogin);
    const api = fakeApi();
    const lines: string[] = [];
    const publisher = start({ home, api, intervalMs: 10, log: (l) => lines.push(l) });

    await publisher.reconcile("interval");
    await publisher.reconcile("interval");

    assert.deepEqual(api.pushed, []);
    const refusals = lines.filter((line) => line.includes("decision=refused"));
    assert.equal(refusals.length, 1);
    assert.match(refusals[0]!, /reason=access_not_jwt/);
  });

  it("runs a pass at start, which is what repairs a publication a previous session lost", async () => {
    const home = tempHome();
    // The agent dir already holds a token newer than the delivered one: a refresh whose push
    // never reached the API before the runner died.
    writeLogin(home, REFRESHED);
    const api = fakeApi();
    start({ home, api, intervalMs: 60_000 });

    const deadline = Date.now() + 2_000;
    while (api.pushed.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(api.pushed, [REFRESHED]);
  });

  it("publishes on its interval without anyone asking", async () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const api = fakeApi();
    start({ home, api, intervalMs: 20 });

    writeLogin(home, REFRESHED);
    const deadline = Date.now() + 3_000;
    while (api.pushed.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(api.pushed, [REFRESHED]);
  });
});

describe("shutdown", () => {
  it("drains the pass in flight and takes one final sample", async () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const api = fakeApi();
    const publisher = start({ home, api, intervalMs: 60_000 });

    // Pi persists a refreshed token around the moment a turn ends, after the last interval.
    writeLogin(home, REFRESHED);
    await publisher.stop();

    assert.deepEqual(api.pushed, [REFRESHED]);
  });

  it("is idempotent and publishes nothing more after it", async () => {
    const home = tempHome();
    writeLogin(home, REFRESHED);
    const api = fakeApi();
    const publisher = start({ home, api, intervalMs: 60_000 });

    await publisher.stop();
    await publisher.stop();
    writeLogin(home, { ...REFRESHED, refresh: "later-refresh" } as SubscriptionLogin);
    await publisher.reconcile("interval");

    assert.equal(api.pushed.length, 1);
  });
});

describe("a Daytona session", () => {
  const home = "/home/sandbox/agenta/subscriptions/conn-1";

  function sandboxWith(files: Record<string, string>): SubscriptionSandboxFs {
    return {
      mkdirFs: async () => undefined,
      writeFsFile: async ({ path }, content) => {
        files[path] = content;
      },
      readFsFile: async ({ path }) => {
        const found = files[path];
        if (found === undefined) throw new Error("ENOENT");
        return Buffer.from(found, "utf-8");
      },
    };
  }

  it("reads the in-VM file through the sandbox API and publishes what it finds", async () => {
    const files: Record<string, string> = {
      [`${home}/auth.json`]: JSON.stringify({ "openai-codex": REFRESHED }),
    };
    const api = fakeApi();
    const publisher = start({ home, api, sandbox: sandboxWith(files), intervalMs: 60_000 });

    await publisher.reconcile("interval");
    assert.deepEqual(api.pushed, [REFRESHED]);
  });

  it("does nothing while the run has no sandbox", async () => {
    const api = fakeApi();
    const publisher = startSubscriptionPublisher({
      plan: {
        isDaytona: true,
        credentials: { subscription: SUBSCRIPTION, subscriptionHome: home },
      },
      state: subscriptionPublishState(SUBSCRIPTION),
      sandbox: () => undefined,
      apiBase: "https://api.test",
      authorization: "ApiKey test",
      fetchImpl: api.fetchImpl,
      log: () => {},
      intervalMs: 60_000,
    });
    assert.ok(publisher);
    running.push(publisher);

    await publisher.reconcile("interval");
    await publisher.stop();
    assert.deepEqual(api.pushed, []);
  });
});

describe("a run that is not wired for publication", () => {
  it("starts no publisher and says which part is missing", () => {
    const lines: string[] = [];
    const publisher = startSubscriptionPublisher({
      plan: {
        isDaytona: false,
        credentials: { subscription: SUBSCRIPTION, subscriptionHome: undefined },
      },
      state: subscriptionPublishState(SUBSCRIPTION),
      sandbox: () => undefined,
      apiBase: "https://api.test",
      authorization: "",
      log: (line) => lines.push(line),
    });

    assert.equal(publisher, undefined);
    assert.match(lines.join("\n"), /decision=not-wired home=no .*credential=no/);
  });

  it("stays quiet for a run that carries no subscription at all", () => {
    const lines: string[] = [];
    const publisher = startSubscriptionPublisher({
      plan: { isDaytona: false, credentials: {} },
      state: undefined,
      sandbox: () => undefined,
      apiBase: "https://api.test",
      authorization: "ApiKey test",
      log: (line) => lines.push(line),
    });

    assert.equal(publisher, undefined);
    assert.deepEqual(lines, []);
  });
});

describe("the log never carries the credential", () => {
  it("keeps tokens out of every line, whatever the API answers", async () => {
    const home = tempHome();
    writeLogin(home, REFRESHED);
    const lines: string[] = [];
    const api = fakeApi((call) => {
      if (call === 1) throw new Error(`boom ${REFRESHED.refresh}`);
      return { status: 200, body: { version: 9, updated: false, stale: true } };
    });
    const publisher = start({ home, api, intervalMs: 60_000, log: (l) => lines.push(l) });

    await publisher.reconcile("interval");
    await publisher.reconcile("interval");

    const text = lines.join("\n");
    assert.ok(!text.includes(REFRESHED.refresh), text);
    assert.ok(!text.includes(REFRESHED.access), text);
    assert.match(text, /decision=stale/);
  });
});
