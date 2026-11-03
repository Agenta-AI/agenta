/**
 * `grep` and `find` in the command sandbox: ripgrep over the sandbox's mount of the drive, one
 * Daytona call per tool call, with a bounded answer.
 *
 * Pi's own `grep` spawns ripgrep on the machine it runs on, so it cannot be pointed at the sandbox
 * through operations: `createSandboxGrepTool` keeps Pi's definition (name, schema, prompt text,
 * rendering) and output format, and runs the search there. `find` keeps Pi's whole tool and only
 * supplies its `glob`.
 *
 * Both skip `node_modules` and `.git`, do not apply `.gitignore` files, include hidden files, and
 * sort by path so an answer is stable. ripgrep prints at most `MAX_COLUMNS` bytes of a line, and
 * the sandbox sends back at most `ANSWER_BYTES`; ripgrep's regex engine is linear-time, so a
 * model-written pattern cannot stall the sandbox either.
 */
import { createGrepToolDefinition, DEFAULT_MAX_BYTES, formatSize, truncateHead, truncateLine, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isAbsolute, resolve } from "node:path";
import { shellQuote } from "../../sandbox_agent/mount.ts";
import type { DaytonaSandbox } from "../sandbox/daytona-api.ts";
import type { SandboxToolAccess } from "./file-tools.ts";
import { SandboxFileError } from "../sandbox/sandbox-files.ts";

const DEFAULT_LIMIT = 100;
/** Bytes of one line ripgrep prints; the rest of the line is omitted. */
const MAX_COLUMNS = 500;
const MAX_CONTEXT = 50;
/** Most bytes of ripgrep output one call brings back. */
const ANSWER_BYTES = 512 * 1024;
const SEARCH_SECONDS = 60;

const COMMON = ["--no-config", "--no-ignore", "--hidden", "--glob", "!node_modules", "--glob", "!.git", "--sort", "path"];

interface GrepParams {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

/** Run `script` in the sandbox; it prints `missing`, `notdir` or `ok`, then the base64 answer, then `rc=<n>` and base64 stderr. */
async function search(sandbox: DaytonaSandbox, script: string, signal?: AbortSignal): Promise<{ status: string; data: Buffer; rc: number; stderr: string }> {
  const r = await sandbox.run(`bash -c ${shellQuote(script)}`, { timeoutSeconds: SEARCH_SECONDS, ...(signal ? { signal } : {}) });
  const lines = r.output.split("\n");
  const status = (lines[0] ?? "").trim();
  if (status.includes('"unmounted"')) throw new SandboxFileError("unmounted", "a folder of the agent's files is not attached in the command sandbox");
  if (status !== "ok") return { status: status || "failed", data: Buffer.alloc(0), rc: -1, stderr: r.output.slice(0, 300) };
  const rc = Number((lines[2] ?? "").replace(/^rc=/, ""));
  return { status, data: Buffer.from((lines[1] ?? "").trim(), "base64"), rc, stderr: Buffer.from((lines[3] ?? "").trim(), "base64").toString("utf-8") };
}

/** Files under `searchDir` matching `pattern` (relative paths, sorted), at most `limit`. */
export async function sandboxGlob(sandbox: DaytonaSandbox, searchDir: string, pattern: string, limit: number, signal?: AbortSignal): Promise<string[]> {
  const rg = ["rg", "--files", ...COMMON, "--glob", pattern].map(shellQuote).join(" ");
  const script = [
    `p=${shellQuote(searchDir)}`,
    `[ -e "$p" ] || { echo missing; exit 0; }`,
    `cd "$p" 2>/dev/null || { echo notdir; exit 0; }`,
    `echo ok`,
    `e=$(mktemp)`,
    `${rg} 2>"$e" | head -n ${Math.max(1, limit)} | head -c ${ANSWER_BYTES} | base64 -w0; rc=\${PIPESTATUS[0]}; echo`,
    `echo "rc=$rc"; head -c 2000 "$e" | base64 -w0; echo; rm -f "$e"`,
  ].join("\n");
  const r = await search(sandbox, script, signal);
  if (r.status === "missing") throw Object.assign(new Error(`Path not found: ${searchDir}`), { code: "ENOENT" });
  if (r.status === "notdir") throw Object.assign(new Error(`Not a directory: ${searchDir}`), { code: "ENOTDIR" });
  if (r.status !== "ok") throw new Error(`find could not run in the command sandbox: ${r.stderr}`);
  if (r.rc === 2 && r.stderr.trim()) throw new Error(r.stderr.trim().replace(/^rg: /, ""));
  return r.data
    .toString("utf-8")
    .split("\n")
    .filter(Boolean)
    .slice(0, limit);
}

/** Pi's `grep`, run in the sandbox. */
export function createSandboxGrepTool(cwd: string, access: Pick<SandboxToolAccess, "read" | "inSandbox">): ToolDefinition<any, any> {
  const definition = createGrepToolDefinition(cwd);
  const tool: typeof definition = {
    ...definition,
    execute: async (_toolCallId, params: GrepParams, signal, _onUpdate, ctx) => {
      if (signal?.aborted) throw new Error("Operation aborted");
      const base = ctx?.cwd || cwd;
      const raw = params.path || ".";
      const searchPath = isAbsolute(raw) ? raw : resolve(base, raw);
      const limit = Math.max(1, params.limit ?? DEFAULT_LIMIT);
      const context = Math.min(MAX_CONTEXT, Math.max(0, Math.floor(params.context ?? 0)));
      const args = ["rg", "--line-number", "--color=never", "--no-heading", "--with-filename", "--null", "--max-columns", String(MAX_COLUMNS), "--max-columns-preview", ...COMMON];
      if (params.glob) args.push("--glob", params.glob);
      if (params.ignoreCase) args.push("--ignore-case");
      if (params.literal) args.push("--fixed-strings");
      if (context > 0) args.push("--context", String(context));
      args.push("--", params.pattern);
      const script = [
        `p=${shellQuote(access.inSandbox(searchPath))}`,
        `[ -e "$p" ] || { echo missing; exit 0; }`,
        `if [ -d "$p" ]; then cd "$p" || exit 1; set --; else cd "$(dirname "$p")" || exit 1; set -- "$(basename "$p")"; fi`,
        `echo ok`,
        `e=$(mktemp)`,
        `${args.map(shellQuote).join(" ")} "$@" 2>"$e" | head -c ${ANSWER_BYTES} | base64 -w0; rc=\${PIPESTATUS[0]}; echo`,
        `echo "rc=$rc"; head -c 2000 "$e" | base64 -w0; echo; rm -f "$e"`,
      ].join("\n");
      const r = await access.read(signal ?? undefined, (sandbox) => search(sandbox, script, signal ?? undefined));
      if (signal?.aborted) throw new Error("Operation aborted");
      if (r.status === "missing") throw new Error(`Path not found: ${raw}`);
      if (r.status !== "ok") throw new Error(`grep could not run in the command sandbox: ${r.stderr}`);
      // 0: matches, 1: none, 2: an error (a file that could not be read still leaves the others' matches), 141: cut at the answer size.
      const otherError = r.stderr.split("\n").some((l) => l.trim() && !/^rg: .*: (Permission denied|No such file|Input\/output error)/.test(l));
      if (r.rc !== 0 && r.rc !== 1 && r.rc !== 141 && (r.rc !== 2 || otherError)) {
        throw new Error(r.stderr.trim().replace(/^rg: /, "") || `ripgrep exited with code ${r.rc}`);
      }

      const lines: string[] = [];
      let bytes = 0;
      let matches = 0;
      let limitReached = false;
      let budgetReached = r.rc === 141;
      let linesTruncated = false;
      for (const line of r.data.toString("utf-8").split("\n")) {
        const nul = line.indexOf("\0");
        if (nul === -1) continue; // a group separator, or a line cut at the answer size
        const parsed = /^(\d+)([:-])(.*)$/s.exec(line.slice(nul + 1));
        if (!parsed) continue;
        const [, number, kind, text] = parsed as unknown as [string, string, string, string];
        const shown = truncateLine(text.replace(/\r$/, ""));
        if (shown.wasTruncated) linesTruncated = true;
        const printed = kind === ":" ? `${line.slice(0, nul)}:${number}: ${shown.text}` : `${line.slice(0, nul)}-${number}- ${shown.text}`;
        lines.push(printed);
        bytes += Buffer.byteLength(printed) + 1;
        if (kind === ":") matches += 1;
        if (matches >= limit) {
          limitReached = true;
          break;
        }
        if (bytes > DEFAULT_MAX_BYTES) {
          budgetReached = true;
          break;
        }
      }
      if (matches === 0) return { content: [{ type: "text", text: "No matches found" }], details: undefined };

      const truncation = truncateHead(lines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
      let output = truncation.content;
      const details: Record<string, unknown> = {};
      const notices: string[] = [];
      if (limitReached) {
        notices.push(`${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`);
        details.matchLimitReached = limit;
      }
      if (truncation.truncated || budgetReached) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
        details.truncation = truncation;
      }
      if (linesTruncated) {
        notices.push(`Some lines truncated to ${MAX_COLUMNS} chars. Use read tool to see full lines`);
        details.linesTruncated = true;
      }
      if (notices.length) output += `\n\n[${notices.join(". ")}]`;
      return { content: [{ type: "text", text: output }], details: Object.keys(details).length ? details : undefined };
    },
  };
  return tool;
}
