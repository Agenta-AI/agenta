/**
 * Unit tests for the tracing additions in `tracing/otel.ts`:
 *
 *  - F-029/F-036: the loaded skills (author + forced `_agenta.*`) are stamped on the agent span
 *    via `ag.meta.skills.loaded` / `ag.meta.skills.count`, on BOTH the sandbox-agent ACP tracer
 *    (`createSandboxAgentOtel`, non-Pi / Daytona) and Pi's own extension tracer
 *    (`createAgentaOtel`, local Pi). The `ag.meta.*` namespace is a recognized `ag.*` bucket, so
 *    Agenta's OTel ingest keeps the attributes there rather than relocating an unrecognized
 *    `ag.agent.*` key into `ag.unsupported.*` (the F-036 namespace wrinkle).
 *  - F-030/F-036: `recordError` stamps the user-facing error message + the provider that failed
 *    plus an exception event on the agent span, so an error run's trace carries the same
 *    diagnostic the HTTP response does. The attributes use the recognized `ag.exception.*`
 *    namespace (not `ag.error.*`, which ingest would relocate to `ag.unsupported.*`). When the
 *    harness self-instruments (no owned span) it emits a standalone `agent_error` span so the
 *    failure still reaches the trace.
 *
 * Spans export over OTLP from a module-level provider, so we spy on the OTel API tracer and
 * capture the attributes/exceptions each span records, rather than wiring an in-memory exporter.
 *
 * Run: pnpm exec vitest run tests/unit/otel-skills-error.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import {
  createSandboxAgentOtel,
  createAgentaOtel,
} from "../../src/tracing/otel.ts";

interface FakeSpan {
  name: string;
  attributes: Record<string, unknown>;
  exceptions: Array<{ name?: string; message?: string }>;
  status?: { code: number; message?: string };
  ended: boolean;
}

/** Replace the OTel tracer so every span built records into a captured array. */
function spyTracer(): FakeSpan[] {
  const spans: FakeSpan[] = [];
  const makeSpan = (name: string): Span => {
    const span: FakeSpan = {
      name,
      attributes: {},
      exceptions: [],
      ended: false,
    };
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
      recordException(exc: { name?: string; message?: string }) {
        span.exceptions.push(exc);
      },
      setStatus(status: { code: number; message?: string }) {
        span.status = status;
        return api;
      },
      end() {
        span.ended = true;
      },
      spanContext() {
        return {
          traceId: "0".repeat(32),
          spanId: "0".repeat(16),
          traceFlags: 1,
        };
      },
      isRecording() {
        return true;
      },
      addEvent() {
        return api;
      },
      updateName() {
        return api;
      },
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("otel skills + error tracing", () => {
  it("stamps loaded skills (author + builtins) on the sandbox-agent agent span (F-029/F-036)", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      // The runner stamps exactly the materialized list it is given: an author skill AND a
      // forced `_agenta.*` platform skill both appear in `loaded` (F-036 builtins-in-loaded).
      skills: ["weather-oracle", "_agenta.agenta-getting-started"],
    });
    otel.start({ prompt: "hi" });

    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan).toBeTruthy();
    expect(agentSpan?.attributes["ag.meta.skills.loaded"]).toEqual([
      "weather-oracle",
      "_agenta.agenta-getting-started",
    ]);
    expect(agentSpan?.attributes["ag.meta.skills.count"]).toBe(2);
  });

  it("uses recognized ag.* namespaces, never ag.agent.* / ag.error.* (F-036)", () => {
    // Agenta's OTel ingest strict-whitelists top-level `ag.*` keys against a known-attribute
    // schema and relocates any unrecognized key (e.g. an `ag.agent.*` or `ag.error.*` key) into
    // `ag.unsupported.*`. Pin that skills + error attributes use the recognized `ag.meta.*` and
    // `ag.exception.*` buckets so they are never demoted to `ag.unsupported.*`.
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      skills: ["weather-oracle"],
    });
    otel.start({ prompt: "hi" });
    otel.recordError("model authentication failed", "anthropic");

    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    const keys = Object.keys(agentSpan?.attributes ?? {});
    // No demoted-to-unsupported namespaces.
    expect(keys.some((k) => k.startsWith("ag.agent."))).toBe(false);
    expect(keys.some((k) => k.startsWith("ag.error."))).toBe(false);
    expect(keys.some((k) => k.startsWith("ag.unsupported."))).toBe(false);
    // The recognized homes are present.
    expect(agentSpan?.attributes["ag.meta.skills.loaded"]).toEqual([
      "weather-oracle",
    ]);
    expect(agentSpan?.attributes["ag.exception.message"]).toBeDefined();
  });

  it("omits the skills attributes when no skills loaded", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan?.attributes["ag.meta.skills.loaded"]).toBeUndefined();
    expect(agentSpan?.attributes["ag.meta.skills.count"]).toBeUndefined();
  });

  it("stamps loaded skills on Pi's own agent span (F-029, local Pi)", () => {
    const spans = spyTracer();
    const otel = createAgentaOtel({
      captureContent: true,
      skills: ["weather-oracle", "_agenta.agenta-getting-started"],
    });
    // Drive the Pi lifecycle: register handlers, then fire before_agent_start + agent_start.
    const handlers: Record<string, (e: any) => Promise<void>> = {};
    otel.register({
      on: (name: string, fn: (e: any) => Promise<void>) => {
        handlers[name] = fn;
      },
    } as any);
    return (async () => {
      await handlers["before_agent_start"]?.({ prompt: "hi" });
      await handlers["agent_start"]?.({});
      const agentSpan = spans.find((s) => s.name === "invoke_agent");
      expect(agentSpan?.attributes["ag.meta.skills.loaded"]).toEqual([
        "weather-oracle",
        "_agenta.agenta-getting-started",
      ]);
      expect(agentSpan?.attributes["ag.meta.skills.count"]).toBe(2);
    })();
  });

  it("records the error message + provider + exception on the owned agent span (F-030)", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.recordError(
      "claude: model authentication failed — add the project's Anthropic key.",
      "anthropic",
    );

    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan?.attributes["ag.exception.message"]).toContain(
      "model authentication failed",
    );
    expect(agentSpan?.attributes["ag.exception.provider"]).toBe("anthropic");
    expect(agentSpan?.exceptions.length).toBe(1);
    expect(agentSpan?.exceptions[0].message).toContain(
      "model authentication failed",
    );
    // ERROR status (SpanStatusCode.ERROR = 2).
    expect(agentSpan?.status?.code).toBe(2);
  });

  it("emits a standalone error span when the harness self-instruments (F-030, local Pi)", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "pi",
      model: "openai/gpt-4o-mini",
      // Local Pi: the runner's sandbox-agent tracer is span-less; Pi emits its own spans.
      emitSpans: false,
      traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
    });
    otel.start({ prompt: "hi" });
    // No invoke_agent span exists yet (span-less mode).
    expect(spans.find((s) => s.name === "invoke_agent")).toBeUndefined();

    otel.recordError(
      "pi_core: model authentication failed — add the project's Anthropic key.",
      "anthropic",
    );

    const errSpan = spans.find((s) => s.name === "agent_error");
    expect(errSpan).toBeTruthy();
    expect(errSpan?.attributes["ag.exception.message"]).toContain(
      "model authentication failed",
    );
    expect(errSpan?.attributes["ag.exception.provider"]).toBe("anthropic");
    expect(errSpan?.exceptions.length).toBe(1);
    expect(errSpan?.ended).toBe(true);
  });

  it("falls back to the init model provider when recordError omits one", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.recordError("some failure");
    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan?.attributes["ag.exception.provider"]).toBe("anthropic");
  });

  // Emit the dotted cache-token keys the ingest adapter reads; underscore form is dropped.
  it("emits dotted cache-token keys matching the ingest adapter's expected form", () => {
    const spans = spyTracer();
    const otel = createAgentaOtel({ captureContent: true });
    const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
    otel.register({
      on: (name: string, fn: (...args: any[]) => Promise<void>) => {
        handlers[name] = fn;
      },
    } as any);
    return (async () => {
      await handlers["before_agent_start"]?.({ prompt: "hi" });
      await handlers["agent_start"]?.({});
      await handlers["turn_start"]?.({ turnIndex: 0 });
      await handlers["before_provider_request"]?.({}, { model: { id: "gpt-5" } });
      await handlers["message_end"]?.({
        message: {
          role: "assistant",
          usage: { input: 10, output: 5, cacheRead: 7, cacheWrite: 3 },
        },
      });

      const llmSpan = spans.find((s) => s.name === "chat gpt-5");
      expect(llmSpan?.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(
        7,
      );
      expect(
        llmSpan?.attributes["gen_ai.usage.cache_creation.input_tokens"],
      ).toBe(3);
      // The old underscore form must be gone — that mismatch is the bug being fixed.
      expect(
        llmSpan?.attributes["gen_ai.usage.cache_read_input_tokens"],
      ).toBeUndefined();
      expect(
        llmSpan?.attributes["gen_ai.usage.cache_creation_input_tokens"],
      ).toBeUndefined();
    })();
  });
});
