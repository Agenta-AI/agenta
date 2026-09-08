/**
 * Unit tests for contract amendment A3: publish a refreshed login AT REFRESH TIME.
 *
 * What these pin is a data-loss rule, not a convenience. Pi refreshes its OAuth token mid-turn and
 * writes the new pair into `auth.json`. That file is then the ONLY copy of a live credential: the
 * delivered refresh token has been spent and the provider rotated it away. Publishing only at turn
 * end means an hour-long turn that dies takes the credential with it.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-login-publish.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LOCAL_WATCH_DEBOUNCE_MS,
  LOCAL_WATCH_POLL_INTERVAL_MS,
  pollDaytonaSubscriptionLogin,
  startSubscriptionLoginPublisher,
  subscriptionPushState,
  watchLocalSubscriptionLogin,
  type SubscriptionSandboxFs,
} from "../../src/engines/sandbox_agent/subscription-login.ts";
import type {
  ModelConnectionSubscription,
  SubscriptionLogin,
} from "../../src/protocol.ts";
import { makeLogin } from "../utils/subscription-login.ts";

// Real-shaped logins, because the runner refuses to publish anything it cannot recognize as a
// ChatGPT credential. The two carry payloads of IDENTICAL length, which is what defeated the
// stat-based poller and is why the poller hashes content. See tests/utils.
const DELIVERED: SubscriptionLogin = makeLogin({
  refresh: "delivered-refresh",
  expires: Date.now() + 3_600_000,
});
const REFRESHED: SubscriptionLogin = makeLogin({
  refresh: "refreshed-refresh",
  expires: Date.now() + 7_200_000,
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
const stops: Array<() => void> = [];
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "agenta-subscription-watch-"));
  homes.push(home);
  return home;
}
afterEach(() => {
  while (stops.length) stops.pop()!();
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

/** Poll until `check` passes or the budget runs out. Filesystem events are not instantaneous. */
async function eventually(
  check: () => boolean,
  budgetMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("condition never became true");
}

function writeLogin(home: string, login: SubscriptionLogin): void {
  writeFileSync(join(home, "auth.json"), JSON.stringify({ "openai-codex": login }), {
    mode: 0o600,
  });
}

/**
 * A stand-in for `fs.watch` whose events the test raises by hand.
 *
 * The real watcher is injected rather than used because an inotify INSTANCE is a per-UID kernel
 * resource (`fs.inotify.max_user_instances`, 128 on this box, shared by every container running as
 * the same uid), and a test suite must not fail because a neighbour exhausted it. The watch
 * plumbing under test is the debounce, the read under the lock, and the stop; none of those is an
 * inotify behavior. The graceful degradation when `fs.watch` DOES throw is covered separately, with
 * the real function.
 */
function fakeWatch(): {
  watchImpl: never;
  fire: () => void;
  closed: () => boolean;
  watched: string[];
} {
  const listeners: Array<(event: string, filename: string) => void> = [];
  const watched: string[] = [];
  let closed = false;
  const watchImpl = ((path: string, listener: (e: string, f: string) => void) => {
    watched.push(path);
    listeners.push(listener);
    return {
      close: () => {
        closed = true;
      },
      on: () => {},
      unref: () => {},
    };
  }) as never;
  return {
    watchImpl,
    watched,
    closed: () => closed,
    fire: () => {
      for (const listener of listeners) listener("change", "auth.json");
    },
  };
}

describe("watchLocalSubscriptionLogin", () => {
  it("watches the agent dir, not the file, so a replaced file is still seen", () => {
    const home = tempHome();
    const fake = fakeWatch();
    const watch = watchLocalSubscriptionLogin({
      home,
      onLogin: () => {},
      watchImpl: fake.watchImpl,
      log: () => {},
    });
    stops.push(watch.stop);
    assert.deepEqual(fake.watched, [home]);
  });

  it("reports the login Pi wrote, once, after the debounce", async () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const seen: SubscriptionLogin[] = [];
    const fake = fakeWatch();
    const watch = watchLocalSubscriptionLogin({
      home,
      onLogin: (login) => {
        seen.push(login);
      },
      debounceMs: 20,
      watchImpl: fake.watchImpl,
      log: () => {},
    });
    stops.push(watch.stop);

    // Three events in a burst, as one logical write raises.
    writeLogin(home, REFRESHED);
    fake.fire();
    fake.fire();
    fake.fire();

    await eventually(() => seen.length >= 1);
    assert.deepEqual(seen[0], REFRESHED);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(seen.length, 1, "one burst is one read");
  });

  it("stops reporting after stop(), and closes the watcher", async () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const seen: SubscriptionLogin[] = [];
    const fake = fakeWatch();
    const watch = watchLocalSubscriptionLogin({
      home,
      onLogin: (login) => {
        seen.push(login);
      },
      debounceMs: 10,
      watchImpl: fake.watchImpl,
      log: () => {},
    });
    watch.stop();
    watch.stop(); // idempotent
    assert.equal(fake.closed(), true);

    writeLogin(home, REFRESHED);
    fake.fire();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(seen, []);
  });

  it("logs the code and the message when fs.watch cannot start", () => {
    // The real `fs.watch`, on a path that does not exist. `error=Error` alone sent a reader
    // hunting; the code and the message are what say WHY, and neither can carry the login.
    const lines: string[] = [];
    const watch = watchLocalSubscriptionLogin({
      home: join(tmpdir(), "agenta-does-not-exist-ever"),
      onLogin: () => {},
      log: (line) => lines.push(line),
    });
    stops.push(watch.stop);
    const joined = lines.join("\n");
    assert.match(joined, /watch unavailable/);
    // ENOENT for the missing path, or EMFILE when the box has already exhausted
    // `fs.inotify.max_user_instances` for this uid and never gets as far as resolving it. Which
    // one it is IS the diagnosis, and printing neither is what sent a reader hunting.
    assert.match(joined, /code=(ENOENT|EMFILE)/);
    assert.match(joined, /message="/);
    assert.doesNotThrow(watch.stop);
  });

  /**
   * The fallback exists because `fs.watch` is an inotify instance and
   * `fs.inotify.max_user_instances` is a PER-UID kernel limit shared across the whole host.
   * Measured on this box on 2026-09-08: uid 0 could not open a single watch while uid 1000 could,
   * with 69 root containers running. Going silent there would mean a refresh Pi wrote mid-turn
   * reaches the API only if the turn survives — the exact loss A3 exists to prevent.
   */
  it("falls back to polling when fs.watch throws, and still publishes", async () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const seen: SubscriptionLogin[] = [];
    const lines: string[] = [];
    const watch = watchLocalSubscriptionLogin({
      home,
      onLogin: (login) => {
        seen.push(login);
      },
      debounceMs: 10,
      pollIntervalMs: 15,
      // Exactly what an exhausted per-uid inotify limit raises.
      watchImpl: (() => {
        const err = new Error("EMFILE: too many open files, watch") as Error & {
          code: string;
        };
        err.code = "EMFILE";
        throw err;
      }) as never,
      log: (line) => lines.push(line),
    });
    stops.push(watch.stop);

    const joined = lines.join("\n");
    assert.match(joined, /watch unavailable/);
    assert.match(joined, /code=EMFILE/);
    assert.match(joined, /watch mode=poll/);

    writeLogin(home, REFRESHED);
    await eventually(() => seen.length >= 1);
    assert.deepEqual(seen[0], REFRESHED);
  });

  it("hands over to polling when a live watch dies mid-turn", async () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const seen: SubscriptionLogin[] = [];
    const lines: string[] = [];
    let raise: ((err: unknown) => void) | undefined;
    let closed = false;
    const watchImpl = (() => ({
      close: () => {
        closed = true;
      },
      on: (event: string, listener: (err: unknown) => void) => {
        if (event === "error") raise = listener;
      },
      unref: () => {},
    })) as never;

    const watch = watchLocalSubscriptionLogin({
      home,
      onLogin: (login) => {
        seen.push(login);
      },
      debounceMs: 10,
      pollIntervalMs: 15,
      watchImpl,
      log: (line) => lines.push(line),
    });
    stops.push(watch.stop);
    assert.ok(raise, "the watcher registered no error listener");

    const err = new Error("EBADF: bad file descriptor, watch") as Error & {
      code: string;
    };
    err.code = "EBADF";
    raise?.(err);

    const joined = lines.join("\n");
    assert.match(joined, /watch stopped .*code=EBADF/);
    assert.match(joined, /watch mode=poll/);
    assert.equal(closed, true, "the dead watcher is closed, not leaked");

    writeLogin(home, REFRESHED);
    await eventually(() => seen.length >= 1);
    assert.deepEqual(seen[0], REFRESHED);
  });

  it("a stopped poller makes no further reads", async () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const seen: SubscriptionLogin[] = [];
    const watch = watchLocalSubscriptionLogin({
      home,
      onLogin: (login) => {
        seen.push(login);
      },
      debounceMs: 10,
      pollIntervalMs: 15,
      watchImpl: (() => {
        throw new Error("no watcher for you");
      }) as never,
      log: () => {},
    });
    watch.stop();

    writeLogin(home, REFRESHED);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(seen, []);
  });

  it("polls every 5 s and keeps the same debounce as the inotify path", () => {
    // The interval and the debounce are a product decision, not an implementation detail: they
    // set how long a refreshed credential can exist only on local disk. Pinned so a later edit
    // cannot quietly widen that window.
    assert.equal(LOCAL_WATCH_POLL_INTERVAL_MS, 5_000);
    assert.equal(LOCAL_WATCH_DEBOUNCE_MS, 500);
  });

  it("never logs the login itself, whatever the failure", () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const lines: string[] = [];
    const watch = watchLocalSubscriptionLogin({
      home,
      onLogin: () => {},
      pollIntervalMs: 15,
      watchImpl: (() => {
        const err = new Error(
          `EMFILE: too many open files, watch '${home}'`,
        ) as Error & { code: string };
        err.code = "EMFILE";
        throw err;
      }) as never,
      log: (line) => lines.push(line),
    });
    stops.push(watch.stop);
    const joined = lines.join("\n");
    for (const secret of [
      DELIVERED.access,
      DELIVERED.refresh,
      DELIVERED.accountId as string,
    ]) {
      assert.ok(!joined.includes(secret), `log leaked ${secret}`);
    }
  });
});

describe("pollDaytonaSubscriptionLogin", () => {
  it("reads the in-VM file on its interval and stops on stop()", async () => {
    let content = JSON.stringify({ "openai-codex": REFRESHED });
    const sandbox: SubscriptionSandboxFs = {
      mkdirFs: async () => undefined,
      writeFsFile: async () => undefined,
      readFsFile: async () => Buffer.from(content, "utf-8"),
    };
    const seen: SubscriptionLogin[] = [];
    const watch = pollDaytonaSubscriptionLogin({
      sandbox,
      home: "/home/sandbox/agenta/subscriptions/conn-1",
      onLogin: (login) => {
        seen.push(login);
      },
      intervalMs: 15,
      log: () => {},
    });
    stops.push(watch.stop);

    await eventually(() => seen.length >= 1);
    assert.deepEqual(seen[0], REFRESHED);

    watch.stop();
    const after = seen.length;
    content = JSON.stringify({ "openai-codex": DELIVERED });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(seen.length, after, "a stopped poll makes no further reads");
  });
});

describe("startSubscriptionLoginPublisher", () => {
  const plan = (isDaytona: boolean) => ({
    isDaytona,
    credentials: {
      subscription: SUBSCRIPTION,
      subscriptionHome: isDaytona
        ? "/home/sandbox/agenta/subscriptions/conn-1"
        : "",
    },
  });

  it("pushes the refreshed login a local watch saw, and never the delivered one", async () => {
    const home = tempHome();
    writeLogin(home, DELIVERED);
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ version: 4 }), { status: 200 });
    }) as unknown as typeof fetch;

    const localPlan = plan(false);
    localPlan.credentials.subscriptionHome = home;
    const state = subscriptionPushState(SUBSCRIPTION);
    const fake = fakeWatch();
    const watch = startSubscriptionLoginPublisher({
      plan: localPlan,
      state,
      sandbox: undefined,
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
      debounceMs: 20,
      watchImpl: fake.watchImpl,
    });
    stops.push(watch.stop);

    // The delivered login is already on disk: touching the file must not push it.
    writeLogin(home, DELIVERED);
    fake.fire();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(bodies, [], "the delivered login is never pushed back");

    writeLogin(home, REFRESHED);
    fake.fire();
    await eventually(() => bodies.length >= 1);
    assert.deepEqual(bodies[0], {
      login: REFRESHED,
      version: 3,
      generation: 1,
    });
    assert.equal(state.pushedExpires, REFRESHED.expires);
    assert.equal(state.version, 4);

    // The same refresh must not be sent twice, however many events the file raises.
    fake.fire();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(bodies.length, 1);
  });

  it("does nothing for a run with no subscription, no home, or no credential", () => {
    const noop = { stop: () => {} };
    const started = [
      startSubscriptionLoginPublisher({
        plan: { isDaytona: false, credentials: {} },
        state: subscriptionPushState(SUBSCRIPTION),
        sandbox: undefined,
        apiBase: "http://api:8000",
        authorization: "ApiKey secret",
      }),
      startSubscriptionLoginPublisher({
        plan: plan(false),
        state: undefined,
        sandbox: undefined,
        apiBase: "http://api:8000",
        authorization: "ApiKey secret",
      }),
      startSubscriptionLoginPublisher({
        plan: plan(true),
        state: subscriptionPushState(SUBSCRIPTION),
        sandbox: undefined,
        apiBase: "http://api:8000",
        authorization: "",
      }),
    ];
    for (const watch of started) {
      assert.doesNotThrow(watch.stop);
    }
    assert.doesNotThrow(noop.stop);
  });

  it("polls the sandbox on a Daytona run", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ version: 4 }), { status: 200 });
    }) as unknown as typeof fetch;
    const sandbox: SubscriptionSandboxFs = {
      mkdirFs: async () => undefined,
      writeFsFile: async () => undefined,
      // Bytes, as the real sandbox API answers.
      readFsFile: async () =>
        Buffer.from(JSON.stringify({ "openai-codex": REFRESHED }), "utf-8"),
    };

    const watch = startSubscriptionLoginPublisher({
      plan: plan(true),
      state: subscriptionPushState(SUBSCRIPTION),
      sandbox,
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
      intervalMs: 15,
    });
    stops.push(watch.stop);

    await eventually(() => bodies.length >= 1);
    assert.deepEqual(bodies[0], {
      login: REFRESHED,
      version: 3,
      generation: 1,
    });
  });
});
