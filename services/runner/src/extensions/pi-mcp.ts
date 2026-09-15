/**
 * Pi has no built-in MCP client.  Its supported extension API does, however, let an extension
 * register tools, so this module is the production HTTP MCP client used by the Agenta Pi
 * extension.  The runner supplies only already-resolved gateway routes and their short-lived
 * Agenta credential; upstream URLs and credentials never enter this configuration.
 */

import { mcpToolPermission, normalizeMcpServerPermissions } from "../mcp-permission.ts";

export const PI_GATEWAY_MCP_SERVERS_ENV = "AGENTA_AGENT_GATEWAY_MCP_SERVERS";

/** What the gate is told about one call. Identity only; the runner reads the policy itself. */
export interface PiMcpGateRequest {
  /** Pi's extension context, which owns the confirm dialog. Opaque here. */
  ctx: unknown;
  /** The Pi-rendered tool name, which is what the approval card and decision key use. */
  toolName: string;
  toolCallId: string;
  input: unknown;
  /** The configured server name, verbatim from the wire. */
  mcpServer: string;
  /** The tool name the SERVER advertises, verbatim. */
  mcpTool: string;
}

/**
 * The approval seam for an MCP tool call, supplied by the extension that owns the dialog.
 *
 * It lives here as a parameter rather than an import so this module keeps no dependency on Pi's
 * extension API and stays unit-testable without one.
 */
export type PiMcpToolGate = (
  request: PiMcpGateRequest,
) => Promise<{ allowed: boolean; reason: string }>;

export const MCP_PROTOCOL_VERSION = "2026-07-28";

/**
 * The method every MCP client on this runner opens a connection with, and the one every MCP
 * server on this runner answers: `initialize`, the specification's handshake.
 *
 * OR56. This client used to open with `server/discover`, the capability-negotiation call the
 * 2026-07-28 revision adds. Nothing needs it. That revision makes it a server obligation and a
 * client option ("servers MUST implement it; clients MAY call it"), while the two harness MCP
 * clients we do not control — Claude Code's and Codex's — open with `initialize` and cannot be
 * told otherwise. So `initialize` is the only method every server we speak to must answer
 * anyway, and it is what the runner's own MCP server (`tools/tool-mcp-http.ts`), its handshake
 * probe (`engines/sandbox_agent/mcp-handshake.ts`), and the gateway's builtin adapter answer.
 * Discovery then proceeds `tools/list` -> `tools/call`.
 *
 * Exported so the probe imports this string rather than repeating it: one lifecycle, one symbol.
 */
export const MCP_DISCOVERY_METHOD = "initialize";

export interface PiGatewayMcpServer {
  name: string;
  url: string;
  headers: Record<string, string>;
  /**
   * The server's policy, verbatim from the wire. `tools` is the advertise filter; the permission
   * fields are read through `normalizeMcpServerPermissions` rather than off this object, so a
   * malformed verdict cannot reach a decision. Before OR79 this type declared only `tools`, which
   * is how `permission` came to be delivered to the sandbox and read by nobody.
   */
  policy: {
    tools?: { mode?: "all" | "include"; names?: string[] };
    permission?: string;
    toolPermissions?: Record<string, string>;
    newToolPermission?: string;
  };
}

interface PiGatewayMcpConfig {
  version: 1;
  servers: PiGatewayMcpServer[];
}

export interface PiMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Pi receives only Agenta's gateway data-plane URL plus its short-lived credentials header.
 * A direct author URL is valid for the ACP harnesses, but it is deliberately not a Pi extension
 * input: Pi's extension is the trusted client boundary for registered gateway routes.
 */
export function piGatewayMcpServersFromWire(
  servers: Array<{
    name: string;
    connection: {
      type: "http";
      url: string;
      headers?: Record<string, string>;
      credentials?: Array<{
        binding: { kind: "header"; name: string };
        value: string;
        usage: "opaque_http";
      }>;
    };
    policy: PiGatewayMcpServer["policy"];
  }> | undefined,
): PiGatewayMcpServer[] {
  return (servers ?? []).map((server) => {
    let parsed: URL;
    try {
      parsed = new URL(server.connection.url);
    } catch {
      throw new Error(`Pi MCP server '${server.name}' has an invalid gateway URL`);
    }
    if (!/^\/(?:api\/)?gateways\/mcps\/(?:builtin|standard|custom)\//.test(parsed.pathname)) {
      throw new Error(
        `Pi MCP server '${server.name}' must be a registered Agenta gateway route`,
      );
    }
    const credentials = server.connection.credentials ?? [];
    if (
      credentials.length !== 1 ||
      credentials[0].binding.kind !== "header" ||
      credentials[0].binding.name.toLowerCase() !== "x-ag-credentials" ||
      credentials[0].usage !== "opaque_http" ||
      !credentials[0].value
    ) {
      throw new Error(
        `Pi MCP server '${server.name}' must carry exactly one Agenta gateway credential`,
      );
    }
    const headers = {
      ...(server.connection.headers ?? {}),
      [credentials[0].binding.name]: credentials[0].value,
    };
    return { name: server.name, url: server.connection.url, headers, policy: server.policy };
  });
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readJsonResponse(raw: string): JsonRpcResponse {
  const text = raw.trim();
  // Streamable HTTP may return either JSON or a single SSE data event.
  const json = text.startsWith("data:")
    ? text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
    : text;
  try {
    const parsed = JSON.parse(json);
    if (!isRecord(parsed)) throw new Error("response is not an object");
    return parsed as JsonRpcResponse;
  } catch (error) {
    throw new Error(
      `MCP server returned invalid JSON-RPC: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * A request the MCP server answered badly, carrying the HTTP status so a caller can say WHICH
 * refusal it was. A bare `Error` loses that, and the status is the one thing an operator looks up.
 */
export class PiMcpRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PiMcpRequestError";
  }
}

class PiHttpMcpClient {
  private nextId = 1;
  private sessionId: string | undefined;

  constructor(private readonly server: PiGatewayMcpServer) {}

  private post(message: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...this.server.headers,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return fetch(this.server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });
  }

  /**
   * A JSON-RPC notification: no id, so the server owes no response and a conforming one answers
   * `202` with an empty body. Best effort by design — `notifications/initialized` completes the
   * handshake for servers that require it, and a server that ignores it is not a failure.
   */
  private async notify(method: string): Promise<void> {
    try {
      await this.post({ jsonrpc: "2.0", method, params: {} });
    } catch {
      // Deliberately ignored: the `initialize` answer already proved the connection.
    }
  }

  private async request(method: string, params?: unknown): Promise<unknown> {
    const response = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params: {
        ...(isRecord(params) ? params : {}),
        _meta: { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION },
      },
    });
    if (!response.ok) {
      throw new PiMcpRequestError(`MCP ${method} failed (${response.status})`, response.status);
    }
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    const payload = readJsonResponse(await response.text());
    if (payload.error) {
      throw new PiMcpRequestError(payload.error.message ?? `MCP ${method} failed`, response.status);
    }
    return payload.result;
  }

  async discover(): Promise<PiMcpTool[]> {
    await this.request(MCP_DISCOVERY_METHOD, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "agenta-pi-extension", version: "1" },
    });
    await this.notify("notifications/initialized");
    const result = await this.request("tools/list");
    if (!isRecord(result) || !Array.isArray(result.tools)) {
      throw new Error("MCP tools/list returned no tools array");
    }
    return result.tools.flatMap((tool): PiMcpTool[] => {
      if (!isRecord(tool) || typeof tool.name !== "string") return [];
      return [{
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        ...(isRecord(tool.inputSchema) ? { inputSchema: tool.inputSchema } : {}),
      }];
    });
  }

  call(name: string, args: unknown): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args ?? {} });
  }
}

function allowsTool(server: PiGatewayMcpServer, name: string): boolean {
  const tools = server.policy.tools;
  return tools?.mode !== "include" || (tools.names ?? []).includes(name);
}

/** Stable, collision-resistant Pi tool identity: external tools cannot replace Pi or Agenta tools. */
export function piMcpToolName(serverName: string, toolName: string): string {
  const normalize = (value: string) => value.replace(/[^A-Za-z0-9_]/g, "_");
  return `mcp__${normalize(serverName)}__${normalize(toolName)}`;
}

export function parsePiGatewayMcpConfig(raw: string | undefined): PiGatewayMcpServer[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.servers)) {
      throw new Error("expected {version: 1, servers: []}");
    }
    return parsed.servers.map((server): PiGatewayMcpServer => {
      if (!isRecord(server) || typeof server.name !== "string" || typeof server.url !== "string" || !isRecord(server.headers) || !isRecord(server.policy)) {
        throw new Error("server is malformed");
      }
      return {
        name: server.name,
        url: server.url,
        headers: Object.fromEntries(Object.entries(server.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
        policy: server.policy as PiGatewayMcpServer["policy"],
      };
    });
  } catch (error) {
    throw new Error(`invalid Pi gateway MCP configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface PiToolRegistry {
  registerTool: (tool: any) => void;
  getAllTools?: () => Array<{ name: string }>;
}

/**
 * The gateway MCP tool names this module has already registered on a given Pi instance.
 *
 * OR59. `before_agent_start` fires once per turn and a pooled session runs many turns through
 * one Pi instance, so from turn two `pi.getAllTools()` returns the tools turn one registered.
 * Seeding the collision guard from that list alone made the session's own tools collide with
 * themselves, and the tools vanished for the rest of the session. A name cannot be judged by
 * spelling — the tool a foreign server wants to shadow and the tool we registered last turn
 * spell the same — so ownership has to be remembered. Weakly keyed, so the names go when the
 * session's Pi instance does.
 */
const registeredNamesByPi = new WeakMap<PiToolRegistry, Set<string>>();

/**
 * Register external MCP tools through Pi's supported native extension API.
 *
 * `gate` is the approval seam. It is REQUIRED rather than optional on purpose: before OR79 this
 * function registered every tool with an `execute` that called the upstream directly, so an agent
 * whose server was configured `deny` ran the tool anyway. An optional gate is the same defect with
 * a longer fuse — one caller that forgets to pass it restores the hole — so the signature makes a
 * gateless registration impossible to write.
 */
export async function registerPiGatewayMcpTools(
  pi: PiToolRegistry,
  raw: string | undefined,
  log: (message: string) => void,
  gate: PiMcpToolGate,
): Promise<void> {
  const servers = parsePiGatewayMcpConfig(raw);
  let ours = registeredNamesByPi.get(pi);
  if (!ours) {
    ours = new Set<string>();
    registeredNamesByPi.set(pi, ours);
  }
  const registered = new Set((pi.getAllTools?.() ?? []).map((tool) => tool.name));
  const collisions: string[] = [];
  // Which server each Pi tool name in THIS pass came from. `registered` cannot answer that: it
  // holds names Pi already has, so two servers in one pass that rewrite to the same name both
  // looked new and the second silently shadowed the first (OR80).
  const claimedBy = new Map<string, string>();
  let connected = 0;
  for (const server of servers) {
    const permissions = normalizeMcpServerPermissions(server.policy);
    const client = new PiHttpMcpClient(server);
    let tools: PiMcpTool[];
    try {
      tools = await client.discover();
    } catch (error) {
      // NON-FATAL, per server. Pi used to let a failed handshake escape `before_agent_start` and
      // kill the whole turn, which is both harsher than the ACP harnesses (they run on without
      // the server) and less informative: the person saw a generic run failure, never the server
      // name. The runner's acquire-time probe is what tells them; this is the operator's log line.
      const status = error instanceof PiMcpRequestError ? error.status : undefined;
      log(
        `[mcp] warn: server '${server.name}' failed its handshake: ` +
          `status=${status ?? "none"} reason=${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    connected += 1;
    for (const tool of tools) {
      if (!allowsTool(server, tool.name)) continue;
      // A tool the policy denies is not offered at all. A denied tool the model can see is a tool
      // it will try, and the refusal it gets back is a worse experience than never offering it —
      // the same rule the Composio search filter already applies (`tools/gateway-policy.ts`).
      if (mcpToolPermission(permissions, tool.name) === "deny") continue;
      const name = piMcpToolName(server.name, tool.name);
      // The cross-server check runs BEFORE the warm-turn no-op, and that order is the fix rather
      // than an optimisation: `ours` says "this module registered this name", which is true for a
      // name the OTHER server registered a moment ago, so the no-op below swallowed exactly the
      // collision this is looking for (OR80).
      const claimant = claimedBy.get(name);
      if (claimant !== undefined && claimant !== server.name) {
        // Two DIFFERENT configured servers rewrote to one Pi tool name. Whichever registered first
        // would answer for both, so the model would reach one account's tool believing it had
        // reached the other's. Refuse both rather than pick (OR80).
        log(
          `[mcp] error: servers '${claimant}' and '${server.name}' both render tool ` +
            `'${tool.name}' as '${name}'; neither was registered`,
        );
        collisions.push(name);
        continue;
      }
      // Already live on this session from an earlier turn, and from THIS server: re-registering it
      // is the no-op that keeps a warm turn's tools, not a collision.
      if (ours.has(name)) {
        claimedBy.set(name, server.name);
        continue;
      }
      if (registered.has(name)) {
        // A genuine collision: some tool Pi already holds that this module did not put there.
        // Report it per tool and keep going, so one shadowed name does not cost every other
        // server's tools, then fail the registration at the end so the caller sees it too.
        log(
          `[mcp] error: server '${server.name}' tool '${tool.name}' collides with an existing ` +
            `tool named '${name}'; it was not registered`,
        );
        collisions.push(name);
        continue;
      }
      registered.add(name);
      ours.add(name);
      claimedBy.set(name, server.name);
      // Captured per tool, so the closure cannot read a later loop iteration's server.
      const serverName = server.name;
      const upstreamTool = tool.name;
      pi.registerTool({
        name,
        label: name,
        description: tool.description ?? `${server.name}: ${tool.name}`,
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
        // Positional shape (ctx 5th) is pi-coding-agent's `registerTool` execute contract, and it
        // matches the custom-tool registration in `agenta.ts`. If upstream changes the arity the
        // gate fails closed (no ui -> block); it never fails open.
        async execute(
          toolCallId: string,
          params: unknown,
          _signal?: unknown,
          _onUpdate?: unknown,
          ctx?: unknown,
        ) {
          // Gate BEFORE the upstream call: only an allow reaches the server. A deny surfaces as
          // the tool's own result text, so the model loop continues rather than dying.
          const { allowed, reason } = await gate({
            ctx,
            toolName: name,
            toolCallId,
            input: params,
            mcpServer: serverName,
            mcpTool: upstreamTool,
          });
          if (!allowed) {
            return {
              content: [{ type: "text", text: reason }],
              details: { server: serverName, tool: upstreamTool },
            };
          }
          const result = await client.call(upstreamTool, params);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: { server: serverName, tool: upstreamTool },
          };
        },
      });
    }
  }
  if (servers.length > 0) {
    log(`registered gateway MCP tools from ${connected}/${servers.length} server(s)`);
  }
  if (collisions.length > 0) {
    throw new Error(`MCP tool name collision: ${collisions.join(", ")}`);
  }
}

export function serializePiGatewayMcpConfig(servers: PiGatewayMcpServer[]): string {
  const config: PiGatewayMcpConfig = { version: 1, servers };
  return JSON.stringify(config);
}
