/**
 * WP-8 tool MCP bridge (stdio server).
 *
 * The harness only accepts tools over MCP when driven via ACP. This is a minimal,
 * dependency-free MCP stdio server that exposes the backend-resolved runnable tools
 * (WP-7) and routes each tool call back through Agenta's /tools/call — so the Composio
 * key and connection auth stay server-side, exactly as in the in-process Pi path.
 *
 * Launched by the rivet daemon as a session MCP server (see mcp-bridge.ts). It reads
 * everything from env so nothing tool-specific is written to the agent filesystem:
 *   AGENTA_TOOL_SPECS            JSON array of { name, description, inputSchema, callRef }
 *   AGENTA_TOOL_CALLBACK_ENDPOINT  full /tools/call URL
 *   AGENTA_TOOL_CALLBACK_AUTH      Authorization header value (optional)
 *
 * Protocol: JSON-RPC 2.0 over stdio, newline-delimited (the MCP stdio framing). Handles
 * initialize, tools/list, tools/call; ignores notifications. stdout carries protocol
 * messages only; logs go to stderr.
 */
import { randomUUID } from "node:crypto";

import type { ResolvedToolSpec } from "../protocol.ts";
import { EMPTY_OBJECT_SCHEMA } from "./callback.ts";
import { runResolvedTool } from "./dispatch.ts";

const SPECS: ResolvedToolSpec[] = JSON.parse(process.env.AGENTA_TOOL_SPECS ?? "[]");
const ENDPOINT = process.env.AGENTA_TOOL_CALLBACK_ENDPOINT ?? "";
const AUTH = process.env.AGENTA_TOOL_CALLBACK_AUTH;
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
      // `code` runs the snippet locally (scoped secret env); everything else routes back to
      // Agenta's /tools/call. A unique id per call so two parallel calls in the same
      // millisecond don't collide (Date.now() would).
      const text = await runResolvedTool(spec, params?.arguments, {
        toolCallId: randomUUID(),
        endpoint: ENDPOINT,
        authorization: AUTH,
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
  log(`serving ${SPECS.length} tool(s) -> ${ENDPOINT || "(no endpoint)"}`);
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
