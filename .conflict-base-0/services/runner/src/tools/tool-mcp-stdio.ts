/**
 * In-sandbox stdio MCP shim — the INTERNAL gateway-tool delivery channel for an MCP-client
 * harness (Claude) running in a remote Daytona sandbox.
 *
 * Background. A non-Pi harness takes tools over MCP. On LOCAL the runner advertises them over
 * a loopback HTTP MCP server (`tools/tool-mcp-http.ts`), which the harness — running on the
 * runner host — dials. On DAYTONA the harness runs IN the remote sandbox, where that loopback
 * (`127.0.0.1`) is the sandbox's, not the runner's, so the loopback channel is skipped. This
 * shim is the in-sandbox advertiser that fills the gap: the runner uploads it (bundled by
 * esbuild to `dist/tools/tool-mcp-stdio.js`) plus a public-specs JSON file, and advertises an
 * ACP stdio MCP entry `{name: "agenta-tools", command: "node", args: [bundle], env}` — NO
 * `type` field, so the Claude ACP adapter maps it to a Claude SDK `{type: "stdio", ...}` MCP
 * server and launches it inside the sandbox over NEWLINE-DELIMITED JSON-RPC (one JSON object
 * per line on stdin/stdout). stdout is reserved for JSON-RPC; all logging goes to stderr.
 *
 * On `tools/call` the shim writes a relay request file through the shared relay client
 * (`relay-client.ts`) — the same writer the Pi extension uses — and the runner-side relay loop
 * (`tools/relay.ts` `startToolRelay`) executes the private spec server-side, behind the
 * runner's permission guard, with credentials that never enter the sandbox.
 *
 * Env contract (see `engines/sandbox_agent/mcp.ts` `buildInternalToolMcpEntry`):
 *   AGENTA_AGENT_TOOLS_RELAY_DIR          the in-sandbox relay dir to write request files into
 *                                         (reused name — same variable the Pi extension reads)
 *   AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE  PATH to a JSON file holding the AdvertisedToolSpec
 *                                         array. A file, not an env value: the env is copied
 *                                         through four exec layers (runner session config,
 *                                         daemon/ACP protocol state, adapter spawn env, child
 *                                         process env) and tool JSON Schemas are unbounded.
 * Missing/unreadable/bad env or file => log to stderr + exit 1 (fail loud; the MCP client
 * surfaces a server-start failure rather than a silently inert tool advertiser).
 *
 * Security: this child runs INSIDE the sandbox, under the sandbox's own confinement — not on
 * the runner host (the #4831 user-stdio hole is a runner-host concern and stays closed; this
 * entry is synthesized by the runner, never user-declared). It reads ONLY public tool metadata
 * plus the relay dir, opens no socket, and holds no credential.
 *
 * Bundle safety: this module is bundled standalone and uploaded into the sandbox, so it may
 * import ONLY node builtins, `relay-client.ts`, `relay-protocol.ts`, the dependency-free
 * `tool-mcp-env.ts` (the env-name contract shared with the server-side entry builder), and
 * types — never server-side runner modules (the build script's forbidden-symbols gate
 * enforces this).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { AdvertisedToolSpec } from "./public-spec.ts";
// The file-relay CLIENT only (never dispatch.ts): the bundle carries file-relay code alone —
// no direct callback (`/tools/call` POST) or code executor belongs in a sandbox child.
import { relayToolCall, RELAY_PAUSED } from "./relay-client.ts";
// The two required env names — the whole input contract of the shim. They live in the
// dependency-free `tool-mcp-env.ts` so server code (`engines/sandbox_agent/mcp.ts`) shares
// them without importing this bundle entrypoint; re-exported here for the shim's consumers.
import { PUBLIC_SPECS_FILE_ENV, RELAY_DIR_ENV } from "./tool-mcp-env.ts";

export { PUBLIC_SPECS_FILE_ENV, RELAY_DIR_ENV };

const DEFAULT_PROTOCOL = "2025-06-18";

function log(message: string): void {
  // stderr only: stdout is the JSON-RPC channel.
  process.stderr.write(`[agenta-tool-mcp] ${message}\n`);
}

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

/**
 * A spec's input schema: camelCase `inputSchema` first, then snake_case `input_schema` (the
 * un-normalized platform-catalog shape), then the empty-object schema. Mirrors the shared
 * accessor logic in `spec-schema.ts` / `tool-mcp-http.ts` — reading `inputSchema` alone
 * advertised an EMPTY schema for every snake-case platform-catalog tool (a live bug). Local
 * copy rather than an import so the bundle's import surface stays exactly relay-client +
 * relay-protocol + types.
 */
function specInputSchema(spec: AdvertisedToolSpec): Record<string, unknown> {
  const snake = (
    spec as AdvertisedToolSpec & {
      input_schema?: Record<string, unknown> | null;
    }
  ).input_schema;
  return spec.inputSchema ?? snake ?? EMPTY_OBJECT_SCHEMA;
}

/** The shim's validated startup inputs. */
export interface ShimConfig {
  relayDir: string;
  specs: AdvertisedToolSpec[];
}

/**
 * Validate the env contract and load the specs file. Returns `{ok: false}` with a message on
 * ANY defect (missing env, unreadable file, bad JSON, non-array) — the caller exits 1 so the
 * MCP client reports a server-start failure instead of a silently inert tool advertiser.
 * Split from `main()` so tests can drive the validation without a real process exit.
 */
export function loadShimConfig(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf-8"),
): { ok: true; config: ShimConfig } | { ok: false; error: string } {
  const relayDir = env[RELAY_DIR_ENV];
  if (!relayDir) {
    return {
      ok: false,
      error: `${RELAY_DIR_ENV} is unset; cannot relay tool calls`,
    };
  }
  const specsFile = env[PUBLIC_SPECS_FILE_ENV];
  if (!specsFile) {
    return {
      ok: false,
      error: `${PUBLIC_SPECS_FILE_ENV} is unset; cannot advertise tools`,
    };
  }
  let raw: string;
  try {
    raw = readFile(specsFile);
  } catch (err) {
    return {
      ok: false,
      error: `cannot read specs file ${specsFile}: ${(err as Error).message}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `bad JSON in specs file ${specsFile}: ${(err as Error).message}`,
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: `specs file ${specsFile} must hold a JSON array of tool specs`,
    };
  }
  return {
    ok: true,
    config: { relayDir, specs: parsed as AdvertisedToolSpec[] },
  };
}

/**
 * Delivery is at least once: after pickup, the runner still executes if this writer dies, and
 * a writer retry publishes a new request because the relay does not deduplicate retries.
 *
 * Handle one MCP JSON-RPC message. Returns the response object, or `undefined` for a
 * notification (no `id`). Mirrors `tools/tool-mcp-http.ts` `handle` (initialize / tools-list /
 * tools-call shapes), but `tools/call` writes a relay request file (`relayToolCall`) rather
 * than dispatching in-process — the runner executes.
 */
export async function handleToolMcpMessage(
  message: any,
  specs: AdvertisedToolSpec[],
  relayDir: string,
): Promise<unknown | undefined> {
  const { id, method, params } = message ?? {};

  if (typeof method !== "string") {
    return {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code: -32600, message: "invalid request" },
    };
  }

  // Notifications (no id, e.g. notifications/initialized) need no response.
  if (id === undefined || id === null) return undefined;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "agenta-tools", version: "0.1.0" },
      },
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        // Only public metadata crosses to the harness — the specs file never carries a
        // callRef, code, scoped env, or callback auth (those stay in runner memory), and the
        // advertisement exposes only the three public fields even from what it does carry.
        tools: specs.map((s) => ({
          name: s.name,
          description: s.description ?? s.name,
          inputSchema: specInputSchema(s),
        })),
      },
    };
  }

  if (method === "tools/call") {
    const name = params?.name;
    const spec = specs.find((s) => s.name === name);
    if (!spec) {
      // Never write a relay file for a tool this run does not carry.
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `unknown tool: ${name}` },
      };
    }
    try {
      // Publish the relay request and wait for the runner's response; the runner-side loop
      // executes the private spec server-side behind its permission guard. A fresh uuid per
      // call keeps parallel calls from colliding on the relay filename, and the per-tool
      // timeout budget rides the public spec.
      const text = await relayToolCall(
        relayDir,
        name,
        randomUUID(),
        params?.arguments,
        spec.timeoutMs,
      );
      if (text === RELAY_PAUSED) {
        // A client tool parked; the runner has already ended the turn. Return a benign, NON-error
        // result so the harness's turn ends cleanly instead of waiting out the per-tool timeout and
        // emitting a late error frame. The text tells the model not to retry while the pause
        // settles. The reserved warm-hold outcome would hold this call open instead (see #5384).
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text:
                  `The user has been asked to complete "${name}" in their browser. ` +
                  `This is being handled outside this tool call. Do not call "${name}" again ` +
                  `or retry — the result will be delivered automatically once the user responds.`,
              },
            ],
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text }] },
      };
    } catch (err) {
      // Surface as an MCP tool error (isError) so the model can recover, not a crash.
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        },
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `method not found: ${method}` },
  };
}

/**
 * Run the stdio JSON-RPC loop: one JSON object per line in, one per line out. Messages are
 * handled CONCURRENTLY — a `tools/call` blocks on the relay round-trip, and the client may
 * pipeline `tools/list` plus several calls — and each response is written as one atomic
 * `write()` of a single line, so interleaved responses stay valid JSON-RPC. Exposed so tests
 * can drive it with fake streams; `main()` wires the real stdin/stdout.
 */
export async function runToolMcpStdio(
  specs: AdvertisedToolSpec[],
  relayDir: string,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  log(`serving ${specs.length} tool(s) -> relay ${relayDir}`);
  const rl = createInterface({ input, crlfDelay: Infinity });
  // Entries remove themselves on settle, so a long session's completed calls never
  // accumulate; the shutdown path below awaits only what is still pending.
  const inflight = new Set<Promise<void>>();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message: any;
    try {
      message = JSON.parse(trimmed);
    } catch (err) {
      log(`parse error: ${(err as Error).message}`);
      output.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse error" },
        })}\n`,
      );
      continue;
    }
    const pending = handleToolMcpMessage(message, specs, relayDir).then(
      (response) => {
        if (response !== undefined) {
          output.write(`${JSON.stringify(response)}\n`);
        }
      },
    );
    inflight.add(pending);
    void pending.then(
      () => inflight.delete(pending),
      () => inflight.delete(pending),
    );
  }
  await Promise.allSettled(inflight);
}

async function main(): Promise<void> {
  const loaded = loadShimConfig(process.env);
  if (!loaded.ok) {
    // Fail loud (nonzero exit) so the MCP client surfaces a server-start failure.
    log(loaded.error);
    process.exitCode = 1;
    return;
  }
  await runToolMcpStdio(loaded.config.specs, loaded.config.relayDir);
}

// Run when executed directly (the harness launches `node tool-mcp-stdio.js`); stay inert on
// import (so the unit tests can import the handler without starting the stdin loop).
function isDirectRun(): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return import.meta.url.endsWith(entry);
  }
}
if (isDirectRun()) {
  void main();
}
