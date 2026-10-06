/**
 * A long run's trace must not go out as one OTLP request. Agenta's ingest rejects a request above
 * 10 MB with a 413 and drops every span in it, so the runner used to lose a long run's whole trace.
 * These tests pin that a trace is split into parent-first requests of at most
 * `OTLP_MAX_REQUEST_BYTES`, that a trace which fills a request is sent before the run ends, and
 * that every span arrives exactly once.
 *
 * Run: pnpm exec vitest run tests/unit/otel-chunked-export.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceFlags } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

import {
  chunkTraceBatch,
  createAgentaOtel,
  createSandboxAgentOtel,
  OTLP_MAX_REQUEST_BYTES,
  type SerializedTraceBatch,
} from "../../src/tracing/otel.ts";
import { TEST_EXPORT_ENDPOINT } from "../utils/otel-export.ts";

/** The ingest's default request limit (`AGENTA_OTLP_MAX_BATCH_BYTES`). */
const INGEST_LIMIT_BYTES = 10 * 1024 * 1024;
const TOOL_OUTPUT_BYTES = 512 * 1024;
const TOOL_CALLS = 24;

const TRACE_ID = "1".repeat(32);

function readableSpan(spanId: string, parentSpanId?: string): ReadableSpan {
  return {
    name: spanId,
    spanContext: () => ({
      traceId: TRACE_ID,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
    }),
    parentSpanContext: parentSpanId
      ? { traceId: TRACE_ID, spanId: parentSpanId, traceFlags: 1 }
      : undefined,
  } as unknown as ReadableSpan;
}

function exportPrototype(): SpanExporter {
  const exporter = new OTLPTraceExporter({ url: TEST_EXPORT_ENDPOINT });
  return Object.getPrototypeOf(Object.getPrototypeOf(exporter));
}

function requestBytes(spans: ReadableSpan[]): number {
  return ProtobufTraceSerializer.serializeRequest(spans)!.byteLength;
}

function spanIds(requests: ReadableSpan[][]): string[] {
  return requests.flat().map((span) => span.spanContext().spanId);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chunkTraceBatch", () => {
  const size = (span: ReadableSpan) => Number(span.name.slice(-1)) * 10;

  it("packs spans parent-first into requests within the budget", () => {
    const root = readableSpan("a00000000000000" + "4");
    const child = readableSpan("b00000000000000" + "4", root.name);
    const grandchild = readableSpan("c00000000000000" + "4", child.name);
    const sibling = readableSpan("d00000000000000" + "4", root.name);

    const chunks = chunkTraceBatch(
      [grandchild, sibling, child, root],
      80,
      size,
    );

    expect(chunks.map((chunk) => chunk.map((span) => span.name))).toEqual([
      [root.name, sibling.name],
      [child.name, grandchild.name],
    ]);
  });

  it("sends a span larger than the budget alone, without dropping it", () => {
    const root = readableSpan("a00000000000000" + "1");
    const huge = readableSpan("b00000000000000" + "9", root.name);
    const small = readableSpan("c00000000000000" + "1", root.name);

    const chunks = chunkTraceBatch([root, huge, small], 50, size);

    expect(chunks.map((chunk) => chunk.map((span) => span.name))).toEqual([
      [root.name],
      [huge.name],
      [small.name],
    ]);
  });
});

describe("chunked trace export", () => {
  it("sends a trace above the ingest limit as several requests under it, before the run ends", async () => {
    const requests: ReadableSpan[][] = [];
    vi.spyOn(exportPrototype(), "export").mockImplementation(
      (spans, cb: (result: ExportResult) => void) => {
        requests.push([...spans]);
        cb({ code: ExportResultCode.SUCCESS });
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint: TEST_EXPORT_ENDPOINT,
    });
    run.start({ prompt: "read every file" });
    for (let index = 0; index < TOOL_CALLS; index += 1) {
      const toolCallId = `call_${index}`;
      run.handleUpdate({
        sessionUpdate: "tool_call",
        toolCallId,
        title: "Read",
        rawInput: { path: `file-${index}.txt` },
      });
      run.handleUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: `${index}`.padEnd(TOOL_OUTPUT_BYTES, "x"),
            },
          },
        ],
      });
    }
    // The tool spans already fill more than one request, so some went out mid-run.
    const sentBeforeEnd = requests.length;
    run.finish();
    await run.flush();

    const sizes = requests.map(requestBytes);
    const total = sizes.reduce((sum, bytes) => sum + bytes, 0);
    expect(sentBeforeEnd).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(INGEST_LIMIT_BYTES);
    expect(requests.length).toBeGreaterThanOrEqual(3);
    for (const bytes of sizes) {
      expect(bytes).toBeLessThanOrEqual(OTLP_MAX_REQUEST_BYTES);
      expect(bytes).toBeLessThan(INGEST_LIMIT_BYTES);
    }

    const ids = spanIds(requests);
    expect(new Set(ids).size).toBe(ids.length);
    const spans = requests.flat();
    expect(
      spans.filter((span) => span.name.startsWith("execute_tool")),
    ).toHaveLength(TOOL_CALLS);
    expect(spans.filter((span) => span.name === "invoke_agent")).toHaveLength(
      1,
    );
    // Every parent this run produced arrived too, so the backend can rebuild the whole tree.
    const sent = new Set(ids);
    for (const span of spans) {
      const parentId = span.parentSpanContext?.spanId;
      if (parentId) expect(sent.has(parentId)).toBe(true);
    }
  });

  it("sends one trace's requests one at a time, and the final flush waits for all of them", async () => {
    const callbacks: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let delivered = 0;
    vi.spyOn(exportPrototype(), "export").mockImplementation(
      (spans, cb: (result: ExportResult) => void) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // A slow collector: each request completes only when the test releases it.
        callbacks.push(() => {
          inFlight -= 1;
          delivered += spans.length;
          cb({ code: ExportResultCode.SUCCESS });
        });
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint: TEST_EXPORT_ENDPOINT,
    });
    run.start({ prompt: "read every file" });
    for (let index = 0; index < TOOL_CALLS; index += 1) {
      run.handleUpdate({
        sessionUpdate: "tool_call",
        toolCallId: `call_${index}`,
        title: "Read",
        rawInput: { path: `file-${index}.txt` },
      });
      run.handleUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: `call_${index}`,
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: `${index}`.padEnd(TOOL_OUTPUT_BYTES, "x"),
            },
          },
        ],
      });
    }
    run.finish();
    let flushed = false;
    const flush = run.flush().then(() => {
      flushed = true;
    });

    // Release the requests one by one, in order, and check that the next one starts only then.
    let released = 0;
    while (released < callbacks.length || !flushed) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (released < callbacks.length) {
        expect(flushed).toBe(false);
        callbacks[released]!();
        released += 1;
      } else if (!flushed) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (released === callbacks.length) break;
      }
    }
    await flush;

    expect(released).toBeGreaterThanOrEqual(3);
    expect(maxInFlight).toBe(1);
    expect(flushed).toBe(true);
    // invoke_agent, its turn, the turn's model span, and one span per tool call.
    expect(delivered).toBe(TOOL_CALLS + 3);
  });

  it("splits a Pi turn into serialized batches the spool accepts", async () => {
    const batches: SerializedTraceBatch[] = [];
    const otel = createAgentaOtel({
      captureContent: true,
      serializedBatchTransport: {
        export: async (batch) => {
          batches.push(batch);
        },
      },
    });
    const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
    otel.register({
      on: (name: string, handler: (...args: any[]) => Promise<void>) => {
        handlers[name] = handler;
      },
    } as any);

    await handlers.before_agent_start?.({ prompt: "read every file" });
    await handlers.agent_start?.({});
    await handlers.turn_start?.({ turnIndex: 0 });
    for (let index = 0; index < TOOL_CALLS; index += 1) {
      const toolCallId = `call_${index}`;
      await handlers.tool_execution_start?.({
        toolCallId,
        toolName: "read",
        args: { path: `file-${index}.txt` },
      });
      await handlers.tool_execution_end?.({
        toolCallId,
        toolName: "read",
        result: {
          content: [
            { type: "text", text: `${index}`.padEnd(TOOL_OUTPUT_BYTES, "x") },
          ],
        },
        isError: false,
      });
    }
    await handlers.turn_end?.({});
    await handlers.agent_end?.({ messages: [] });
    await handlers.agent_settled?.({});
    await otel.flush();

    const total = batches.reduce((sum, b) => sum + b.body.byteLength, 0);
    expect(total).toBeGreaterThan(INGEST_LIMIT_BYTES);
    expect(batches.length).toBeGreaterThanOrEqual(3);
    for (const batch of batches)
      expect(batch.body.byteLength).toBeLessThanOrEqual(OTLP_MAX_REQUEST_BYTES);
    // invoke_agent, one turn, and one span per tool call: each exactly once.
    expect(batches.reduce((sum, b) => sum + b.spanCount, 0)).toBe(
      TOOL_CALLS + 2,
    );
  });
});
