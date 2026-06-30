/**
 * In-sandbox stdio MCP relay shim — the INTERNAL gateway-tool delivery channel for a non-Pi
 * harness on Daytona (F-042).
 *
 * Background. A non-Pi harness (Claude) takes tools over MCP. On LOCAL the runner advertises
 * them over a loopback HTTP MCP server (`tools/tool-mcp-http.ts`), which Claude — running on the
 * runner host — dials. On DAYTONA the harness runs IN the remote sandbox, where that loopback
 * (`127.0.0.1`) is the sandbox's, not the runner's, so the loopback channel is skipped
 * (`engines/sandbox_agent/mcp.ts`). That left a non-Pi harness on Daytona with no in-sandbox tool
 * advertiser at all (Pi has its bundled extension; Claude had nothing), so the model never saw
 * the tool — the F-042 gap.
 *
 * This shim is the Daytona equivalent of the Pi extension's `registerTools`, but packaged as a
 * standalone stdio MCP server the in-sandbox harness launches. It is advertised to the harness as
 * an ACP `McpServerStdio` entry (`{name, command, args, env}`, NO `type` field) in
 * `sessionInit.mcpServers`; the sandbox-agent SDK forwards that verbatim into the in-sandbox
 * `newSession`, and the Claude ACP adapter (`@zed-industries/claude-agent-acp`) maps a type-less
 * entry to a Claude SDK `{type:"stdio", command, args, env}` MCP server. The Claude Agent SDK
 * launches it over the standard MCP stdio transport, which is NEWLINE-DELIMITED JSON-RPC: one
 * JSON object per line on stdin, one JSON object per line on stdout. stdout is reserved for
 * JSON-RPC; all logging goes to stderr.
 *
 * Security (does NOT reopen the #4831 runner-host-stdio hole): this child runs INSIDE the Daytona
 * sandbox, under the sandbox's own confinement — not on the runner host. It reads ONLY public
 * tool metadata + the relay dir from its env:
 *   AGENTA_TOOL_PUBLIC_SPECS   JSON [{ name, description, inputSchema }] (no callRef/code/auth)
 *   AGENTA_TOOL_RELAY_DIR      the in-sandbox relay dir to write request files into
 * It launches no network and holds no credential. On `tools/call` it writes a relay request file
 * the runner-side relay loop (`tools/relay.ts` `startToolRelay`) already polls and executes; the
 * private spec + callback auth are applied server-side in runner memory. Same guarantee as the
 * loopback HTTP server and the Pi extension; the user-declared stdio MCP gate (`run-plan.ts` /
 * `toAcpMcpServers`) is a SEPARATE layer and stays disabled — this internal channel is
 * synthesized by the runner from `customTools`, never user-declared.
 *
 * Bundled self-contained (esbuild -> `dist/tools/relay-mcp-stdio.js`, like the Pi extension) so it
 * runs wherever it is uploaded. It imports ONLY from sibling `tools/*` modules that bundle cleanly
 * (no harness SDK).
 */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

import type { PublicToolSpec } from "./public-spec.ts";
// Import the file-relay CLIENT directly (NOT dispatch.ts) so the bundle carries only file-relay
// code — no direct callback (`/tools/call` POST) or code executor reaches a sandbox child.
import { relayToolCall } from "./relay-client.ts";

const DEFAULT_PROTOCOL = "2025-06-18";

function log(message: string): void {
  // stderr only: stdout is the JSON-RPC channel.
  process.stderr.write(`[agenta-relay-mcp] ${message}\n`);
}

/** Parse the public specs from env; [] on absent/malformed (the shim then advertises nothing). */
function parsePublicSpecs(raw: string | undefined): PublicToolSpec[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PublicToolSpec[]) : [];
  } catch (err) {
    log(`bad AGENTA_TOOL_PUBLIC_SPECS: ${(err as Error).message}`);
    return [];
  }
}

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

/**
 * Handle one MCP JSON-RPC message. Returns the response object, or `undefined` for a
 * notification (no `id`). Mirrors `tools/tool-mcp-http.ts` `handle`, but `tools/call` writes a
 * relay request file (`relayToolCall`) rather than dispatching in-process — the runner executes.
 */
export async function handleRelayMcpMessage(
  message: any,
  specs: PublicToolSpec[],
  relayDir: string,
): Promise<unknown | undefined> {
  const { id, method, params } = message ?? {};

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

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        // Only public metadata crosses to the harness — never callRef, code, scoped env, or
        // callback auth (those never reach this process; it only has the public specs).
        tools: specs.map((s) => ({
          name: s.name,
          description: s.description ?? s.name,
          inputSchema:
            (s.inputSchema as Record<string, unknown>) ?? EMPTY_OBJECT_SCHEMA,
        })),
      },
    };
  }

  if (method === "tools/call") {
    const name = params?.name;
    if (!specs.some((s) => s.name === name)) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `unknown tool: ${name}` },
      };
    }
    try {
      // Write the relay request + poll the response; the runner-side loop executes the private
      // spec server-side. A fresh uuid per call keeps parallel calls from colliding on the
      // relay filename.
      const text = await relayToolCall(
        relayDir,
        name,
        randomUUID(),
        params?.arguments,
      );
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
 * Run the stdio JSON-RPC loop: one JSON object per line in, one per line out. Exposed so a test
 * can drive it with fake streams; `main()` wires the real stdin/stdout.
 */
export async function runRelayMcpStdio(
  specs: PublicToolSpec[],
  relayDir: string,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  log(`serving ${specs.length} tool(s) -> relay ${relayDir}`);
  const rl = createInterface({ input, crlfDelay: Infinity });
  const inflight: Promise<void>[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message: any;
    try {
      message = JSON.parse(trimmed);
    } catch (err) {
      log(`parse error: ${(err as Error).message}`);
      continue;
    }
    // Handle each message concurrently: a `tools/call` blocks on the relay round-trip, and we
    // must keep reading stdin (the client may pipeline `tools/list` + several calls). Each write
    // is a single atomic line, so interleaved responses stay valid JSON-RPC.
    inflight.push(
      handleRelayMcpMessage(message, specs, relayDir).then((response) => {
        if (response !== undefined)
          output.write(`${JSON.stringify(response)}\n`);
      }),
    );
  }
  await Promise.allSettled(inflight);
}

async function main(): Promise<void> {
  const relayDir = process.env.AGENTA_TOOL_RELAY_DIR ?? "";
  if (!relayDir) {
    // The harness launched the shim without its required env: fail loud (nonzero exit) so the
    // MCP client surfaces a server start failure rather than a silently inert tool advertiser.
    log("AGENTA_TOOL_RELAY_DIR is unset; cannot relay tool calls");
    process.exitCode = 1;
    return;
  }
  const specs = parsePublicSpecs(process.env.AGENTA_TOOL_PUBLIC_SPECS);
  await runRelayMcpStdio(specs, relayDir);
}

// Run when executed directly (the harness launches `node relay-mcp-stdio.js`); stay inert on
// import (so the unit test can import the handler without starting the stdin loop).
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
