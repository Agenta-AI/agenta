import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPiFileSpanExporter } from "../../src/tracing/pi-file-exporter.ts";
import { piTraceFileName } from "../../src/tracing/pi-spool-protocol.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("createPiFileSpanExporter", () => {
  it("publishes exact bytes under a bounded numeric sequence with no temp residue", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agenta-pi-traces-"));
    dirs.push(directory);
    const channelId = "a".repeat(32);
    const exporter = createPiFileSpanExporter({ directory, channelId });

    await exporter.export({
      body: Uint8Array.from([0, 255, 7]),
      traceId: "b".repeat(32),
      spanCount: 3,
    });

    const path = join(directory, piTraceFileName(channelId, 0));
    expect(existsSync(path)).toBe(true);
    expect([...readFileSync(path)]).toEqual([0, 255, 7]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory)).toEqual([piTraceFileName(channelId, 0)]);
  });

  it("reuses the same sequence after a failed publication", async () => {
    const root = mkdtempSync(join(tmpdir(), "agenta-pi-traces-retry-"));
    dirs.push(root);
    const directory = join(root, "telemetry");
    writeFileSync(directory, "blocks mkdir");
    const logs: string[] = [];
    const channelId = "e".repeat(32);
    const exporter = createPiFileSpanExporter({
      directory,
      channelId,
      maxFiles: 1,
      log: (message) => logs.push(message),
    });

    await exporter.export({
      body: Uint8Array.from([1]),
      traceId: "f".repeat(32),
      spanCount: 1,
    });
    rmSync(directory, { force: true });
    mkdirSync(directory);
    await exporter.export({
      body: Uint8Array.from([2]),
      traceId: "f".repeat(32),
      spanCount: 1,
    });

    expect(readdirSync(directory)).toEqual([piTraceFileName(channelId, 0)]);
    expect([
      ...readFileSync(join(directory, piTraceFileName(channelId, 0))),
    ]).toEqual([2]);
    expect(logs.filter((line) => line.includes("sequence=0"))).toHaveLength(2);
    expect(logs.some((line) => line.includes("reason=file_limit"))).toBe(false);
  });

  it("drops oversized and over-limit batches without exposing partial files", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agenta-pi-traces-"));
    dirs.push(directory);
    const logs: string[] = [];
    const exporter = createPiFileSpanExporter({
      directory,
      channelId: "c".repeat(32),
      maxBatchBytes: 2,
      maxFiles: 1,
      log: (message) => logs.push(message),
    });

    await exporter.export({
      body: Uint8Array.from([1, 2, 3]),
      traceId: "d".repeat(32),
      spanCount: 1,
    });
    await exporter.export({
      body: Uint8Array.from([4]),
      traceId: "d".repeat(32),
      spanCount: 1,
    });
    await exporter.export({
      body: Uint8Array.from([5]),
      traceId: "d".repeat(32),
      spanCount: 1,
    });

    expect(readdirSync(directory)).toEqual([
      piTraceFileName("c".repeat(32), 0),
    ]);
    expect(logs.some((line) => line.includes("reason=oversized"))).toBe(true);
    expect(logs.some((line) => line.includes("reason=file_limit"))).toBe(true);
  });
});
