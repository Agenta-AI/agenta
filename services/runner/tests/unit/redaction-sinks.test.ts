/**
 * Slice 1 of docs/designs/online-redaction: the known-value pass wired at the runner's two
 * durable/exported sinks — the persisted transcript (WP1.4) and the exported OTel spans (WP1.5),
 * seeded from the per-run deny-set (WP1.1).
 *
 * The load-bearing case is the seed SOURCE. A run's provider keys ride `secrets` on the wire and
 * are applied per run (`buildDaemonEnv`); they are never in the sidecar's own process env. A
 * redactor seeded only from process env would therefore look wired and catch nothing that matters,
 * so these tests plant a key that exists ONLY in the request and assert it is scrubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

import { seedForRun } from "../../src/redaction.ts";
import { buildPersistingEmitter } from "../../src/sessions/persist.ts";
import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";

/** A per-run provider key: present in the request's `secrets`, never in `process.env`. */
const PER_RUN_KEY = "sk-per-run-fake-key-DO-NOT-USE-a1b2c3d4e5f6";
/** The invoke caller's credential, which rides the OTLP auth header. */
const RUN_CREDENTIAL = "ApiKey ag-run-cred-9f8e7d6c5b4a";

/** A request carrying this run's resolved provider key + run credential. */
const runRequest = {
  secrets: { OPENAI_API_KEY: PER_RUN_KEY },
  telemetry: {
    exporters: { otlp: { headers: { authorization: RUN_CREDENTIAL } } },
  },
};

const postedBodies: unknown[] = [];

vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
  postedBodies.push(init?.body ? JSON.parse(init.body as string) : undefined);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

beforeEach(() => {
  postedBodies.length = 0;
  // The per-run key must NOT be reachable from process env — that is the whole point.
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The shared base prototype real exporters inherit `export` from (see otel-flush-export.test). */
function exportProtoOf(exporter: OTLPTraceExporter): SpanExporter {
  return Object.getPrototypeOf(Object.getPrototypeOf(exporter));
}

/** Capture the spans that would actually be shipped, after the sink's redaction pass. */
function captureExportedSpans(): ReadableSpan[] {
  const exported: ReadableSpan[] = [];
  const proto = exportProtoOf(
    new OTLPTraceExporter({ url: "http://127.0.0.1:1/v1/traces" }),
  );
  vi.spyOn(proto, "export").mockImplementation(
    (spans: ReadableSpan[], cb: (r: ExportResult) => void) => {
      exported.push(...spans);
      cb({ code: ExportResultCode.SUCCESS });
    },
  );
  return exported;
}

describe("seedForRun (WP1.1 — the deny-set source)", () => {
  it("seeds from the request's per-run secrets, which are NOT in process env", () => {
    expect(process.env.OPENAI_API_KEY).toBeUndefined();

    const redactor = seedForRun(runRequest);

    // The proof: the key is caught even though nothing in the process env holds it.
    expect(
      redactor.redactString(`key is ${PER_RUN_KEY}`, "test"),
    ).not.toContain(PER_RUN_KEY);
  });

  it("a process-env-only seed would MISS the per-run key (the cosmetic-fix failure mode)", async () => {
    const { seedFromEnv } = await import("../../src/redaction.ts");

    // seedFromEnv() with no per-run values sees only the process env — which never holds the
    // run's resolved provider key. This pins WHY seedForRun must be handed the request.
    const envOnly = seedFromEnv();
    expect(envOnly.redactString(`key is ${PER_RUN_KEY}`, "test")).toContain(
      PER_RUN_KEY,
    );

    // Seeded from the run, the same value is scrubbed.
    expect(
      seedForRun(runRequest).redactString(`key is ${PER_RUN_KEY}`, "test"),
    ).not.toContain(PER_RUN_KEY);
  });

  it("also seeds the run credential from the OTLP auth header", () => {
    const redactor = seedForRun(runRequest);
    expect(
      redactor.redactString(`called back with ${RUN_CREDENTIAL}`, "test"),
    ).not.toContain("ag-run-cred-9f8e7d6c5b4a");
  });
});

describe("persisted transcript sink (WP1.4)", () => {
  it("a per-run provider key echoed into a message never reaches the persisted record", async () => {
    const live: unknown[] = [];
    const { emit, flush } = buildPersistingEmitter(
      "sess-redact",
      () => RUN_CREDENTIAL,
      (e) => live.push(e),
      seedForRun(runRequest),
    );

    // The agent echoes the key back (a tool dumped the env, the model repeated it, ...).
    emit({ type: "message", text: `your key is ${PER_RUN_KEY} ok` });
    await flush();

    const body = postedBodies[0] as Record<string, unknown>;
    const persisted = JSON.stringify(body);
    expect(persisted).not.toContain(PER_RUN_KEY);
    expect(persisted).toContain("[ag:redacted");

    // The LIVE event the client/harness sees is untouched — we redact the durable copy, not the
    // in-memory conversation state.
    expect(live).toHaveLength(1);
    expect(JSON.stringify(live[0])).toContain(PER_RUN_KEY);
  });

  it("redacts the coalesced message text, not just whole-value leaves", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-redact-coalesced",
      () => RUN_CREDENTIAL,
      undefined,
      seedForRun(runRequest),
    );

    // The key arrives split across deltas; only the coalesced text carries it whole.
    emit({ type: "message_start", id: "m1" });
    emit({
      type: "message_delta",
      id: "m1",
      delta: `leaked ${PER_RUN_KEY.slice(0, 20)}`,
    });
    emit({
      type: "message_delta",
      id: "m1",
      delta: `${PER_RUN_KEY.slice(20)} done`,
    });
    emit({ type: "message_end", id: "m1" });
    await flush();

    const persisted = JSON.stringify(postedBodies[0]);
    expect(persisted).not.toContain(PER_RUN_KEY);
    expect(persisted).toContain("[ag:redacted");
  });

  it("scrubs a key inside tool-call arguments", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-redact-tool",
      () => RUN_CREDENTIAL,
      undefined,
      seedForRun(runRequest),
    );

    emit({
      type: "tool_call",
      id: "call_1",
      name: "bash",
      input: { command: `curl -H "auth: ${PER_RUN_KEY}" https://x` },
    });
    await flush();

    expect(JSON.stringify(postedBodies[0])).not.toContain(PER_RUN_KEY);
  });

  it("leaves ordinary user content untouched (we redact leaks, not conversation)", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-redact-content",
      () => RUN_CREDENTIAL,
      undefined,
      seedForRun(runRequest),
    );

    // A deliberately-pasted key-SHAPED string that is not a live secret must survive: the
    // known-value pass has zero false positives by construction.
    const userPasted = "sk-user-pasted-this-on-purpose-000";
    emit({ type: "message", text: `here is my sample ${userPasted}` });
    await flush();

    const persisted = JSON.stringify(postedBodies[0]);
    expect(persisted).toContain(userPasted);
    expect(persisted).not.toContain("[ag:redacted");
  });
});

describe("exported span sink (WP1.5)", () => {
  it("a per-run provider key never reaches the exported span attributes", async () => {
    const exported = captureExportedSpans();

    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint: "http://127.0.0.1:1/v1/traces",
      // captureContent left at its default (ON) — the fix is to scrub secrets from captured
      // content, not to stop capturing it.
      redactor: seedForRun(runRequest),
    });

    otel.start({ prompt: `use my key ${PER_RUN_KEY} please` });
    otel.recordError(`auth failed for key ${PER_RUN_KEY}`);
    otel.finish();
    await otel.flush();

    expect(exported.length).toBeGreaterThan(0);
    const attrs = JSON.stringify(exported.map((s) => s.attributes));
    expect(attrs).not.toContain(PER_RUN_KEY);
    expect(attrs).toContain("[ag:redacted");
  });

  it("still captures content by default — the prompt is present, only the secret is scrubbed", async () => {
    const exported = captureExportedSpans();

    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint: "http://127.0.0.1:1/v1/traces",
      redactor: seedForRun(runRequest),
    });

    otel.start({
      prompt: `summarize the quarterly report using ${PER_RUN_KEY}`,
    });
    otel.finish();
    await otel.flush();

    const attrs = JSON.stringify(exported.map((s) => s.attributes));
    // User content survives (trace viewing keeps working); the secret does not.
    expect(attrs).toContain("summarize the quarterly report");
    expect(attrs).not.toContain(PER_RUN_KEY);
  });

  it("without a redactor the span still exports (no behavior change for an unseeded run)", async () => {
    const exported = captureExportedSpans();

    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint: "http://127.0.0.1:1/v1/traces",
    });

    otel.start({ prompt: "hello" });
    otel.finish();
    await otel.flush();

    expect(exported.length).toBeGreaterThan(0);
  });
});
