/**
 * Pi has no built-in MCP client.  Its supported extension API does, however, let an extension
 * register tools, so this module is the production HTTP MCP client used by the Agenta Pi
 * extension.  The runner supplies only already-resolved gateway routes and their short-lived
 * Agenta credential; upstream URLs and credentials never enter this configuration.
 */

export const PI_GATEWAY_MCP_SERVERS_ENV = "AGENTA_AGENT_GATEWAY_MCP_SERVERS";

const MCP_PROTOCOL_VERSION = "2026-07-28";

export interface PiGatewayMcpServer {
  name: string;
  url: string;
  headers: Record<string, string>;
  policy: { tools?: { mode?: "all" | "include"; names?: string[] } };
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

class PiHttpMcpClient {
  private nextId = 1;
  private sessionId: string | undefined;

  constructor(private readonly server: PiGatewayMcpServer) {}

  private async request(method: string, params?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...this.server.headers,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const response = await fetch(this.server.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        params: {
          ...(isRecord(params) ? params : {}),
          _meta: { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`MCP ${method} failed (${response.status})`);
    }
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    const payload = readJsonResponse(await response.text());
    if (payload.error) {
      throw new Error(payload.error.message ?? `MCP ${method} failed`);
    }
    return payload.result;
  }

  async discover(): Promise<PiMcpTool[]> {
    await this.request("server/discover");
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

/** Register external MCP tools through Pi's supported native extension API. */
export async function registerPiGatewayMcpTools(
  pi: {
    registerTool: (tool: any) => void;
    getAllTools?: () => Array<{ name: string }>;
  },
  raw: string | undefined,
  log: (message: string) => void,
): Promise<void> {
  const servers = parsePiGatewayMcpConfig(raw);
  const registered = new Set((pi.getAllTools?.() ?? []).map((tool) => tool.name));
  for (const server of servers) {
    const client = new PiHttpMcpClient(server);
    const tools = await client.discover();
    for (const tool of tools) {
      if (!allowsTool(server, tool.name)) continue;
      const name = piMcpToolName(server.name, tool.name);
      if (registered.has(name)) throw new Error(`MCP tool name collision: ${name}`);
      registered.add(name);
      pi.registerTool({
        name,
        label: name,
        description: tool.description ?? `${server.name}: ${tool.name}`,
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
        async execute(_toolCallId: string, params: unknown) {
          const result = await client.call(tool.name, params);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: { server: server.name, tool: tool.name },
          };
        },
      });
    }
  }
  if (servers.length > 0) log(`registered gateway MCP tools from ${servers.length} server(s)`);
}

export function serializePiGatewayMcpConfig(servers: PiGatewayMcpServer[]): string {
  const config: PiGatewayMcpConfig = { version: 1, servers };
  return JSON.stringify(config);
}
