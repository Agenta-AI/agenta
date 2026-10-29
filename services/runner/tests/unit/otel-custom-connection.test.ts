/**
 * A model served by a custom model connection must not be priced at the public provider rate.
 *
 * The ACP tracer stamps the bare model id (`gpt-5.3-codex`) on its model spans, which the
 * platform prices from its public table. A custom connection is the user's own gateway or
 * OpenAI-compatible deployment and charges what it charges, so its model spans carry
 * `agenta.model.custom_connection = true`. A standard provider route carries no marker.
 *
 * Run: pnpm exec vitest run tests/unit/otel-custom-connection.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import {
  CUSTOM_CONNECTION,
  createAgentaOtel,
  createSandboxAgentOtel,
} from "../../src/tracing/otel.ts";

interface FakeSpan {
  name: string;
  attributes: Record<string, unknown>;
}

function spyTracer(): FakeSpan[] {
  const spans: FakeSpan[] = [];
  const makeSpan = (name: string): Span => {
    const span: FakeSpan = { name, attributes: {} };
    spans.push(span);
    const api = {
      setAttribute(key: string, value: unknown) {
        span.attributes[key] = value;
        return api;
      },
      setAttributes(attrs: Record<string, unknown>) {
        Object.assign(span.attributes, attrs);
        return api;
      },
      recordException() {},
      setStatus() {
        return api;
      },
      end() {},
      spanContext() {
        return {
          traceId: "0".repeat(32),
          spanId: "0".repeat(16),
          traceFlags: 1,
        };
      },
      isRecording: () => true,
      addEvent: () => api,
      updateName: () => api,
    };
    return api as unknown as Span;
  };
  vi.spyOn(trace, "getTracer").mockReturnValue({
    startSpan: (name: string) => makeSpan(name),
    startActiveSpan: ((name: string, fn: (s: Span) => unknown) =>
      fn(makeSpan(name))) as any,
  } as any);
  return spans;
}

function runOnce(customConnection: boolean | undefined) {
  const spans = spyTracer();
  const otel = createSandboxAgentOtel({
    harness: "claude",
    model: "anthropic/claude-sonnet",
    customConnection,
    emitSpans: true,
  });
  otel.start({ prompt: "hi" });
  otel.setTokenDetail({ input: 14, output: 7, cacheRead: 0, cacheWrite: 0 });
  // Claude's harness cost: its own public price-table estimate.
  otel.setUsage({ input: 14, output: 7, total: 21, cost: 0.02 });
  otel.finish();
  return Object.assign(spans, { usage: otel.usage() });
}

const modelSpans = (spans: FakeSpan[]) =>
  spans.filter((span) => span.name.startsWith("chat"));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("custom model connection marker on model spans", () => {
  it("marks the model span of a custom connection, and no other span", () => {
    const spans = runOnce(true);
    const models = modelSpans(spans);
    expect(models).toHaveLength(1);
    for (const span of models) {
      expect(span.attributes[CUSTOM_CONNECTION]).toBe(true);
    }
    for (const span of spans.filter((s) => !s.name.startsWith("chat"))) {
      expect(span.attributes[CUSTOM_CONNECTION]).toBeUndefined();
    }
    expect(CUSTOM_CONNECTION).toBe("agenta.model.custom_connection");
  });

  it("keeps the harness's price-table estimate off a custom connection's span and usage", () => {
    const spans = runOnce(true);
    expect(
      modelSpans(spans)[0].attributes["gen_ai.usage.cost"],
    ).toBeUndefined();
    expect(spans.usage).toEqual({ input: 14, output: 7, total: 21 });

    const standard = runOnce(false);
    expect(modelSpans(standard)[0].attributes["gen_ai.usage.cost"]).toBe(0.02);
    expect(standard.usage?.cost).toBe(0.02);
  });

  it.each([[false], [undefined]])(
    "leaves a standard route (%s) unmarked",
    (customConnection) => {
      for (const span of modelSpans(runOnce(customConnection))) {
        expect(span.attributes[CUSTOM_CONNECTION]).toBeUndefined();
      }
    },
  );
});

/** Drive one Pi turn through the extension tracer, as Pi's own lifecycle events would. */
async function runPiTurn(
  customConnection: boolean | undefined,
  cost?: { total: number; source?: string },
) {
  const spans = spyTracer();
  const pi = registerPi();
  await piTurn(pi, customConnection, cost);
  return Object.assign(spans, { usage: pi.otel.usage() });
}

function registerPi() {
  const otel = createAgentaOtel({ captureContent: false });
  const handlers: Record<string, (e: any, ctx?: any) => Promise<void>> = {};
  otel.register({
    on: (name: string, fn: (e: any, ctx?: any) => Promise<void>) => {
      handlers[name] = fn;
    },
  } as any);
  return { otel, handlers };
}

async function piTurn(
  { otel, handlers }: ReturnType<typeof registerPi>,
  customConnection: boolean | undefined,
  cost?: { total: number; source?: string },
) {
  otel.beginTurn({ enabled: true, captureContent: false, customConnection });

  await handlers["before_agent_start"]?.({ prompt: "hi" });
  await handlers["agent_start"]?.({});
  await handlers["turn_start"]?.({ turnIndex: 0 });
  await handlers["before_provider_request"]?.(
    {},
    { model: { id: "gpt-5.5", provider: "openai" } },
  );
  await handlers["message_end"]?.({
    message: {
      role: "assistant",
      model: "gpt-5.5",
      provider: "openai",
      content: "ok",
      usage: {
        input: 10,
        output: 5,
        totalTokens: 15,
        ...(cost ? { cost } : {}),
      },
    },
  });
  await handlers["agent_settled"]?.({});
}

describe("custom model connection marker on Pi native spans", () => {
  it("marks the chat span of a turn served by a custom connection", async () => {
    const spans = await runPiTurn(true);
    const chats = modelSpans(spans);
    expect(chats).toHaveLength(1);
    expect(chats[0].attributes[CUSTOM_CONNECTION]).toBe(true);
    for (const span of spans.filter((s) => !s.name.startsWith("chat"))) {
      expect(span.attributes[CUSTOM_CONNECTION]).toBeUndefined();
    }
  });

  it.each([[false], [undefined]])(
    "leaves a standard route (%s) unmarked",
    async (customConnection) => {
      for (const span of modelSpans(await runPiTurn(customConnection))) {
        expect(span.attributes[CUSTOM_CONNECTION]).toBeUndefined();
      }
    },
  );

  it("drops Pi's price-table estimate on a custom connection", async () => {
    const spans = await runPiTurn(true, { total: 0.01 });
    expect(
      modelSpans(spans)[0].attributes["gen_ai.usage.cost"],
    ).toBeUndefined();
    expect(spans.usage.cost).toBeUndefined();

    const standard = await runPiTurn(false, { total: 0.01 });
    expect(modelSpans(standard)[0].attributes["gen_ai.usage.cost"]).toBe(0.01);
    expect(standard.usage.cost).toBe(0.01);
  });

  it("keeps a provider-billed cost on a custom connection", async () => {
    const spans = await runPiTurn(true, { total: 0.03, source: "provider" });
    expect(modelSpans(spans)[0].attributes["gen_ai.usage.cost"]).toBe(0.03);
    expect(spans.usage.cost).toBe(0.03);
  });

  it("reports no cost for a custom-connection turn after a priced turn", async () => {
    spyTracer();
    const pi = registerPi();
    await piTurn(pi, false, { total: 0.01 });
    expect(pi.otel.usage().cost).toBe(0.01);

    await piTurn(pi, true, { total: 0.02 });
    expect(pi.otel.usage()).toEqual({ input: 10, output: 5, total: 15 });
  });
});
