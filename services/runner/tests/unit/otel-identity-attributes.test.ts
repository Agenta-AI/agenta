/**
 * Every span the runner exports carries the run's session id (`ag.session.id`) and session turn
 * id (`ag.turn.id`), so ingest can fill the span's identity columns without walking to the root.
 * This pins it for both tracers: Pi's own extension tracer (`createAgentaOtel`) and the
 * sandbox-agent tracer (`createSandboxAgentOtel`), including the `agent_error` span the latter
 * makes for a Pi run that sent no trace batch.
 *
 * Spans are captured at the exporter (a fake OTLP exporter), so the test reads what leaves the
 * runner, not what a tracer spy saw.
 *
 * Run: pnpm exec vitest run tests/unit/otel-identity-attributes.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportResult } from "@opentelemetry/core";

interface ExportedSpan {
  name: string;
  traceId: string;
  attributes: Record<string, unknown>;
}

const exported: ExportedSpan[] = [];

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => {
  class FakeOTLPTraceExporter {
    export(
      spans: Array<{
        name: string;
        attributes: Record<string, unknown>;
        spanContext: () => { traceId: string };
      }>,
      cb: (r: ExportResult) => void,
    ): void {
      for (const span of spans)
        exported.push({
          name: span.name,
          traceId: span.spanContext().traceId,
          attributes: { ...span.attributes },
        });
      cb({ code: 0 /* ExportResultCode.SUCCESS */ });
    }
    async shutdown(): Promise<void> {}
  }
  return { OTLPTraceExporter: FakeOTLPTraceExporter };
});

// Imported AFTER the mock so `otel.ts` picks up the fake OTLPTraceExporter.
const { createAgentaOtel, createSandboxAgentOtel } =
  await import("../../src/tracing/otel.ts");

const ENDPOINT = "http://collector.example/v1/traces";
const TRACE_ID = "c".repeat(32);
const TRACEPARENT = `00-${TRACE_ID}-${"d".repeat(16)}-01`;

beforeEach(() => {
  vi.stubEnv("AGENTA_API_INTERNAL_URL", "");
  vi.stubEnv("AGENTA_API_URL", "");
  vi.stubEnv("AGENTA_CREDENTIALS", "Secret test-credential");
});

afterEach(() => {
  exported.length = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Drive one full Pi run (agent, turn, model call, tool call) and flush it. */
async function runPi(ids: {
  sessionId?: string;
  sessionTurnId?: string;
}): Promise<void> {
  const otel = createAgentaOtel({
    captureContent: true,
    endpoint: ENDPOINT,
    authorization: "Secret test-credential",
    traceparent: TRACEPARENT,
    ...ids,
  });
  const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
  otel.register({
    on: (name: string, fn: (...args: any[]) => Promise<void>) => {
      handlers[name] = fn;
    },
  } as any);
  await handlers["before_agent_start"]?.({ prompt: "hi" });
  await handlers["agent_start"]?.({});
  await handlers["turn_start"]?.({ turnIndex: 0 });
  await handlers["before_provider_request"]?.({}, { model: { id: "gpt-5" } });
  await handlers["message_end"]?.({
    message: { role: "assistant", usage: { input: 1, output: 1 } },
  });
  await handlers["tool_execution_start"]?.({
    toolName: "read",
    toolCallId: "call-1",
    args: { path: "a.md" },
  });
  await handlers["tool_execution_end"]?.({
    toolCallId: "call-1",
    result: "ok",
  });
  await handlers["turn_end"]?.({});
  await handlers["agent_end"]?.({ messages: [] });
  await handlers["agent_settled"]?.({});
  await otel.flush();
}

/** Drive one full sandbox-agent run (agent, turn, model, tool call) and flush it. */
async function runSandboxAgent(init: {
  sessionId?: string;
  sessionTurnId?: string;
}): Promise<void> {
  const run = createSandboxAgentOtel({
    harness: "claude",
    model: "anthropic/claude-haiku",
    emitSpans: true,
    endpoint: ENDPOINT,
    traceparent: TRACEPARENT,
    sessionTurnId: init.sessionTurnId,
  });
  run.start({ prompt: "hi", sessionId: init.sessionId });
  run.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "read",
    kind: "read",
    rawInput: { path: "a.md" },
  });
  run.handleUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
    rawOutput: "ok",
  });
  run.finish();
  await run.flush();
}

function expectIds(
  spans: ExportedSpan[],
  sessionId: string,
  turnId: string,
): void {
  expect(spans.length).toBeGreaterThan(0);
  for (const span of spans) {
    expect(span.attributes["ag.session.id"], span.name).toBe(sessionId);
    expect(span.attributes["ag.turn.id"], span.name).toBe(turnId);
    expect(span.attributes["ag.meta.turn.id"], span.name).toBeUndefined();
  }
}

describe("Pi tracer identity attributes", () => {
  it("writes the session id and turn id on every exported span", async () => {
    await runPi({ sessionId: "sess-1", sessionTurnId: "turn-1" });

    const names = exported.map((span) => span.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "invoke_agent",
        "turn 0",
        "chat gpt-5",
        "execute_tool read",
      ]),
    );
    expectIds(exported, "sess-1", "turn-1");
    // invoke_agent keeps the OpenInference and gen_ai session names.
    const agent = exported.find((span) => span.name === "invoke_agent");
    expect(agent?.attributes["session.id"]).toBe("sess-1");
    expect(agent?.attributes["gen_ai.conversation.id"]).toBe("sess-1");
  });

  it("writes neither id on a run with no session", async () => {
    await runPi({});

    expect(exported.length).toBeGreaterThan(0);
    for (const span of exported) {
      expect(span.attributes["ag.session.id"]).toBeUndefined();
      expect(span.attributes["ag.turn.id"]).toBeUndefined();
    }
  });
});

describe("sandbox-agent tracer identity attributes", () => {
  it("writes the session id and turn id on every exported span", async () => {
    await runSandboxAgent({ sessionId: "sess-1", sessionTurnId: "turn-1" });

    const names = exported.map((span) => span.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "invoke_agent",
        "turn 0",
        "chat claude-haiku",
        "execute_tool read",
      ]),
    );
    expectIds(exported, "sess-1", "turn-1");
  });

  it("writes neither id on a run with no session", async () => {
    await runSandboxAgent({});

    expect(exported.length).toBeGreaterThan(0);
    for (const span of exported) {
      expect(span.attributes["ag.session.id"]).toBeUndefined();
      expect(span.attributes["ag.turn.id"]).toBeUndefined();
    }
  });

  it("keeps each run's own turn id when two runs share one trace", async () => {
    await runSandboxAgent({ sessionId: "sess-1", sessionTurnId: "turn-1" });
    const first = [...exported];
    exported.length = 0;
    await runSandboxAgent({ sessionId: "sess-1", sessionTurnId: "turn-2" });
    const second = [...exported];

    expect(first.every((span) => span.traceId === TRACE_ID)).toBe(true);
    expect(second.every((span) => span.traceId === TRACE_ID)).toBe(true);
    expectIds(first, "sess-1", "turn-1");
    expectIds(second, "sess-1", "turn-2");
  });

  it("writes both ids on the agent_error span of a Pi run with no trace batch", async () => {
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai/gpt-4o-mini",
      emitSpans: false,
      endpoint: ENDPOINT,
      traceparent: TRACEPARENT,
      sessionTurnId: "turn-1",
    });
    run.start({ prompt: "hi", sessionId: "sess-1" });
    run.recordError("pi_core: no trace batch", "openai");
    run.finish();
    await run.flush();

    const errorSpans = exported.filter((span) => span.name === "agent_error");
    expect(errorSpans).toHaveLength(1);
    expectIds(errorSpans, "sess-1", "turn-1");
  });
});
