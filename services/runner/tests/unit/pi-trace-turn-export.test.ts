import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Redactor } from "../../src/redaction.ts";
import { createPiTraceTurnExport } from "../../src/tracing/pi-trace-turn-export.ts";
import {
  PI_TRACE_CONTROL_FILE,
  PI_TRACE_CONTROL_VERSION,
  piTraceFileName,
} from "../../src/tracing/pi-spool-protocol.ts";
import type { TelemetryFileHost } from "../../src/tracing/telemetry-file-host.ts";

const DIR = "/telemetry/session";
const CHANNEL = "1".repeat(32);

function memoryHost() {
  const files = new Map<string, Uint8Array>();
  const host: TelemetryFileHost = {
    mkdir: async () => {},
    list: async (dir) =>
      [...files.keys()]
        .filter((path) => dirname(path) === dir)
        .map((path) => basename(path)),
    statSize: async (path) => files.get(path)?.byteLength,
    readBytes: async (path) => {
      const value = files.get(path);
      if (!value) throw new Error("missing");
      return value;
    },
    writeBytes: async (path, contents) => {
      files.set(
        path,
        typeof contents === "string"
          ? new TextEncoder().encode(contents)
          : Uint8Array.from(contents),
      );
    },
    rename: async (from, to) => {
      const value = files.get(from);
      if (!value) throw new Error("missing");
      files.set(to, value);
      files.delete(from);
    },
    remove: async (path) => {
      if (!files.delete(path)) throw new Error("missing");
    },
  };
  return { files, host };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createPiTraceTurnExport", () => {
  it("keeps the bytes standard and resolves the live runner credential at pickup", async () => {
    const memory = memoryHost();
    const requests: Array<{ body: number[]; authorization?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requests.push({
          body: [...(init?.body as Buffer)],
          authorization: (init?.headers as Record<string, string>)
            ?.Authorization,
        });
        return new Response(null, { status: 200 });
      }),
    );
    let credential = "ApiKey old";
    const turn = createPiTraceTurnExport({
      host: memory.host,
      dir: DIR,
      channelId: CHANNEL,
      context: {
        endpoint: "https://cloud.agenta.ai/api/otlp/v1/traces",
        authorization: () => credential,
        authorizationSource: "platform",
        placement: "local",
        redactor: new Redactor({ mode: "known" }),
        traceId: "a".repeat(32),
      },
    });

    expect(
      await turn.publishControl({
        version: PI_TRACE_CONTROL_VERSION,
        channelId: CHANNEL,
        capture: { content: true },
        skills: [],
        redaction: { knownValues: [] },
      }),
    ).toBe(true);
    await memory.host.remove(join(DIR, PI_TRACE_CONTROL_FILE));
    memory.files.set(
      join(DIR, piTraceFileName(CHANNEL, 0)),
      Uint8Array.from([10, 0, 255]),
    );
    credential = "ApiKey rotated";

    const firstFinish = turn.finish();
    const secondFinish = turn.finish();
    await expect(firstFinish).resolves.toEqual({
      pickedUpBatches: 1,
      exportedBatches: 1,
    });
    await expect(secondFinish).resolves.toEqual({
      pickedUpBatches: 1,
      exportedBatches: 1,
    });
    await turn.teardown();
    expect(requests).toEqual([
      { body: [10, 0, 255], authorization: "ApiKey rotated" },
    ]);
    expect(memory.files.size).toBe(0);
  });

  it("keeps an external collector credential static and reports bounded spool diagnostics", async () => {
    const memory = memoryHost();
    const authorizations: Array<string | undefined> = [];
    const logs: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        authorizations.push(
          (init?.headers as Record<string, string>)?.Authorization,
        );
        return new Response(null, { status: 200 });
      }),
    );
    const turn = createPiTraceTurnExport({
      host: memory.host,
      dir: DIR,
      channelId: CHANNEL,
      context: {
        endpoint: "https://collector.example.test/v1/traces",
        authorization: () => "Bearer collector",
        authorizationSource: "exporter",
        placement: "daytona",
        turnId: "turn-1",
        redactor: new Redactor({ mode: "known" }),
        traceId: "b".repeat(32),
      },
      log: (message) => logs.push(message),
    });
    await turn.publishControl({
      version: PI_TRACE_CONTROL_VERSION,
      channelId: CHANNEL,
      capture: { content: true },
      skills: [],
      redaction: { knownValues: [] },
    });
    await memory.host.remove(join(DIR, PI_TRACE_CONTROL_FILE));
    memory.files.set(
      join(DIR, piTraceFileName(CHANNEL, 0)),
      Uint8Array.from([1, 2, 3]),
    );

    turn.updatePlatformAuthorization(() => "Secret platform");
    await turn.finish();

    expect(authorizations).toEqual(["Bearer collector"]);
    expect(logs.join("\n")).toContain("source=pi-spool placement=daytona");
    expect(logs.join("\n")).toContain("bytes=3");
  });

  it("counts a valid pickup separately from a rejected HTTP export", async () => {
    const memory = memoryHost();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const turn = createPiTraceTurnExport({
      host: memory.host,
      dir: DIR,
      channelId: CHANNEL,
      context: {
        endpoint: "https://cloud.agenta.ai/api/otlp/v1/traces",
        authorization: () => "Secret current",
        authorizationSource: "platform",
        placement: "local",
        redactor: new Redactor({ mode: "known" }),
      },
    });
    await turn.publishControl({
      version: PI_TRACE_CONTROL_VERSION,
      channelId: CHANNEL,
      capture: { content: true },
      skills: [],
      redaction: { knownValues: [] },
    });
    await memory.host.remove(join(DIR, PI_TRACE_CONTROL_FILE));
    memory.files.set(
      join(DIR, piTraceFileName(CHANNEL, 0)),
      Uint8Array.from([1]),
    );

    await expect(turn.finish()).resolves.toEqual({
      pickedUpBatches: 1,
      exportedBatches: 0,
    });
  });

  it("exposes the original trace id and emits a missing-batch fallback once", async () => {
    const fallback: string[] = [];
    const turn = createPiTraceTurnExport({
      host: memoryHost().host,
      dir: DIR,
      channelId: CHANNEL,
      context: {
        endpoint: "https://cloud.agenta.ai/api/otlp/v1/traces",
        authorization: () => "Secret current",
        authorizationSource: "platform",
        placement: "local",
        redactor: new Redactor({ mode: "known" }),
        traceId: "c".repeat(32),
        onMissingBatch: async (message) => {
          fallback.push(message);
        },
      },
    });

    expect(turn.traceId()).toBe("c".repeat(32));
    await turn.emitMissingBatchFallback("missing");
    await turn.emitMissingBatchFallback("duplicate");
    expect(fallback).toEqual(["missing"]);
    await turn.teardown();
  });
});
