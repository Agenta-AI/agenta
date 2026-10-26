/**
 * A caller who loses access to the project while their turn runs.
 *
 * The platform rechecks the run credential on every session call, so the next record write,
 * heartbeat or record-log read of that turn answers 403. That is an access change, not data loss:
 * the turn must end with `access_denied`, and the session's record log must not be marked
 * incomplete or called unreadable. See `src/sessions/access-denied.ts`.
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

// The hermetic setup stubs the records query for the engine suites; this file tests the real one.
vi.unmock("../../src/sessions/records-query.ts");

const {
  ACCESS_DENIED_CODE,
  ACCESS_DENIED_MESSAGE,
  accessDenied,
  noteAccessDenied,
  watchAccessDenied,
} = await import("../../src/sessions/access-denied.ts");
const { buildPersistingEmitter, recordsIncomplete, takePersistFailures } =
  await import("../../src/sessions/persist.ts");
const { startAliveWatchdog } = await import("../../src/sessions/alive.ts");
const { LiveFramePublisher } = await import("../../src/sessions/live-frames.ts");
const { reconstructHistoryIfNeeded } = await import(
  "../../src/engines/sandbox_agent/reconstruct-history.ts"
);
const { createAgentServer } = await import("../../src/server.ts");
const { HEARTBEAT_INTERVAL_SECONDS } = await import(
  "../../src/sessions/contract.ts"
);
const { resetExecutionsForTest } = await import(
  "../../src/sessions/execution-registry.ts"
);
type RunAgent = import("../../src/server.ts").RunAgent;

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const previousToken = process.env[TOKEN_ENV];

beforeEach(() => {
  vi.stubEnv("AGENTA_RECORDS_INGEST_RETRY_BUDGET_MS", "0");
});

afterEach(() => {
  resetExecutionsForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (previousToken === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = previousToken;
});

describe("watchAccessDenied", () => {
  it("fires once per watched turn and forgets the turn when the watch stops", () => {
    const onDenied = vi.fn();
    const stop = watchAccessDenied("sess-w", "turn-w", onDenied);
    noteAccessDenied("sess-w", "turn-w", "heartbeat");
    noteAccessDenied("sess-w", "turn-w", "records-ingest");
    assert.equal(onDenied.mock.calls.length, 1);
    assert.equal(accessDenied("sess-w", "turn-w"), true);
    // Another turn of the same session (maybe another person's) is not affected.
    assert.equal(accessDenied("sess-w", "turn-other"), false);
    stop();
    assert.equal(accessDenied("sess-w", "turn-w"), false);
  });

  it("ignores a 403 for a turn nobody watches (a late record of a finished turn)", () => {
    noteAccessDenied("sess-late", "turn-late", "records-ingest");
    assert.equal(accessDenied("sess-late", "turn-late"), false);
  });
});

describe("a record write answered 403", () => {
  it("ends the turn as access denied, not as a lost record", async () => {
    const onDenied = vi.fn();
    const stop = watchAccessDenied("sess-p403", "turn-p403", onDenied);
    const attempts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      attempts.push(JSON.parse(String(init!.body)).record_type);
      return new Response('{"detail":"forbidden"}', { status: 403 });
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { emit, flush } = buildPersistingEmitter(
        "sess-p403",
        () => "t",
        undefined,
        undefined,
        "turn-p403",
      );
      emit({ type: "message", text: "a" });
      emit({ type: "message", text: "b" });
      emit({ type: "done" });
      await flush();

      assert.equal(onDenied.mock.calls.length, 1, "the turn is told once");
      assert.equal(accessDenied("sess-p403", "turn-p403"), true);
      // One refused write is enough: the rest of the turn's records are not sent.
      assert.equal(attempts.length, 1);
      // Not data loss: nothing counted, the log is not marked incomplete, no drop alert.
      assert.equal(takePersistFailures("sess-p403"), 0);
      assert.equal(recordsIncomplete("sess-p403"), false);
      assert.equal(
        errors.mock.calls.filter((c) => String(c[0]).includes("RECORD_DROPPED")).length,
        0,
      );
    } finally {
      stop();
    }
  });

  it("stops an ingest retry when another call of the turn learns of the denial", async () => {
    vi.stubEnv("AGENTA_RECORDS_INGEST_RETRY_BUDGET_MS", "600000");
    const onDenied = vi.fn();
    const stop = watchAccessDenied("sess-retry", "turn-retry", onDenied);
    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      attempts += 1;
      return new Response("", { status: 503 });
    });
    try {
      const { emit, flush } = buildPersistingEmitter(
        "sess-retry",
        () => "t",
        undefined,
        undefined,
        "turn-retry",
      );
      emit({ type: "message", text: "a" });
      // Let the record fail once and start waiting to retry, then a heartbeat answers 403.
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(attempts >= 1);
      noteAccessDenied("sess-retry", "turn-retry", "heartbeat");
      const started = Date.now();
      await flush();
      assert.ok(Date.now() - started < 2_000, "the drain does not wait out the retry budget");
      assert.equal(takePersistFailures("sess-retry"), 0);
      assert.equal(recordsIncomplete("sess-retry"), false);
    } finally {
      stop();
    }
  });

  it("keeps a non-403 refusal as a lost record", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("", { status: 422 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { emit, flush } = buildPersistingEmitter(
      "sess-p422",
      () => "t",
      undefined,
      undefined,
      "turn-p422",
    );
    emit({ type: "message", text: "a" });
    await flush();
    assert.equal(takePersistFailures("sess-p422"), 1);
    assert.equal(recordsIncomplete("sess-p422"), true);
  });
});

describe("a live-frame write answered 403", () => {
  it("ends the turn as access denied and sends no more frames", async () => {
    const onDenied = vi.fn();
    const stop = watchAccessDenied("sess-lf", "turn-lf", onDenied);
    let posts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      posts += 1;
      return new Response("", { status: 403 });
    });
    try {
      const publisher = new LiveFramePublisher({
        sessionId: "sess-lf",
        executionId: "turn-lf",
        auth: () => "t",
        enabled: true,
      });
      publisher.emit({ type: "message_start", id: "m" });
      await publisher.whenIdle();
      assert.equal(onDenied.mock.calls.length, 1);
      publisher.emit({ type: "message_delta", id: "m", delta: "x" });
      publisher.emit({ type: "message_end", id: "m" });
      await publisher.whenIdle();
      assert.equal(posts, 1, "no frame is sent after the denial");
    } finally {
      stop();
    }
  });
});

describe("a live-frame write answered 409 (not the running turn any more)", () => {
  // A Stop, a takeover or a newer turn moved the session's running turn while this one still
  // streams. The API answers 409, not 403: the turn did not lose access, and its own records
  // (the partial answer and the done record) must still be written.
  it("does not end the turn as access denied and still writes the turn's records", async () => {
    const onDenied = vi.fn();
    const stop = watchAccessDenied("sess-lf409", "turn-lf409", onDenied);
    const records: string[] = [];
    let framePosts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      if (Array.isArray(body)) {
        framePosts += 1;
        return new Response('{"detail":"not the running turn"}', { status: 409 });
      }
      records.push(body.record_type);
      return new Response('{"ok":true}', { status: 200 });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const publisher = new LiveFramePublisher({
        sessionId: "sess-lf409",
        executionId: "turn-lf409",
        auth: () => "t",
        enabled: true,
      });
      publisher.emit({ type: "message_start", id: "m" });
      publisher.emit({ type: "message_delta", id: "m", delta: "partial" });
      await publisher.whenIdle();
      assert.ok(framePosts >= 1);
      assert.equal(onDenied.mock.calls.length, 0, "a 409 is not lost access");
      assert.equal(accessDenied("sess-lf409", "turn-lf409"), false);

      const { emit, flush } = buildPersistingEmitter(
        "sess-lf409",
        () => "t",
        undefined,
        undefined,
        "turn-lf409",
      );
      emit({ type: "message", text: "partial" });
      emit({ type: "done", stopReason: "cancelled" });
      await flush();
      assert.deepEqual(records, ["message", "done"]);
      assert.equal(takePersistFailures("sess-lf409"), 0);
      assert.equal(recordsIncomplete("sess-lf409"), false);
    } finally {
      stop();
    }
  });
});

describe("a heartbeat answered 403", () => {
  it("ends an admitted turn as access denied", async () => {
    let beats = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      beats += 1;
      return beats === 1
        ? Response.json({ is_current_turn: true })
        : new Response('{"detail":"forbidden"}', { status: 403 });
    });
    const onDenied = vi.fn();
    const stop = watchAccessDenied("sess-h403", "turn-h403", onDenied);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const watchdog = await startAliveWatchdog("sess-h403", "turn-h403", "t");
      assert.equal(watchdog.admitted, true);
      assert.equal(onDenied.mock.calls.length, 0);
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_SECONDS * 1000);
      assert.equal(onDenied.mock.calls.length, 1);
      await watchdog.release();
    } finally {
      stop();
    }
  });

  it("keeps a 403 on the admission beat an admission refusal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("", { status: 403 }),
    );
    const onDenied = vi.fn();
    const stop = watchAccessDenied("sess-a403", "turn-a403", onDenied);
    try {
      const watchdog = await startAliveWatchdog("sess-a403", "turn-a403", "t");
      assert.equal(watchdog.admitted, false);
      assert.equal(watchdog.admissionRejectedStatus, 403);
      assert.equal(onDenied.mock.calls.length, 0);
      watchdog.abandon();
    } finally {
      stop();
    }
  });
});

describe("the record-log read answered 403", () => {
  it("fails reconstruction with access_denied, not 'record log is unreadable'", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("", { status: 403 }),
    );
    const onDenied = vi.fn();
    const stop = watchAccessDenied("sess-q403", "turn-q403", onDenied);
    try {
      await assert.rejects(
        reconstructHistoryIfNeeded(
          {
            harness: "pi_core",
            turnId: "turn-q403",
            messages: [{ role: "user", content: "hi again" }],
          } as any,
          "sess-q403",
          () => "t",
        ),
        (err: any) =>
          err.publicCode === ACCESS_DENIED_CODE &&
          err.message === ACCESS_DENIED_MESSAGE,
      );
      assert.equal(onDenied.mock.calls.length, 1);
    } finally {
      stop();
    }
  });

  it("keeps any other failure as an unreadable log", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("", { status: 404 }),
    );
    await assert.rejects(
      reconstructHistoryIfNeeded(
        {
          harness: "pi_core",
          turnId: "turn-q404",
          messages: [{ role: "user", content: "hi again" }],
        } as any,
        "sess-q404",
        () => "t",
      ),
      /record log is unreadable/,
    );
  });
});

describe("the runner ends the turn with access_denied", () => {
  /** A run that works until it is aborted, then ends as a cancel (what an aborted turn returns). */
  const runUntilAborted: RunAgent = (_request, emit, signal) =>
    new Promise((resolve) => {
      emit?.({ type: "message_start", id: "m1" });
      const end = () =>
        resolve({ ok: true, stopReason: "cancelled", events: [] });
      if (signal?.aborted) return end();
      signal?.addEventListener("abort", end, { once: true });
    });

  async function runTurn(answer: (url: string) => Response | undefined) {
    process.env[TOKEN_ENV] = "test-token";
    const server = createAgentServer(runUntilAborted, async () => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const realFetch = globalThis.fetch.bind(globalThis);
    const calls: string[] = [];
    // The first record write follows admission, so the heartbeat interval is armed by then.
    let markAdmitted!: () => void;
    const admitted = new Promise<void>((resolve) => (markAdmitted = resolve));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === `${base}/run`) return realFetch(input, init);
        calls.push(url);
        if (url.endsWith("/sessions/records/ingest")) markAdmitted();
        return answer(url) ?? Response.json({});
      });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const pending = fetchSpy(`${base}/run`, {
        method: "POST",
        headers: {
          accept: "application/x-ndjson",
          authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          harness: "pi_core",
          sandbox: "local",
          sessionId: `sess-run-${Math.random().toString(16).slice(2)}`,
          runContext: { project: { id: "project-1" } },
          telemetry: {
            exporters: {
              otlp: {
                endpoint: `${base}/otlp/v1/traces`,
                headers: { authorization: "Test platform authorization" },
              },
            },
          },
          messages: [{ role: "user", content: "sleep 45" }],
        }),
      });
      await admitted;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_SECONDS * 1000);
      const response = await pending;
      const lines = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, any>);
      return { lines, calls };
    } finally {
      vi.useRealTimers();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  function assertAccessDenied(lines: Record<string, any>[], calls: string[]) {
    const result = lines.at(-1)!;
    assert.equal(result.kind, "result");
    assert.equal(result.result.ok, false);
    assert.equal(result.result.error, ACCESS_DENIED_MESSAGE);
    assert.deepEqual(result.result.errorDetail, {
      code: ACCESS_DENIED_CODE,
      message: ACCESS_DENIED_MESSAGE,
      retryable: false,
    });
    const errorEvents = lines.filter(
      (line) => line.kind === "event" && line.event?.type === "error",
    );
    assert.equal(errorEvents.length, 1, "one error frame reaches the client");
    assert.equal(errorEvents[0].event.code, ACCESS_DENIED_CODE);
    assert.equal(
      calls.filter((url) => url.endsWith("/sessions/records/incomplete")).length,
      0,
      "the record log is not reported incomplete",
    );
  }

  it("when a heartbeat of the running turn answers 403", async () => {
    let beats = 0;
    const { lines, calls } = await runTurn((url) => {
      if (!url.endsWith("/sessions/streams/heartbeat")) return undefined;
      beats += 1;
      return beats === 1
        ? Response.json({ stream: { id: "s" }, is_current_turn: true })
        : new Response("", { status: 403 });
    });
    assertAccessDenied(lines, calls);
  });

  it("when a record write of the running turn answers 403", async () => {
    const { lines, calls } = await runTurn((url) => {
      if (url.endsWith("/sessions/streams/heartbeat"))
        return Response.json({ stream: { id: "s" }, is_current_turn: true });
      if (url.endsWith("/sessions/records/ingest"))
        return new Response("", { status: 403 });
      return undefined;
    });
    assertAccessDenied(lines, calls);
  });
});

describe("the LLM gateway's own policy_denied refusals", () => {
  // Pi unwraps `error` before it reports, so its text carries the bare body.
  const piBody = (message: string, code: string) =>
    `403 ${JSON.stringify({ message: `${message} \u27e6agenta_code:${code}\u27e7`, type: "permission_error", code })}`;
  // The OpenAI SDKs fold the wrapped body into their message.
  const wrappedBody = (message: string, code: string) =>
    `403 ${JSON.stringify({ error: { message: `${message} \u27e6agenta_code:${code}\u27e7`, type: "permission_error", code } })}`;
  // Codex keeps only the message line.
  const markerOnly = (message: string, code: string) =>
    `unexpected status 403 Forbidden: ${message} \u27e6agenta_code:${code}\u27e7, url: https://example.test/v1/responses`;
  const shapes = { piBody, wrappedBody, markerOnly };

  for (const [shape, render] of Object.entries(shapes)) {
    it(`a permission denial (use_llm_endpoints) is access_denied (${shape})`, async () => {
      const { classifyRunError } = await import("../../src/engines/sandbox_agent/errors.ts");
      const classified = classifyRunError(
        new Error(render("Denied use_llm_endpoints on standard/openai", "policy_denied")),
        "claude",
        "openai",
      );
      assert.deepEqual(classified, {
        code: ACCESS_DENIED_CODE,
        message: ACCESS_DENIED_MESSAGE,
        detail: { code: ACCESS_DENIED_CODE, message: ACCESS_DENIED_MESSAGE, retryable: false },
      });
    });

    it(`a spending-check denial (Entitlement) is not access_denied and not "keep going" (${shape})`, async () => {
      const { classifyRunError, GATEWAY_ENTITLEMENT_DENIED_MESSAGE } = await import(
        "../../src/engines/sandbox_agent/errors.ts"
      );
      const classified = classifyRunError(
        new Error(render("Entitlement wallet_balance exceeded for builtin/openai", "policy_denied")),
        "claude",
        "openai",
      );
      assert.notEqual(classified.code, ACCESS_DENIED_CODE);
      assert.equal(classified.message, GATEWAY_ENTITLEMENT_DENIED_MESSAGE);
      assert.doesNotMatch(classified.message, /keep going|access/i);
      assert.equal(classified.detail?.code, "policy_denied");
    });
  }

  it("leaves an MCP-plane policy denial to the rules that read it", async () => {
    const { classifyRunError } = await import("../../src/engines/sandbox_agent/errors.ts");
    const jsonRpc = JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Denied use_mcp_endpoints on standard/github",
        data: { cause: "policy_denied" },
      },
    });
    const classified = classifyRunError(new Error(jsonRpc), "claude", "anthropic");
    assert.notEqual(classified.code, ACCESS_DENIED_CODE);
  });

  it("keeps a provider's own 403 a provider refusal", async () => {
    const { classifyRunError } = await import("../../src/engines/sandbox_agent/errors.ts");
    const classified = classifyRunError(
      new Error('403 {"error":{"message":"Your organization is not allowed","type":"permission_error"}}'),
      "claude",
      "anthropic",
    );
    assert.notEqual(classified.code, ACCESS_DENIED_CODE);
  });
});
