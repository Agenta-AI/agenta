/**
 * Unit tests for the hosted subscription device-login attempt state machine, and for the report
 * that carries an attempt's outcome to the API.
 *
 * The provider is mocked: `SubscriptionLoginAttempts` takes the login function and the report
 * function as constructor arguments precisely so these run with no network, no OAuth, and no API.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/subscription-login-attempts.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  ABANDONED_ATTEMPT_REASON,
  SubscriptionLoginAttempts,
  reportAttemptOutcome,
  type AttemptOutcome,
  type DeviceCodeInfo,
} from "../../src/subscription-login-attempts.ts";

const LOGIN = {
  access: "access-token",
  refresh: "refresh-token",
  expires: 1_800_000_000_000,
  accountId: "acct_1",
};

const OWNER = { projectId: "project-1", secretId: "secret-1" };

const USER_CODE = "ABCD-1234";
const VERIFICATION_URI = "https://auth.openai.com/codex/device";

/** A login function whose device code fires at once and whose approval the test resolves. */
function controllableLogin(info: Partial<DeviceCodeInfo> = {}) {
  let approve: (value: typeof LOGIN) => void = () => {};
  let refuse: (err: unknown) => void = () => {};
  const login = (options: {
    onDeviceCode: (info: DeviceCodeInfo) => void;
    signal?: AbortSignal;
  }) => {
    options.onDeviceCode({
      userCode: USER_CODE,
      verificationUri: VERIFICATION_URI,
      intervalSeconds: 7,
      expiresInSeconds: 900,
      ...info,
    });
    return new Promise<typeof LOGIN>((resolve, reject) => {
      approve = resolve;
      refuse = reject;
      options.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
    });
  };
  return {
    login,
    approve: (value = LOGIN) => approve(value),
    refuse: (err: unknown) => refuse(err),
  };
}

/** A report function that records every outcome it is handed. */
function recordingReport() {
  const outcomes: AttemptOutcome[] = [];
  const options: Array<{ retry?: boolean } | undefined> = [];
  const report = async (
    outcome: AttemptOutcome,
    reportOptions?: { retry?: boolean },
  ) => {
    outcomes.push(outcome);
    options.push(reportOptions);
  };
  return { outcomes, options, report };
}

/** Lets the microtask queue drain so a settled login promise has reported its outcome. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SubscriptionLoginAttempts", () => {
  it("returns the user code as soon as the provider issues it, still pending", async () => {
    const provider = controllableLogin();
    const { outcomes, report } = recordingReport();
    const attempts = new SubscriptionLoginAttempts(provider.login, report, () => {});

    const started = await attempts.start("chatgpt", OWNER);

    assert.equal(started.state, "pending");
    assert.equal(started.userCode, USER_CODE);
    assert.equal(started.verificationUri, VERIFICATION_URI);
    assert.equal(started.intervalSeconds, 7);
    assert.ok(started.expiresAt);
    assert.equal("login" in started, false);
    assert.equal(outcomes.length, 0, "nothing is reported while the user is at the provider");
  });

  it("reports a success with the login and the connection ids, then forgets the attempt", async () => {
    const provider = controllableLogin();
    const { outcomes, report } = recordingReport();
    const attempts = new SubscriptionLoginAttempts(provider.login, report, () => {});
    const { attemptId } = await attempts.start("chatgpt", OWNER);

    provider.approve();
    await settle();

    assert.deepEqual(outcomes, [
      {
        attemptId,
        projectId: OWNER.projectId,
        secretId: OWNER.secretId,
        state: "succeeded",
        // `type` is stamped on, so the vault stores the file-ready Pi shape.
        login: { type: "oauth", ...LOGIN },
      },
    ]);
    // The login rode the report and nothing in the store still holds it.
    assert.equal(attempts.size(), 0);
  });

  it("reports a refused login as failed with a reason that quotes nothing", async () => {
    const provider = controllableLogin();
    const { outcomes, report } = recordingReport();
    const attempts = new SubscriptionLoginAttempts(provider.login, report, () => {});
    const { attemptId } = await attempts.start("chatgpt", OWNER);

    provider.refuse(
      new Error("device code POST failed: user_code=ABCD-1234 secret=xyz"),
    );
    await settle();

    assert.deepEqual(outcomes, [
      { attemptId, ...OWNER, state: "failed", error: "login_failed" },
    ]);
    assert.equal(attempts.size(), 0);
  });

  it("reports a provider timeout as expired", async () => {
    const provider = controllableLogin();
    const { outcomes, report } = recordingReport();
    const attempts = new SubscriptionLoginAttempts(provider.login, report, () => {});
    const { attemptId } = await attempts.start("chatgpt", OWNER);

    provider.refuse(new Error("Device code login timed out"));
    await settle();

    assert.deepEqual(outcomes, [
      { attemptId, ...OWNER, state: "expired", error: "timed_out" },
    ]);
  });

  it("aborts the flow on cancel, forgets the attempt, and reports nothing", async () => {
    let aborted = false;
    let approveAnyway: (value: typeof LOGIN) => void = () => {};
    const login = (options: {
      onDeviceCode: (info: DeviceCodeInfo) => void;
      signal?: AbortSignal;
    }) => {
      options.onDeviceCode({
        userCode: "WXYZ-9999",
        verificationUri: VERIFICATION_URI,
      });
      return new Promise<typeof LOGIN>((resolve) => {
        approveAnyway = resolve;
        options.signal?.addEventListener("abort", () => {
          aborted = true;
        });
      });
    };
    const { outcomes, report } = recordingReport();
    const attempts = new SubscriptionLoginAttempts(login, report, () => {});
    const { attemptId } = await attempts.start("chatgpt", OWNER);

    attempts.cancel(attemptId);
    // The provider answered just as the cancel landed. The API already cleared the record, so
    // the login must not travel anywhere.
    approveAnyway(LOGIN);
    await settle();

    assert.equal(aborted, true, "the AbortController stops the provider poll");
    assert.equal(attempts.size(), 0);
    assert.deepEqual(outcomes, []);
    // A repeated cancel is a no-op, so the route stays idempotent.
    attempts.cancel(attemptId);
  });

  it("fails the start when the provider never issues a device code, and reports nothing", async () => {
    const login = () => Promise.reject(new Error("bad client id"));
    const { outcomes, report } = recordingReport();
    const attempts = new SubscriptionLoginAttempts(login, report, () => {});

    await assert.rejects(
      () => attempts.start("chatgpt", OWNER),
      /subscription login could not start: login_failed/,
    );
    await settle();
    // A start that never became actionable leaves nothing behind and nothing to report: the API
    // answered the browser's start with an error and stored no record.
    assert.equal(attempts.size(), 0);
    assert.deepEqual(outcomes, []);
  });

  it("survives a report function that throws", async () => {
    const provider = controllableLogin();
    const attempts = new SubscriptionLoginAttempts(
      provider.login,
      async () => {
        throw new Error("broken reporter");
      },
      () => {},
    );
    await attempts.start("chatgpt", OWNER);

    provider.approve();
    await settle();

    assert.equal(attempts.size(), 0);
  });

  it("abandons every live attempt at shutdown: one failed report each, then nothing", async () => {
    const first = controllableLogin();
    const second = controllableLogin();
    const { outcomes, options, report } = recordingReport();
    const providers = [first, second];
    const attempts = new SubscriptionLoginAttempts(
      (opts) => providers.shift()!.login(opts),
      report,
      () => {},
    );
    const one = await attempts.start("chatgpt", OWNER);
    const two = await attempts.start("chatgpt", {
      projectId: "project-2",
      secretId: "secret-2",
    });

    await attempts.abandonAll(1_000);
    // The provider answers after the abandon. The API already holds the failure.
    first.approve();
    second.approve();
    await settle();

    assert.equal(attempts.size(), 0);
    assert.deepEqual(outcomes, [
      {
        attemptId: one.attemptId,
        ...OWNER,
        state: "failed",
        error: ABANDONED_ATTEMPT_REASON,
      },
      {
        attemptId: two.attemptId,
        projectId: "project-2",
        secretId: "secret-2",
        state: "failed",
        error: ABANDONED_ATTEMPT_REASON,
      },
    ]);
    assert.deepEqual(options, [{ retry: false }, { retry: false }]);
    // The browser keeps the sentence it showed for a lost sign-in.
    assert.equal(ABANDONED_ATTEMPT_REASON, "attempt not found; try again");
  });

  it("bounds the abandon when the API does not answer", async () => {
    const provider = controllableLogin();
    const attempts = new SubscriptionLoginAttempts(
      provider.login,
      () => new Promise<void>(() => {}),
      () => {},
    );
    await attempts.start("chatgpt", OWNER);

    const startedAt = Date.now();
    await attempts.abandonAll(20);

    assert.ok(Date.now() - startedAt < 1_000);
    assert.equal(attempts.size(), 0);
  });

  it("waits at shutdown for a success report already on its way to the API", async () => {
    const provider = controllableLogin();
    const { outcomes, report } = recordingReport();
    let deliver: () => void = () => {};
    const attempts = new SubscriptionLoginAttempts(
      provider.login,
      async (outcome, options) => {
        await new Promise<void>((resolve) => {
          deliver = resolve;
        });
        await report(outcome, options);
      },
      () => {},
    );
    const { attemptId } = await attempts.start("chatgpt", OWNER);
    provider.approve();
    await settle();
    // The attempt left the map when its flow ended; only its report is still running.
    assert.equal(attempts.size(), 0);

    let abandoned = false;
    const shutdown = attempts.abandonAll(1_000).then(() => {
      abandoned = true;
    });
    await settle();
    assert.equal(abandoned, false, "shutdown must not end while the login is undelivered");

    deliver();
    await shutdown;

    assert.deepEqual(outcomes, [
      {
        attemptId,
        ...OWNER,
        state: "succeeded",
        login: { type: "oauth", ...LOGIN },
      },
    ]);
  });

  it("does not hold shutdown past its bound for a report the API never answers", async () => {
    const provider = controllableLogin();
    const attempts = new SubscriptionLoginAttempts(
      provider.login,
      () => new Promise<void>(() => {}),
      () => {},
    );
    await attempts.start("chatgpt", OWNER);
    provider.approve();
    await settle();

    const startedAt = Date.now();
    await attempts.abandonAll(20);

    assert.ok(Date.now() - startedAt < 1_000);
  });

  it("abandons nothing when no attempt is live", async () => {
    const { outcomes, report } = recordingReport();
    const attempts = new SubscriptionLoginAttempts(
      controllableLogin().login,
      report,
      () => {},
    );

    await attempts.abandonAll(1_000);

    assert.deepEqual(outcomes, []);
  });

  it("never logs the login, the user code, or the verification address", async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const { report } = recordingReport();

    const succeeding = controllableLogin();
    const one = new SubscriptionLoginAttempts(succeeding.login, report, log);
    await one.start("chatgpt", OWNER);
    succeeding.approve();

    const failing = controllableLogin();
    const two = new SubscriptionLoginAttempts(failing.login, report, log);
    await two.start("chatgpt", OWNER);
    failing.refuse(new Error(`refused user_code=${USER_CODE}`));

    const cancelled = controllableLogin();
    const three = new SubscriptionLoginAttempts(cancelled.login, report, log);
    const { attemptId } = await three.start("chatgpt", OWNER);
    three.cancel(attemptId);
    await settle();

    assert.ok(lines.length > 0, "the decisions are logged");
    const text = lines.join("\n");
    for (const secret of [
      USER_CODE,
      VERIFICATION_URI,
      LOGIN.access,
      LOGIN.refresh,
    ]) {
      assert.ok(!text.includes(secret), `a log line carried ${secret}`);
    }
  });
});

describe("reportAttemptOutcome", () => {
  const OUTCOME: AttemptOutcome = {
    attemptId: "att-1",
    projectId: "project-1",
    secretId: "secret-1",
    state: "succeeded",
    login: { type: "oauth", ...LOGIN },
  };

  /** A fetch that answers each call with the next status in `statuses`, or throws on `"throw"`. */
  function scriptedFetch(statuses: Array<number | "throw">) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = statuses[calls.length - 1] ?? 200;
      if (next === "throw") throw new Error("connect ECONNREFUSED");
      return new Response(next === 204 ? null : "{}", { status: next });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("posts the outcome with the runner token and the connection ids", async () => {
    const { calls, fetchImpl } = scriptedFetch([204]);

    await reportAttemptOutcome(OUTCOME, {
      fetchImpl,
      apiBase: "http://api:8000",
      token: "runner-secret",
      log: () => {},
    });

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "http://api:8000/secrets/subscription-login/attempts/att-1/outcome",
    );
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.redirect, "error");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["x-agenta-runner-token"], "runner-secret");
    assert.equal(headers.authorization, undefined);
    assert.deepEqual(JSON.parse(calls[0].init.body as string), {
      project_id: "project-1",
      secret_id: "secret-1",
      state: "succeeded",
      login: { type: "oauth", ...LOGIN },
    });
  });

  it("sends a failure with its reason and no login", async () => {
    const { calls, fetchImpl } = scriptedFetch([204]);

    await reportAttemptOutcome(
      {
        attemptId: "att-2",
        projectId: "project-1",
        secretId: "secret-1",
        state: "expired",
        error: "timed_out",
      },
      { fetchImpl, apiBase: "http://api:8000", token: "t", log: () => {} },
    );

    assert.deepEqual(JSON.parse(calls[0].init.body as string), {
      project_id: "project-1",
      secret_id: "secret-1",
      state: "expired",
      error: "timed_out",
    });
  });

  it("retries a 5xx and a transport failure, then stops on success", async () => {
    const { calls, fetchImpl } = scriptedFetch([503, "throw", 204]);

    await reportAttemptOutcome(OUTCOME, {
      fetchImpl,
      apiBase: "http://api:8000",
      token: "t",
      retryDelaysMs: [0, 0, 0],
      log: () => {},
    });

    assert.equal(calls.length, 3);
  });

  it("retries a 404 that comes before the API stored the attempt, then delivers", async () => {
    const lines: string[] = [];
    const { calls, fetchImpl } = scriptedFetch([404, 200]);

    await reportAttemptOutcome(OUTCOME, {
      fetchImpl,
      apiBase: "http://api:8000",
      token: "t",
      retryDelaysMs: [0, 0, 0],
      log: (line) => lines.push(line),
    });

    assert.equal(calls.length, 2);
    assert.ok(lines.some((line) => line.includes("report=delivered")));
  });

  it("stops after its retry budget when every try answers 404, and logs it as refused", async () => {
    const lines: string[] = [];
    const { calls, fetchImpl } = scriptedFetch([404, 404, 404, 404, 404]);

    await reportAttemptOutcome(OUTCOME, {
      fetchImpl,
      apiBase: "http://api:8000",
      token: "t",
      retryDelaysMs: [0, 0, 0],
      log: (line) => lines.push(line),
    });

    assert.equal(calls.length, 4, "one try plus one per retry delay");
    assert.ok(lines.some((line) => line.includes("report=refused")));
    assert.ok(!lines.some((line) => line.includes("report=unanswered")));
  });

  it("tries a 404 once when retries are off, as the shutdown report runs", async () => {
    const lines: string[] = [];
    const { calls, fetchImpl } = scriptedFetch([404, 200]);

    await reportAttemptOutcome(
      {
        ...OUTCOME,
        state: "failed",
        login: undefined,
        error: ABANDONED_ATTEMPT_REASON,
      },
      {
        fetchImpl,
        apiBase: "http://api:8000",
        token: "t",
        retryDelaysMs: [],
        log: (line) => lines.push(line),
      },
    );

    assert.equal(calls.length, 1);
    assert.ok(lines.some((line) => line.includes("report=refused")));
  });

  it("does not retry any other API decision", async () => {
    const { calls, fetchImpl } = scriptedFetch([409, 200]);

    await reportAttemptOutcome(OUTCOME, {
      fetchImpl,
      apiBase: "http://api:8000",
      token: "t",
      retryDelaysMs: [0, 0, 0],
      log: () => {},
    });

    assert.equal(calls.length, 1);
  });

  it("gives up after its retry budget", async () => {
    const lines: string[] = [];
    const { calls, fetchImpl } = scriptedFetch([502, 502, 502, 502, 502]);

    await reportAttemptOutcome(OUTCOME, {
      fetchImpl,
      apiBase: "http://api:8000",
      token: "t",
      retryDelaysMs: [0, 0],
      log: (line) => lines.push(line),
    });

    assert.equal(calls.length, 3, "one try plus one per retry delay");
    assert.ok(lines.some((line) => line.includes("report=unanswered")));
  });

  it("sends nothing without a runner token", async () => {
    const { calls, fetchImpl } = scriptedFetch([204]);

    await reportAttemptOutcome(OUTCOME, {
      fetchImpl,
      apiBase: "http://api:8000",
      token: "",
      log: () => {},
    });

    assert.equal(calls.length, 0);
  });

  it("never logs the login", async () => {
    const lines: string[] = [];
    const { fetchImpl } = scriptedFetch([500, 204]);

    await reportAttemptOutcome(OUTCOME, {
      fetchImpl,
      apiBase: "http://api:8000",
      token: "t",
      retryDelaysMs: [0],
      log: (line) => lines.push(line),
    });

    const text = lines.join("\n");
    assert.ok(lines.length > 0);
    assert.ok(!text.includes(LOGIN.access));
    assert.ok(!text.includes(LOGIN.refresh));
  });
});
