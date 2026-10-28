/**
 * Every span of a session run carries the platform session id as `ag.session.id`, not only the
 * agent span. Trace reads filter a whole trace by the session ids its spans carry, so a batch
 * that holds no agent span (a long run's early flush, or children exported before the root) must
 * still be linked to its session.
 *
 * Run: pnpm exec vitest run tests/unit/otel-session-id-every-span.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

import {
  createAgentaOtel,
  createSandboxAgentOtel,
} from "../../src/tracing/otel.ts";
import { TEST_EXPORT_ENDPOINT } from "../utils/otel-export.ts";

function exportPrototype(): SpanExporter {
  const exporter = new OTLPTraceExporter({ url: TEST_EXPORT_ENDPOINT });
  return Object.getPrototypeOf(Object.getPrototypeOf(exporter));
}

function captureExports(): ReadableSpan[] {
  const spans: ReadableSpan[] = [];
  vi.spyOn(exportPrototype(), "export").mockImplementation(
    (batch, cb: (result: ExportResult) => void) => {
      spans.push(...batch);
      cb({ code: ExportResultCode.SUCCESS });
    },
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  return spans;
}

function sandboxRun(sessionId: string | undefined): ReadableSpan[] {
  const spans = captureExports();
  const run = createSandboxAgentOtel({
    harness: "claude",
    model: "anthropic/claude-haiku",
    emitSpans: true,
    endpoint: TEST_EXPORT_ENDPOINT,
    authorization: "ApiKey test",
  });
  run.start({ prompt: "hi", ...(sessionId ? { sessionId } : {}) });
  run.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "call_1",
    title: "Read",
    rawInput: { path: "a.txt" },
  });
  run.handleUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "call_1",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "ok" } }],
  });
  run.finish();
  return spans;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ag.session.id on every span", () => {
  it("stamps the session id on every span of a runner-traced session run", async () => {
    const spans = sandboxRun("sess-every-span");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // invoke_agent, its turn, the model span and the tool span.
    expect(spans.length).toBeGreaterThanOrEqual(4);
    for (const span of spans)
      expect(span.attributes["ag.session.id"]).toBe("sess-every-span");
    const agent = spans.find((span) => span.name === "invoke_agent");
    expect(agent?.attributes["session.id"]).toBe("sess-every-span");
  });

  it("stamps nothing on a run without a session", async () => {
    const spans = sandboxRun(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spans.length).toBeGreaterThanOrEqual(4);
    for (const span of spans)
      expect(span.attributes["ag.session.id"]).toBeUndefined();
  });

  it("stamps the session id on every span of a Pi-traced session run", async () => {
    const spans = captureExports();
    const otel = createAgentaOtel({
      captureContent: true,
      endpoint: TEST_EXPORT_ENDPOINT,
      authorization: "ApiKey test",
      sessionId: "sess-pi",
    });
    const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
    otel.register({
      on: (name: string, handler: (...args: any[]) => Promise<void>) => {
        handlers[name] = handler;
      },
    } as any);
    await handlers.before_agent_start?.({ prompt: "read" });
    await handlers.agent_start?.({});
    await handlers.turn_start?.({ turnIndex: 0 });
    await handlers.tool_execution_start?.({
      toolCallId: "call_1",
      toolName: "read",
      args: { path: "a.txt" },
    });
    await handlers.tool_execution_end?.({
      toolCallId: "call_1",
      toolName: "read",
      result: { content: [{ type: "text", text: "ok" }] },
      isError: false,
    });
    await handlers.turn_end?.({});
    await handlers.agent_end?.({ messages: [] });
    await handlers.agent_settled?.({});
    await otel.flush();

    expect(spans.length).toBeGreaterThanOrEqual(3);
    for (const span of spans)
      expect(span.attributes["ag.session.id"]).toBe("sess-pi");
  });
});
