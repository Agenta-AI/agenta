/**
 * Unit tests for the gate that keeps a corrupt or tampered login out of the vault, and for the
 * version a failure report is allowed to quote.
 *
 * THE DEFECT THESE PIN, measured live on 2026-09-08. The runner's local `auth.json` was rewritten
 * with junk `access` and `refresh` strings and a LATER `expires`. Every gate on the publish path
 * asked only "is it newer", `expires` is one number, so the junk sailed through and overwrote the
 * project's good stored login. The failure report that followed quoted a version a push earlier in
 * the same run had learned, so it looked current, the API answered `stale: false`, and the
 * connection was marked `needs_login`. One bad file cost the user their sign-in twice over.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-login-validate.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  pushSubscriptionLogin,
  reportSubscriptionLoginFailure,
  subscriptionPushState,
  validateSubscriptionLogin,
} from "../../src/engines/sandbox_agent/subscription-login.ts";
import type { ModelConnectionSubscription } from "../../src/protocol.ts";
import { accessToken, makeLogin } from "../utils/subscription-login.ts";

const GOOD = makeLogin({ expires: Date.now() + 3_600_000 });

const SUBSCRIPTION: ModelConnectionSubscription = {
  id: "conn-1",
  slug: "chatgpt",
  provider: "chatgpt",
  version: 3,
  generation: 1,
  login: GOOD,
};

function recordingFetch(): {
  calls: Array<{ url: string; body: Record<string, unknown> }>;
  fetchImpl: typeof fetch;
} {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ version: 9, stale: false }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("validateSubscriptionLogin", () => {
  it("accepts a real-shaped login", () => {
    assert.deepEqual(validateSubscriptionLogin(GOOD), { ok: true });
  });

  it("rejects the exact garbage that reached the API on the stale-session cell", () => {
    // Junk tokens, a LATER expiry. Newer, and worthless.
    const garbage = {
      ...GOOD,
      access: "aaaaaaaaaaaa",
      refresh: "bbbbbbbbbbbb",
      expires: Date.now() + 86_400_000,
    };
    assert.deepEqual(validateSubscriptionLogin(garbage), {
      ok: false,
      reason: "access_not_jwt",
    });
  });

  it("rejects a token whose account claim names a DIFFERENT account", () => {
    // The one case a "does it look like a JWT" check would wave through, and the one that would
    // hand another tenant's credential to this project's connection.
    assert.deepEqual(
      validateSubscriptionLogin({ ...GOOD, access: accessToken("acct_other") }),
      { ok: false, reason: "account_mismatch" },
    );
  });

  it("rejects a well-formed JWT with no account claim at all", () => {
    assert.deepEqual(
      validateSubscriptionLogin({ ...GOOD, access: accessToken(undefined) }),
      { ok: false, reason: "account_claim_missing" },
    );
  });

  it("accepts a login that carries no accountId, since the claim identifies the account", () => {
    const { accountId: _dropped, ...withoutId } = GOOD;
    assert.deepEqual(validateSubscriptionLogin(withoutId as typeof GOOD), {
      ok: true,
    });
  });

  it("rejects a missing or empty refresh token", () => {
    for (const refresh of ["", "   ", undefined as unknown as string]) {
      assert.deepEqual(validateSubscriptionLogin({ ...GOOD, refresh }), {
        ok: false,
        reason: "refresh_missing",
      });
    }
  });

  it("rejects an expiry that is absent, unusable, or already past", () => {
    assert.equal(
      validateSubscriptionLogin({ ...GOOD, expires: undefined as never }).ok,
      false,
    );
    assert.deepEqual(
      validateSubscriptionLogin({ ...GOOD, expires: "soon" as never }),
      { ok: false, reason: "expires_invalid" },
    );
    assert.deepEqual(
      validateSubscriptionLogin({ ...GOOD, expires: Date.now() - 1 }),
      { ok: false, reason: "expires_past" },
    );
  });

  it("rejects a missing login outright", () => {
    assert.deepEqual(validateSubscriptionLogin(undefined), {
      ok: false,
      reason: "access_missing",
    });
  });
});

describe("pushSubscriptionLogin is the one gate", () => {
  it("does not send a login that fails validation, and says so", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const state = subscriptionPushState(SUBSCRIPTION);
    const lines: string[] = [];
    const garbage = {
      ...GOOD,
      access: "aaaa",
      refresh: "bbbb",
      expires: Date.now() + 86_400_000,
    };

    await pushSubscriptionLogin(SUBSCRIPTION, state, garbage, {
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: (line) => lines.push(line),
    });

    assert.deepEqual(calls, [], "nothing may reach the API");
    assert.match(lines.join("\n"), /push skipped reason=unparseable/);
    assert.match(lines.join("\n"), /check=access_not_jwt/);
    // The floor must not move either: a skipped push is not a push.
    assert.equal(state.pushedExpires, undefined);
    assert.equal(state.version, 3);
  });

  it("still sends a real login", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const state = subscriptionPushState(SUBSCRIPTION);
    const better = makeLogin({ expires: Date.now() + 7_200_000 });

    await pushSubscriptionLogin(SUBSCRIPTION, state, better, {
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.login, better);
    assert.equal(state.version, 9);
  });

  it("never puts the login in the skip log", async () => {
    const { fetchImpl } = recordingFetch();
    const lines: string[] = [];
    const garbage = { ...GOOD, access: "SECRET-JUNK-VALUE", refresh: "SECRET-REFRESH" };
    await pushSubscriptionLogin(
      SUBSCRIPTION,
      subscriptionPushState(SUBSCRIPTION),
      garbage,
      {
        apiBase: "http://api:8000",
        authorization: "ApiKey secret",
        fetchImpl,
        log: (line) => lines.push(line),
      },
    );
    const joined = lines.join("\n");
    for (const secret of ["SECRET-JUNK-VALUE", "SECRET-REFRESH", "acct_1"]) {
      assert.ok(!joined.includes(secret), `log leaked ${secret}`);
    }
  });
});

describe("a failure report quotes the DELIVERED version", () => {
  it("does not quote a version a push in the same run learned", async () => {
    // The live sequence: a push lands and the API answers with a new version, then the turn fails.
    // Quoting that new version tells the API "I ran on the current login", so a connection that
    // had simply moved on gets marked needs_login instead of answering stale.
    const state = subscriptionPushState(SUBSCRIPTION);
    const { calls, fetchImpl } = recordingFetch();

    await pushSubscriptionLogin(
      SUBSCRIPTION,
      state,
      makeLogin({ expires: Date.now() + 7_200_000 }),
      {
        apiBase: "http://api:8000",
        authorization: "ApiKey secret",
        fetchImpl,
        log: () => {},
      },
    );
    assert.equal(state.version, 9, "the push followed the API");

    await reportSubscriptionLoginFailure(SUBSCRIPTION, state, "auth_failed", {
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
    });

    const report = calls.at(-1);
    assert.match(String(report?.url), /subscription-login\/failure$/);
    assert.deepEqual(report?.body, {
      version: 3,
      generation: 1,
      reason: "auth_failed",
    });
  });

  it("keeps the delivered pair immutable across several pushes", async () => {
    const state = subscriptionPushState(SUBSCRIPTION);
    const { fetchImpl } = recordingFetch();
    for (const hours of [2, 3, 4]) {
      await pushSubscriptionLogin(
        SUBSCRIPTION,
        state,
        makeLogin({ expires: Date.now() + hours * 3_600_000 }),
        {
          apiBase: "http://api:8000",
          authorization: "ApiKey secret",
          fetchImpl,
          log: () => {},
        },
      );
    }
    assert.equal(state.deliveredVersion, 3);
    assert.equal(state.deliveredGeneration, 1);
  });
});
