import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  localTelemetryFileHost,
  publishTelemetryFileAtomic,
  sandboxTelemetryFileHost,
  type TelemetryFileHost,
} from "../../src/tracing/telemetry-file-host.ts";

const temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("localTelemetryFileHost", () => {
  it("round-trips arbitrary bytes and reports size without a text conversion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-telemetry-host-"));
    temporaryDirs.push(dir);
    const path = join(dir, "batch.otlp.pb");
    const bytes = Uint8Array.from([0, 255, 254, 128, 10, 0, 42]);
    const host = localTelemetryFileHost();

    await host.writeBytes(path, bytes);

    expect(await host.list(dir, 10)).toEqual(["batch.otlp.pb"]);
    expect(await host.statSize(path)).toBe(bytes.byteLength);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect([...(await host.readBytes(path, 10))]).toEqual([...bytes]);
    await host.remove(path);
    expect(await host.list(dir, 10)).toEqual([]);
  });

  it("rejects a local file before allocating beyond the read bound", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-telemetry-bound-"));
    temporaryDirs.push(dir);
    const path = join(dir, "batch.otlp.pb");
    writeFileSync(path, Uint8Array.from([1, 2, 3, 4]));

    await expect(localTelemetryFileHost().readBytes(path, 3)).rejects.toThrow(
      "Telemetry file exceeds read limit",
    );
  });

  it("atomically publishes through a temporary sibling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-telemetry-atomic-"));
    temporaryDirs.push(dir);
    const finalPath = join(dir, "current.control.json");
    const real = localTelemetryFileHost();
    const operations: string[] = [];
    const host: TelemetryFileHost = {
      ...real,
      writeBytes: async (path, contents) => {
        operations.push(`write:${path}`);
        expect(path.startsWith(`${finalPath}.tmp.`)).toBe(true);
        await real.writeBytes(path, contents);
      },
      rename: async (from, to) => {
        operations.push(`rename:${from}:${to}`);
        expect(readFileSync(from, "utf8")).toBe("control");
        expect(() => readFileSync(to)).toThrow();
        await real.rename(from, to);
      },
    };

    await publishTelemetryFileAtomic(host, finalPath, "control");

    expect(operations.map((entry) => entry.split(":", 1)[0])).toEqual([
      "write",
      "rename",
    ]);
    expect(readFileSync(finalPath, "utf8")).toBe("control");
    expect(
      (await real.list(dir, 10)).filter((name) => name.includes(".tmp.")),
    ).toEqual([]);
  });

  it("removes a temporary sibling when publication fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-telemetry-failure-"));
    temporaryDirs.push(dir);
    const finalPath = join(dir, "current.control.json");
    const real = localTelemetryFileHost();
    const host: TelemetryFileHost = {
      ...real,
      rename: async () => {
        throw new Error("rename failed");
      },
    };

    await expect(
      publishTelemetryFileAtomic(host, finalPath, "control"),
    ).rejects.toThrow("rename failed");
    expect(await real.list(dir, 10)).toEqual([]);
  });
});

describe("sandboxTelemetryFileHost", () => {
  it("uses bounded Daytona reads and maps publication to overwrite rename", async () => {
    const calls: Array<{ method: string; value: unknown }> = [];
    const stored = Uint8Array.from([0, 255, 1, 128]);
    const sandbox = {
      mkdirFs: async (value: unknown) => {
        calls.push({ method: "mkdirFs", value });
        return { path: "/telemetry" };
      },
      listFsEntries: async (value: unknown) => {
        calls.push({ method: "listFsEntries", value });
        return [
          {
            entryType: "file",
            modified: null,
            name: "batch.otlp.pb",
            path: "/telemetry/batch.otlp.pb",
            size: stored.byteLength,
          },
        ];
      },
      runProcess: async (value: any) => {
        calls.push({ method: "runProcess", value });
        const isList = value.args?.[2] === "agenta-telemetry-list";
        return {
          durationMs: 1,
          exitCode: 0,
          stderr: "",
          stderrTruncated: false,
          stdout: isList
            ? "batch.otlp.pb\n"
            : Buffer.from(stored).toString("base64"),
          stdoutTruncated: false,
          timedOut: false,
        };
      },
      statFs: async (value: unknown) => {
        calls.push({ method: "statFs", value });
        return {
          entryType: "file",
          modified: null,
          path: "/telemetry/batch.otlp.pb",
          size: stored.byteLength,
        };
      },
      readFsFile: async (value: unknown) => {
        calls.push({ method: "readFsFile", value });
        return stored;
      },
      writeFsFile: async (query: unknown, body: unknown) => {
        calls.push({ method: "writeFsFile", value: { query, body } });
        return { path: "/telemetry/batch.otlp.pb" };
      },
      moveFs: async (value: unknown) => {
        calls.push({ method: "moveFs", value });
        return value;
      },
      deleteFsEntry: async (value: unknown) => {
        calls.push({ method: "deleteFsEntry", value });
        return { path: "/telemetry/batch.otlp.pb" };
      },
    };
    const host = sandboxTelemetryFileHost(sandbox as never);

    await host.mkdir("/telemetry");
    expect(await host.list("/telemetry", 10)).toEqual(["batch.otlp.pb"]);
    expect(await host.statSize("/telemetry/batch.otlp.pb")).toBe(4);
    expect([...(await host.readBytes("/telemetry/batch.otlp.pb", 10))]).toEqual(
      [0, 255, 1, 128],
    );
    await host.writeBytes("/telemetry/temp", stored);
    await host.rename("/telemetry/temp", "/telemetry/batch.otlp.pb");
    await host.remove("/telemetry/batch.otlp.pb");

    const write = calls.find((call) => call.method === "writeFsFile")
      ?.value as {
      query: unknown;
      body: ArrayBuffer;
    };
    expect(write.query).toEqual({ path: "/telemetry/temp" });
    expect([...new Uint8Array(write.body)]).toEqual([...stored]);
    expect(calls.find((call) => call.method === "moveFs")?.value).toEqual({
      from: "/telemetry/temp",
      to: "/telemetry/batch.otlp.pb",
      overwrite: true,
    });
    const processCalls = calls
      .filter((call) => call.method === "runProcess")
      .map(
        (call) => call.value as { maxOutputBytes: number; timeoutMs: number },
      );
    expect(processCalls).toHaveLength(2);
    expect(processCalls.every((call) => call.maxOutputBytes > 0)).toBe(true);
    expect(processCalls.every((call) => call.timeoutMs === 10_000)).toBe(true);
  });

  it("treats a missing Daytona telemetry directory as empty", async () => {
    const calls: any[] = [];
    const host = sandboxTelemetryFileHost({
      mkdirFs: async () => ({ path: "/telemetry" }),
      statFs: async () => {
        throw new Error("missing");
      },
      runProcess: async (value: any) => {
        calls.push(value);
        return {
          durationMs: 1,
          exitCode: 0,
          stderr: "",
          stderrTruncated: false,
          stdout: "",
          stdoutTruncated: false,
          timedOut: false,
        };
      },
      writeFsFile: async () => ({ path: "/telemetry/file" }),
      moveFs: async () => ({}),
      deleteFsEntry: async () => ({}),
    } as never);

    await expect(host.list("/telemetry/missing", 10)).resolves.toEqual([]);
    expect(calls[0].args[1]).toContain("if [ ! -d");
  });

  it("rejects an empty Daytona file instead of exporting an empty OTLP body", async () => {
    const host = sandboxTelemetryFileHost({
      mkdirFs: async () => ({ path: "/telemetry" }),
      statFs: async () => ({
        entryType: "file",
        modified: null,
        path: "/telemetry/batch.otlp.pb",
        size: 1,
      }),
      runProcess: async () => ({
        durationMs: 1,
        exitCode: 0,
        stderr: "",
        stderrTruncated: false,
        stdout: "",
        stdoutTruncated: false,
        timedOut: false,
      }),
      writeFsFile: async () => ({ path: "/telemetry/file" }),
      moveFs: async () => ({}),
      deleteFsEntry: async () => ({}),
    } as never);

    await expect(host.readBytes("/telemetry/batch.otlp.pb", 4)).rejects.toThrow(
      "Telemetry file read returned no bytes",
    );
  });

  it("rejects a truncated Daytona process response", async () => {
    const host = sandboxTelemetryFileHost({
      mkdirFs: async () => ({ path: "/telemetry" }),
      statFs: async () => ({
        entryType: "file",
        modified: null,
        path: "/telemetry/batch.otlp.pb",
        size: 4,
      }),
      runProcess: async () => ({
        durationMs: 1,
        exitCode: 0,
        stderr: "",
        stderrTruncated: false,
        stdout: "AA==",
        stdoutTruncated: true,
        timedOut: false,
      }),
      writeFsFile: async () => ({ path: "/telemetry/file" }),
      moveFs: async ({ from, to }: { from: string; to: string }) => ({
        from,
        to,
      }),
      deleteFsEntry: async () => ({ path: "/telemetry/file" }),
    } as never);

    await expect(host.readBytes("/telemetry/batch.otlp.pb", 4)).rejects.toThrow(
      "Telemetry file read exceeded its bound",
    );
  });

  it("returns undefined when the remote stat cannot be obtained", async () => {
    const host = sandboxTelemetryFileHost({
      mkdirFs: async () => ({ path: "/telemetry" }),
      listFsEntries: async () => [],
      statFs: async () => {
        throw new Error("gone");
      },
      runProcess: async () => ({
        durationMs: 1,
        exitCode: 0,
        stderr: "",
        stderrTruncated: false,
        stdout: "",
        stdoutTruncated: false,
        timedOut: false,
      }),
      readFsFile: async () => new Uint8Array(),
      writeFsFile: async () => ({ path: "/telemetry/file" }),
      moveFs: async ({ from, to }: { from: string; to: string }) => ({
        from,
        to,
      }),
      deleteFsEntry: async () => ({ path: "/telemetry/file" }),
    } as never);

    expect(await host.statSize("/telemetry/missing")).toBeUndefined();
  });
});
