/**
 * `traceTargets` used to be a single traceId -> ExportTarget slot, overwritten/deleted by
 * whichever run touched it last — the exact single-slot bug `traceRedactors` was fixed to avoid
 * (see redaction-sinks.test.ts's "two overlapping runs sharing one trace id" case). Two concurrent
 * runs sharing a distributed trace (a caller's traceparent nests them under the same trace id) can
 * legitimately have DIFFERENT targets (different endpoint/auth) — the target is a property of the
 * RUN that produced a batch, not of the trace as a whole. This pins that every exported batch lands
 * on the target of the run that produced it, never on `defaultTarget()` nor on another still-live
 * run's target, across an overlapping start/flush order.
 *
 * Both runs here use `emitSpans: true` WITH a remote traceparent, so `invoke_agent` has an
 * in-process `parentSpanId` (the remote span) and root-end does NOT auto-flush (see the
 * `TraceBatchProcessor` docstring: "cross-boundary run ... root-end never fires") — each run must
 * call `flush()` explicitly, exactly like the real runner does after a remote-parented run. That is
 * what lets run B's `start()` (which used to unconditionally overwrite the trace's single target
 * slot) land BEFORE run A's explicit flush, and reproduces the bug pre-fix.
 *
 * `OTLPTraceExporter` is mocked at the module boundary (its constructor args are otherwise
 * unobservable — the url is closed over inside the transport, not stored on a public field), so
 * each fake instance records its own `url`/`headers` plus every span batch it "exported".
 *
 * Run: pnpm exec vitest run tests/unit/otel-trace-target-attribution.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

interface FakeExport {
  url: string;
  authorization?: string;
  spans: ReadableSpan[];
}

const fakeExports: FakeExport[] = [];

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => {
  class FakeOTLPTraceExporter {
    url: string;
    authorization?: string;
    constructor(config: { url: string; headers?: Record<string, string> }) {
      this.url = config.url;
      this.authorization = config.headers?.Authorization;
    }
    export(spans: ReadableSpan[], cb: (r: ExportResult) => void): void {
      fakeExports.push({ url: this.url, authorization: this.authorization, spans });
      cb({ code: 0 /* ExportResultCode.SUCCESS */ });
    }
    async shutdown(): Promise<void> {}
  }
  return { OTLPTraceExporter: FakeOTLPTraceExporter };
});

// Imported AFTER the mock so `otel.ts` picks up the fake OTLPTraceExporter.
const { createSandboxAgentOtel } = await import("../../src/tracing/otel.ts");

/** Batches actually shipped to one endpoint, across every (possibly cached) exporter instance
 * built for it — `getExporter` caches per endpoint+auth, so distinct auths to the same endpoint
 * would be separate instances, but this suite always pairs a distinct auth with a distinct URL. */
function exportsTo(endpoint: string): ReadableSpan[] {
  return fakeExports.filter((e) => e.url === endpoint).flatMap((e) => e.spans);
}

afterEach(() => {
  fakeExports.length = 0;
  vi.restoreAllMocks();
});

describe("otel traceTargets — per-run target attribution across a shared trace id", () => {
  it("two overlapping runs sharing one trace id, DIFFERENT targets: run B registering its target does not steal run A's already-buffered batch, and run A's later flush does not steal run B's", async () => {
    const sharedTraceparent = `00-${"d".repeat(32)}-${"2".repeat(16)}-01`;

    const TARGET_A = "http://collector-a.example/v1/traces";
    const TARGET_B = "http://collector-b.example/v1/traces";

    const runA = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint: TARGET_A,
      authorization: "ApiKey run-a-key",
      traceparent: sharedTraceparent, // remote parent -> root-end does NOT auto-flush
    });

    // Run A starts and finishes (ends its spans) but, being remote-parented, nothing is exported
    // yet — the batch sits buffered under the shared trace id until an explicit flush().
    runA.start({ prompt: "a" });
    runA.finish();

    // Run B starts on the SAME trace id WHILE run A's batch is still buffered and unflushed.
    // Pre-fix, `traceTargets.set(traceId, ...)` was a single slot: this call unconditionally
    // overwrote run A's registered target with run B's.
    const runB = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint: TARGET_B,
      authorization: "ApiKey run-b-key",
      traceparent: sharedTraceparent,
    });
    runB.start({ prompt: "b" });
    runB.finish();

    // Run A flushes explicitly (the real cross-boundary path: "the run flushes explicitly by
    // trace id"). Pre-fix, this exported run A's OWN buffered batch to whatever target the slot
    // held at that moment — run B's, since B's start() had just overwritten it.
    await runA.flush();
    await runB.flush();

    const atA = exportsTo(TARGET_A);
    const atB = exportsTo(TARGET_B);

    expect(atA.length).toBeGreaterThan(0);
    expect(atB.length).toBeGreaterThan(0);

    // No batch fell back to the env default while a run was still registered.
    expect(exportsTo("https://cloud.agenta.ai/api/otlp/v1/traces")).toHaveLength(0);

    // Attribution is correct, not merely present: A's spans carry A's prompt, B's carry B's.
    // `input.value` is itself a JSON-encoded string attribute, so the nested quotes are escaped.
    const textOf = (spans: ReadableSpan[]) =>
      JSON.stringify(spans.map((s) => s.attributes));
    expect(textOf(atA)).toContain('\\"prompt\\":\\"a\\"');
    expect(textOf(atA)).not.toContain('\\"prompt\\":\\"b\\"');
    expect(textOf(atB)).toContain('\\"prompt\\":\\"b\\"');
    expect(textOf(atB)).not.toContain('\\"prompt\\":\\"a\\"');
  });

  it("three overlapping runs sharing one trace id: each explicit flush ships only its own run's spans to its own target", async () => {
    const sharedTraceparent = `00-${"e".repeat(32)}-${"3".repeat(16)}-01`;

    const TARGETS = {
      A: "http://collector-1.example/v1/traces",
      B: "http://collector-2.example/v1/traces",
      C: "http://collector-3.example/v1/traces",
    };

    const make = (label: keyof typeof TARGETS) =>
      createSandboxAgentOtel({
        harness: "claude",
        model: "anthropic/claude-haiku",
        emitSpans: true,
        endpoint: TARGETS[label],
        authorization: `ApiKey ${label}`,
        traceparent: sharedTraceparent,
      });

    const runA = make("A");
    const runB = make("B");
    const runC = make("C");

    // All three start+finish (buffer, no auto-flush) before any of them flushes — every run's
    // spans sit interleaved in the SAME per-trace-id buffer.
    runA.start({ prompt: "prompt-a" });
    runA.finish();
    runB.start({ prompt: "prompt-b" });
    runB.finish();
    runC.start({ prompt: "prompt-c" });
    runC.finish();

    // Flush in a different order than start, to prove ordering isn't what saves it.
    await runB.flush();
    await runA.flush();
    await runC.flush();

    for (const [label, endpoint] of Object.entries(TARGETS)) {
      const spans = exportsTo(endpoint);
      expect(spans.length, `${label} should have exported to its own target`).toBeGreaterThan(0);
      const text = JSON.stringify(spans.map((s) => s.attributes));
      expect(text).toContain(`\\"prompt\\":\\"prompt-${label.toLowerCase()}\\"`);
      for (const other of Object.keys(TARGETS)) {
        if (other === label) continue;
        expect(text).not.toContain(`\\"prompt\\":\\"prompt-${other.toLowerCase()}\\"`);
      }
    }
    expect(exportsTo("https://cloud.agenta.ai/api/otlp/v1/traces")).toHaveLength(0);
  });
});
