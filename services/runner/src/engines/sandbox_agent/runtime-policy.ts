import { type AgentRunRequest, type ToolPermission } from "../../protocol.ts";
import { isToolPermission } from "../../permission-plan.ts";
import { claimSessionOwnership, REPLICA_ID } from "../../sessions/alive.ts";
import { materializeGatewayHeaders } from "./run-plan.ts";
import {
  configuredIngestBases,
  isAgentaIngest,
  platformAuthorizationProvider,
  publicApiBaseConfigured,
  resolveOtlpTraceEndpoint,
  type AuthorizationProvider,
} from "../../tracing/otel.ts";
import { endpointHost } from "../../tracing/export-diagnostics.ts";
import { PendingApprovalPauseController } from "./pause.ts";
import { GATEWAY_PLACEHOLDER_API_KEY } from "../../extensions/model-provider-override.ts";

type Log = (message: string) => void;

/** Extract the run credential from the OTLP export headers (initial value, constant for the run). */
export function runCredential(request: AgentRunRequest): string {
  const headers = (request.telemetry?.exporters?.otlp?.headers ?? {}) as Record<
    string,
    string
  >;
  return (headers["authorization"] ?? headers["Authorization"] ?? "").trim();
}

/** Endpoints already warned about, so a per-turn read warns once instead of every run. */
const warnedEndpoints = new Set<string>();

/** Test-only: forget which endpoints have warned, so a case can assert on its own warning. */
export function resetPlatformCredentialWarnings(): void {
  warnedEndpoints.clear();
}

/**
 * The legacy wire has one authorization header for two possible owners. Treat it as an Agenta
 * platform credential only when the configured destination is Agenta ingest; for an external
 * collector it belongs exclusively to that collector and must never enter platform calls.
 *
 * That attribution is only decidable once the runner knows its platform's PUBLIC api base
 * (`AGENTA_API_URL`), because the public form is what a dispatched run carries: the API hands the
 * SDK `https://<host>/api`, while the runner's own hop is usually the internal `http://api:8000`.
 * A runner told ONLY its internal hop cannot tell its own API under its public name from a
 * third-party collector. Refusing there fails closed on the wrong axis — it silently strips the
 * credential from every run in an otherwise healthy self-hosted deployment, and the damage
 * surfaces far away as a 401 on session persistence. So the strict check arms itself only when
 * the operator has supplied the base that makes it decidable, and otherwise keeps the credential
 * and says loudly what to configure.
 */
export function platformCredentialForRequest(
  request: AgentRunRequest,
  log: Log = (message) => process.stderr.write(`${message}\n`),
): string {
  const endpoint = resolveOtlpTraceEndpoint(
    request.telemetry?.exporters?.otlp?.endpoint,
  );
  if (isAgentaIngest(endpoint)) return runCredential(request);

  const credential = runCredential(request);
  if (!credential) return "";

  if (!publicApiBaseConfigured()) {
    if (!warnedEndpoints.has(endpoint)) {
      warnedEndpoints.add(endpoint);
      log(
        `[sessions] WARNING: trace endpoint host ${endpointHost(endpoint)} matches no configured ` +
          `Agenta ingest host (${configuredIngestBases().map(endpointHost).join(", ")}), and AGENTA_API_URL is not set, so the ` +
          `run credential cannot be attributed. Using it for platform calls anyway. Set ` +
          `AGENTA_API_URL to this deployment's public api base (e.g. https://<host>/api) to ` +
          `attribute it properly and to keep third-party collector credentials out of platform calls.`,
      );
    }
    return credential;
  }

  if (!warnedEndpoints.has(endpoint)) {
    warnedEndpoints.add(endpoint);
    log(
      `[sessions] trace endpoint host ${endpointHost(endpoint)} is not Agenta ingest ` +
        `(${configuredIngestBases().map(endpointHost).join(", ")}); dropping the run credential from platform ` +
        `calls. Session persistence and history rebuild will fail with HTTP 401 if this ` +
        `endpoint IS this deployment's api base.`,
    );
  }
  return "";
}

export interface RunOtlpTarget {
  endpoint: string;
  authorization: AuthorizationProvider;
  authorizationSource: "platform" | "exporter";
}

/**
 * Bind one run to its trusted OTLP destination and the credential that belongs to it.
 * Agenta ingest follows the renewable platform credential; an external collector keeps the
 * exporter header from the original request and never receives a refreshed platform token.
 */
export function resolveRunOtlpTarget(
  request: AgentRunRequest,
  platformAuthorization: AuthorizationProvider,
): RunOtlpTarget {
  const endpoint = resolveOtlpTraceEndpoint(
    request.telemetry?.exporters?.otlp?.endpoint,
  );
  if (isAgentaIngest(endpoint)) {
    return {
      endpoint,
      authorization: platformAuthorizationProvider(platformAuthorization),
      authorizationSource: "platform",
    };
  }
  const exporterAuthorization = runCredential(request) || undefined;
  return {
    endpoint,
    authorization: () => exporterAuthorization,
    authorizationSource: "exporter",
  };
}

/**
 * One MCP server's resolved permission table, after intake.
 *
 * `tools` is keyed by the name the SERVER advertises. That is the only spelling every harness
 * agrees on: Claude renders `mcp__<server>__<tool>`, Codex renders `mcp.<server>.<tool>`, and Pi
 * rewrites both halves through a lossy character filter (OR80). A table keyed on any rendered
 * name is a table that misses on at least one harness.
 */
export interface McpServerPermissions {
  /** The whole-server decision, when the author set a readable one. */
  server?: ToolPermission;
  /** Per-tool decisions by upstream tool name. Empty unless the author opted in. */
  tools: ReadonlyMap<string, ToolPermission>;
  /**
   * The decision an advertised tool gets when `tools` has no entry for it. Present exactly when
   * the author opted into per-tool policy, and authoritative when present — see
   * `mcpToolPermission`.
   */
  newTool?: ToolPermission;
}

export type McpPermissionTable = ReadonlyMap<string, McpServerPermissions>;

/**
 * Validate the whole MCP permission wire once, at intake.
 *
 * Modelled on `tools/gateway-policy.ts`'s `normalizeGatewayPolicy`, and for the same reason: every
 * consumer downstream reads the result of this function and nothing else, so an entry that does
 * not survive here cannot be reached by any of them. The alternative — each call site checking the
 * fields it happens to use — is how a `permission` of `"Deny"` or `null` quietly passes a filter
 * written as "anything but deny".
 *
 * Three rules, and the third is the one that matters:
 *
 *  - A `permission` that is not exactly `allow`/`ask`/`deny` is not a decision, so it is dropped
 *    and the server falls to the run's own permission ladder. That is what an ABSENT permission
 *    already does, so a malformed one is never more permissive than saying nothing.
 *  - A malformed `toolPermissions` entry is dropped and falls to `newTool`, which is itself a real
 *    decision whenever the author opted in.
 *  - An author who opted in but whose `newToolPermission` is PRESENT AND CORRUPT gets `deny`. The
 *    wire is misdescribing its own shape at that point, and the runner must not guess a floor on
 *    behalf of someone who asked for a restriction. An OMITTED `newToolPermission` beside a
 *    readable table is a different thing — an older or hand-written sender, not a corrupt one — and
 *    gets `ask`, so a human decides rather than a parser.
 */
export function mcpPermissionsFromRequest(
  request: AgentRunRequest,
): McpPermissionTable {
  const table = new Map<string, McpServerPermissions>();
  for (const server of request.mcpServers ?? []) {
    const name = typeof server?.name === "string" ? server.name : "";
    if (!name) continue;
    const policy = (server.policy ?? {}) as Record<string, unknown>;

    const tools = new Map<string, ToolPermission>();
    const rawTools = policy.toolPermissions;
    if (isRecord(rawTools)) {
      // Own enumerable keys only, so a key the sender inherited never enters the table.
      for (const [tool, permission] of Object.entries(rawTools)) {
        if (!tool.trim() || !isToolPermission(permission)) continue;
        tools.set(tool, permission);
      }
    }

    const declaredNewTool = "newToolPermission" in policy;
    const optedIn = declaredNewTool || isRecord(rawTools);
    let newTool: ToolPermission | undefined;
    if (optedIn) {
      if (isToolPermission(policy.newToolPermission)) {
        newTool = policy.newToolPermission;
      } else {
        newTool = declaredNewTool ? "deny" : "ask";
      }
    }

    table.set(name, {
      ...(isToolPermission(policy.permission)
        ? { server: policy.permission }
        : {}),
      tools,
      ...(newTool !== undefined ? { newTool } : {}),
    });
  }
  return table;
}

/**
 * The decision for one call, given its server's table and the UPSTREAM tool name.
 *
 * A per-tool table is authoritative for its server: once the author wrote one, an unlisted tool
 * gets `newTool` and the lookup stops. It deliberately does NOT fall through to the whole-server
 * permission or to the run default, because a per-tool policy a run default can widen is not a
 * policy — an agent configured `default: "allow"` would otherwise run every tool the author had
 * not got around to listing.
 *
 * With no table, this returns the whole-server permission, or `undefined` so the caller's existing
 * ladder (rules, then the run default) decides exactly as it did before per-tool policy existed.
 */
export function mcpToolPermission(
  entry: McpServerPermissions | undefined,
  tool: string | undefined,
): ToolPermission | undefined {
  if (!entry) return undefined;
  if (entry.newTool === undefined) return entry.server;
  if (tool) {
    const named = entry.tools.get(tool);
    if (named !== undefined) return named;
  }
  return entry.newTool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function shouldSuppressPausedToolCallUpdate(
  update: unknown,
  pause: PendingApprovalPauseController,
): boolean {
  const frame = update as
    | { sessionUpdate?: unknown; toolCallId?: unknown; status?: unknown }
    | undefined;
  const kind = frame?.sessionUpdate;
  if (kind !== "tool_call" && kind !== "tool_call_update") return false;
  const toolCallId =
    typeof frame?.toolCallId === "string" ? frame.toolCallId : undefined;
  // F-024: a paused (gated) tool call's later frames are teardown artifacts and never reach the
  // stream.
  if (pause.isPausedToolCall(toolCallId)) return true;
  // Answered allows and denies both carry authoritative terminal evidence through a sibling pause.
  if (
    kind === "tool_call_update" &&
    pause.active &&
    frame?.status === "failed" &&
    !pause.isAllowedExecution(toolCallId) &&
    !pause.isAnsweredDeny(toolCallId)
  ) {
    return true;
  }
  return false;
}

const CLAUDE_STRICT_DEPLOYMENTS = new Set([
  "custom",
  "bedrock",
  "vertex",
  "vertex_ai",
]);

/**
 * Codex validates the provider block's ``env_key`` before it sends an HTTP request. Gateway
 * routes authenticate with ``X-AG-Credentials`` instead, so provide only a fixed, non-secret
 * selector value—not a provider credential.
 */
export function applyCodexGatewayConnectionEnv(
  env: Record<string, string>,
  request: AgentRunRequest,
  acpAgent: string,
): void {
  if (
    acpAgent !== "codex" ||
    !request.modelConnection?.gatewayCredentials?.value
  )
    return;
  env.OPENAI_API_KEY = GATEWAY_PLACEHOLDER_API_KEY;
}

export function applyClaudeConnectionEnv(
  env: Record<string, string>,
  request: AgentRunRequest,
  acpAgent: string,
  logger: Log,
): void {
  if (acpAgent !== "claude") return;

  // Claude Code discovers the gateway's current stateless MCP interface.
  env.MCP_PROTOCOL_NEGOTIATION = "auto";
  logger("claude MCP protocol negotiation: auto");

  // Disable the Claude Agent SDK's Tool-Search feature for every Claude run. The bundled
  // SDK defaults Tool-Search ON, which makes Claude DEFER the `agenta-tools` MCP tools and
  // call them before their `inputSchema` is loaded — so it emits an empty `input: {}` and
  // tools-with-args (reference workflows, commit_revision) never receive their arguments.
  // Our tool count is small, so deferral buys nothing and only strips the schema. The SDK
  // treats only `false`/`0`/`no`/`off` as off, so the string must be "false" (not "0"/"100").
  // This is applied after `buildDaemonEnv`'s clear and is not in `KNOWN_PROVIDER_ENV_VARS`,
  // so it is never stripped, and it reaches the Daytona sandbox like `ANTHROPIC_BASE_URL`.
  env.ENABLE_TOOL_SEARCH = "false";

  const deployment = request.modelConnection?.deployment;
  const selectedModel = request.model;
  const baseUrl = request.modelConnection?.endpoint?.baseUrl;
  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
    logger(`claude base_url: ${baseUrl}`);
  }

  // Gateway credentials use one `Name: Value` pair per ANTHROPIC_CUSTOM_HEADERS line.
  const gatewayHeaders = materializeGatewayHeaders(request);
  const headerLines = Object.entries(gatewayHeaders)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
  if (headerLines) {
    env.ANTHROPIC_CUSTOM_HEADERS = headerLines;
    // The Anthropic SDK refuses to initialize without a key-shaped value, even when a custom
    // base URL and headers authenticate the request. This is only a fixed selector; the gateway
    // alone reads the real credential carried in ANTHROPIC_CUSTOM_HEADERS.
    env.ANTHROPIC_API_KEY = GATEWAY_PLACEHOLDER_API_KEY;
    logger(
      `claude gateway credentials header: ${request.modelConnection?.gatewayCredentials?.header}`,
    );
  }

  if (deployment === "bedrock") {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    const region = request.modelConnection?.endpoint?.region;
    if (region) {
      env.AWS_REGION = region;
      env.AWS_DEFAULT_REGION ??= region;
    }
  } else if (deployment === "vertex" || deployment === "vertex_ai") {
    env.CLAUDE_CODE_USE_VERTEX = "1";
  }

  if (
    selectedModel &&
    (baseUrl || (deployment && CLAUDE_STRICT_DEPLOYMENTS.has(deployment)))
  ) {
    env.ANTHROPIC_MODEL = selectedModel;
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = selectedModel;
    logger(
      `claude model=${selectedModel} deployment=${deployment ?? "<none>"}`,
    );
  }
}

/**
 * Whether a requested-but-unsettable model fails the run (F-007). Strict by default on every
 * harness path: a user who picks a model either runs that model or sees a loud error, never a
 * silent (often pricier) fallback to the harness default. `AGENTA_AGENT_MODEL_STRICT=false` is
 * the explicit opt-out that restores the legacy warn-and-fallback behavior. A run that requests
 * no model is unaffected either way — it keeps the harness default.
 */
export function modelResolutionStrict(): boolean {
  return process.env.AGENTA_AGENT_MODEL_STRICT !== "false";
}

export async function defaultResolveLocalRunnerOwner(
  sessionId: string,
  authorization: string,
): Promise<{ replicaId: string; ownerReplicaId: string | undefined }> {
  // No credential ⇒ the claim would 401; treat as "no known owner" (pass), never worse than today.
  if (!authorization) {
    return { replicaId: REPLICA_ID, ownerReplicaId: undefined };
  }
  return claimSessionOwnership(sessionId, authorization);
}

export function isTransportEndpointDisconnected(err: unknown): boolean {
  const message = String(err instanceof Error ? err.message : err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  return (
    code === "ENOTCONN" ||
    message.includes("ENOTCONN") ||
    message.includes("Transport endpoint is not connected")
  );
}

export function containsTransportEndpointDisconnected(value: unknown): boolean {
  const seen = new Set<object>();

  const visit = (current: unknown): boolean => {
    if (typeof current === "string") {
      return isTransportEndpointDisconnected(current);
    }
    if (current instanceof Error) {
      return isTransportEndpointDisconnected(current);
    }
    if (!current || typeof current !== "object") {
      return false;
    }
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);

    const code =
      "code" in current ? String((current as { code?: unknown }).code) : "";
    if (code === "ENOTCONN") {
      return true;
    }

    if (Array.isArray(current)) {
      return current.some(visit);
    }
    return Object.values(current as Record<string, unknown>).some(visit);
  };

  return visit(value);
}
