/**
 * Records a turn could not write are re-sent before the session's next turn (#7479, #7480).
 *
 * On 2026-10-08 a database restart answered HTTP 500 to record writes for about a minute. The
 * runner gave up on one record after a few seconds, marked the session incomplete in memory, and
 * refused every later turn of it on that pod, although the database later held every record.
 *
 * These tests drive a real runner server against a fake platform API and pin the recovery:
 *  - a record that does not land is held, and re-sent at the start of the next turn, ahead of
 *    that turn's own records and with that turn's credential;
 *  - after it lands the session runs normally, and nothing is reported incomplete;
 *  - when the re-send fails, the turn is refused before it persists anything, with the
 *    `session_records_incomplete` code, and the loss is reported to the API.
 *
 * Run: pnpm exec vitest run tests/unit/session-records-recovery.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { AgentRunRequest, AgentRunResult } from "../../src/protocol.ts";
import { createAgentServer, type RunAgent } from "../../src/server.ts";

const TEST_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const BUDGET_ENV = "AGENTA_RECORDS_INGEST_RETRY_BUDGET_MS";
const INTERNAL_ENV = "AGENTA_API_INTERNAL_URL";

interface Ingest {
  turn_id?: string;
  record_index: number;
  record_type: string;
  record_source: string;
  attributes: { text?: string };
  authorization: string;
}

/** A fake platform API: admits every turn; record writes answer `ingestStatus()`. */
async function startFakeApi(ingestStatus: () => number) {
  const landed: Ingest[] = [];
  const incompleteReports: unknown[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw.trim() ? JSON.parse(raw) : {};
      if (path.endsWith("/sessions/streams/heartbeat")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            stream: { id: "11111111-1111-1111-1111-111111111111" },
            replica_id: body.replica_id ?? null,
            is_current_turn: true,
          }),
        );
        return;
      }
      if (path.endsWith("/sessions/records/ingest")) {
        const status = ingestStatus();
        if (status < 300) {
          landed.push({ ...body, authorization: req.headers.authorization ?? "" });
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (path.endsWith("/sessions/records/incomplete")) {
        incompleteReports.push(body);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    landed,
    incompleteReports,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startRunner(run: RunAgent) {
  process.env.AGENTA_RUNNER_TOKEN = TEST_TOKEN;
  const server: Server = createAgentServer(run);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function turn(sessionId: string, text: string, credential: string, apiUrl: string) {
  return {
    harness: "claude",
    model: "m1",
    sessionId,
    messages: [{ role: "user", content: text }],
    telemetry: {
      exporters: {
        otlp: {
          endpoint: `${apiUrl}/otlp/v1/traces`,
          headers: { authorization: credential },
        },
      },
    },
  };
}

interface StreamRecord {
  kind: string;
  event?: { type: string; message?: string; code?: string };
  result?: { ok: boolean; error?: string };
}

async function postRun(runnerUrl: string, body: Record<string, unknown>) {
  const res = await fetch(`${runnerUrl}/run`, {
    method: "POST",
    headers: { accept: "application/x-ndjson", ...AUTH },
    body: JSON.stringify(body),
  });
  return (await res.text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StreamRecord);
}

/** A run that answers with one message. */
const answering =
  (calls: AgentRunRequest[]): RunAgent =>
  async (request, emit): Promise<AgentRunResult> => {
    calls.push(request);
    emit?.({ type: "message", text: `answer ${calls.length}` });
    emit?.({ type: "done" });
    return { ok: true, output: `answer ${calls.length}`, events: [] };
  };

const saved = {
  internal: process.env[INTERNAL_ENV],
  token: process.env.AGENTA_RUNNER_TOKEN,
  budget: process.env[BUDGET_ENV],
};

beforeEach(() => {
  // One attempt per record, so a failure parks at once.
  process.env[BUDGET_ENV] = "0";
});

afterEach(() => {
  for (const [name, value] of [
    [INTERNAL_ENV, saved.internal],
    ["AGENTA_RUNNER_TOKEN", saved.token],
    [BUDGET_ENV, saved.budget],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("records a turn could not write", () => {
  it("are re-sent before the next turn writes, with its credential, and the session runs on", async () => {
    let down = true;
    const api = await startFakeApi(() => (down ? 500 : 200));
    process.env[INTERNAL_ENV] = api.url;
    const calls: AgentRunRequest[] = [];
    const runner = await startRunner(answering(calls));
    const sessionId = "session-recovery-ok";
    try {
      const first = await postRun(runner.url, turn(sessionId, "q1", "ApiKey first", api.url));
      assert.equal(first.find((r) => r.kind === "result")?.result?.ok, true);
      assert.equal(api.landed.length, 0, "the api was down for the whole first turn");

      down = false;
      const second = await postRun(runner.url, turn(sessionId, "q2", "ApiKey second", api.url));
      assert.equal(second.find((r) => r.kind === "result")?.result?.ok, true);
      assert.equal(calls.length, 2, "the second turn ran");

      // The first turn's records land first, in their order, then the second turn's.
      const texts = api.landed.map((r) => r.attributes.text ?? r.record_type);
      assert.deepEqual(texts, ["q1", "answer 1", "done", "q2", "answer 2", "done"]);
      // Re-sent with the second turn's credential, not the first turn's.
      assert.ok(api.landed.slice(0, 3).every((r) => r.authorization === "ApiKey second"));
      // Parked is not lost: nothing was reported incomplete.
      assert.equal(api.incompleteReports.length, 0);
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("refuse the next turn with session_records_incomplete when the re-send fails", async () => {
    const api = await startFakeApi(() => 500);
    process.env[INTERNAL_ENV] = api.url;
    const calls: AgentRunRequest[] = [];
    const runner = await startRunner(answering(calls));
    const sessionId = "session-recovery-lost";
    try {
      await postRun(runner.url, turn(sessionId, "q1", "ApiKey first", api.url));
      assert.equal(calls.length, 1);

      const second = await postRun(runner.url, turn(sessionId, "q2", "ApiKey second", api.url));
      assert.equal(calls.length, 1, "the refused turn never reached run()");
      const error = second.find((r) => r.event?.type === "error")?.event;
      assert.equal(error?.code, "session_records_incomplete");
      assert.match(String(error?.message), /Start a new session/);
      assert.equal(second.find((r) => r.kind === "result")?.result?.ok, false);
      // The loss is reported, once, for this session.
      assert.equal(api.incompleteReports.length, 1);
      assert.equal((api.incompleteReports[0] as { session_id: string }).session_id, sessionId);

      // The session stays refused on this runner, even after the api is back.
      const third = await postRun(runner.url, turn(sessionId, "q3", "ApiKey third", api.url));
      assert.equal(calls.length, 1);
      assert.equal(
        third.find((r) => r.event?.type === "error")?.event?.code,
        "session_records_incomplete",
      );
    } finally {
      await runner.close();
      await api.close();
    }
  });
});
