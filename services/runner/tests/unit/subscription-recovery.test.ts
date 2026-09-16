/**
 * Unit tests for the recovery decision: classify with the official client before calling a login
 * dead, then ask the API whether a newer one exists.
 *
 * The product rule these encode: a hosted subscription run must not send the user to a device
 * sign-in for a connection that is fine. Pi says the same sentence for a dead login, a refresh that
 * lost a race, and a provider that timed out, so the runner asks the provider itself, then asks the
 * API, and only then gives up.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-recovery.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE } from "../../src/engines/sandbox_agent/errors.ts";
import { materializeSubscriptionLoginForRun } from "../../src/engines/sandbox_agent/subscription-login/files.ts";
import {
  classifyRefreshError,
  recoverSubscriptionAuthFailure,
  refreshFailureReason,
  verifySubscriptionRefresh,
} from "../../src/engines/sandbox_agent/subscription-recovery.ts";
import {
  startSubscriptionPublisher,
  subscriptionPublishState,
  type SubscriptionPublishState,
} from "../../src/engines/sandbox_agent/subscription-login/publisher.ts";
import type {
  ModelConnectionSubscription,
  SubscriptionLogin,
} from "../../src/protocol.ts";
import { accessToken, makeLogin } from "../utils/subscription-login.ts";

// Real-shaped logins: the runner refuses to publish anything it cannot recognize as a ChatGPT
// credential, so a fixture that expects a push has to look like one. See tests/utils.
const LOCAL: SubscriptionLogin = makeLogin({
  refresh: "local-refresh",
  expires: Date.now() + 3_600_000,
});
const ROTATED = {
  access: accessToken("acct_1"),
  refresh: "rotated-refresh",
  expires: Date.now() + 7_200_000,
};
const RECOVERED: SubscriptionLogin = makeLogin({
  refresh: "recovered-refresh",
  expires: Date.now() + 10_800_000,
});

const SUBSCRIPTION: ModelConnectionSubscription = {
  id: "conn-1",
  slug: "chatgpt",
  provider: "chatgpt",
  version: 3,
  generation: 1,
  login: LOCAL,
};

const AUTH_ERROR = new Error('Authentication failed for "openai-codex".');

const homes: string[] = [];
function tempHome(withLogin = LOCAL): string {
  const home = mkdtempSync(join(tmpdir(), "agenta-subscription-recovery-"));
  homes.push(home);
  writeFileSync(
    join(home, "auth.json"),
    JSON.stringify({ "openai-codex": withLogin }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(home, "meta.json"),
    JSON.stringify({ generation: 1, version: 3 }),
  );
  return home;
}
afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

function localLogin(home: string): SubscriptionLogin {
  return JSON.parse(readFileSync(join(home, "auth.json"), "utf-8"))[
    "openai-codex"
  ];
}

function pushState(): SubscriptionPublishState {
  return subscriptionPublishState(SUBSCRIPTION);
}

/** An API stub that records every call and answers each URL from a script. */
function fakeApi(answers: {
  failure?: unknown;
  push?: unknown;
  failureStatus?: number;
}): {
  calls: Array<{ url: string; body: Record<string, unknown> }>;
  api: {
    apiBase: string;
    authorization: string;
    fetchImpl: typeof fetch;
    log: () => void;
  };
} {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (url.endsWith("/failure")) {
      return new Response(JSON.stringify(answers.failure ?? { stale: false }), {
        status: answers.failureStatus ?? 200,
      });
    }
    return new Response(JSON.stringify(answers.push ?? { version: 4 }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return {
    calls,
    api: {
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
    },
  };
}

describe("classifyRefreshError", () => {
  it("calls a 400 or 401 refusal terminal", () => {
    for (const status of [400, 401, 403]) {
      assert.equal(
        classifyRefreshError(
          new Error(
            `OpenAI Codex token refresh failed (${status}): {"error":"invalid_grant"}`,
          ),
        ),
        "terminal",
      );
    }
  });

  it("calls a 5xx, a 429, and a network failure retryable", () => {
    assert.equal(
      classifyRefreshError(
        new Error("OpenAI Codex token refresh failed (503): upstream"),
      ),
      "retryable",
    );
    assert.equal(
      classifyRefreshError(
        new Error("OpenAI Codex token refresh failed (429): slow down"),
      ),
      "retryable",
    );
    assert.equal(
      classifyRefreshError(
        new Error("OpenAI Codex token refresh error: fetch failed"),
      ),
      "retryable",
    );
  });

  it("does not guess about an error it cannot read", () => {
    assert.equal(classifyRefreshError(new Error("something else")), "retryable");
  });

  /**
   * The provider's REAL refusal, measured against the live token endpoint on 2026-09-08.
   *
   * Two things about it break a naive classifier, and both are pinned here. The status is 401,
   * not the 400 an OAuth refusal is usually written as. And the code sits at `error.code`, nested,
   * not at the top level where `invalid_grant` normally lives. A rotated-away refresh token keeps
   * working for about an hour before the endpoint starts answering this way, so the failure is
   * genuinely terminal by the time it appears: the token has been superseded and no retry will
   * bring it back.
   */
  const REUSED_BODY = JSON.stringify({
    error: {
      message:
        "Your refresh token has already been used to generate a new access token. Please try signing in again.",
      type: "invalid_request_error",
      param: null,
      code: "refresh_token_reused",
    },
  });

  it("calls the live 401 refresh_token_reused refusal terminal", () => {
    // pi-ai's `readTokenResponse` builds this exact sentence around the provider body.
    const err = new Error(
      `OpenAI Codex token refresh failed (401): ${REUSED_BODY}`,
    );
    assert.equal(classifyRefreshError(err), "terminal");
    assert.equal(refreshFailureReason(err), "refresh_token_rejected");
  });

  /**
   * The SECOND refusal the provider gives for the same dead token, measured on 2026-09-18's
   * endpoint on 2026-09-08. A rotated-away token answers `refresh_token_reused` for about two
   * hours and then switches to this one. The word order is reversed, so a `refresh_token_` prefix
   * rule catches the first and silently misses the second.
   */
  const INVALID_BODY = JSON.stringify({
    error: {
      message: "Invalid refresh token.",
      type: "invalid_request_error",
      param: null,
      code: "invalid_refresh_token",
    },
  });

  it("calls the live 401 invalid_refresh_token refusal terminal", () => {
    const err = new Error(
      `OpenAI Codex token refresh failed (401): ${INVALID_BODY}`,
    );
    assert.equal(classifyRefreshError(err), "terminal");
    assert.equal(refreshFailureReason(err), "refresh_token_rejected");
  });

  it("gives the two refusals for one dead token the SAME reason word", () => {
    // They are one condition seen at two ages. A connection whose login_error flips wording as
    // time passes is a support question nobody can answer.
    const reused = new Error(
      `OpenAI Codex token refresh failed (401): ${REUSED_BODY}`,
    );
    const invalid = new Error(
      `OpenAI Codex token refresh failed (401): ${INVALID_BODY}`,
    );
    assert.equal(refreshFailureReason(reused), refreshFailureReason(invalid));
  });

  it("does not read the echoed refresh_token PARAMETER as a token refusal", () => {
    // Every failure body echoes the request, which names `refresh_token`. Matching that would
    // label a network blip or a 502 as a dead credential.
    const network = new Error(
      'OpenAI Codex token refresh error: fetch failed while sending refresh_token',
    );
    assert.equal(classifyRefreshError(network), "retryable");
    assert.equal(refreshFailureReason(network), "refresh_unreachable");
    const upstream = new Error(
      'OpenAI Codex token refresh failed (502): {"sent":{"grant_type":"refresh_token"}}',
    );
    assert.equal(classifyRefreshError(upstream), "retryable");
    assert.equal(refreshFailureReason(upstream), "refresh_status_502");
  });

  it("calls every refresh_token_* code terminal, nested or not, at 400 and at 401", () => {
    for (const status of ["400", "401"]) {
      for (const code of [
        "refresh_token_reused",
        "refresh_token_expired",
        "refresh_token_invalidated",
      ]) {
        const nested = new Error(
          `OpenAI Codex token refresh failed (${status}): {"error":{"code":"${code}"}}`,
        );
        assert.equal(classifyRefreshError(nested), "terminal", `${status} ${code}`);
        assert.equal(refreshFailureReason(nested), "refresh_token_rejected");
      }
      for (const body of [
        '{"error":"invalid_grant"}',
        '{"error":{"code":"invalid_grant"}}',
      ]) {
        const err = new Error(
          `OpenAI Codex token refresh failed (${status}): ${body}`,
        );
        assert.equal(classifyRefreshError(err), "terminal", body);
        assert.equal(refreshFailureReason(err), "invalid_grant");
      }
    }
  });

  it("never repeats the provider's advice, which would double the user-facing copy", () => {
    // The body says "Please try signing in again". That sentence is the RUNNER's to write, from
    // its own classified code, so the reason word must not carry the provider's version of it.
    const reason = refreshFailureReason(
      new Error(`OpenAI Codex token refresh failed (401): ${REUSED_BODY}`),
    );
    assert.ok(!/sign/i.test(reason), reason);
  });
});

describe("refreshFailureReason", () => {
  it("names the provider code when it has one, the status otherwise", () => {
    assert.equal(
      refreshFailureReason(
        new Error(
          'OpenAI Codex token refresh failed (400): {"error":"invalid_grant"}',
        ),
      ),
      "invalid_grant",
    );
    assert.equal(
      refreshFailureReason(
        new Error(
          'OpenAI Codex token refresh failed (400): {"error":"refresh_token_expired"}',
        ),
      ),
      "refresh_token_rejected",
    );
    assert.equal(
      refreshFailureReason(
        new Error("OpenAI Codex token refresh failed (503): upstream"),
      ),
      "refresh_status_503",
    );
    assert.equal(
      refreshFailureReason(new Error("OpenAI Codex token refresh error: x")),
      "refresh_unreachable",
    );
  });

  it("never repeats the provider's body, which echoes the refresh token", () => {
    const reason = refreshFailureReason(
      new Error(
        'OpenAI Codex token refresh failed (400): {"error":"invalid_grant","refresh_token":"local-refresh"}',
      ),
    );
    assert.ok(!reason.includes("local-refresh"));
  });
});

describe("verifySubscriptionRefresh", () => {
  it("exchanges the LOCAL refresh token, not the delivered one", async () => {
    const home = tempHome({ ...LOCAL, refresh: "rotated-by-pi" });
    const seen: string[] = [];
    const verdict = await verifySubscriptionRefresh({
      home,
      isDaytona: false,
      generation: 1,
      refresh: async (token) => {
        seen.push(token);
        return ROTATED;
      },
      log: () => {},
    });

    assert.deepEqual(seen, ["rotated-by-pi"]);
    assert.equal(verdict.verdict, "success");
  });

  it("writes the new pair back and keeps the account id", async () => {
    const home = tempHome();
    const verdict = await verifySubscriptionRefresh({
      home,
      isDaytona: false,
      generation: 1,
      refresh: async () => ROTATED,
      log: () => {},
    });

    assert.equal(verdict.verdict, "success");
    assert.deepEqual(localLogin(home), {
      type: "oauth",
      accountId: "acct_1",
      ...ROTATED,
    });
  });

  it("keeps the lineage sidecar untouched: a refresh is not a new sign-in", async () => {
    const home = tempHome();
    await verifySubscriptionRefresh({
      home,
      isDaytona: false,
      generation: 1,
      refresh: async () => ROTATED,
      log: () => {},
    });
    assert.deepEqual(JSON.parse(readFileSync(join(home, "meta.json"), "utf-8")), {
      generation: 1,
      version: 3,
    });
  });

  it("reports terminal when the provider refuses the token", async () => {
    const home = tempHome();
    const verdict = await verifySubscriptionRefresh({
      home,
      isDaytona: false,
      generation: 1,
      refresh: async () => {
        throw new Error(
          'OpenAI Codex token refresh failed (400): {"error":"invalid_grant"}',
        );
      },
      log: () => {},
    });
    assert.deepEqual(verdict, { verdict: "terminal", reason: "invalid_grant" });
    assert.deepEqual(localLogin(home), LOCAL, "a refused refresh changes nothing");
  });

  it("reports terminal when there is no local login at all", async () => {
    const home = mkdtempSync(join(tmpdir(), "agenta-subscription-recovery-"));
    homes.push(home);
    const verdict = await verifySubscriptionRefresh({
      home,
      isDaytona: false,
      generation: 1,
      refresh: async () => {
        assert.fail("must not call the provider with no token");
      },
      log: () => {},
    });
    assert.deepEqual(verdict, { verdict: "terminal", reason: "login_missing" });
  });

  it("reports retryable when the provider cannot be reached", async () => {
    const home = tempHome();
    const verdict = await verifySubscriptionRefresh({
      home,
      isDaytona: false,
      generation: 1,
      refresh: async () => {
        throw new Error("OpenAI Codex token refresh error: fetch failed");
      },
      log: () => {},
    });
    assert.deepEqual(verdict, {
      verdict: "retryable",
      reason: "refresh_unreachable",
    });
  });

  it("never puts a token in the log", async () => {
    const home = tempHome();
    const lines: string[] = [];
    await verifySubscriptionRefresh({
      home,
      isDaytona: false,
      generation: 1,
      refresh: async () => ROTATED,
      log: (line) => lines.push(line),
    });
    const joined = lines.join("\n");
    for (const secret of [
      LOCAL.access,
      LOCAL.refresh,
      ROTATED.access,
      ROTATED.refresh,
      "acct_1",
    ]) {
      assert.ok(!joined.includes(secret), `log leaked ${secret}`);
    }
  });
});

describe("recoverSubscriptionAuthFailure", () => {
  it("ignores a failure that is not about the login", async () => {
    const home = tempHome();
    const { api } = fakeApi({});
    const recovery = await recoverSubscriptionAuthFailure({
      err: new Error("the model returned a 500"),
      subscription: SUBSCRIPTION,
      state: pushState(),
      home,
      isDaytona: false,
      api,
      refresh: async () => ROTATED,
      log: () => {},
    });
    assert.equal(recovery, undefined);
  });

  it("a refresh that succeeds repairs the login and ends the turn for a cold start", async () => {
    const home = tempHome();
    const { calls, api } = fakeApi({});
    const published: string[] = [];
    const recovery = await recoverSubscriptionAuthFailure({
      err: AUTH_ERROR,
      subscription: SUBSCRIPTION,
      state: pushState(),
      home,
      isDaytona: false,
      api,
      publish: async (trigger) => {
        published.push(trigger);
      },
      refresh: async () => ROTATED,
      log: () => {},
    });

    // Pi holds the refused token in memory for the life of the daemon, so this turn cannot use
    // the repaired login. It fails retryably and the next message cold-starts on the new pair.
    assert.deepEqual(recovery, {
      action: "fail",
      reason: "refresh-succeeded",
      classified: {
        message: SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
        code: "subscription_login_refreshed",
      },
    });
    // The new pair is on disk and published through the session's one publisher, and no failure
    // is reported.
    assert.deepEqual(published, ["recovery"]);
    assert.deepEqual(calls, []);
    assert.deepEqual(localLogin(home), {
      type: "oauth",
      accountId: "acct_1",
      ...ROTATED,
    });
  });

  it("refuses to spend a refresh token that belongs to a newer sign-in", async () => {
    // Another session materialized a new sign-in into this connection's dir. Exchanging its token
    // would rotate it away for the sessions that own it, so the check runs BEFORE the exchange.
    const home = tempHome();
    writeFileSync(join(home, "meta.json"), JSON.stringify({ generation: 2, version: 8 }));
    const verdict = await verifySubscriptionRefresh({
      home,
      isDaytona: false,
      generation: 1,
      refresh: async () => {
        assert.fail("must not exchange a token of a newer lineage");
      },
      log: () => {},
    });

    assert.deepEqual(verdict, { verdict: "retryable", reason: "generation_moved" });
    assert.deepEqual(localLogin(home), LOCAL, "the file is untouched");
  });

  it("holds the lock across the exchange, so a sign-in that lands during it still wins", async () => {
    const home = tempHome();
    let releaseProvider: (() => void) | undefined;
    const provider = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let lockHeld: (() => void) | undefined;
    const holdingLock = new Promise<void>((resolve) => {
      lockHeld = resolve;
    });
    const verdict = verifySubscriptionRefresh({
      home,
      isDaytona: false,
      generation: 1,
      refresh: async () => {
        lockHeld?.();
        await provider;
        return ROTATED;
      },
      log: () => {},
    });
    // A new sign-in materializes while the provider is answering. It must queue on the lock, and
    // it must be what the file holds when both are done. The refresh runs only once the lock is
    // held, so this signal proves the acquisition rather than assuming it.
    await holdingLock;
    const signIn = materializeSubscriptionLoginForRun({
      home,
      isDaytona: false,
      subscription: { id: "conn-1", login: RECOVERED, version: 9, generation: 2 },
      log: () => {},
    });
    releaseProvider?.();

    assert.equal((await verdict).verdict, "success");
    assert.equal((await signIn).write, true);
    assert.deepEqual(localLogin(home), RECOVERED);
    assert.deepEqual(JSON.parse(readFileSync(join(home, "meta.json"), "utf-8")), {
      generation: 2,
      version: 9,
    });
  });

  it("names the renewed sign-in, not a dead one, when the login was repaired", async () => {
    const home = tempHome();
    const { api } = fakeApi({});
    const recovery = await recoverSubscriptionAuthFailure({
      err: AUTH_ERROR,
      subscription: SUBSCRIPTION,
      state: pushState(),
      home,
      isDaytona: false,
      api,
      refresh: async () => ROTATED,
      log: () => {},
    });

    assert.equal(recovery?.action, "fail");
    assert.equal(
      recovery?.action === "fail" && recovery.classified.code,
      "subscription_login_refreshed",
    );
  });

  it("a provider that cannot answer marks NOTHING and offers a retry", async () => {
    const home = tempHome();
    const { calls, api } = fakeApi({});
    const recovery = await recoverSubscriptionAuthFailure({
      err: AUTH_ERROR,
      subscription: SUBSCRIPTION,
      state: pushState(),
      home,
      isDaytona: false,
      api,
      refresh: async () => {
        throw new Error("OpenAI Codex token refresh failed (503): upstream");
      },
      log: () => {},
    });

    assert.deepEqual(calls, [], "nothing is reported to the API");
    assert.equal(recovery?.action, "fail");
    assert.equal(
      recovery?.action === "fail" && recovery.classified.code,
      "subscription_login_refreshed",
    );
    assert.match(
      (recovery?.action === "fail" && recovery.classified.message) || "",
      /could not be checked/,
    );
  });

  it("a refused refresh with no newer login asks the user to sign in again", async () => {
    const home = tempHome();
    const { calls, api } = fakeApi({ failure: { stale: false, version: 3 } });
    const recovery = await recoverSubscriptionAuthFailure({
      err: AUTH_ERROR,
      subscription: SUBSCRIPTION,
      state: pushState(),
      home,
      isDaytona: false,
      api,
      refresh: async () => {
        throw new Error(
          'OpenAI Codex token refresh failed (400): {"error":"invalid_grant"}',
        );
      },
      log: () => {},
    });

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "http://api:8000/secrets/conn-1/subscription-login/failure",
    );
    assert.deepEqual(calls[0].body, {
      version: 3,
      generation: 1,
      reason: "auth_failed",
    });
    assert.equal(
      recovery?.action === "fail" && recovery.classified.code,
      "subscription_login_required",
    );
  });

  it("a stale answer with a newer login of the same lineage rematerializes and ends the turn", async () => {
    const home = tempHome();
    const { calls, api } = fakeApi({
      failure: {
        stale: true,
        version: 7,
        generation: 1,
        login: RECOVERED,
      },
    });
    const state = pushState();
    const recovery = await recoverSubscriptionAuthFailure({
      err: AUTH_ERROR,
      subscription: SUBSCRIPTION,
      state,
      home,
      isDaytona: false,
      api,
      refresh: async () => {
        throw new Error(
          'OpenAI Codex token refresh failed (401): {"error":"invalid_grant"}',
        );
      },
      log: () => {},
    });

    assert.deepEqual(recovery, {
      action: "fail",
      reason: "stale-recovered",
      classified: {
        message: SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
        code: "subscription_login_refreshed",
      },
    });
    assert.deepEqual(localLogin(home), RECOVERED);
    assert.equal(calls.length, 1, "the recovered login is not pushed straight back");
    assert.equal(state.version, 7, "the run now runs on the recovered login");
    // And the publisher agrees: the API plainly holds this login, so no pass sends it back.
    const publisher = startSubscriptionPublisher({
      plan: {
        isDaytona: false,
        credentials: { subscription: SUBSCRIPTION, subscriptionHome: home },
      },
      state,
      sandbox: () => undefined,
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl: api.fetchImpl,
      log: () => {},
      intervalMs: 60_000,
    });
    assert.ok(publisher);
    await publisher.reconcile("interval");
    await publisher.stop();
    assert.equal(calls.length, 1);
  });

  it("a stale answer carrying a NEW generation fails retryably, it does not replay", async () => {
    const home = tempHome();
    const { api } = fakeApi({
      failure: {
        stale: true,
        version: 1,
        generation: 2,
        login: { ...RECOVERED, expires: 500 },
      },
    });
    const state = pushState();
    const recovery = await recoverSubscriptionAuthFailure({
      err: AUTH_ERROR,
      subscription: SUBSCRIPTION,
      state,
      home,
      isDaytona: false,
      api,
      refresh: async () => {
        throw new Error(
          'OpenAI Codex token refresh failed (400): {"error":"invalid_grant"}',
        );
      },
      log: () => {},
    });

    assert.equal(recovery?.action, "fail");
    assert.equal(
      recovery?.action === "fail" && recovery.classified.code,
      "subscription_login_refreshed",
    );
    // The new sign-in still lands on disk, even with a shorter life, so the next cold start uses it.
    assert.deepEqual(localLogin(home), { ...RECOVERED, expires: 500 });
    assert.equal(state.generation, 2);
  });

  it("a stale answer with no login is retryable, not a sign-in prompt", async () => {
    const home = tempHome();
    const { api } = fakeApi({ failure: { stale: true, version: 7 } });
    const recovery = await recoverSubscriptionAuthFailure({
      err: AUTH_ERROR,
      subscription: SUBSCRIPTION,
      state: pushState(),
      home,
      isDaytona: false,
      api,
      refresh: async () => {
        throw new Error(
          'OpenAI Codex token refresh failed (400): {"error":"invalid_grant"}',
        );
      },
      log: () => {},
    });
    assert.equal(
      recovery?.action === "fail" && recovery.classified.code,
      "subscription_login_refreshed",
    );
    assert.equal(
      recovery?.action === "fail" && recovery.reason,
      "stale-without-login",
    );
  });

  it("a failure report that never reaches the API asks for a sign-in", async () => {
    const home = tempHome();
    const api = {
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      log: () => {},
    };
    const recovery = await recoverSubscriptionAuthFailure({
      err: AUTH_ERROR,
      subscription: SUBSCRIPTION,
      state: pushState(),
      home,
      isDaytona: false,
      api,
      refresh: async () => {
        throw new Error(
          'OpenAI Codex token refresh failed (400): {"error":"invalid_grant"}',
        );
      },
      log: () => {},
    });
    assert.equal(
      recovery?.action === "fail" && recovery.classified.code,
      "subscription_login_required",
    );
  });

  it("no message it produces carries a token or a path", async () => {
    const home = tempHome();
    const { api } = fakeApi({ failure: { stale: false } });
    const lines: string[] = [];
    const recovery = await recoverSubscriptionAuthFailure({
      err: new Error(
        `Authentication failed for "openai-codex". token=${LOCAL.access}`,
      ),
      subscription: SUBSCRIPTION,
      state: pushState(),
      home,
      isDaytona: false,
      api,
      refresh: async () => {
        throw new Error(
          `OpenAI Codex token refresh failed (400): {"refresh_token":"${LOCAL.refresh}"}`,
        );
      },
      log: (line) => lines.push(line),
    });

    const surfaced = `${lines.join("\n")}\n${
      recovery?.action === "fail" ? recovery.classified.message : ""
    }`;
    for (const secret of [LOCAL.access, LOCAL.refresh, "acct_1", home]) {
      assert.ok(!surfaced.includes(secret), `leaked ${secret}`);
    }
  });
});
