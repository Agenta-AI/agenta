/**
 * `TraceBatchProcessor.flush` previously discarded the exporter's `ExportResult`, so an OTLP
 * export FAILURE resolved as success and was invisible. This pins that a failing export is
 * logged rather than silently swallowed.
 *
 * The runs here export to a third-party collector, which takes unauthenticated spans, so no
 * credential is needed. Only a credential-less export to Agenta's OWN ingest is skipped before
 * reaching the exporter (pinned in otel-export-diagnostics.test.ts).
 *
 * Run: pnpm exec vitest run tests/unit/otel-flush-export.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportResultCode } from "@opentelemetry/core";

import { runExportCapture } from "../utils/otel-export.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("otel TraceBatchProcessor.flush", () => {
  it("logs a FAILED ExportResult instead of silently resolving", async () => {
    const { logs, exportCalled } = await runExportCapture({
      result: { code: ExportResultCode.FAILED, error: new Error("boom") },
    });

    expect(exportCalled).toBe(true);
    // The failure must surface via a log, not vanish.
    expect(logs.some((line) => line.includes("export failed"))).toBe(true);
  });

  it("does not log on a SUCCESS ExportResult", async () => {
    const { logs } = await runExportCapture({
      result: { code: ExportResultCode.SUCCESS },
    });

    expect(logs).toEqual([]);
  });
});
