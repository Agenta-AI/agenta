/**
 * Pi has no built-in MCP client.  Its supported extension API does, however, let an extension
 * register tools, so this module is the production HTTP MCP client used by the Agenta Pi
 * extension.  The runner supplies only already-resolved gateway routes and their short-lived
 * Agenta credential; upstream URLs and credentials never enter this configuration.
 */

import { isRecord, mcpToolPermission, normalizeMcpServerPermissions } from "../mcp-permission.ts";

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

/**
 * The MCP revision this client OFFERS at `initialize`. A server is free to answer an older one
 * it supports, and `negotiatedVersion` is what every request after the handshake then carries.
 *
 * One value, shared by all three clients this product ships: this one, the browser client
 * (`web/packages/agenta-entities/src/mcpEndpoint/core/mcpRpc.ts`) and the backend probe
 * (`api/oss/src/core/gateways/mcps/probe.py`). They disagreed until D64 — this client claimed
 * `2026-07-28` while the other two claimed `2025-06-18` — which meant one product told the same
 * server three different things about the wire, and a mock's strictness derived from one client
 * certified nothing about the other two.
 *
 * `2025-06-18` is the revision we picked, and the reason is that a client should claim only what
 * it implements. The later revisions add requirements to the request envelope that none of these
 * three clients implements or reads back, and claiming a revision we do not satisfy is what OR91
 * cost us against a real server: it validated our envelope against the revision we NAMED and
 * refused every request. Claiming the revision whose requirements we do meet makes that removal
 * correct rather than merely convenient. Raise this only alongside the work that implements what
 * the newer revision asks for, in all three clients at once.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * How long a HANDSHAKE request from this client may take (CR10).
 *
 * `fetch` has no timeout of its own, so without this a server that accepts the connection and
 * then says nothing hangs the call forever. `discover()` runs inside `before_agent_start`, whose
 * failure branch catches rejections and not hangs, so an unbounded handshake there stalls the
 * whole turn before its first token. Matched to the runner's own handshake probe
 * (`MCP_HANDSHAKE_PROBE_TIMEOUT_MS`), which already had a bound, so the two agree on how long a
 * server gets to answer.
 *
 * This is a LIVENESS bound and deliberately short: the handshake asks a server to say that it is
 * there and to list what it has, and a server that cannot do that promptly should not delay the
 * turn's first token. It is not, and must not be, the bound on a tool call (D65).
 */
export const PI_MCP_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The gateway's own upstream budget for one MCP relay, in milliseconds.
 *
 * Mirrors `_DEFAULT_TIMEOUT_SECONDS` in `api/oss/src/core/gateways/mcps/providers/http/adapter.py`,
 * which is the peer this client always talks to: `piGatewayMcpServersFromWire` refuses any URL
 * that is not a gateway route on this deployment, so there is no other peer to budget for. Raise
 * the two together or this client starts cancelling work the gateway is still willing to wait for.
 */
export const GATEWAY_MCP_BUDGET_MS = 30_000;

/** Time for the gateway's own refusal to travel back once its upstream budget has expired. */
export const PI_MCP_TIMEOUT_MARGIN_MS = 5_000;

/**
 * How long a TOOL CALL from this client may take (D65).
 *
 * CR10 applied the handshake's ten-second liveness bound to every request, `tools/call` included.
 * The gateway allows its upstream thirty seconds, so every tool that took between ten and thirty
 * seconds — an ordinary search against a real provider — was cancelled by the client while the
 * gateway was still waiting, and the turn failed. A reviewer proved it by driving a real
 * registration against a server answering inside the gateway's budget: rejected at 10001 ms.
 *
 * The invariant is that this client must never be the first to give up on its own gateway: the
 * bound is the gateway's budget plus enough margin for the gateway's refusal to come back, so a
 * slow upstream produces the gateway's own error rather than this client's cancellation. An
 * operator who raises the gateway's budget must raise this with it; the margin is not slack for
 * that, it is only the return trip.
 *
 * Known residual: a per-ENDPOINT `timeout_seconds` above the gateway default is still capped here,
 * because nothing delivers that stored setting to the runner. Closing it means carrying the
 * resolved endpoint's budget on the run's MCP wire, which is a change to the contract between the
 * API, the SDK and this client rather than a constant.
 */
export const PI_MCP_CALL_TIMEOUT_MS = GATEWAY_MCP_BUDGET_MS + PI_MCP_TIMEOUT_MARGIN_MS;

/**
 * Headers this client owns, lowercased for case-insensitive comparison (M19).
 *
 * `Mcp-Session-Id` is here too: it is the session the client itself opened, and a configured
 * value for it would point the request at a session the server never issued to us.
 */
const PROTOCOL_HEADER_NAMES = new Set([
  "accept",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
]);

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

/**
 * A page cap on `tools/list`, so a server that keeps handing back a cursor cannot hold the turn
 * open before its first token. Well past any real catalogue; it is a stop, not a budget.
 *
 * The same cap and the same reasoning as the browser client's `MAX_TOOL_PAGES`
 * (`web/packages/agenta-entities/src/mcpEndpoint/api/api.ts`).
 */
export const MCP_MAX_TOOL_PAGES = 20;

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
    // The path shape says the URL LOOKS like a gateway route; it does not say whose. Any host
    // serving `/gateways/mcps/custom/...` satisfied it, and this client attaches the gateway
    // credential to every request it makes — so the origin has to be ours too (CR9).
    const allowed = allowedGatewayOrigins();
    if (allowed.length > 0 && !allowed.includes(parsed.origin)) {
      throw new Error(
        `Pi MCP server '${server.name}' must be a route on this deployment's API`,
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

/**
 * The origins a gateway MCP route may have: this deployment's own API, internal hop and public
 * base both.
 *
 * Read at call time rather than at module load, because this function runs runner-side (from
 * `pi-assets.ts`, building the extension's config) and the runner's env is what defines them.
 * An empty list means the operator configured neither, which is a real self-hosted shape; the
 * path check then stands alone rather than refusing every MCP server on such a deployment.
 */
function allowedGatewayOrigins(): string[] {
  const origins: string[] = [];
  for (const base of [
    process.env.AGENTA_API_INTERNAL_URL,
    process.env.AGENTA_API_URL,
  ]) {
    if (!base) continue;
    try {
      origins.push(new URL(base).origin);
    } catch {
      // A malformed base configures nothing; it must not widen the check either.
    }
  }
  return origins;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** One SSE event's payload: its `data:` lines joined, as the transport specifies. */
function eventPayload(event: string): string {
  const dataLines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  return dataLines.length > 0 ? dataLines.join("\n") : event.trim();
}

function parseObjectOrNull(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The JSON body of a Streamable HTTP answer, which may arrive as plain JSON or as an SSE stream.
 *
 * Exported so the handshake probe reads a server's answer exactly as the client that follows it
 * will; two parsers meant a server could pass the probe and be unreadable to the client.
 *
 * Three transport facts decide this, and each one has cost us a server:
 *
 *  - ANY `data:` line means SSE, not just a leading one. A conforming event may open with `event:`
 *    or an id, and a real upstream (Linear) opens with `event: message`, so testing only the first
 *    character called such a server's every answer invalid JSON.
 *  - A stream may carry MORE THAN ONE event. The transport lets a server send notifications
 *    (progress, logging) before the response, and joining every `data:` line in the body produced
 *    two JSON documents separated by a newline, which parses as nothing: the client then reported
 *    no tools and dropped the server (D63).
 *  - The answer to THIS request is the frame whose `id` matches it. A notification carries no id
 *    and no `result`/`error`, which is what distinguishes it, but two in-flight requests can share
 *    a stream and only the id tells them apart.
 *
 * `id` is optional because the handshake probe reads a body it did not number. Without one this
 * takes the last frame carrying a result or an error, which is what the browser client
 * (`web/packages/agenta-entities/src/mcpEndpoint/core/mcpRpc.ts`) does. When nothing in the body
 * qualifies, the whole text is returned so the caller's parse failure names the real body.
 */
export function readMcpResponseJson(raw: string, id?: number | string): string {
  const text = raw.trim();
  if (!text) return text;

  const frames = text.split(/\r?\n\r?\n/).map(eventPayload).filter(Boolean);
  // One frame is the ordinary case (a plain JSON body, or a single event) and must behave exactly
  // as it did before: returned whole, so a malformed body reaches the caller's error message
  // rather than being silently dropped as "no frame carried a result".
  if (frames.length <= 1) return frames[0] ?? text;

  let anyAnswer: string | undefined;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const parsed = parseObjectOrNull(frames[index]);
    // A notification: no result, no error, nothing owed to any request. Skip it.
    if (!parsed || !("result" in parsed || "error" in parsed)) continue;
    if (id === undefined || parsed.id === id) return frames[index];
    anyAnswer ??= frames[index];
  }
  return anyAnswer ?? text;
}

function readJsonResponse(raw: string, id?: number | string): JsonRpcResponse {
  const json = readMcpResponseJson(raw, id);
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

/**
 * One answer, read whole while the request is still bounded (D67).
 *
 * `post` hands back the decoded body rather than a `Response`, so there is no way to read a body
 * outside the region where the timeout and the caller's cancellation still apply. Only the three
 * pieces the caller uses are carried, which is also what keeps that invariant hard to break.
 */
interface PiMcpAnswer {
  ok: boolean;
  status: number;
  sessionId: string | null;
  text: string;
}

class PiHttpMcpClient {
  private nextId = 1;
  private sessionId: string | undefined;

  /** The version `initialize` agreed on. Unset until then, and that is what gates the header. */
  private negotiatedVersion: string | undefined;

  constructor(private readonly server: PiGatewayMcpServer) {}

  /**
   * One request, bounded by `PI_MCP_REQUEST_TIMEOUT_MS` and by the caller's own signal when it
   * has one (CR10). Both abort the same request: the timeout is the floor nobody has to remember,
   * and the caller's signal is how a cancelled tool call stops waiting on a server that is simply
   * slow rather than broken.
   */
  private async post(
    message: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs: number = PI_MCP_REQUEST_TIMEOUT_MS,
  ): Promise<PiMcpAnswer> {
    // The protocol version is NEGOTIATED, so it cannot be asserted before `initialize` answers.
    // The transport spec says the client sends `MCP-Protocol-Version` on requests AFTER
    // initialization, carrying the version the server returned; on `initialize` itself there is
    // nothing to send, because the client does not yet know what the server speaks. Servers that
    // enforce this refuse an `initialize` carrying the header with a 400 whose message reads as a
    // client/server version disagreement, which is how a real upstream failed while every mock
    // (which does not check) passed.
    // M19. The user's headers go on FIRST and the protocol's own go on top, so a configured
    // header cannot replace `Accept`, `Content-Type` or `MCP-Protocol-Version`. Spread the other
    // way round, a server config that set any of the three broke `initialize` in a way that reads
    // as a gateway bug rather than as the configuration it is. Case matters too: HTTP header names
    // are case-insensitive but a JS object's keys are not, so `accept` and `Accept` would both
    // survive the spread and `fetch` would fold them into one comma-joined value; the user's keys
    // are dropped by case-insensitive name rather than by exact match.
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(this.server.headers ?? {})) {
      if (PROTOCOL_HEADER_NAMES.has(name.toLowerCase())) continue;
      headers[name] = value;
    }
    headers.Accept = "application/json, text/event-stream";
    headers["Content-Type"] = "application/json";
    if (this.negotiatedVersion) {
      headers["MCP-Protocol-Version"] = this.negotiatedVersion;
    }
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetch(this.server.url, {
        method: "POST",
        // CR9, on this path as on the handshake probe. Every request here carries the gateway
        // credential, so a 302 would hand it to a host nothing validated. `manual` surfaces the
        // 3xx as an ordinary response, which `request()` then reports as a failed MCP call.
        redirect: "manual",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      // D67. The body is read INSIDE the guarded region, because the headers are not the answer.
      // Reading it after this block cleared the timer and dropped the caller's listener left the
      // stream watched by nothing: a server that answered and then stalled held the call forever,
      // and a cancelled turn could not end it. CR10's own defect, half closed. Both the bound and
      // the caller's signal abort the same controller, and aborting it after the headers have
      // arrived tears down the body stream too, so `text()` rejects rather than hanging.
      return {
        ok: response.ok,
        status: response.status,
        sessionId: response.headers.get("mcp-session-id"),
        text: await response.text(),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
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

  private async request(
    method: string,
    params?: unknown,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<unknown> {
    // No `_meta` envelope. `_meta` is OPTIONAL in every MCP revision and nothing on either side
    // of this client reads one back, but a server that receives one validates it in full against
    // the revision in force — so an envelope sent for politeness is a refusal waiting to happen.
    // A real upstream (Linear) answers any `_meta` on a post-initialize request with
    // `-32602 Invalid _meta envelope for protocol revision <rev>: <key>: missing`, naming a key
    // this client has no reason to send; the same requests without `_meta` succeed. Send the
    // caller's params and nothing else. The mock upstream enforces this rule too, so the cell
    // matrix fails rather than the next real server.
    const id = this.nextId++;
    const response = await this.post({
      jsonrpc: "2.0",
      id,
      method,
      params: isRecord(params) ? params : {},
    }, signal, timeoutMs);
    if (!response.ok) {
      throw new PiMcpRequestError(`MCP ${method} failed (${response.status})`, response.status);
    }
    if (response.sessionId) this.sessionId = response.sessionId;
    // The id is handed to the reader so a stream carrying notifications, or another request's
    // answer, resolves to THIS request's frame rather than to whatever arrived last.
    const payload = readJsonResponse(response.text, id);
    if (payload.error) {
      throw new PiMcpRequestError(payload.error.message ?? `MCP ${method} failed`, response.status);
    }
    return payload.result;
  }

  async discover(): Promise<PiMcpTool[]> {
    const initialized = await this.request(MCP_DISCOVERY_METHOD, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "agenta-pi-extension", version: "1" },
    });
    // Echo back what the server chose, not what we asked for: a server is free to answer an
    // older version it supports, and every later request must name the one actually in force.
    this.negotiatedVersion =
      isRecord(initialized) && typeof initialized.protocolVersion === "string"
        ? initialized.protocolVersion
        : MCP_PROTOCOL_VERSION;
    await this.notify("notifications/initialized");

    // `tools/list` is PAGINATED: a server that has more to list answers with a `nextCursor`, and
    // the client asks again with it. Reading only the first page silently hid every tool past it,
    // and hid it in the worst way — the model was simply never offered them, so the turn looked
    // like a model that would not use a tool rather than a client that never advertised one
    // (D69). The browser client already followed the cursor; this is the same wire.
    const tools: PiMcpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MCP_MAX_TOOL_PAGES; page += 1) {
      const result = await this.request("tools/list", cursor ? { cursor } : undefined);
      if (!isRecord(result) || !Array.isArray(result.tools)) {
        throw new Error("MCP tools/list returned no tools array");
      }
      for (const tool of result.tools) {
        if (!isRecord(tool) || typeof tool.name !== "string") continue;
        tools.push({
          name: tool.name,
          ...(typeof tool.description === "string" ? { description: tool.description } : {}),
          ...(isRecord(tool.inputSchema) ? { inputSchema: tool.inputSchema } : {}),
        });
      }
      const next = result.nextCursor;
      // A cursor equal to the one just used is a server looping; stop rather than ask forever.
      if (typeof next !== "string" || !next || next === cursor) break;
      cursor = next;
    }
    return tools;
  }

  call(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    // The gateway's budget plus the return trip, not the handshake's liveness bound (D65): this
    // call's peer is the gateway, which is willing to wait thirty seconds for its upstream.
    return this.request(
      "tools/call",
      { name, arguments: args ?? {} },
      signal,
      PI_MCP_CALL_TIMEOUT_MS,
    );
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

  // Handshakes run together, registration runs in configuration order. This is called from
  // `before_agent_start`, so every turn waits on it, and each `discover()` is three round trips
  // through the gateway to the upstream — serially that was 3xN hops before the first token.
  // The results are consumed in the array's own order, which is what the collision rules below
  // depend on, so only the I/O overlaps.
  type Discovery = {
    server: PiGatewayMcpServer;
    // The same client the registered tools call through, so a tool call reuses the connection
    // its handshake opened rather than opening a second one.
    client: PiHttpMcpClient;
  } & ({ tools: PiMcpTool[]; error?: undefined } | { tools?: undefined; error: unknown });
  const discoveries = await Promise.all(
    servers.map(async (server): Promise<Discovery> => {
      const client = new PiHttpMcpClient(server);
      try {
        return { server, client, tools: await client.discover() };
      } catch (error) {
        return { server, client, error };
      }
    }),
  );

  for (const discovery of discoveries) {
    const { server, client } = discovery;
    if (discovery.tools === undefined) {
      // NON-FATAL, per server. Pi used to let a failed handshake escape `before_agent_start` and
      // kill the whole turn, which is both harsher than the ACP harnesses (they run on without
      // the server) and less informative: the person saw a generic run failure, never the server
      // name. The runner's acquire-time probe is what tells them; this is the operator's log line.
      const { error } = discovery;
      const status = error instanceof PiMcpRequestError ? error.status : undefined;
      log(
        `[mcp] warn: server '${server.name}' failed its handshake: ` +
          `status=${status ?? "none"} reason=${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const tools = discovery.tools;
    const permissions = normalizeMcpServerPermissions(server.policy);
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
        // reached the other's. The name keeps its first claimant and the SECOND server's tool is
        // refused, which is what makes every remaining call unambiguous; the registration then
        // fails at the end so the operator sees it. Following OR59, one shadowed name does not
        // cost the other servers their tools (OR80).
        log(
          `[mcp] error: servers '${claimant}' and '${server.name}' both render tool ` +
            `'${tool.name}' as '${name}'; it stays with '${claimant}' and ` +
            `'${server.name}' did not register it`,
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
          signal?: unknown,
          _onUpdate?: unknown,
          ctx?: unknown,
        ) {
          // Pi hands the turn's abort signal in this slot. It used to be ignored, so a cancelled
          // turn still sat waiting on the upstream (CR10). Narrowed rather than cast, because the
          // positional contract is upstream's and a future arity change must degrade to "no
          // signal" instead of throwing here.
          const abortSignal =
            signal instanceof AbortSignal ? signal : undefined;
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
          const result = await client.call(upstreamTool, params, abortSignal);
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
