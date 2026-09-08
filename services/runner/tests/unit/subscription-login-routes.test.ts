/**
 * Unit tests for the `/subscription-login/attempts` HTTP routes, driven at the WIRE.
 *
 * These boot the REAL server (`createAgentServer`) on an ephemeral port and make real `fetch`
 * calls, exactly like `tests/unit/server.test.ts` does for `/health`, `/run` and `/kill`. The
 * device-login provider is MOCKED through `setSubscriptionLoginAttempts`, which
 * `subscription-login-attempts.ts` exposes for precisely this reason: no OAuth, no network, no
 * human approving a code.
 *
 * WHY AT THIS LAYER. The attempt state machine is already covered one level down in
 * `subscription-login-attempts.test.ts`. What has had no coverage is the HTTP contract the API
 * actually calls: status codes, the token gate, the request-body limits, and the SHAPE of what
 * comes back. Every assertion here is on a status code or a response field, never on an internal
 * function name, so a refactor inside `subscription-*.ts` cannot break these without breaking the
 * contract in `docs/design/hosted-subscription-connections/implementation-contract.md` section 2.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/subscription-login-routes.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { createAgentServer, type RunAgent } from "../../src/server.ts";
import {
  SubscriptionLoginAttempts,
  setSubscriptionLoginAttempts,
  type DeviceCodeInfo,
  type DeviceCodeLogin,
} from "../../src/subscription-login-attempts.ts";
import { makeLogin } from "../utils/subscription-login.ts";

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const previousToken = process.env[TOKEN_ENV];

const TEST_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const JSON_HEADERS = { ...AUTH, "content-type": "application/json" };

/** The provider the runner accepts. Anything else is a 400 at the route. */
const PROVIDER = "chatgpt";

/** Values a mocked provider hands back. None of them is a credential. */
const USER_CODE = "WXYZ-9876";
const VERIFICATION_URI = "https://auth.openai.com/codex/device";

afterEach(() => {
  // Drop the injected store so the next test (and any other file) builds its own.
  setSubscriptionLoginAttempts(undefined);
  if (previousToken === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = previousToken;
});

/**
 * A mocked device-code provider. `announce()` fires the device code (which is what `start`
 * awaits), `approve()` resolves the long poll with a login, `refuse()` fails it.
 *
 * `announceOnCall` defaults to true so the common case reads as one line at the call site; the
 * "provider refused before issuing a code" case turns it off.
 */
function mockProvider(options: { announceOnCall?: boolean } = {}) {
  const announceOnCall = options.announceOnCall !== false;
  let announce: (info?: Partial<DeviceCodeInfo>) => void = () => {};
  let approve: (login: Record<string, unknown>) => void = () => {};
  let refuse: (err: unknown) => void = () => {};
  let calls = 0;

  const login: DeviceCodeLogin = (opts) => {
    calls += 1;
    announce = (info) =>
      opts.onDeviceCode({
        userCode: USER_CODE,
        verificationUri: VERIFICATION_URI,
        intervalSeconds: 7,
        expiresInSeconds: 900,
        ...info,
      });
    if (announceOnCall) announce();
    return new Promise((resolve, reject) => {
      approve = resolve as (login: Record<string, unknown>) => void;
      refuse = reject;
    }) as ReturnType<DeviceCodeLogin>;
  };

  return {
    login,
    announce: (info?: Partial<DeviceCodeInfo>) => announce(info),
    approve: (l: Record<string, unknown>) => approve(l),
    refuse: (err: unknown) => refuse(err),
    get calls() {
      return calls;
    },
  };
}

const okRun: RunAgent = async () => ({ ok: true, output: "hi", events: [] });

/**
 * Boot the real server with an injected attempt store. `token: null` leaves the env untouched so
 * the tokenless case can be probed.
 */
async function listen(
  attempts?: SubscriptionLoginAttempts,
  token: string | null = TEST_TOKEN,
): Promise<{ url: string; close: () => Promise<void> }> {
  if (token !== null) process.env[TOKEN_ENV] = token;
  setSubscriptionLoginAttempts(attempts);
  const server = createAgentServer(okRun);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Start one attempt over HTTP and return the parsed body. Fails the test on a non-200. */
async function startAttempt(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${url}/subscription-login/attempts`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ provider: PROVIDER }),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as Record<string, unknown>;
}

/** Poll the GET route until `state` matches, so a settled background promise is observed. */
async function getUntil(
  url: string,
  attemptId: string,
  state: string,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 50; i += 1) {
    const res = await fetch(
      `${url}/subscription-login/attempts/${encodeURIComponent(attemptId)}`,
      { headers: AUTH },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    if (body.state === state) return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`attempt never reached state=${state}`);
}

describe("POST /subscription-login/attempts", () => {
  it("returns the device code fields and never a token or a login", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const body = await startAttempt(s.url);

      // What the API needs to render the sign-in screen.
      assert.equal(typeof body.attemptId, "string");
      assert.ok((body.attemptId as string).length > 0);
      assert.equal(body.state, "pending");
      assert.equal(body.userCode, USER_CODE);
      assert.equal(body.verificationUri, VERIFICATION_URI);
      assert.equal(body.intervalSeconds, 7);
      assert.equal(typeof body.expiresAt, "string");
      assert.ok(!Number.isNaN(Date.parse(body.expiresAt as string)));

      // What must never ride the start response: the login blob, or anything token-shaped.
      assert.equal(body.login, undefined);
      assert.equal(body.access, undefined);
      assert.equal(body.refresh, undefined);
      assert.equal(body.error, undefined);
    } finally {
      await s.close();
    }
  });

  it("gates on the runner token: absent 401, wrong 401, right 200", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const noToken = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: PROVIDER }),
      });
      assert.equal(noToken.status, 401);
      assert.equal(((await noToken.json()) as { ok: boolean }).ok, false);

      const wrongToken = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: {
          authorization: "Bearer definitely-not-the-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ provider: PROVIDER }),
      });
      assert.equal(wrongToken.status, 401);

      // A refused request must never have reached the provider.
      assert.equal(provider.calls, 0);

      const right = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ provider: PROVIDER }),
      });
      assert.equal(right.status, 200);
      assert.equal(provider.calls, 1);
    } finally {
      await s.close();
    }
  });

  it("accepts the header form of the token too", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const res = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: {
          "x-agenta-runner-token": TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ provider: PROVIDER }),
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("rejects an unknown or missing provider with 400", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      for (const body of [
        JSON.stringify({ provider: "claude-max" }),
        JSON.stringify({ provider: "" }),
        JSON.stringify({}),
        "",
      ]) {
        const res = await fetch(`${s.url}/subscription-login/attempts`, {
          method: "POST",
          headers: JSON_HEADERS,
          body,
        });
        assert.equal(res.status, 400, `body=${JSON.stringify(body)}`);
        const parsed = (await res.json()) as { ok: boolean; error: string };
        assert.equal(parsed.ok, false);
        assert.equal(typeof parsed.error, "string");
      }
      // No provider call for any of the refused shapes.
      assert.equal(provider.calls, 0);
    } finally {
      await s.close();
    }
  });

  it("rejects an unparseable JSON body with 400", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const res = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: "{not json",
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, false);
      assert.equal(provider.calls, 0);
    } finally {
      await s.close();
    }
  });

  it("rejects an oversize body with 413, not buffered in full", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      // The start body is capped at 4 KiB; this is well past it and still valid JSON, so the
      // rejection proves the CAP fired rather than the parser.
      const oversized = JSON.stringify({
        provider: PROVIDER,
        pad: "x".repeat(64 * 1024),
      });
      // Streamed in small chunks with a real event-loop tick between them (rather than one
      // synchronous fetch() write), for the same reason `server.test.ts` does it on /kill: the
      // guard rejects AND destroys the socket, so the client can legitimately see the reset
      // instead of the 413 response. Either outcome proves the cap fired before the whole body
      // was ever buffered; a clean 413 is the ideal case.
      const url = new URL(`${s.url}/subscription-login/attempts`);
      const responseStatus = await new Promise<number | "reset">((resolve) => {
        const req = http.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: "POST",
            // Authorized: the token gate runs BEFORE the body is read, so an un-tokened
            // request would 401 without ever reaching the cap this test is about.
            headers: { "content-type": "application/json", ...AUTH },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? -1);
          },
        );
        req.on("error", () => resolve("reset"));
        void (async () => {
          const chunkSize = 1024;
          for (let i = 0; i < oversized.length; i += chunkSize) {
            if (req.destroyed) return;
            const ok = req.write(oversized.slice(i, i + chunkSize));
            if (!ok) await new Promise((r) => req.once("drain", r));
            await new Promise((r) => setImmediate(r));
          }
          if (!req.destroyed) req.end();
        })();
      });
      assert.ok(
        responseStatus === 413 || responseStatus === "reset",
        `expected 413 or a reset, got ${responseStatus}`,
      );
      // Whichever way it ended, the provider was never reached.
      assert.equal(provider.calls, 0);
    } finally {
      await s.close();
    }
  });

  it("accepts a start body that sits inside the cap", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const res = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ provider: PROVIDER, pad: "x".repeat(512) }),
      });
      assert.equal(res.status, 200);
      assert.equal(provider.calls, 1);
    } finally {
      await s.close();
    }
  });

  it("reports a provider that refuses before issuing a code as 502", async () => {
    const provider = mockProvider({ announceOnCall: false });
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const pending = fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ provider: PROVIDER }),
      });
      // Let the route reach the provider before failing it.
      await new Promise((resolve) => setTimeout(resolve, 10));
      provider.refuse(new Error("device authorization endpoint said no"));
      const res = await pending;
      assert.equal(res.status, 502);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      // The provider's own words never reach the wire, only a short reason.
      assert.ok(!body.error.includes("device authorization endpoint"));
    } finally {
      await s.close();
    }
  });
});

describe("GET /subscription-login/attempts/{id}", () => {
  it("returns pending, then succeeded with the login once the provider resolves", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const started = await startAttempt(s.url);
      const attemptId = started.attemptId as string;

      const pending = await getUntil(s.url, attemptId, "pending");
      assert.equal(pending.attemptId, attemptId);
      assert.equal(pending.userCode, USER_CODE);
      assert.equal(pending.verificationUri, VERIFICATION_URI);
      // Nothing to hand over yet.
      assert.equal(pending.login, undefined);

      const login = makeLogin({ refresh: "fixture-refresh", accountId: "acct_wire" });
      provider.approve({ ...login });

      const succeeded = await getUntil(s.url, attemptId, "succeeded");
      assert.equal(succeeded.attemptId, attemptId);
      const delivered = succeeded.login as Record<string, unknown>;
      assert.ok(delivered, "a succeeded attempt hands the login to the API");
      assert.equal(delivered.type, "oauth");
      assert.equal(delivered.refresh, "fixture-refresh");
      assert.equal(delivered.accountId, "acct_wire");
      assert.equal(typeof delivered.access, "string");
      assert.equal(typeof delivered.expires, "number");
      // The login is handed out on every poll until the API acknowledges with DELETE.
      const again = await getUntil(s.url, attemptId, "succeeded");
      assert.ok(again.login, "a second poll still carries the login");
      assert.equal(succeeded.error, undefined);
    } finally {
      await s.close();
    }
  });

  it("keeps handing the login out on repeat reads until the DELETE", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const started = await startAttempt(s.url);
      const attemptId = started.attemptId as string;
      provider.approve({ ...makeLogin({ refresh: "second-read" }) });
      await getUntil(s.url, attemptId, "succeeded");

      // A poll whose response was lost in flight must be able to ask again (amendment A5).
      const second = await getUntil(s.url, attemptId, "succeeded");
      assert.equal(
        (second.login as Record<string, unknown>).refresh,
        "second-read",
      );
    } finally {
      await s.close();
    }
  });

  it("surfaces a failed provider poll as a state, not an HTTP error", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const started = await startAttempt(s.url);
      const attemptId = started.attemptId as string;
      provider.refuse(new Error("approval was declined"));

      const failed = await getUntil(s.url, attemptId, "failed");
      assert.equal(failed.login, undefined);
      assert.equal(typeof failed.error, "string");
      assert.ok(!(failed.error as string).includes("declined"));
    } finally {
      await s.close();
    }
  });

  it("is 404 for an id this runner never started", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const res = await fetch(
        `${s.url}/subscription-login/attempts/00000000-0000-4000-8000-000000000000`,
        { headers: AUTH },
      );
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, false);
    } finally {
      await s.close();
    }
  });

  it("is 401 without a token, and does not leak whether the id exists", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const started = await startAttempt(s.url);
      const attemptId = started.attemptId as string;

      const real = await fetch(
        `${s.url}/subscription-login/attempts/${attemptId}`,
        {},
      );
      const fake = await fetch(
        `${s.url}/subscription-login/attempts/does-not-exist`,
        {},
      );
      assert.equal(real.status, 401);
      assert.equal(fake.status, 401);
    } finally {
      await s.close();
    }
  });
});

describe("DELETE /subscription-login/attempts/{id}", () => {
  it("is 204 and idempotent, and the attempt is gone afterwards", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const started = await startAttempt(s.url);
      const attemptId = started.attemptId as string;
      provider.approve({ ...makeLogin() });
      await getUntil(s.url, attemptId, "succeeded");

      const first = await fetch(
        `${s.url}/subscription-login/attempts/${attemptId}`,
        { method: "DELETE", headers: AUTH },
      );
      assert.equal(first.status, 204);

      // Repeat delete: still 204, never a 404 and never a 500.
      const second = await fetch(
        `${s.url}/subscription-login/attempts/${attemptId}`,
        { method: "DELETE", headers: AUTH },
      );
      assert.equal(second.status, 204);

      // And an id nothing ever held.
      const unknown = await fetch(
        `${s.url}/subscription-login/attempts/never-existed`,
        { method: "DELETE", headers: AUTH },
      );
      assert.equal(unknown.status, 204);

      // The credential is no longer readable through the route.
      const after = await fetch(
        `${s.url}/subscription-login/attempts/${attemptId}`,
        { headers: AUTH },
      );
      assert.equal(after.status, 404);
    } finally {
      await s.close();
    }
  });

  it("is 401 without a token", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const started = await startAttempt(s.url);
      const res = await fetch(
        `${s.url}/subscription-login/attempts/${started.attemptId as string}`,
        { method: "DELETE" },
      );
      assert.equal(res.status, 401);
      // Still readable: the refused delete did nothing.
      const after = await fetch(
        `${s.url}/subscription-login/attempts/${started.attemptId as string}`,
        { headers: AUTH },
      );
      assert.equal(after.status, 200);
    } finally {
      await s.close();
    }
  });
});

describe("subscription-login route shape", () => {
  it("answers 405 for an unsupported method on an attempt", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const started = await startAttempt(s.url);
      for (const method of ["PUT", "PATCH"]) {
        const res = await fetch(
          `${s.url}/subscription-login/attempts/${started.attemptId as string}`,
          { method, headers: JSON_HEADERS, body: "{}" },
        );
        assert.equal(res.status, 405, method);
        const body = (await res.json()) as { ok: boolean };
        assert.equal(body.ok, false);
      }
    } finally {
      await s.close();
    }
  });

  it("answers 404 for the collection route under a method it does not serve", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      // No attempt id in the path, and not the POST that creates one.
      const res = await fetch(`${s.url}/subscription-login/attempts`, {
        headers: AUTH,
      });
      assert.equal(res.status, 404);
    } finally {
      await s.close();
    }
  });

  it("does not treat a nested path as an attempt id", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const res = await fetch(
        `${s.url}/subscription-login/attempts/abc/../../health`,
        { headers: AUTH },
      );
      assert.ok(res.status === 404 || res.status === 200);
      // Whatever the client normalized to, no attempt view came back.
      if (res.status === 200) {
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(body.attemptId, undefined);
      }
    } finally {
      await s.close();
    }
  });

  it("ignores a query string when reading the attempt id", async () => {
    const provider = mockProvider();
    const s = await listen(new SubscriptionLoginAttempts(provider.login, () => {}));
    try {
      const started = await startAttempt(s.url);
      const res = await fetch(
        `${s.url}/subscription-login/attempts/${started.attemptId as string}?wait=1`,
        { headers: AUTH },
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.attemptId, started.attemptId);
    } finally {
      await s.close();
    }
  });
});
