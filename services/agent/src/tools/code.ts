/**
 * Code-tool executor: run a resolved `code` tool's snippet in the agent sandbox.
 *
 * A code tool ships a snippet (`code`) + a runtime (`python` | `node`) + a scoped `env` (the
 * tool's declared vault secrets, resolved server-side). Unlike a `callback` tool, it never
 * touches Agenta's /tools/call — it runs locally where the harness runs, which is exactly why
 * its secrets are injected here as subprocess env (and nowhere else).
 *
 * Entry convention (same for both runtimes): the snippet defines a top-level `main`. A bare
 * `def main(**inputs)` / `function main(inputs)` is found automatically; an explicit export
 * (`module.exports.main` / `exports.main` / `module.exports = fn` in Node) is also accepted.
 * Python calls `main(**inputs)` (keyword args from the tool input object); Node calls
 * `main(inputs)` (the input object) and may return a promise. The return value is
 * JSON-serialized and handed to the model as the tool result.
 *
 * Shared by every delivery path that runs code locally: engines/pi.ts (in-process Pi),
 * extensions/agenta.ts (Pi under sandbox-agent), tools/mcp-server.ts (the MCP bridge for other
 * harnesses).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Per-call budget for a code tool. Surfaced as a tool error on timeout. */
export const CODE_TOOL_TIMEOUT_MS = Number(
  process.env.AGENTA_AGENT_CODE_TOOL_TIMEOUT_MS ?? 30000,
);

// argv[1] is the snippet path (python `-c`/node `-e` put the first extra arg at argv[1]);
// the tool input arrives as JSON on stdin. Both bootstraps evaluate the snippet in a fresh
// scope and pick up a top-level `main` (a bare `def main`/`function main`), falling back to an
// explicit export. Either way the contract is: define a callable `main`.
const PY_BOOTSTRAP = `import sys, json
_path = sys.argv[1]
with open(_path) as _f:
    _src = _f.read()
_ns = {}
exec(compile(_src, _path, "exec"), _ns)
if not callable(_ns.get("main")):
    sys.stderr.write("code tool must define a callable main(**inputs)")
    sys.exit(1)
_args = json.loads(sys.stdin.read() or "{}")
_out = _ns["main"](**_args)
sys.stdout.write(json.dumps(_out))
`;

// `require(path)` would only see CommonJS exports, so a bare top-level `function main` (which
// exports nothing under CommonJS) would be invisible. Instead read the source and evaluate it
// in a scope that captures a top-level `main`, while still honoring an explicit
// `module.exports.main` / `exports.main` / `module.exports = fn`.
const NODE_BOOTSTRAP = `const fs = require("fs");
const path = process.argv[1];
const src = fs.readFileSync(path, "utf8");
const mod = { exports: {} };
const factory = new Function(
  "exports",
  "require",
  "module",
  "__filename",
  "__dirname",
  src +
    "\\n;return (typeof main !== 'undefined' ? main : (module.exports && (module.exports.main || module.exports.default)) || module.exports);",
);
const fn = factory(mod.exports, require, mod, path, require("path").dirname(path));
if (typeof fn !== "function") {
  process.stderr.write("code tool must define or export a callable main(inputs) function");
  process.exit(1);
}
const args = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
Promise.resolve(fn(args))
  .then((out) => process.stdout.write(JSON.stringify(out === undefined ? null : out)))
  .catch((err) => { process.stderr.write(String((err && err.stack) || err)); process.exit(1); });
`;

export type CodeRuntime = "python" | "node";

// The minimal set of host env vars a python3/node runtime needs to start. Deliberately
// excludes everything secret-bearing or sidecar-specific: no AGENTA_*, no *_API_KEY /
// *_TOKEN, no COMPOSIO_* / DAYTONA_*, no provider keys that the in-process Pi path writes
// into process.env before a run. Only the tool's declared scoped `env` is layered on top.
const BASE_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_PATH",
  // Windows essentials, copied only when present.
  "SystemRoot",
  "ComSpec",
];

/** Build the child env from a minimal allowlist (copied only when set) plus scoped secrets. */
function buildChildEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of BASE_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) base[key] = value;
  }
  return { ...base, ...(env ?? {}) };
}

/**
 * Run a code tool's snippet and return its JSON-serialized output as text. Throws on a
 * non-zero exit, a timeout, or an abort; callers turn the throw into a tool-error result so
 * the model loop continues.
 */
export async function runCodeTool(
  runtime: CodeRuntime | undefined,
  code: string,
  env: Record<string, string> | undefined,
  args: unknown,
  signal?: AbortSignal,
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-code-"));
  try {
    const isNode = runtime === "node";
    const scriptPath = join(dir, isNode ? "tool.js" : "tool.py");
    writeFileSync(scriptPath, code ?? "", "utf8");

    const command = isNode ? "node" : "python3";
    const childArgs = isNode
      ? ["-e", NODE_BOOTSTRAP, scriptPath]
      : ["-c", PY_BOOTSTRAP, scriptPath];

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, childArgs, {
        // The child inherits ONLY a minimal startup allowlist (PATH, HOME, locale/temp, and
        // Windows essentials when present) plus the tool's declared scoped secrets. It does
        // NOT inherit the sidecar's process.env, so provider keys (OPENAI_API_KEY, etc.) that
        // the in-process Pi path writes into process.env, AGENTA_* config, and other secret-
        // bearing vars never reach an author-supplied snippet. Nothing is written to the
        // agent-visible filesystem beyond the temp dir.
        env: buildChildEnv(env),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() =>
          reject(new Error(`code tool timed out after ${CODE_TOOL_TIMEOUT_MS}ms`)),
        );
      }, CODE_TOOL_TIMEOUT_MS);

      const onAbort = () => {
        child.kill("SIGKILL");
        finish(() => reject(new Error("aborted")));
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => finish(() => reject(err)));
      child.on("close", (exitCode) =>
        finish(() => {
          if (exitCode === 0) resolve(stdout.trim());
          else
            reject(
              new Error(
                `code tool exited ${exitCode}: ${stderr.slice(0, 500) || "(no stderr)"}`,
              ),
            );
        }),
      );

      child.stdin.write(JSON.stringify(args ?? {}));
      child.stdin.end();
    });
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of the throwaway snippet dir
    }
  }
}
