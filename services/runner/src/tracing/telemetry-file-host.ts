import {
  closeSync,
  mkdirSync,
  constants,
  fstatSync,
  openSync,
  opendirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

import type { SandboxAgent } from "sandbox-agent";

/** Binary filesystem operations used only by the Pi telemetry spool. */
export interface TelemetryFileHost {
  mkdir: (path: string) => Promise<void>;
  list: (dir: string, maxEntries: number) => Promise<string[]>;
  statSize: (path: string) => Promise<number | undefined>;
  readBytes: (path: string, maxBytes: number) => Promise<Uint8Array>;
  writeBytes: (path: string, contents: Uint8Array | string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

/** Telemetry host for a Pi process sharing the runner's local filesystem. */
export function localTelemetryFileHost(): TelemetryFileHost {
  return {
    mkdir: async (path) => {
      mkdirSync(path, { recursive: true });
    },
    list: async (dir, maxEntries) => {
      let handle: ReturnType<typeof opendirSync> | undefined;
      try {
        handle = opendirSync(dir);
        const names: string[] = [];
        while (names.length < Math.max(0, maxEntries)) {
          const entry = handle.readSync();
          if (!entry) break;
          names.push(entry.name);
        }
        return names;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      } finally {
        handle?.closeSync();
      }
    },
    statSize: async (path) => {
      try {
        return statSync(path).size;
      } catch {
        return undefined;
      }
    },
    readBytes: async (path, maxBytes) => {
      const fd = openSync(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const initial = fstatSync(fd);
        if (!initial.isFile() || initial.size > maxBytes) {
          throw new Error("Telemetry file exceeds read limit");
        }
        const buffer = Buffer.allocUnsafe(
          Math.min(maxBytes + 1, Math.max(1, initial.size + 1)),
        );
        const length = readSync(fd, buffer, 0, buffer.byteLength, 0);
        return buffer.subarray(0, length);
      } finally {
        closeSync(fd);
      }
    },
    writeBytes: async (path, contents) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents, { mode: 0o600 });
    },
    rename: async (from, to) => {
      renameSync(from, to);
    },
    remove: async (path) => {
      unlinkSync(path);
    },
  };
}

type TelemetrySandbox = Pick<
  SandboxAgent,
  | "mkdirFs"
  | "statFs"
  | "runProcess"
  | "writeFsFile"
  | "moveFs"
  | "deleteFsEntry"
>;

/** Telemetry host for a Pi process running inside a Daytona sandbox. */
export function sandboxTelemetryFileHost(
  sandbox: TelemetrySandbox,
): TelemetryFileHost {
  return {
    mkdir: async (path) => {
      await sandbox.mkdirFs({ path });
    },
    list: async (dir, maxEntries) => {
      const limit = Math.max(0, Math.floor(maxEntries));
      if (limit === 0) return [];
      const result = await sandbox.runProcess({
        command: "sh",
        args: [
          "-c",
          'test -d "$1" && LC_ALL=C ls -1A -- "$1" | head -n "$2"',
          "agenta-telemetry-list",
          dir,
          String(limit),
        ],
        maxOutputBytes: (limit + 1) * 512,
        timeoutMs: 10_000,
      });
      if (
        result.exitCode !== 0 ||
        result.stdoutTruncated ||
        result.stderrTruncated ||
        result.timedOut
      ) {
        throw new Error("Telemetry directory listing exceeded its bound");
      }
      return result.stdout.split("\n").filter(Boolean);
    },
    statSize: async (path) => {
      try {
        const stat = await sandbox.statFs({ path });
        return Number.isFinite(stat.size) && stat.size >= 0
          ? stat.size
          : undefined;
      } catch {
        return undefined;
      }
    },
    readBytes: async (path, maxBytes) => {
      const rawLimit = Math.max(1, Math.floor(maxBytes)) + 1;
      const encodedLimit = 4 * Math.ceil(rawLimit / 3) + 1024;
      // sandbox-agent v0.4.2 readFsFile materializes the full remote file before returning.
      // Limit the bytes inside the sandbox, then cap the process response as a second bound.
      const result = await sandbox.runProcess({
        command: "sh",
        args: [
          "-c",
          'test -f "$1" && head -c "$2" -- "$1" | base64 | tr -d "\n"',
          "agenta-telemetry-read",
          path,
          String(rawLimit),
        ],
        maxOutputBytes: encodedLimit,
        timeoutMs: 10_000,
      });
      if (
        result.exitCode !== 0 ||
        result.stdoutTruncated ||
        result.stderrTruncated ||
        result.timedOut
      ) {
        throw new Error("Telemetry file read exceeded its bound");
      }
      const bytes = Buffer.from(result.stdout, "base64");
      if (bytes.byteLength > rawLimit) {
        throw new Error("Telemetry file read exceeded its bound");
      }
      return bytes;
    },
    writeBytes: async (path, contents) => {
      const body =
        typeof contents === "string"
          ? contents
          : Uint8Array.from(contents).buffer;
      await sandbox.writeFsFile({ path }, body);
    },
    rename: async (from, to) => {
      // sandbox-agent v0.4.2 maps this same-directory move to rename(2).
      await sandbox.moveFs({ from, to, overwrite: true });
    },
    remove: async (path) => {
      await sandbox.deleteFsEntry({ path });
    },
  };
}

/** Write a complete sibling and expose it only through an atomic rename. */
export async function publishTelemetryFileAtomic(
  host: TelemetryFileHost,
  finalPath: string,
  contents: Uint8Array | string,
): Promise<void> {
  const tempPath = `${finalPath}.tmp.${randomBytes(8).toString("hex")}`;
  try {
    await host.writeBytes(tempPath, contents);
    await host.rename(tempPath, finalPath);
  } catch (err) {
    await host.remove(tempPath).catch(() => {});
    throw err;
  }
}
