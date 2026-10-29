/**
 * A chat span keeps its output, usage, and cost however long the model's context is.
 *
 * The Pi tracer copies the context handed to each model call onto the chat span as flattened
 * `llm.input_messages.N.*` attributes, at request time. Output, token usage, finish reason, and
 * cost arrive later, at `message_end`. The OpenTelemetry SDK caps a span's attribute count (128
 * by default) and silently drops every attribute set after the cap, so a long session used to
 * produce chat spans with inputs and nothing else: no answer, no tokens, no cost.
 *
 * The tests run the real SDK span (not a spy) so the SDK's own limits apply.
 *
 * Run: pnpm exec vitest run tests/unit/otel-long-context-span.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

import {
  createAgentaOtel,
  createSandboxAgentOtel,
} from "../../src/tracing/otel.ts";

const TRACE_ID = "4".repeat(32);

/** Capture the spans the tracer hands to the OTLP serializer, after the SDK applied its limits. */
function captureExportedSpans(): ReadableSpan[] {
  const spans: ReadableSpan[] = [];
  vi.spyOn(ProtobufTraceSerializer, "serializeRequest").mockImplementation(
    (batch: ReadableSpan[]) => {
      spans.push(...batch);
      return new Uint8Array([1]);
    },
  );
  return spans;
}

/** A long agent context: user prompt, then many assistant tool calls and tool results. */
function longContext(toolRounds: number): any[] {
  const messages: any[] = [{ role: "user", content: "fix the build" }];
  for (let i = 0; i < toolRounds; i++) {
    messages.push({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: `call_${i}`,
          name: "bash",
          arguments: { command: `ls ${i}` },
        },
      ],
    });
    messages.push({
      role: "toolResult",
      toolCallId: `call_${i}`,
      content: [{ type: "text", text: `output ${i} `.repeat(400) }],
    });
  }
  return messages;
}

async function runPiCall(options: {
  context: any[];
  model?: Record<string, unknown>;
  cost?: Record<string, unknown>;
}) {
  const spans = captureExportedSpans();
  const otel = createAgentaOtel({
    captureContent: true,
    traceparent: `00-${TRACE_ID}-${"5".repeat(16)}-01`,
    serializedBatchTransport: { export: async () => {} },
  });
  const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
  otel.register({
    on: (name: string, handler: (...args: any[]) => Promise<void>) => {
      handlers[name] = handler;
    },
  } as any);

  await handlers["before_agent_start"]?.({ prompt: "fix the build" });
  await handlers["agent_start"]?.({});
  await handlers["turn_start"]?.({ turnIndex: 0 });
  await handlers["context"]?.({ messages: options.context });
  await handlers["before_provider_request"]?.(
    {},
    {
      model: options.model ?? {
        id: "gemini-3.8-flash",
        provider: "google",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.1, cacheWrite: 0 },
      },
    },
  );
  await handlers["message_end"]?.({
    message: {
      role: "assistant",
      model: "google/gemini-3.8-flash",
      provider: "agenta",
      stopReason: "toolUse",
      content: [{ type: "text", text: "the answer" }],
      usage: {
        input: 4000,
        output: 20,
        cacheRead: 30000,
        cacheWrite: 0,
        totalTokens: 34020,
        cost: options.cost ?? {
          input: 0.003,
          output: 0.000075,
          cacheRead: 0.003,
          cacheWrite: 0,
          total: 0.006075,
        },
      },
    },
  });
  await handlers["turn_end"]?.({});
  await handlers["agent_end"]?.({ messages: [] });
  await handlers["agent_settled"]?.({});
  await otel.flush();

  const chat = spans.find((span) => span.name.startsWith("chat"));
  if (!chat) throw new Error("no chat span exported");
  return { chat, usage: otel.usage() };
}

const inputKeys = (span: ReadableSpan): string[] =>
  Object.keys(span.attributes).filter((key) =>
    key.startsWith("llm.input_messages."),
  );

const inputBytes = (span: ReadableSpan): number =>
  inputKeys(span).reduce(
    (sum, key) => sum + Buffer.byteLength(String(span.attributes[key])),
    0,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chat span on a long context", () => {
  it("keeps output, usage, finish reason, and cost past 128 input attributes", async () => {
    const { chat } = await runPiCall({ context: longContext(60) });

    expect(chat.attributes["gen_ai.usage.input_tokens"]).toBe(4000);
    expect(chat.attributes["gen_ai.usage.output_tokens"]).toBe(20);
    expect(chat.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(30000);
    expect(chat.attributes["gen_ai.usage.cost"]).toBe(0.006075);
    expect(chat.attributes["gen_ai.response.finish_reasons"]).toEqual([
      "toolUse",
    ]);
    expect(chat.attributes["llm.output_messages.0.message.content"]).toBe(
      "the answer",
    );
    expect(chat.droppedAttributesCount).toBe(0);
  });

  it("keeps the latest messages of the context, in order, within a bounded size", async () => {
    const context = longContext(60);
    const { chat } = await runPiCall({ context });

    const keys = inputKeys(chat);
    expect(inputBytes(chat)).toBeLessThanOrEqual(32_000);

    // The last message of the context is the newest input, and it is kept as the last entry.
    const indexes = new Set(keys.map((key) => Number(key.split(".")[2])));
    const last = Math.max(...indexes);
    expect(indexes.size).toBe(last + 1);
    expect(chat.attributes[`llm.input_messages.${last}.message.role`]).toBe(
      "tool",
    );
    expect(
      chat.attributes[`llm.input_messages.${last}.message.tool_call_id`],
    ).toBe("call_59");
  });

  it("cuts a newest message that alone is larger than the budget", async () => {
    // One assistant message with hundreds of tool calls and large arguments, then multibyte text.
    const huge = {
      role: "assistant",
      content: [
        { type: "text", text: "构建".repeat(20_000) },
        ...Array.from({ length: 350 }, (_, i) => ({
          type: "toolCall",
          id: `call_${i}`,
          name: "write",
          arguments: { content: "x".repeat(30_000) },
        })),
      ],
    };
    const { chat } = await runPiCall({ context: [huge] });

    expect(chat.droppedAttributesCount).toBe(0);
    expect(chat.attributes["gen_ai.usage.input_tokens"]).toBe(4000);
    expect(chat.attributes["llm.output_messages.0.message.content"]).toBe(
      "the answer",
    );
    expect(inputBytes(chat)).toBeLessThanOrEqual(32_000);
    expect(inputKeys(chat).length).toBeLessThanOrEqual(256);
    // A cut never splits a character.
    expect(
      String(chat.attributes["llm.input_messages.0.message.content"]),
    ).not.toContain("\uFFFD");
  });

  it("drops an older message rather than cut the newest one", async () => {
    const { chat } = await runPiCall({
      context: [
        { role: "user", content: "x".repeat(31_996) },
        { role: "user", content: "next" },
      ],
    });
    expect(chat.attributes["llm.input_messages.0.message.content"]).toBe(
      "next",
    );
    expect(
      chat.attributes["llm.input_messages.1.message.role"],
    ).toBeUndefined();
  });

  it("keeps a short context whole", async () => {
    const context = longContext(2);
    const { chat } = await runPiCall({ context });
    expect(chat.attributes["llm.input_messages.0.message.content"]).toBe(
      "fix the build",
    );
    expect(chat.attributes["llm.input_messages.4.message.tool_call_id"]).toBe(
      "call_1",
    );
  });
});

describe("cost of a model Pi has no price for", () => {
  it("leaves the cost off the span and the run usage, so the platform prices the tokens", async () => {
    // The built-in gateway model is a models.json custom provider with no cost table. Pi fills
    // a zero table for it (provider-composer.js) and prices every call at zero, which is not a
    // measured price.
    const { chat, usage } = await runPiCall({
      context: longContext(1),
      model: {
        id: "google/gemini-3.8-flash",
        provider: "agenta",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
    expect(chat.attributes["gen_ai.usage.cost"]).toBeUndefined();
    expect(chat.attributes["gen_ai.usage.input_tokens"]).toBe(4000);
    expect(usage.cost).toBeUndefined();
  });

  it("keeps a provider-billed zero (an OpenRouter free model)", async () => {
    const { chat, usage } = await runPiCall({
      context: longContext(1),
      model: {
        id: "nvidia/nemotron:free",
        provider: "openrouter",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
        source: "provider",
      },
    });
    expect(chat.attributes["gen_ai.usage.cost"]).toBe(0);
    expect(usage.cost).toBe(0);
  });
});

describe("ACP tracer chat span on a long history", () => {
  it("keeps output and usage past 128 input attributes", async () => {
    // The ACP tracer ships over the runner's HTTP exporter, not the serialized Pi transport.
    const spans: ReadableSpan[] = [];
    vi.spyOn(OTLPTraceExporter.prototype, "export").mockImplementation(
      (batch: ReadableSpan[], done: (result: { code: number }) => void) => {
        spans.push(...batch);
        done({ code: 0 });
      },
    );
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-sonnet",
      emitSpans: true,
      endpoint: "http://agenta.test/api/otlp/v1/traces",
      authorization: "Secret test",
      traceparent: `00-${TRACE_ID}-${"6".repeat(16)}-01`,
    });
    otel.start({ prompt: "next", messages: longContext(60) });
    otel.setTokenDetail({ input: 14, output: 7, cacheRead: 0, cacheWrite: 0 });
    otel.setUsage({ input: 14, output: 7, total: 21, cost: 0.02 });
    otel.finish();
    await otel.flush();

    const chat = spans.find((span) => span.name.startsWith("chat"));
    expect(chat?.attributes["gen_ai.usage.input_tokens"]).toBe(14);
    expect(chat?.attributes["gen_ai.usage.cost"]).toBe(0.02);
    expect(chat?.droppedAttributesCount).toBe(0);
  });
});
