import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceFlags } from "@opentelemetry/api";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

import {
  createAgentaOtel,
  serializeTraceBatch,
  type SerializedTraceBatch,
} from "../../src/tracing/otel.ts";

const TRACE_ID = "1".repeat(32);

function readableSpan(
  name: string,
  spanId: string,
  parentSpanId?: string,
): ReadableSpan {
  return {
    name,
    spanContext: () => ({
      traceId: TRACE_ID,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
    }),
    parentSpanContext: parentSpanId
      ? {
          traceId: TRACE_ID,
          spanId: parentSpanId,
          traceFlags: TraceFlags.SAMPLED,
        }
      : undefined,
  } as unknown as ReadableSpan;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Pi OTLP serialization", () => {
  it("parent-orders the trace before calling the public protobuf serializer", () => {
    const root = readableSpan("root", "a".repeat(16));
    const child = readableSpan("child", "b".repeat(16), "a".repeat(16));
    const grandchild = readableSpan(
      "grandchild",
      "c".repeat(16),
      "b".repeat(16),
    );
    const expected = new Uint8Array([10, 20, 30]);
    const serialize = vi
      .spyOn(ProtobufTraceSerializer, "serializeRequest")
      .mockReturnValue(expected);

    const actual = serializeTraceBatch([grandchild, child, root]);

    expect(actual).toBe(expected);
    expect(
      serialize.mock.calls[0]?.[0].map((span: ReadableSpan) => span.name),
    ).toEqual(["root", "child", "grandchild"]);
  });

  it("lets Pi publish one standard byte batch without using runner network code", async () => {
    const exported: SerializedTraceBatch[] = [];
    const otel = createAgentaOtel({
      captureContent: true,
      traceparent: `00-${TRACE_ID}-${"2".repeat(16)}-01`,
      serializedBatchTransport: {
        export: async (batch) => {
          exported.push(batch);
        },
      },
    });
    const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
    otel.register({
      on: (name: string, handler: (...args: any[]) => Promise<void>) => {
        handlers[name] = handler;
      },
    } as any);

    await handlers["before_agent_start"]?.({ prompt: "hello" });
    await handlers["agent_start"]?.({});
    await handlers["turn_start"]?.({ turnIndex: 0 });
    await handlers["before_provider_request"]?.(
      {},
      { model: { id: "gpt-5", provider: "openai" } },
    );
    await handlers["message_end"]?.({
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: { input: 2, output: 1, totalTokens: 3 },
      },
    });
    await handlers["turn_end"]?.({});
    await handlers["agent_end"]?.({
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      ],
    });
    await expect(otel.flush()).resolves.toBeUndefined();

    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      traceId: TRACE_ID,
      spanCount: 3,
    });
    expect(exported[0]?.body).toBeInstanceOf(Uint8Array);
    expect(exported[0]?.body.byteLength).toBeGreaterThan(0);
  });

  it("keeps a rejected Pi byte transport best effort", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const otel = createAgentaOtel({
      traceparent: `00-${TRACE_ID}-${"3".repeat(16)}-01`,
      serializedBatchTransport: {
        export: async () => {
          throw new Error("spool unavailable");
        },
      },
    });
    const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
    otel.register({
      on: (name: string, handler: (...args: any[]) => Promise<void>) => {
        handlers[name] = handler;
      },
    } as any);

    await handlers["before_agent_start"]?.({ prompt: "hello" });
    await handlers["agent_start"]?.({});
    await handlers["agent_end"]?.({ messages: [] });

    await expect(otel.flush()).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(" ")).toContain(
      "serialized trace transport threw",
    );
  });

  it("closes partial child spans before publishing a cancelled Pi agent", async () => {
    const exported: SerializedTraceBatch[] = [];
    const otel = createAgentaOtel({
      traceparent: "00-" + TRACE_ID + "-" + "4".repeat(16) + "-01",
      serializedBatchTransport: {
        export: async (batch) => {
          exported.push(batch);
        },
      },
    });
    const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
    otel.register({
      on: (name: string, handler: (...args: any[]) => Promise<void>) => {
        handlers[name] = handler;
      },
    } as any);

    await handlers["before_agent_start"]?.({ prompt: "cancel me" });
    await handlers["agent_start"]?.({});
    await handlers["turn_start"]?.({ turnIndex: 0 });
    await handlers["before_provider_request"]?.(
      {},
      { model: { id: "gpt-5", provider: "openai" } },
    );
    await handlers["tool_execution_start"]?.({
      toolName: "bash",
      toolCallId: "tool-1",
      args: { command: "sleep 10" },
    });
    await handlers["agent_end"]?.({ messages: [] });
    await otel.flush();

    expect(exported).toHaveLength(1);
    expect(exported[0]?.spanCount).toBe(4);
  });

  it("resets warm-turn tracing policy and usage before handling the next prompt", async () => {
    const exported: SerializedTraceBatch[] = [];
    const otel = createAgentaOtel({ enabled: false, captureContent: true });
    const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
    otel.register({
      on: (name: string, handler: (...args: any[]) => Promise<void>) => {
        handlers[name] = handler;
      },
    } as any);

    otel.beginTurn({
      enabled: true,
      captureContent: true,
      serializedBatchTransport: {
        export: async (batch) => {
          exported.push(batch);
        },
      },
    });
    await handlers["before_agent_start"]?.({ prompt: "first" });
    await handlers["agent_start"]?.({});
    await handlers["message_end"]?.({
      message: { role: "assistant", usage: { input: 2, output: 1 } },
    });
    await handlers["agent_end"]?.({ messages: [] });
    await otel.flush();
    expect(exported).toHaveLength(1);
    expect(otel.usage()).toMatchObject({ input: 2, output: 1, total: 3 });

    // A missing control disables only tracing. Usage writeback still reflects this turn and
    // cannot inherit the first turn totals or transport.
    otel.beginTurn({ enabled: false, captureContent: true });
    await handlers["before_agent_start"]?.({ prompt: "second" });
    await handlers["message_end"]?.({
      message: { role: "assistant", usage: { input: 5, output: 4 } },
    });
    await handlers["agent_end"]?.({ messages: [] });
    await otel.flush();

    expect(exported).toHaveLength(1);
    expect(otel.usage()).toMatchObject({ input: 5, output: 4, total: 9 });
    expect(otel.config.serializedBatchTransport).toBeUndefined();
  });
});
