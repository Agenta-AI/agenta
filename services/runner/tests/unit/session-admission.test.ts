/**
 * Single-turn admission at the runner's edge (#6417, #5539, #5538).
 *
 * ============================================================================================
 * THE BUG THESE PIN
 * ============================================================================================
 *
 * A second user message that reached the runner while a turn was running on the same session
 * killed BOTH turns and left the session locked until the 30-minute lease expired:
 *
 *  1. The runner started the second turn's alive watchdog. Its first heartbeat asked the API's
 *     atomic `nx` acquire for the session and LOST, so the API answered `is_current_turn: false`.
 *  2. The runner read that only as "abort this run later" and carried on into the keepalive pool,
 *     which found the first turn's environment busy and DESTROYED it (`supersede-busy`). Turn one
 *     lost its sandbox mid-answer.
 *  3. Turn two then aborted on its own watchdog signal. Both turns were dead, and the session read
 *     as alive under a dead turn's lock.
 *
 * The arbiter was always right. The runner acted before reading its answer. These tests pin that
 * the runner now stops at the edge: a refused turn resolves no session environment, evicts
 * nothing, persists nothing, and returns a clear conflict to the caller.
 *
 * ============================================================================================
 * WHAT THE FAKE MODELS
 * ============================================================================================
 *
 * A real runner HTTP server (`createAgentServer`) driven over a real socket, plus a fake platform
 * API that answers `POST /sessions/streams/heartbeat`. The fake API models exactly one fact: the
 * `is_current_turn` field, which is the whole admission answer. Every other API call the turn
 * makes (interaction sweep, attachment claim, credential refresh) is answered 200-and-empty,
 * because none of them participate in the decision.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/session-admission.test.ts)
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { AgentRunRequest, AgentRunResult } from "../../src/protocol.ts";
import { createAgentServer, type RunAgent } from "../../src/server.ts";
import {
  SESSION_TURN_IN_USE_CODE,
  SESSION_TURN_IN_USE_MESSAGE,
} from "../../src/sessions/admission.ts";

const TEST_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const INTERNAL_ENV = "AGENTA_API_INTERNAL_URL";

interface Beat {
  session_id?: string;
  turn_id?: string;
  is_running?: boolean;
}

/** The fake platform API. `admit` decides what its heartbeat answers for each beat. */
async function startFakeApi(
  admit: (beat: Beat) => boolean | Promise<boolean>,
): Promise<{
  url: string;
  beats: Beat[];
  paths: string[];
  close: () => Promise<void>;
}> {
  const beats: Beat[] = [];
  const paths: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", async () => {
      const path = (req.url ?? "").split("?")[0];
      paths.push(path);
      let body: Record<string, unknown> = {};
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim()) {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      if (path.endsWith("/sessions/streams/heartbeat")) {
        const beat = body as Beat;
        beats.push(beat);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            stream: { id: "11111111-1111-1111-1111-111111111111" },
            replica_id: body.replica_id ?? null,
            // A turn-end beat (`is_running: false`) is never an admission question.
            is_current_turn:
              beat.is_running === false ? true : await admit(beat),
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    beats,
    paths,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startRunner(
  run: RunAgent,
): Promise<{ url: string; close: () => Promise<void> }> {
  process.env.AGENTA_RUNNER_TOKEN = TEST_TOKEN;
  const server: Server = createAgentServer(run);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A session-owned run request: `sessionId` is the whole gate (`isSessionOwned`). */
function sessionRequest(
  overrides: Partial<AgentRunRequest> = {},
): Record<string, unknown> {
  return {
    harness: "claude",
    model: "m1",
    sessionId: "session-admission-1",
    messages: [{ role: "user", content: "hello" }],
    ...overrides,
  };
}

interface StreamRecord {
  kind: string;
  event?: { type: string; message?: string; code?: string; turnId?: string };
  result?: { ok: boolean; error?: string };
}

async function postRun(
  runnerUrl: string,
  body: Record<string, unknown>,
): Promise<{ status: number; records: StreamRecord[] }> {
  const res = await fetch(`${runnerUrl}/run`, {
    method: "POST",
    headers: { accept: "application/x-ndjson", ...AUTH },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const records = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StreamRecord);
  return { status: res.status, records };
}

const previousInternal = process.env[INTERNAL_ENV];
const previousToken = process.env.AGENTA_RUNNER_TOKEN;

beforeEach(() => {
  delete process.env[INTERNAL_ENV];
});

afterEach(() => {
  if (previousInternal === undefined) delete process.env[INTERNAL_ENV];
  else process.env[INTERNAL_ENV] = previousInternal;
  if (previousToken === undefined) delete process.env.AGENTA_RUNNER_TOKEN;
  else process.env.AGENTA_RUNNER_TOKEN = previousToken;
});

describe("runner admission: a refused turn never reaches the session environment", () => {
  it("does not call run() when the first heartbeat reports is_current_turn: false", async () => {
    const api = await startFakeApi(() => false);
    process.env[INTERNAL_ENV] = api.url;
    const runCalls: AgentRunRequest[] = [];
    const runner = await startRunner(async (request): Promise<AgentRunResult> => {
      runCalls.push(request);
      return { ok: true, output: "should never run", events: [] };
    });
    try {
      const { records } = await postRun(runner.url, sessionRequest());

      assert.equal(
        runCalls.length,
        0,
        "the refused turn must not reach run(), which is what resolves the keepalive pool " +
          "and is where the live turn's environment used to be destroyed",
      );
      const terminal = records.find((r) => r.kind === "result");
      assert.ok(terminal, "a terminal result record is still written");
      assert.equal(terminal!.result!.ok, false);
      assert.equal(terminal!.result!.error, SESSION_TURN_IN_USE_MESSAGE);
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("emits an error event carrying the stable session_turn_in_use code", async () => {
    // The code is what lets the browser render "not sent, keep your text" instead of the generic
    // "The agent run failed" bubble. The message is one line, because the SDK's
    // `sanitize_runner_error` keeps only the first line of a runner error.
    const api = await startFakeApi(() => false);
    process.env[INTERNAL_ENV] = api.url;
    const runner = await startRunner(async () => ({
      ok: true,
      output: "",
      events: [],
    }));
    try {
      const { records } = await postRun(runner.url, sessionRequest());

      const error = records.find(
        (r) => r.kind === "event" && r.event?.type === "error",
      );
      assert.ok(error, "the refusal is streamed as an error event");
      assert.equal(error!.event!.code, SESSION_TURN_IN_USE_CODE);
      assert.equal(error!.event!.message, SESSION_TURN_IN_USE_MESSAGE);
      assert.ok(
        !SESSION_TURN_IN_USE_MESSAGE.includes("\n"),
        "the message must stay one line to survive sanitize_runner_error",
      );
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("makes no interaction-sweep or attachment-claim call for a refused turn", async () => {
    // `cancelStaleInteractions` cancels the session's unanswered approval gates, sparing only the
    // CALLING turn's own. Running it for a turn that was refused would cancel the LIVE turn's
    // pending approval card — a second way the double send broke the running turn.
    const api = await startFakeApi(() => false);
    process.env[INTERNAL_ENV] = api.url;
    const runner = await startRunner(async () => ({
      ok: true,
      output: "",
      events: [],
    }));
    try {
      await postRun(runner.url, sessionRequest());
      // Give any fire-and-forget call a chance to land before asserting it did not.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const nonHeartbeat = api.paths.filter(
        (p) => !p.endsWith("/sessions/streams/heartbeat"),
      );
      assert.deepEqual(
        nonHeartbeat,
        [],
        `a refused turn touched the platform beyond its own beats: ${nonHeartbeat.join(", ")}`,
      );
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("stops the heartbeat with an owner-scoped end beat for its own turn id", async () => {
    // The end beat is safe to send: the API releases `running` only for the turn that owns it, so
    // a refused turn's final beat cannot clear the LIVE turn's lock. Sending it is what stops the
    // heartbeat interval and releases the credential lease.
    const api = await startFakeApi(() => false);
    process.env[INTERNAL_ENV] = api.url;
    const runner = await startRunner(async () => ({
      ok: true,
      output: "",
      events: [],
    }));
    try {
      await postRun(runner.url, sessionRequest());

      assert.equal(api.beats.length, 2, "exactly one start beat and one end beat");
      assert.equal(api.beats[0].is_running, true);
      assert.equal(api.beats[1].is_running, false);
      assert.equal(
        api.beats[0].turn_id,
        api.beats[1].turn_id,
        "the end beat names the REFUSED turn, never the live one",
      );
    } finally {
      await runner.close();
      await api.close();
    }
  });
});

describe("runner admission: an admitted turn proceeds", () => {
  it("runs the turn when the first heartbeat admits it", async () => {
    const api = await startFakeApi(() => true);
    process.env[INTERNAL_ENV] = api.url;
    const runCalls: AgentRunRequest[] = [];
    const runner = await startRunner(async (request): Promise<AgentRunResult> => {
      runCalls.push(request);
      return { ok: true, output: "answered", events: [] };
    });
    try {
      const { records } = await postRun(runner.url, sessionRequest());

      assert.equal(runCalls.length, 1, "the admitted turn runs");
      const terminal = records.find((r) => r.kind === "result");
      assert.equal(terminal!.result!.ok, true);
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("admits an approval RESUME while the previous turn is parked, not running", async () => {
    // The park case is the one a naive "is anything alive on this session?" gate gets wrong. A
    // parked turn still holds `alive` (that is what makes the session reattachable) but has
    // released `running`. The API's heartbeat distinguishes them: with no `running` owner it
    // treats the stale `alive` as a legitimate handover, tombstones the parked turn, and admits
    // the resume. This test pins that the runner honours an ADMIT answer for a resume-shaped
    // request rather than refusing on the presence of a prior turn.
    const api = await startFakeApi(() => true);
    process.env[INTERNAL_ENV] = api.url;
    const runCalls: AgentRunRequest[] = [];
    const runner = await startRunner(async (request): Promise<AgentRunResult> => {
      runCalls.push(request);
      return { ok: true, output: "resumed", events: [] };
    });
    try {
      const resume = sessionRequest({
        messages: [
          { role: "user", content: "edit the file" },
          {
            role: "assistant",
            content: [{ type: "tool_call", toolCallId: "call-1", toolName: "edit" }],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                toolCallId: "call-1",
                output: { approved: true },
              },
            ],
          },
        ],
      } as unknown as Partial<AgentRunRequest>);
      const { records } = await postRun(runner.url, resume);

      assert.equal(runCalls.length, 1, "the resume runs");
      const terminal = records.find((r) => r.kind === "result");
      assert.equal(terminal!.result!.ok, true);
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("a refused second turn cannot replace the admitted turn's Stop handle", async () => {
    let releaseSecondAdmission!: () => void;
    const secondAdmissionMayFinish = new Promise<void>((resolve) => {
      releaseSecondAdmission = resolve;
    });
    let markSecondAdmissionWaiting!: () => void;
    const secondAdmissionWaiting = new Promise<void>((resolve) => {
      markSecondAdmissionWaiting = resolve;
    });
    const api = await startFakeApi(async (beat) => {
      if (beat.turn_id !== "turn-B") return true;
      markSecondAdmissionWaiting();
      await secondAdmissionMayFinish;
      return false;
    });
    process.env[INTERNAL_ENV] = api.url;

    let markFirstRunning!: () => void;
    const firstRunning = new Promise<void>((resolve) => {
      markFirstRunning = resolve;
    });
    let markFirstAborted!: () => void;
    const firstAborted = new Promise<void>((resolve) => {
      markFirstAborted = resolve;
    });
    let finishFirstForCleanup!: () => void;
    const firstMayFinishForCleanup = new Promise<void>((resolve) => {
      finishFirstForCleanup = resolve;
    });
    const runCalls: string[] = [];
    const runner = await startRunner(
      async (request, _emit, signal): Promise<AgentRunResult> => {
        runCalls.push(request.turnId ?? "missing");
        assert.equal(request.turnId, "turn-A", "the refused turn never reaches run()");
        markFirstRunning();
        await Promise.race([
          new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else signal?.addEventListener("abort", () => resolve(), { once: true });
          }),
          firstMayFinishForCleanup,
        ]);
        if (signal?.aborted) markFirstAborted();
        return {
          ok: true,
          output: "",
          events: [],
          ...(signal?.aborted ? { stopReason: "cancelled" as const } : {}),
        };
      },
    );

    const firstRequest = postRun(
      runner.url,
      sessionRequest({ turnId: "turn-A" }),
    );
    let secondRequest: ReturnType<typeof postRun> | undefined;
    try {
      await firstRunning;
      secondRequest = postRun(
        runner.url,
        sessionRequest({ turnId: "turn-B" }),
      );
      await secondAdmissionWaiting;

      const cancel = await fetch(`${runner.url}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify({
          commandId: "command-stop-A",
          projectId: "project-1",
          sessionId: "session-admission-1",
          targetTurnId: "turn-A",
          createdAt: new Date().toISOString(),
        }),
      });

      assert.equal(cancel.status, 202, "the runner still holds admitted turn A");
      await firstAborted;
      releaseSecondAdmission();
      const [first, second] = await Promise.all([firstRequest, secondRequest]);
      assert.equal(
        first.records.find((record) => record.kind === "result")?.result?.ok,
        true,
      );
      assert.equal(
        second.records.find((record) => record.kind === "result")?.result?.error,
        SESSION_TURN_IN_USE_MESSAGE,
      );
      assert.deepEqual(runCalls, ["turn-A"]);
    } finally {
      releaseSecondAdmission();
      finishFirstForCleanup();
      await Promise.allSettled([
        firstRequest,
        ...(secondRequest ? [secondRequest] : []),
      ]);
      await runner.close();
      await api.close();
    }
  });

  it("fails OPEN: an unreachable platform admits the turn rather than refusing it", async () => {
    // The heartbeat has always failed open, and admission must not change that: a transient API
    // blip refusing every message would be a worse outage than the bug this slice fixes. The
    // keepalive pool's busy check is the backstop for the window this leaves.
    process.env[INTERNAL_ENV] = "http://127.0.0.1:1";
    const runCalls: AgentRunRequest[] = [];
    const runner = await startRunner(async (request): Promise<AgentRunResult> => {
      runCalls.push(request);
      return { ok: true, output: "answered", events: [] };
    });
    try {
      const { records } = await postRun(runner.url, sessionRequest());

      assert.equal(runCalls.length, 1, "an unreachable arbiter does not refuse the turn");
      const terminal = records.find((r) => r.kind === "result");
      assert.equal(terminal!.result!.ok, true);
    } finally {
      await runner.close();
    }
  });
});

describe("runner admission: the admitted turn id reaches the client", () => {
  // The runner mints the turn id per execution, and until now it told no one. The client's
  // `start` frame is built and sent before the runner replies at all, so it cannot carry a
  // runner-minted id — which is why `expected_execution_id` on the public Cancel has never had a
  // first-party caller able to fill it. A Stop could only mean "whatever is running now", never
  // "the turn I was watching". The `turn` event is the earliest frame that can carry it.

  it("emits a turn event carrying the admitted turn id, before any other event", async () => {
    const api = await startFakeApi(() => true);
    process.env[INTERNAL_ENV] = api.url;
    const runner = await startRunner(async () => ({
      ok: true,
      output: "answered",
      events: [],
    }));
    try {
      const { records } = await postRun(runner.url, sessionRequest());

      const events = records.filter((r) => r.kind === "event");
      assert.ok(events.length > 0, "the run streamed at least one event");
      assert.equal(
        events[0].event!.type,
        "turn",
        "the turn id must arrive FIRST, so a Stop that races the turn's own output can name it",
      );
      const turnId = events[0].event!.turnId;
      assert.ok(turnId, "the turn event carries an id");
      assert.match(
        String(turnId),
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        "the id is the uuid the runner minted",
      );
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("emits the SAME id the alive lock was acquired under", async () => {
    // The whole point of handing the id out is that a client can name THIS execution to the
    // control plane. An id that does not match the one holding the session's locks would name
    // nothing, so the two must be the same value, not merely both present.
    const api = await startFakeApi(() => true);
    process.env[INTERNAL_ENV] = api.url;
    const runner = await startRunner(async () => ({
      ok: true,
      output: "answered",
      events: [],
    }));
    try {
      const { records } = await postRun(runner.url, sessionRequest());

      const turnEvent = records.find(
        (r) => r.kind === "event" && r.event?.type === "turn",
      );
      assert.ok(turnEvent, "a turn event was emitted");
      assert.equal(
        turnEvent!.event!.turnId,
        api.beats[0].turn_id,
        "the streamed id must be the id that heartbeat the alive lock",
      );
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("emits NO turn event for a refused turn, which owns no execution to name", async () => {
    const api = await startFakeApi(() => false);
    process.env[INTERNAL_ENV] = api.url;
    const runner = await startRunner(async () => ({
      ok: true,
      output: "",
      events: [],
    }));
    try {
      const { records } = await postRun(runner.url, sessionRequest());

      assert.ok(
        !records.some((r) => r.kind === "event" && r.event?.type === "turn"),
        "a refused turn must not hand out an id: it runs nothing and there is nothing to stop",
      );
    } finally {
      await runner.close();
      await api.close();
    }
  });
});
