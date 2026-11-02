/**
 * Unit tests for the gate that keeps a corrupt or tampered login out of the vault, and for the
 * version a failure report is allowed to quote.
 *
 * THE DEFECT THESE PIN, measured live on 2026-09-08. The runner's local `auth.json` was rewritten
 * with junk `access` and `refresh` strings and a LATER `expires`. Every gate on the publish path
 * asked only "is it newer", `expires` is one number, so the junk sailed through and overwrote the
 * project's good stored login. The failure report that followed then looked current, the API
 * answered `stale: false`, and the connection was marked `needs_login`. One bad file cost the user
 * their sign-in twice over.
 *
 * The shape check below is what stops it. A push therefore only ever moves the row to a login that
 * passed the check, which is what makes it safe for the publisher to learn the row version back
 * from an accepted push (`subscription-login-publish.test.ts`).
 *
 * Run: pnpm exec vitest run tests/unit/subscription-login-validate.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  reportSubscriptionLoginFailure,
  subscriptionPublishState,
} from "../../src/engines/sandbox_agent/subscription-login/publisher.ts";
import { validateSubscriptionLogin } from "../../src/engines/sandbox_agent/subscription-login/validate.ts";
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

describe("a failure report quotes the row version this session knows", () => {
  it("quotes the delivered pair when nothing has moved it", async () => {
    // A session that never published and never recovered still runs on the delivered login, so the
    // report asks about that one. The two events that move it are covered in the publish and
    // recovery suites.
    const state = subscriptionPublishState(SUBSCRIPTION);
    const { calls, fetchImpl } = recordingFetch();
    const api = {
      apiBase: "http://api:8000",
      authorization: "ApiKey secret",
      fetchImpl,
      log: () => {},
    };

    await reportSubscriptionLoginFailure(SUBSCRIPTION, state, "auth_failed", api);

    const report = calls.at(-1);
    assert.match(String(report?.url), /subscription-login\/failure$/);
    assert.deepEqual(report?.body, {
      version: 3,
      generation: 1,
      reason: "auth_failed",
    });
    assert.equal(state.version, 3, "no push and no adoption, so nothing moved it");
    assert.equal(state.generation, 1);
  });

  it("never puts the login or the API body in the log", async () => {
    const lines: string[] = [];
    const { fetchImpl } = recordingFetch();
    await reportSubscriptionLoginFailure(
      SUBSCRIPTION,
      subscriptionPublishState(SUBSCRIPTION),
      "auth_failed",
      {
        apiBase: "http://api:8000",
        authorization: "ApiKey secret",
        fetchImpl,
        log: (line) => lines.push(line),
      },
    );
    const joined = lines.join("\n");
    for (const secret of [GOOD.access, GOOD.refresh, "ApiKey secret"]) {
      assert.ok(!joined.includes(String(secret)), `log leaked ${secret}`);
    }
  });
});
