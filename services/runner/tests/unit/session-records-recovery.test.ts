/**
 * Record writes ride out a database restart, and a record lost for good reaches the api's
 * incomplete flag even when the first report fails in the same outage (#7480, #7479).
 *
 * On 2026-10-08 a database restart answered HTTP 500 to record writes for about a minute. The
 * runner gave up on one record after a few seconds, marked the session incomplete in memory, and
 * refused every later turn of it on that pod, although the database later held every record.
 *
 * These tests drive a real runner server against a fake platform API and pin:
 *  - a record write retries through a short outage and lands; nothing is reported incomplete;
 *  - a record that does not land within the budget is lost and reported incomplete at turn end;
 *  - a report that fails is sent again at the start of the session's next turn on this runner,
 *    with that turn's credential, before that turn writes any record.
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

/**
 * A fake platform API: admits every turn; record writes answer `ingestStatus()` and incomplete
 * reports answer `incompleteStatus()`. `log` keeps the order of what landed.
 */
async function startFakeApi(
  ingestStatus: () => number,
  incompleteStatus: () => number = () => 200,
) {
  const landed: Ingest[] = [];
  const incompleteReports: { session_id: string; authorization: string }[] = [];
  const log: string[] = [];
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
          log.push(`record ${body.attributes?.text ?? body.record_type}`);
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (path.endsWith("/sessions/records/incomplete")) {
        const status = incompleteStatus();
        if (status < 300) {
          incompleteReports.push({ ...body, authorization: req.headers.authorization ?? "" });
          log.push("incomplete");
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end("{}");
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
    landed,
    incompleteReports,
    log,
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
  // One attempt per record by default, so a failure is lost at once.
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
  it("retry through a short outage and land, with nothing reported incomplete", async () => {
    process.env[BUDGET_ENV] = "10000";
    let failures = 3;
    const api = await startFakeApi(() => (failures-- > 0 ? 500 : 200));
    process.env[INTERNAL_ENV] = api.url;
    const calls: AgentRunRequest[] = [];
    const runner = await startRunner(answering(calls));
    try {
      const first = await postRun(runner.url, turn("session-outage-short", "q1", "ApiKey a", api.url));
      assert.equal(first.find((r) => r.kind === "result")?.result?.ok, true);
      assert.deepEqual(
        api.landed.map((r) => r.attributes.text ?? r.record_type),
        ["q1", "answer 1", "done"],
      );
      assert.equal(api.incompleteReports.length, 0);
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("are lost after the budget and reported incomplete at turn end", async () => {
    const api = await startFakeApi(() => 500);
    process.env[INTERNAL_ENV] = api.url;
    const calls: AgentRunRequest[] = [];
    const runner = await startRunner(answering(calls));
    const sessionId = "session-lost-reported";
    try {
      await postRun(runner.url, turn(sessionId, "q1", "ApiKey first", api.url));
      assert.equal(api.landed.length, 0);
      assert.equal(api.incompleteReports.length, 1);
      assert.equal(api.incompleteReports[0].session_id, sessionId);
    } finally {
      await runner.close();
      await api.close();
    }
  });

  it("report the loss again at the next turn when the first report failed, before it writes", async () => {
    let down = true;
    const api = await startFakeApi(
      () => (down ? 500 : 200),
      () => (down ? 503 : 200),
    );
    process.env[INTERNAL_ENV] = api.url;
    const calls: AgentRunRequest[] = [];
    const runner = await startRunner(answering(calls));
    const sessionId = "session-report-retried";
    try {
      await postRun(runner.url, turn(sessionId, "q1", "ApiKey first", api.url));
      assert.equal(api.incompleteReports.length, 0, "the report failed in the outage");

      down = false;
      await postRun(runner.url, turn(sessionId, "q2", "ApiKey second", api.url));
      // Reported once, with the second turn's credential, ahead of that turn's records.
      assert.equal(api.incompleteReports.length, 1);
      assert.equal(api.incompleteReports[0].session_id, sessionId);
      assert.equal(api.incompleteReports[0].authorization, "ApiKey second");
      assert.equal(api.log[0], "incomplete");
      assert.deepEqual(api.log.slice(1), ["record q2", "record answer 2", "record done"]);

      // Acknowledged: a third turn does not report it again.
      await postRun(runner.url, turn(sessionId, "q3", "ApiKey third", api.url));
      assert.equal(api.incompleteReports.length, 1);
    } finally {
      await runner.close();
      await api.close();
    }
  });
});
