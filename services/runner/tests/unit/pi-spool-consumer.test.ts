import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PI_TRACE_CONTROL_FILE,
  piTraceFileName,
} from "../../src/tracing/pi-spool-protocol.ts";
import {
  createPiTraceSpoolConsumer,
  sweepPiTraceSpoolFiles,
  type PiTraceSpoolBatch,
} from "../../src/tracing/pi-spool-consumer.ts";
import type { TelemetryFileHost } from "../../src/tracing/telemetry-file-host.ts";

const DIR = "/runtime/telemetry/conversation";
const CHANNEL = "0123456789abcdef0123456789abcdef";
const OTHER_CHANNEL = "fedcba9876543210fedcba9876543210";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function memoryHost() {
  const files = new Map<string, Uint8Array>();
  const statSizes = new Map<string, number>();
  const operations: string[] = [];
  let listFailures = 0;

  const host: TelemetryFileHost = {
    mkdir: async (path) => {
      operations.push(`mkdir:${path}`);
    },
    list: async (dir) => {
      operations.push(`list:${dir}`);
      if (listFailures > 0) {
        listFailures -= 1;
        throw new Error("transient list failure");
      }
      return [...files.keys()]
        .filter((path) => dirname(path) === dir)
        .map((path) => basename(path));
    },
    statSize: async (path) => {
      operations.push(`stat:${path}`);
      return statSizes.get(path) ?? files.get(path)?.byteLength;
    },
    readBytes: async (path) => {
      operations.push(`read:${path}`);
      const value = files.get(path);
      if (!value) throw new Error("missing");
      return value;
    },
    writeBytes: async (path, contents) => {
      operations.push(`write:${path}`);
      files.set(
        path,
        typeof contents === "string"
          ? new TextEncoder().encode(contents)
          : Uint8Array.from(contents),
      );
    },
    rename: async (from, to) => {
      operations.push(`rename:${from}:${to}`);
      const value = files.get(from);
      if (!value) throw new Error("missing temp");
      files.set(to, value);
      files.delete(from);
    },
    remove: async (path) => {
      operations.push(`remove:${path}`);
      if (!files.delete(path)) throw new Error("missing");
    },
  };

  return {
    host,
    files,
    statSizes,
    operations,
    failLists(count: number) {
      listFailures = count;
    },
  };
}

function spoolPath(channel: string, sequence: number): string {
  return join(DIR, piTraceFileName(channel, sequence));
}

describe("createPiTraceSpoolConsumer", () => {
  it("retries and completes the start sweep before atomic control publication", async () => {
    const memory = memoryHost();
    const logs: string[] = [];
    const sleeps: number[] = [];
    memory.files.set(spoolPath(OTHER_CHANNEL, 0), bytes(1));
    memory.files.set(join(DIR, `${PI_TRACE_CONTROL_FILE}.tmp.old`), bytes(2));
    memory.files.set(join(DIR, "unrelated.txt"), bytes(3));
    memory.failLists(2);
    const consumer = createPiTraceSpoolConsumer({
      host: memory.host,
      dir: DIR,
      channelId: CHANNEL,
      onBatch: async () => {},
      log: (message) => logs.push(message),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await consumer.ready;
    expect(sleeps).toEqual([25, 25]);
    expect(memory.files.has(spoolPath(OTHER_CHANNEL, 0))).toBe(false);
    expect(
      memory.files.has(join(DIR, `${PI_TRACE_CONTROL_FILE}.tmp.old`)),
    ).toBe(false);
    expect(memory.files.has(join(DIR, "unrelated.txt"))).toBe(true);
    expect(
      logs.some(
        (line) => line.includes("phase=start") && line.includes("found=2"),
      ),
    ).toBe(true);

    expect(await consumer.publishControl("control")).toBe(true);
    const writeIndex = memory.operations.findIndex((op) =>
      op.startsWith("write:"),
    );
    const renameIndex = memory.operations.findIndex((op) =>
      op.startsWith("rename:"),
    );
    expect(writeIndex).toBeGreaterThan(-1);
    expect(renameIndex).toBeGreaterThan(writeIndex);
    expect(memory.files.has(join(DIR, PI_TRACE_CONTROL_FILE))).toBe(true);
    expect(
      [...memory.files.keys()].some((path) =>
        path.includes("current.control.json.tmp."),
      ),
    ).toBe(false);
  });

  it("drains current-channel files before exporting the bounded batch in parallel", async () => {
    const memory = memoryHost();
    const calls: Array<{ sequence: number; bytes: number[] }> = [];
    let active = 0;
    let maxActive = 0;
    const logs: string[] = [];
    const consumer = createPiTraceSpoolConsumer({
      host: memory.host,
      dir: DIR,
      channelId: CHANNEL,
      drainTimeoutMs: 0,
      onBatch: async (batch) => {
        expect(memory.files.has(batch.path)).toBe(false);
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push({ sequence: batch.sequence, bytes: [...batch.bytes] });
        await Promise.resolve();
        active -= 1;
        if (batch.sequence === 2) throw new Error("export unavailable");
      },
      log: (message) => logs.push(message),
    });
    await consumer.ready;
    memory.files.set(spoolPath(CHANNEL, 10), bytes(10));
    memory.files.set(spoolPath(CHANNEL, 2), bytes(2));
    memory.files.set(join(DIR, `${CHANNEL}.02.otlp.pb`), bytes(22));
    memory.files.set(spoolPath(CHANNEL, 1), bytes(1));
    memory.files.set(spoolPath(OTHER_CHANNEL, 0), bytes(99));
    memory.files.set(`${spoolPath(CHANNEL, 3)}.tmp.partial`, bytes(3));

    const result = await consumer.drain();

    expect(calls).toEqual([
      { sequence: 1, bytes: [1] },
      { sequence: 2, bytes: [2] },
      { sequence: 10, bytes: [10] },
    ]);
    expect(maxActive).toBe(3);
    expect(result).toMatchObject({ pickedUp: 3, forwarded: 2, oversized: 0 });
    expect(
      logs.some((line) =>
        line.includes("stage=pi_trace_spool_export sequence=2"),
      ),
    ).toBe(true);
    for (const sequence of [1, 2, 10]) {
      const path = spoolPath(CHANNEL, sequence);
      const stat = memory.operations.indexOf(`stat:${path}`);
      const read = memory.operations.indexOf(`read:${path}`);
      const remove = memory.operations.indexOf(`remove:${path}`);
      expect(stat).toBeLessThan(read);
      expect(read).toBeLessThan(remove);
    }
    expect(memory.files.has(spoolPath(OTHER_CHANNEL, 0))).toBe(true);
    expect(memory.files.has(`${spoolPath(CHANNEL, 3)}.tmp.partial`)).toBe(true);
    expect(memory.files.has(join(DIR, `${CHANNEL}.02.otlp.pb`))).toBe(false);
    expect(
      logs.some(
        (line) =>
          line.includes("sequence=2") && line.includes("duplicate=true"),
      ),
    ).toBe(true);
  });

  it("rejects an oversized stat without reading and rechecks the bytes after reading", async () => {
    const memory = memoryHost();
    const forwarded: PiTraceSpoolBatch[] = [];
    const consumer = createPiTraceSpoolConsumer({
      host: memory.host,
      dir: DIR,
      channelId: CHANNEL,
      maxBatchBytes: 4,
      drainTimeoutMs: 0,
      onBatch: async (batch) => {
        forwarded.push(batch);
      },
    });
    await consumer.ready;
    const statOversized = spoolPath(CHANNEL, 0);
    const grewAfterStat = spoolPath(CHANNEL, 1);
    memory.files.set(statOversized, bytes(1));
    memory.statSizes.set(statOversized, 5);
    memory.files.set(grewAfterStat, bytes(1, 2, 3, 4, 5));
    memory.statSizes.set(grewAfterStat, 3);

    const result = await consumer.drain();

    expect(result).toMatchObject({ pickedUp: 2, forwarded: 0, oversized: 2 });
    expect(memory.operations).not.toContain(`read:${statOversized}`);
    expect(memory.operations).toContain(`read:${grewAfterStat}`);
    expect(forwarded).toEqual([]);
    expect(memory.files.has(statOversized)).toBe(false);
    expect(memory.files.has(grewAfterStat)).toBe(false);
  });

  it("bounds accepted files and leaves later files for teardown", async () => {
    const memory = memoryHost();
    const sequences: number[] = [];
    const consumer = createPiTraceSpoolConsumer({
      host: memory.host,
      dir: DIR,
      channelId: CHANNEL,
      maxFiles: 2,
      drainTimeoutMs: 0,
      onBatch: async (batch) => {
        sequences.push(batch.sequence);
      },
    });
    await consumer.ready;
    for (let sequence = 0; sequence < 4; sequence += 1) {
      memory.files.set(spoolPath(CHANNEL, sequence), bytes(sequence));
    }

    const result = await consumer.drain();

    expect(sequences).toEqual([0, 1]);
    expect(result).toMatchObject({
      pickedUp: 2,
      forwarded: 2,
      limitReached: true,
    });
    expect(memory.files.has(spoolPath(CHANNEL, 2))).toBe(true);
    expect(memory.files.has(spoolPath(CHANNEL, 3))).toBe(true);
  });

  it("waits within the bounded drain for a late file and reports unread control", async () => {
    const memory = memoryHost();
    const logs: string[] = [];
    const sequences: number[] = [];
    let clock = 0;
    let published = false;
    const consumer = createPiTraceSpoolConsumer({
      host: memory.host,
      dir: DIR,
      channelId: CHANNEL,
      drainTimeoutMs: 100,
      pollMs: 25,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        if (!published) {
          published = true;
          memory.files.set(spoolPath(CHANNEL, 0), bytes(7));
        }
      },
      onBatch: async (batch) => {
        sequences.push(batch.sequence);
      },
      log: (message) => logs.push(message),
    });
    await consumer.ready;
    memory.files.set(join(DIR, PI_TRACE_CONTROL_FILE), bytes(1));

    const result = await consumer.drain();

    expect(sequences).toEqual([0]);
    expect(result.unreadControl).toBe(true);
    expect(clock).toBe(100);
    expect(
      logs.filter((line) => line === "stage=pi_trace_control unread=true"),
    ).toHaveLength(1);
  });

  it("teardown sweeps late telemetry residue, preserves unrelated files, and logs leftovers", async () => {
    const memory = memoryHost();
    const logs: string[] = [];
    const consumer = createPiTraceSpoolConsumer({
      host: memory.host,
      dir: DIR,
      channelId: CHANNEL,
      onBatch: async () => {},
      log: (message) => logs.push(message),
    });
    await consumer.ready;
    memory.files.set(spoolPath(CHANNEL, 0), bytes(1));
    memory.files.set(join(DIR, PI_TRACE_CONTROL_FILE), bytes(2));
    memory.files.set(join(DIR, "keep.me"), bytes(3));

    await consumer.teardown();

    expect(memory.files.has(spoolPath(CHANNEL, 0))).toBe(false);
    expect(memory.files.has(join(DIR, PI_TRACE_CONTROL_FILE))).toBe(false);
    expect(memory.files.has(join(DIR, "keep.me"))).toBe(true);
    expect(
      logs.some(
        (line) =>
          line.includes("phase=teardown") &&
          line.includes("found=2") &&
          line.includes("leftovers=0"),
      ),
    ).toBe(true);
    expect(logs).toContain("stage=pi_trace_control unread=true phase=teardown");
  });

  it("bounds stale cleanup and reports telemetry files left behind", async () => {
    const memory = memoryHost();
    const logs: string[] = [];
    for (let sequence = 0; sequence < 3; sequence += 1) {
      memory.files.set(spoolPath(CHANNEL, sequence), bytes(sequence));
    }

    await sweepPiTraceSpoolFiles({
      host: memory.host,
      dir: DIR,
      phase: "teardown",
      log: (message) => logs.push(message),
      sleep: async () => {},
      maxFiles: 1,
    });

    expect(
      [...memory.files.keys()].filter((path) => path.endsWith(".otlp.pb")),
    ).toHaveLength(2);
    expect(
      logs.some(
        (line) =>
          line.includes("phase=teardown") && line.includes("leftovers=2"),
      ),
    ).toBe(true);
  });
});
