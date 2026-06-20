/**
 * WP-8 tool MCP bridge (stdio server).
 *
 * The harness only accepts tools over MCP when driven via ACP. This is a minimal,
 * dependency-free MCP stdio server that exposes the backend-resolved runnable tools
 * (WP-7) and relays each tool call back to the runner — so private specs/auth stay in
 * runner memory, exactly as in the in-process Pi path.
 *
 * Launched by the rivet daemon as a session MCP server (see mcp-bridge.ts). Its env
 * contains only public tool metadata and the relay dir:
 *   AGENTA_TOOL_PUBLIC_SPECS     JSON array of { name, description, inputSchema }
 *   AGENTA_TOOL_RELAY_DIR        directory watched by the runner for tool requests
 *
 * Protocol: JSON-RPC 2.0 over stdio, newline-delimited (the MCP stdio framing). Handles
 * initialize, tools/list, tools/call; ignores notifications. stdout carries protocol
 * messages only; logs go to stderr.
 */
import { randomUUID } from "node:crypto";

import type { ResolvedToolSpec } from "../protocol.ts";
import { EMPTY_OBJECT_SCHEMA } from "./callback.ts";
import { runResolvedTool } from "./dispatch.ts";

const SPECS: ResolvedToolSpec[] = JSON.parse(process.env.AGENTA_TOOL_PUBLIC_SPECS ?? "[]");
const RELAY_DIR = process.env.AGENTA_TOOL_RELAY_DIR;
const SPEC_BY_NAME = new Map(SPECS.map((s) => [s.name, s]));
const DEFAULT_PROTOCOL = "2025-06-18";

function log(message: string): void {
  process.stderr.write(`[tool-bridge] ${message}\n`);
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message: any): Promise<unknown | undefined> {
  const { id, method, params } = message ?? {};

  // Notifications (no id) need no response.
  if (id === undefined || id === null) {
    return undefined;
  }

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
        // `client` tools are browser-fulfilled, so this server does not advertise them.
        tools: SPECS.filter((s) => s.kind !== "client").map((s) => ({
          name: s.name,
          description: s.description ?? s.name,
          inputSchema: (s.inputSchema as Record<string, unknown>) ?? EMPTY_OBJECT_SCHEMA,
        })),
      },
    };
  }

  if (method === "tools/call") {
    const name = params?.name;
    const spec = SPEC_BY_NAME.get(name);
    if (!spec) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${name}` } };
    }
    try {
      if (!RELAY_DIR) throw new Error("missing AGENTA_TOOL_RELAY_DIR");
      // The bridge only has public metadata. A unique id per call keeps parallel calls from
      // colliding while the runner maps the tool name back to its private resolved spec.
      const text = await runResolvedTool(spec, params?.arguments, {
        toolCallId: randomUUID(),
        relayDir: RELAY_DIR,
      });
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (err) {
      // Surface as an MCP tool error (isError) so the model can recover, not a crash.
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        },
      };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
}

function main(): void {
  log(`serving ${SPECS.length} tool(s) -> relay ${RELAY_DIR || "(missing)"}`);
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        log(`skipping non-JSON line: ${line.slice(0, 120)}`);
        continue;
      }
      Promise.resolve(handle(parsed))
        .then((response) => {
          if (response) send(response);
        })
        .catch((err) => log(`handler error: ${err?.message ?? err}`));
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

main();
