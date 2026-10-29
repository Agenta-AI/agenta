/**
 * Pi's file tools for an in-process session, all run in the conversation's command sandbox on its
 * mount of the drive. The runner never opens a path the model chose.
 *
 * Pi's own definitions (name, schema, prompt text, rendering, output format) are kept; each tool
 * call gets operations that answer from one Daytona call where Pi would make several (`read`
 * checks, sniffs and reads the file; `ls` checks, stats and lists; `find` checks, then globs), so
 * a read-only tool call costs one call once the sandbox runs. `grep` runs ripgrep in the sandbox
 * (`sandbox-search.ts`).
 *
 * Reads run as soon as the sandbox is up. `write` and `edit` run in order with the conversation's
 * commands (`SandboxToolAccess.change`), so an edit's read and its write see nothing else in
 * between. The sandbox starts on the first tool call that needs it.
 */
import { mkdtemp, rm, writeFile as writeLocalFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  type EditOperations,
  type FindOperations,
  type LsOperations,
  type ReadOperations,
  type ToolDefinition,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import type { DaytonaSandbox } from "../sandbox/daytona-api.ts";
import { list, readFile, writeFile, type Listing } from "../sandbox/sandbox-files.ts";
import type { EditDiffs } from "./edit-diffs.ts";
import { createSandboxGrepTool, sandboxGlob } from "./sandbox-search.ts";

/** How the tools reach the sandbox. */
export interface SandboxToolAccess {
  /** Run `step` on the running sandbox (started and mounted if needed). */
  read<T>(signal: AbortSignal | undefined, step: (sandbox: DaytonaSandbox) => Promise<T>): Promise<T>;
  /** Run `step` on the sandbox in order with the conversation's other changes. */
  change<T>(signal: AbortSignal | undefined, step: (sandbox: DaytonaSandbox) => Promise<T>): Promise<T>;
  /** A path as the sandbox sees it (the same path in production; under a folder in tests). */
  inSandbox(path: string): string;
  /** The sandbox's temporary folder. */
  tmpDir: string;
  maxFileBytes: number;
}

const FIND_DEFAULT_LIMIT = 1000;
/** Bytes Pi's image sniffing looks at. */
const SNIFF_BYTES = 4100;

let sniffDir: Promise<string> | undefined;

/** Pi's image detection on bytes already read (it takes a path): through a runner-chosen temporary file. */
async function imageMimeType(content: Buffer): Promise<string | null | undefined> {
  sniffDir ??= mkdtemp(join(tmpdir(), "agenta-sniff-"));
  const file = join(await sniffDir, `${process.pid}-${Math.random().toString(36).slice(2)}`);
  await writeLocalFile(file, content.subarray(0, SNIFF_BYTES));
  try {
    return await detectSupportedImageMimeTypeFromFile(file);
  } finally {
    await rm(file, { force: true });
  }
}

/** One read per call: `access`, the image sniff and `readFile` all answer from the same bytes. */
function readOperations(access: SandboxToolAccess, signal: AbortSignal | undefined): ReadOperations {
  let loaded: { path: string; content: Buffer } | undefined;
  const load = async (path: string) => {
    if (loaded?.path !== path) loaded = { path, content: await access.read(signal, (sb) => readFile(sb, access.inSandbox(path), access.maxFileBytes, signal)) };
    return loaded.content;
  };
  return {
    access: async (path) => {
      await load(path);
    },
    detectImageMimeType: async (path) => imageMimeType(await load(path)),
    readFile: load,
  };
}

/** One listing per call: `exists`, the stats and `readdir` all answer from it. */
function lsOperations(access: SandboxToolAccess, signal: AbortSignal | undefined): LsOperations {
  const listings = new Map<string, Listing>();
  const get = async (path: string) => {
    let l = listings.get(path);
    if (!l) {
      l = await access.read(signal, (sb) => list(sb, access.inSandbox(path), signal));
      listings.set(path, l);
    }
    return l;
  };
  const kind = async (path: string): Promise<"dir" | "file" | "missing"> => {
    const parent = listings.get(dirname(path));
    if (parent?.type === "dir") {
      const entry = parent.entries.find((e) => e.name === basename(path));
      if (entry) return entry.dir ? "dir" : "file";
    }
    return (await get(path)).type;
  };
  return {
    exists: async (path) => (await kind(path)) !== "missing",
    stat: async (path) => {
      const k = await kind(path);
      if (k === "missing") throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
      return { isDirectory: () => k === "dir" };
    },
    readdir: async (path) => {
      const l = await get(path);
      if (l.type !== "dir") throw Object.assign(new Error("ENOTDIR: not a directory"), { code: "ENOTDIR" });
      return l.entries.map((e) => e.name);
    },
  };
}

/** One search per call: `exists` runs the glob it is about to be asked for. */
function findOperations(access: SandboxToolAccess, signal: AbortSignal | undefined, params: { pattern: string; limit?: number }): FindOperations {
  const limit = params.limit ?? FIND_DEFAULT_LIMIT;
  let found: { dir: string; files: string[] | "missing" } | undefined;
  const search = async (dir: string) => {
    if (found?.dir !== dir) {
      const files = await access
        .read(signal, (sb) => sandboxGlob(sb, access.inSandbox(dir), params.pattern, limit, signal))
        .catch((err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT") return "missing" as const;
          throw err;
        });
      found = { dir, files };
    }
    return found.files;
  };
  return {
    exists: async (path) => (await search(path)) !== "missing",
    glob: async (_pattern, searchDir) => {
      const files = await search(searchDir);
      return files === "missing" ? [] : files;
    },
  };
}

/**
 * Write operations for one call. The write is never cancelled once sent: it lands whole or not at
 * all, and the change step holds the conversation's order until it has settled.
 */
function writeOperations(access: SandboxToolAccess, sandbox: DaytonaSandbox): WriteOperations {
  return {
    // The write creates the folders it needs.
    mkdir: async () => {},
    writeFile: async (path, content) => {
      await writeFile(sandbox, access.inSandbox(path), Buffer.from(content, "utf-8"), { tmpDir: access.tmpDir });
    },
  };
}

/**
 * Edit operations for one tool call: one read answers `access` and `readFile`; the text before and
 * after is recorded for the diff. A Stop ends the read; the write, once sent, lands whole.
 */
function editOperations(access: SandboxToolAccess, sandbox: DaytonaSandbox, diffs: EditDiffs, toolCallId: string, shownPath: string, signal: AbortSignal | undefined): EditOperations {
  let loaded: { path: string; content: Buffer } | undefined;
  const load = async (path: string) => {
    if (loaded?.path !== path) loaded = { path, content: await readFile(sandbox, access.inSandbox(path), access.maxFileBytes, signal) };
    return loaded.content;
  };
  return {
    access: async (path) => {
      await load(path);
    },
    readFile: load,
    writeFile: async (path, content) => {
      await writeFile(sandbox, access.inSandbox(path), Buffer.from(content, "utf-8"), { tmpDir: access.tmpDir });
      if (loaded) diffs.record(toolCallId, { path: shownPath, oldText: loaded.content.toString("utf-8"), newText: content });
    },
  };
}

/** Pi's definition `definition`, with operations made for each call by `make`. */
function perCall<T extends ToolDefinition<any, any>>(definition: T, make: (params: any, signal: AbortSignal | undefined) => T): T {
  return {
    ...definition,
    execute: (toolCallId, params, signal, onUpdate, ctx) => make(params, signal ?? undefined).execute(toolCallId, params, signal, onUpdate, ctx),
  };
}

/** Pi's definition `definition`, each call run as one change step with operations made by `make`. */
function inOrder<T extends ToolDefinition<any, any>>(
  definition: T,
  access: SandboxToolAccess,
  make: (sandbox: DaytonaSandbox, toolCallId: string, params: any, signal: AbortSignal | undefined) => T,
): T {
  return {
    ...definition,
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      access.change(signal ?? undefined, (sandbox) => make(sandbox, toolCallId, params, signal ?? undefined).execute(toolCallId, params, signal, onUpdate, ctx)),
  };
}

/** Pi's own element type for a heterogeneous tool list. */
export function buildFileTools(cwd: string, access: SandboxToolAccess, diffs: EditDiffs): ToolDefinition<any, any>[] {
  return [
    perCall(createReadToolDefinition(cwd), (_params, signal) => createReadToolDefinition(cwd, { operations: readOperations(access, signal) })),
    inOrder(createWriteToolDefinition(cwd), access, (sandbox) => createWriteToolDefinition(cwd, { operations: writeOperations(access, sandbox) })),
    inOrder(createEditToolDefinition(cwd), access, (sandbox, toolCallId, params, signal) =>
      createEditToolDefinition(cwd, { operations: editOperations(access, sandbox, diffs, toolCallId, params.path, signal) }),
    ),
    perCall(createLsToolDefinition(cwd), (_params, signal) => createLsToolDefinition(cwd, { operations: lsOperations(access, signal) })),
    createSandboxGrepTool(cwd, access),
    perCall(createFindToolDefinition(cwd), (params, signal) => createFindToolDefinition(cwd, { operations: findOperations(access, signal, params) })),
  ];
}
