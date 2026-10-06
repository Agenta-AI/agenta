/**
 * Unit tests for the `/subscription-login/attempts` HTTP routes, driven at the WIRE.
 *
 * These boot the REAL server (`createAgentServer`) on an ephemeral port and make real `fetch`
 * calls, exactly like `tests/unit/server.test.ts` does for `/health`, `/run` and `/kill`. The
 * device-login provider and the outcome report are MOCKED through `setSubscriptionLoginAttempts`,
 * which `subscription-login-attempts.ts` exposes for precisely this reason: no OAuth, no network,
 * no human approving a code, no API.
 *
 * WHY AT THIS LAYER. The attempt state machine is already covered one level down in
 * `subscription-login-attempts.test.ts`. What this file pins is the HTTP contract the API calls:
 * status codes, the token gate, the request-body limits, and the SHAPE of what comes back. Every
 * assertion here is on a status code, a response field, or an outcome the report received, never
 * on an internal function name.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/subscription-login-routes.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import type { RunAgent } from "../../src/server.ts";
import type {
  AttemptOutcome,
  DeviceCodeInfo,
  DeviceCodeLogin,
  SubscriptionLoginAttempts as AttemptsStore,
} from "../../src/subscription-login-attempts.ts";
import { makeLogin } from "../utils/subscription-login.ts";

// The pod address and the replica id are read once per process, so they are set before the import.
const REPLICA_ADDRESS = "http://10.8.2.17:8765";
const REPLICA_ID = "agenta-runner-6f9c7d5b8-aaaaa";
process.env.AGENTA_RUNNER_REPLICA_ADDRESS = REPLICA_ADDRESS;
process.env.AGENTA_RUNNER_REPLICA_ID = REPLICA_ID;
const { createAgentServer } = await import("../../src/server.ts");
const { SubscriptionLoginAttempts, setSubscriptionLoginAttempts } = await import(
  "../../src/subscription-login-attempts.ts"
);
delete process.env.AGENTA_RUNNER_REPLICA_ADDRESS;
delete process.env.AGENTA_RUNNER_REPLICA_ID;

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const previousToken = process.env[TOKEN_ENV];

const TEST_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const JSON_HEADERS = { ...AUTH, "content-type": "application/json" };

/** The provider the runner accepts. Anything else is a 400 at the route. */
const PROVIDER = "chatgpt";

/** The connection the API starts a sign-in for. Ids, not secrets. */
const OWNER = { projectId: "project-1", secretId: "secret-1" };
const START_BODY = { provider: PROVIDER, ...OWNER };

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
  let aborted = false;

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
      opts.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
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
    get aborted() {
      return aborted;
    },
  };
}

/** A store over `provider` whose outcome reports land in `outcomes`. */
function store(provider: ReturnType<typeof mockProvider>) {
  const outcomes: AttemptOutcome[] = [];
  const attempts = new SubscriptionLoginAttempts(
    provider.login,
    async (outcome) => {
      outcomes.push(outcome);
    },
    () => {},
  );
  return { attempts, outcomes };
}

const okRun: RunAgent = async () => ({ ok: true, output: "hi", events: [] });

/**
 * Boot the real server with an injected attempt store. `token: null` leaves the env untouched so
 * the tokenless case can be probed.
 */
async function listen(
  attempts?: AttemptsStore,
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
    body: JSON.stringify(START_BODY),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as Record<string, unknown>;
}

/** Wait until the store has reported `count` outcomes. */
async function outcomesReach(
  outcomes: AttemptOutcome[],
  count: number,
): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (outcomes.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`only ${outcomes.length} outcome(s) were reported`);
}

describe("POST /subscription-login/attempts", () => {
  it("returns the device code fields and this pod's address, never a token or a login", async () => {
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
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
      // What the API needs to send a cancel to this pod rather than to the Service URL, and to
      // check first that the address still belongs to this pod.
      assert.equal(body.replicaAddress, REPLICA_ADDRESS);
      assert.equal(body.replicaId, REPLICA_ID);

      // What must never ride the start response: the login blob, or anything token-shaped.
      assert.equal(body.login, undefined);
      assert.equal(body.access, undefined);
      assert.equal(body.refresh, undefined);
      assert.equal(body.error, undefined);
    } finally {
      await s.close();
    }
  });

  it("names the same replica id that GET /health answers, so the API can check the address", async () => {
    const s = await listen(store(mockProvider()).attempts);
    try {
      const body = await startAttempt(s.url);
      const health = (await (await fetch(`${s.url}/health`)).json()) as Record<
        string,
        unknown
      >;

      assert.equal(health.replicaId, REPLICA_ID);
      assert.equal(health.replicaId, body.replicaId);
    } finally {
      await s.close();
    }
  });

  it("reports the outcome for the connection the start named", async () => {
    const provider = mockProvider();
    const { attempts, outcomes } = store(provider);
    const s = await listen(attempts);
    try {
      const started = await startAttempt(s.url);
      const login = makeLogin({ refresh: "fixture-refresh", accountId: "acct_wire" });
      provider.approve({ ...login });
      await outcomesReach(outcomes, 1);

      assert.equal(outcomes.length, 1);
      const [outcome] = outcomes;
      assert.equal(outcome.attemptId, started.attemptId);
      assert.equal(outcome.projectId, OWNER.projectId);
      assert.equal(outcome.secretId, OWNER.secretId);
      assert.equal(outcome.state, "succeeded");
      assert.equal(outcome.login?.type, "oauth");
      assert.equal(outcome.login?.refresh, "fixture-refresh");
      assert.equal(attempts.size(), 0, "the pod keeps nothing once the outcome is out");
    } finally {
      await s.close();
    }
  });

  it("requires the connection ids, so the outcome has somewhere to go", async () => {
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
    try {
      for (const body of [
        { provider: PROVIDER },
        { provider: PROVIDER, projectId: "project-1" },
        { provider: PROVIDER, secretId: "secret-1" },
        { provider: PROVIDER, projectId: "  ", secretId: "secret-1" },
        { provider: PROVIDER, projectId: 7, secretId: "secret-1" },
      ]) {
        const res = await fetch(`${s.url}/subscription-login/attempts`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        });
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      assert.equal(provider.calls, 0);
    } finally {
      await s.close();
    }
  });

  it("gates on the runner token: absent 401, wrong 401, right 200", async () => {
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
    try {
      const noToken = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(START_BODY),
      });
      assert.equal(noToken.status, 401);
      assert.equal(((await noToken.json()) as { ok: boolean }).ok, false);

      const wrongToken = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: {
          authorization: "Bearer definitely-not-the-token",
          "content-type": "application/json",
        },
        body: JSON.stringify(START_BODY),
      });
      assert.equal(wrongToken.status, 401);

      // A refused request must never have reached the provider.
      assert.equal(provider.calls, 0);

      const right = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(START_BODY),
      });
      assert.equal(right.status, 200);
      assert.equal(provider.calls, 1);
    } finally {
      await s.close();
    }
  });

  it("accepts the header form of the token too", async () => {
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
    try {
      const res = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: {
          "x-agenta-runner-token": TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify(START_BODY),
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("rejects an unknown or missing provider with 400", async () => {
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
    try {
      for (const body of [
        JSON.stringify({ ...OWNER, provider: "claude-max" }),
        JSON.stringify({ ...OWNER, provider: "" }),
        JSON.stringify(OWNER),
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
    const s = await listen(store(provider).attempts);
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
    const s = await listen(store(provider).attempts);
    try {
      // The start body is capped at 4 KiB; this is well past it and still valid JSON, so the
      // rejection proves the CAP fired rather than the parser.
      const oversized = JSON.stringify({
        ...START_BODY,
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
    const s = await listen(store(provider).attempts);
    try {
      const res = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...START_BODY, pad: "x".repeat(512) }),
      });
      assert.equal(res.status, 200);
      assert.equal(provider.calls, 1);
    } finally {
      await s.close();
    }
  });

  it("reports a provider that refuses before issuing a code as 502", async () => {
    const provider = mockProvider({ announceOnCall: false });
    const { attempts, outcomes } = store(provider);
    const s = await listen(attempts);
    try {
      const pending = fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(START_BODY),
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
      // The API stored no record for a start that failed, so there is nothing to report.
      assert.deepEqual(outcomes, []);
    } finally {
      await s.close();
    }
  });
});

describe("DELETE /subscription-login/attempts/{id}", () => {
  it("is 204, stops the provider poll, and reports nothing", async () => {
    const provider = mockProvider();
    const { attempts, outcomes } = store(provider);
    const s = await listen(attempts);
    try {
      const started = await startAttempt(s.url);
      const attemptId = started.attemptId as string;

      const first = await fetch(
        `${s.url}/subscription-login/attempts/${attemptId}`,
        { method: "DELETE", headers: AUTH },
      );
      assert.equal(first.status, 204);
      assert.equal(first.headers.get("cache-control"), "no-store");
      assert.equal(provider.aborted, true);
      assert.equal(attempts.size(), 0);

      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual(outcomes, [], "the API cleared the record before it sent the DELETE");
    } finally {
      await s.close();
    }
  });

  it("is 204 and idempotent, for a repeat and for an id this pod never held", async () => {
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
    try {
      const started = await startAttempt(s.url);
      const attemptId = started.attemptId as string;

      for (const id of [attemptId, attemptId, "never-existed"]) {
        const res = await fetch(`${s.url}/subscription-login/attempts/${id}`, {
          method: "DELETE",
          headers: AUTH,
        });
        assert.equal(res.status, 204, id);
      }
    } finally {
      await s.close();
    }
  });

  it("is 401 without a token, and the attempt keeps running", async () => {
    const provider = mockProvider();
    const { attempts } = store(provider);
    const s = await listen(attempts);
    try {
      const started = await startAttempt(s.url);
      const res = await fetch(
        `${s.url}/subscription-login/attempts/${started.attemptId as string}`,
        { method: "DELETE" },
      );
      assert.equal(res.status, 401);
      assert.equal(provider.aborted, false);
      assert.equal(attempts.size(), 1);
    } finally {
      await s.close();
    }
  });
});

describe("subscription-login route shape", () => {
  it("serves no read: the outcome reaches the API as a report instead", async () => {
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
    try {
      const started = await startAttempt(s.url);
      for (const method of ["GET", "PUT", "PATCH"]) {
        const res = await fetch(
          `${s.url}/subscription-login/attempts/${started.attemptId as string}`,
          {
            method,
            headers: JSON_HEADERS,
            ...(method === "GET" ? {} : { body: "{}" }),
          },
        );
        assert.equal(res.status, 405, method);
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(body.ok, false);
        assert.equal(body.userCode, undefined);
      }
    } finally {
      await s.close();
    }
  });

  it("answers 404 for the collection route under a method it does not serve", async () => {
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
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
    const s = await listen(store(provider).attempts);
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

  it("answers 404, not 500, for an id with a malformed escape", async () => {
    // `decodeURIComponent` throws on `%ZZ`. An id this runner never minted must read as 404
    // rather than as a server fault.
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
    try {
      const res = await fetch(`${s.url}/subscription-login/attempts/%ZZ`, {
        method: "DELETE",
        headers: AUTH,
      });
      assert.equal(res.status, 404);
    } finally {
      await s.close();
    }
  });

  it("marks the start answer no-store, so no cache keeps a code", async () => {
    const provider = mockProvider();
    const s = await listen(store(provider).attempts);
    try {
      const start = await fetch(`${s.url}/subscription-login/attempts`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(START_BODY),
      });
      assert.equal(start.status, 200);
      assert.equal(start.headers.get("cache-control"), "no-store");
    } finally {
      await s.close();
    }
  });

  it("ignores a query string when reading the attempt id", async () => {
    const provider = mockProvider();
    const { attempts } = store(provider);
    const s = await listen(attempts);
    try {
      const started = await startAttempt(s.url);
      const res = await fetch(
        `${s.url}/subscription-login/attempts/${started.attemptId as string}?wait=1`,
        { method: "DELETE", headers: AUTH },
      );
      assert.equal(res.status, 204);
      assert.equal(provider.aborted, true, "the id before the query string was cancelled");
    } finally {
      await s.close();
    }
  });
});
