/**
 * Internal gateway-tool MCP server (loopback HTTP).
 *
 * THIS IS THE INTERNAL DELIVERY CHANNEL — not a user MCP capability. Harnesses that accept
 * tools over MCP only (Claude Code) cannot receive Agenta gateway/callback tools natively the
 * way Pi does (Pi loads them through the bundled extension). So the runner stands up this tiny
 * MCP endpoint, synthesized from the run's already-resolved `customTools`, and advertises it to
 * the harness as a `type: "http"` MCP server. On `tools/call` it runs the resolved tool through
 * the SAME dispatch the Pi path uses (`runResolvedTool` → relay → `/tools/call`), so every
 * credentialed action still happens server-side in runner memory.
 *
 * Why HTTP-on-loopback and not the old stdio bridge:
 *  - No runner-host child process. The old `mcp-server.ts` spawned `tsx mcp-server.ts` on the
 *    runner host, outside the sandbox boundary — the same execution hole PR #4831 closed for
 *    USER stdio MCP servers. This endpoint launches nothing; it is served by the already-running
 *    runner process and is reachable only from loopback.
 *  - Reuses #4834's proven transport. Claude consumes a `type: "http"` MCP server natively (the
 *    bundled `@zed-industries/claude-agent-acp` maps it to the Claude SDK's HTTP MCP client).
 *
 * This server is INDEPENDENT of the user MCP capability (`engines/sandbox_agent/mcp.ts`
 * `toAcpMcpServers`): user stdio MCP stays disabled, user HTTP MCP is unchanged, and this
 * internal channel is its own thing. Do not merge their gates (see project gateway-tool-mcp).
 *
 * Transport: MCP Streamable HTTP in stateless JSON mode. The MCP client (`@modelcontextprotocol/sdk`
 * `StreamableHTTPClientTransport`) POSTs JSON-RPC with `Accept: application/json, text/event-stream`;
 * we always answer a request with a single `application/json` JSON-RPC response (no SSE), `202` for
 * a notification (no body), and `405` for the `GET`/`DELETE` stream-management verbs the client
 * tolerates. No session id, no streaming — the simplest conformant server. Pin against the MCP SDK
 * version bundled with the installed Claude harness if the framing ever drifts.
 */
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import type { ResolvedToolSpec } from "../protocol.ts";
import { EMPTY_OBJECT_SCHEMA } from "./callback.ts";
import { runResolvedTool } from "./dispatch.ts";
import { specInputSchema } from "./spec-schema.ts";

type Log = (message: string) => void;

const DEFAULT_PROTOCOL = "2025-06-18";
/** Loopback only: never reachable off-host, carries no credentials. */
const HOST = "127.0.0.1";
/** Bound the request body so a malformed/oversized POST cannot exhaust runner memory. */
const MAX_BODY_BYTES = 1_000_000;

export interface InternalToolMcpServer {
  /** The loopback URL to advertise to the harness as a `type: "http"` MCP server. */
  url: string;
  /** Stop the server and release the port. Idempotent; safe in the engine `finally`. */
  close: () => Promise<void>;
}

/**
 * Handle one MCP JSON-RPC message. Returns the JSON-RPC response object, or `undefined` for a
 * notification (no `id`). Mirrors the pre-#4831 stdio bridge handler, but takes the specs and
 * relay dir in-process rather than from env, and dispatches `tools/call` to `runResolvedTool`.
 */
async function handle(
  message: any,
  specByName: Map<string, ResolvedToolSpec>,
  specs: ResolvedToolSpec[],
  relayDir: string,
  log: Log,
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
        // `client` tools are browser-fulfilled, so this channel never advertises them. Only
        // public metadata (name/description/inputSchema) crosses to the harness — never the
        // callRef, code, scoped env, or callback auth, which stay in runner memory.
        tools: specs
          .filter((s) => (s.kind ?? "callback") !== "client")
          .map((s) => ({
            name: s.name,
            description: s.description ?? s.name,
            // Read via the shared accessor (camelCase `inputSchema` OR snake-case
            // `input_schema`). Reading `s.inputSchema` alone advertised an EMPTY schema for every
            // snake-case platform-catalog tool (`request_connection`, `commit_revision`), so
            // Claude received no argument schema — a live bug, not just a client-tool one.
            inputSchema:
              (specInputSchema(s) as Record<string, unknown>) ??
              EMPTY_OBJECT_SCHEMA,
          })),
      },
    };
  }

  if (method === "tools/call") {
    const name = params?.name;
    const spec = specByName.get(name);
    if (!spec) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `unknown tool: ${name}` },
      };
    }
    try {
      // The channel holds only public metadata; execution relays to the runner via the relay
      // dir, where the private spec + callback auth are applied server-side. A unique id per
      // call keeps parallel calls from colliding.
      const text = await runResolvedTool(spec, params?.arguments, {
        toolCallId: randomUUID(),
        relayDir,
      });
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

  log(`unknown method: ${method}`);
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `method not found: ${method}` },
  };
}

/** Read the full request body, rejecting anything over the size cap. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Start the internal gateway-tool MCP server on loopback. Returns the URL to advertise and a
 * `close()`. The caller decides whether to start it (only when there are executable specs); this
 * function does not filter — it serves whatever specs it is given.
 */
export function startInternalToolMcpServer(
  specs: ResolvedToolSpec[],
  relayDir: string,
  log: Log = () => {},
): Promise<InternalToolMcpServer> {
  const specByName = new Map(specs.map((s) => [s.name, s]));

  const requestListener = (req: IncomingMessage, res: ServerResponse): void => {
    // The MCP Streamable-HTTP client opens a GET SSE stream and sends a DELETE on close; this
    // stateless server offers neither, so it returns 405 (the client tolerates 405 for both).
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json", allow: "POST" });
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    readBody(req)
      .then(async (raw) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "parse error" },
            }),
          );
          return;
        }
        // A batch is an array; handle each and answer with an array of the responses that have
        // an id (notifications produce none).
        if (Array.isArray(parsed)) {
          const responses = (
            await Promise.all(
              parsed.map((m) => handle(m, specByName, specs, relayDir, log)),
            )
          ).filter((r) => r !== undefined);
          if (responses.length === 0) {
            res.writeHead(202);
            res.end();
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(responses));
          return;
        }

        const response = await handle(parsed, specByName, specs, relayDir, log);
        if (response === undefined) {
          // Notification: no body. 202 Accepted is the streamable-HTTP convention.
          res.writeHead(202);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(response));
      })
      .catch((err) => {
        log(
          `request error: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32603, message: "internal error" },
            }),
          );
        }
      });
  };

  const server: Server = createServer(requestListener);

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    // Port 0 -> the OS assigns an ephemeral free port, read back from address().
    server.listen(0, HOST, () => {
      const address = server.address() as AddressInfo | null;
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("internal tool MCP server has no bound port"));
        return;
      }
      const url = `http://${HOST}:${address.port}/mcp`;
      log(`internal tool MCP server on ${url} serving ${specs.length} tool(s)`);
      resolve({
        url,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            // Drop keep-alive sockets so close() resolves promptly even if a client lingers.
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
