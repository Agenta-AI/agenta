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
 * Why HTTP on loopback:
 *  - No runner-host child process. This endpoint is served by the already-running runner process
 *    and is reachable only from loopback.
 *  - Reuses #4834's proven transport. Claude consumes a `type: "http"` MCP server natively (the
 *    bundled `@agentclientprotocol/claude-agent-acp` maps it to the Claude SDK's HTTP MCP client).
 *
 * This server is INDEPENDENT of the user MCP capability (`engines/sandbox_agent/mcp.ts`
 * `toAcpMcpServers`): external HTTP MCP is passed separately and this internal channel remains
 * its own thing.
 *
 * Transport: MCP Streamable HTTP in stateless JSON mode. The MCP client (`@modelcontextprotocol/sdk`
 * `StreamableHTTPClientTransport`) POSTs JSON-RPC with `Accept: application/json, text/event-stream`;
 * we always answer a request with a single `application/json` JSON-RPC response (no SSE), `202` for
 * a notification (no body), and `405` for the `GET`/`DELETE` stream-management verbs the client
 * tolerates. No session id, no streaming — the simplest conformant server. Pin against the MCP SDK
 * version bundled with the installed Claude harness if the framing ever drifts.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import type { ResolvedToolSpec } from "../protocol.ts";
import { EMPTY_OBJECT_SCHEMA, MAX_BODY_BYTES } from "./callback.ts";
import { runResolvedTool } from "./dispatch.ts";
import type { ClientToolRelay } from "./client-tool-relay.ts";
import { assertRequiredArguments, specInputSchema } from "./spec-schema.ts";
import { toolSpecsByName } from "./public-spec.ts";

type Log = (message: string) => void;

const DEFAULT_PROTOCOL = "2025-06-18";
/** Loopback only: never reachable off-host. Access also requires a per-server bearer token. */
const HOST = "127.0.0.1";

/**
 * A paused client tool. The handler returns this sentinel INSTEAD of a JSON-RPC response so the
 * request listener emits NO body and deterministically aborts the in-flight HTTP request: a
 * normal MCP result would let the harness (Claude) settle the call and clobber the pending
 * connect widget before the paused turn is observed. The seam already emitted the `client_tool`
 * interaction (`onClientTool`) and the handler then ends the turn (`onPause` -> the engine's
 * pause controller), so the turn ends `paused`.
 */
const MCP_PAUSED = Symbol("mcp-paused");

/** Options for the internal MCP server: the client-tool relay and an engine abort signal. */
export interface InternalToolMcpServerOptions {
  /** When set, a `client` tool call is paused through this relay instead of relayed/executed. */
  clientToolRelay?: ClientToolRelay;
  /** Fired by the engine on pause/teardown; destroys any in-flight request SOCKET so no
   *  response settles late. It does NOT cancel the execution: a `runResolvedTool` dispatch
   *  already running keeps running server-side to completion (its result is just never
   *  written). Threading this signal into dispatch is a known follow-up. */
  signal?: AbortSignal;
  log?: Log;
}

export interface InternalToolMcpServer {
  /** The loopback URL to advertise to the harness as a `type: "http"` MCP server. */
  url: string;
  /** Per-server credential to advertise only as the endpoint's Authorization header. */
  authorizationToken: string;
  /** Stop the server and release the port. Idempotent; safe in the engine `finally`. */
  close: () => Promise<void>;
}

/** An MCP tool-error result (`isError`) so the model can recover, not a crash. */
function mcpToolError(id: unknown, err: unknown): unknown {
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

/**
 * Handle one MCP JSON-RPC message. Returns the JSON-RPC response object, `undefined` for a
 * notification (no `id`), or the `MCP_PAUSED` sentinel for a paused client tool (the listener
 * then aborts the request with no body). Takes the specs and relay dir in-process rather than
 * from env, and dispatches a non-`client` `tools/call` to `runResolvedTool`.
 */
async function handle(
  message: any,
  specByName: Map<string, ResolvedToolSpec>,
  specs: ResolvedToolSpec[],
  relayDir: string,
  clientToolRelay: ClientToolRelay | undefined,
  log: Log,
): Promise<unknown | undefined | typeof MCP_PAUSED> {
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
        // Advertise EVERY spec, including `client` tools (e.g. request_connection): the model
        // must SEE them to call them; the runner pauses the call in `tools/call` below rather
        // than executing it. (`buildToolMcpServers` already dropped `client` specs when no relay
        // is wired.) Only public metadata (name/description/inputSchema) crosses to the harness
        // — never the callRef, code, scoped env, or callback auth, which stay in runner memory.
        tools: specs.map((s) => ({
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

    // `client` tools are browser-fulfilled across a turn boundary: pause them through the shared
    // relay instead of executing. Validate required args FIRST so an under-specified call returns
    // a normal MCP tool error and the model retries (same guard the Pi path has), rather than
    // pausing a half-specified call.
    if ((spec.kind ?? "callback") === "client") {
      try {
        assertRequiredArguments(spec, params?.arguments);
      } catch (err) {
        return mcpToolError(id, err);
      }
      if (!clientToolRelay) {
        return mcpToolError(
          id,
          new Error(
            `client tool '${spec.name}' cannot be delivered on this run`,
          ),
        );
      }
      const callId = randomUUID();
      const request = {
        id: callId,
        toolCallId: callId,
        toolName: spec.name,
        input: params?.arguments,
        spec,
      };
      const decision = await clientToolRelay.onClientTool(request);
      if (decision === "pendingApproval") {
        clientToolRelay.onPause?.(request);
        // No JSON-RPC result: the request listener aborts this in-flight request (see MCP_PAUSED).
        return MCP_PAUSED;
      }
      if (decision === "deny") {
        return mcpToolError(
          id,
          new Error(`Client tool '${spec.name}' was denied.`),
        );
      }
      // Resume: the browser already fulfilled the call; return its structured output as content.
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            { type: "text", text: JSON.stringify(decision.output ?? {}) },
          ],
        },
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

/** Authenticate a bearer token without leaking comparison timing for equal-length values. */
function hasValidAuthorization(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorization) return false;
  const [scheme, presentedToken, ...extra] = authorization.split(" ");
  if (
    scheme?.toLowerCase() !== "bearer" ||
    !presentedToken ||
    extra.length > 0
  ) {
    return false;
  }
  const presented = Buffer.from(presentedToken);
  const expected = Buffer.from(expectedToken);
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

/**
 * Start the internal gateway-tool MCP server on loopback. Returns the URL to advertise and a
 * `close()`. The caller decides whether to start it; this function does not filter — it serves
 * whatever specs it is given. A `client` spec is paused through `options.clientToolRelay`;
 * `options.signal` (the engine's pause/teardown abort) destroys any in-flight request so a
 * paused call never settles late.
 */
export function startInternalToolMcpServer(
  specs: ResolvedToolSpec[],
  relayDir: string,
  options: InternalToolMcpServerOptions = {},
): Promise<InternalToolMcpServer> {
  const { clientToolRelay, signal, log = () => {} } = options;
  const authorizationToken = randomBytes(32).toString("base64url");
  const specByName = toolSpecsByName(specs);
  // Track in-flight responses so the engine abort signal can destroy them deterministically (a
  // paused client tool destroys its OWN response below; the signal is the backstop for any other
  // request still open when the turn ends).
  const active = new Set<ServerResponse>();

  /** Abort a paused request: destroy the socket with no body written, so nothing settles late. */
  const abortPaused = (res: ServerResponse): void => {
    active.delete(res);
    res.destroy();
  };

  const requestListener = (req: IncomingMessage, res: ServerResponse): void => {
    active.add(res);
    res.on("close", () => active.delete(res));
    // Authenticate every MCP transport verb before dispatching or revealing method support.
    if (!hasValidAuthorization(req.headers.authorization, authorizationToken)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32001, message: "unauthorized" },
        }),
      );
      return;
    }

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
          // A client tool crosses a turn boundary and cannot safely participate in concurrent
          // batch execution. Preflight the whole batch so no sibling item executes first.
          const containsClientToolCall = parsed.some((message) => {
            if (message?.method !== "tools/call") return false;
            const spec = specByName.get(message?.params?.name);
            return spec && (spec.kind ?? "callback") === "client";
          });
          if (containsClientToolCall) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                error: {
                  code: -32600,
                  message: "client tools/call is not supported in a batch",
                },
              }),
            );
            return;
          }
          const responses = await Promise.all(
            parsed.map((m) =>
              handle(m, specByName, specs, relayDir, clientToolRelay, log),
            ),
          );
          // A paused client tool in the batch aborts the whole request (no result for any).
          if (responses.some((r) => r === MCP_PAUSED)) {
            abortPaused(res);
            return;
          }
          const out = responses.filter((r) => r !== undefined);
          if (out.length === 0) {
            res.writeHead(202);
            res.end();
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(out));
          return;
        }

        const response = await handle(
          parsed,
          specByName,
          specs,
          relayDir,
          clientToolRelay,
          log,
        );
        if (response === MCP_PAUSED) {
          // Paused client tool: emit NO JSON-RPC result, abort the in-flight request.
          abortPaused(res);
          return;
        }
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

  // Belt and suspenders: on pause/teardown the engine fires this signal; destroy every in-flight
  // request so a handler that has not yet returned cannot write a result after the turn ended.
  // SOCKETS only: a `runResolvedTool` execution already dispatched keeps running server-side —
  // this abort suppresses its response, it does not stop it (signal-threading into dispatch is a
  // known follow-up).
  const onAbort = (): void => {
    for (const res of [...active]) res.destroy();
    active.clear();
    server.closeAllConnections?.();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

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
        authorizationToken,
        close: () =>
          new Promise<void>((done) => {
            signal?.removeEventListener("abort", onAbort);
            server.close(() => done());
            // Drop keep-alive sockets so close() resolves promptly even if a client lingers.
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
