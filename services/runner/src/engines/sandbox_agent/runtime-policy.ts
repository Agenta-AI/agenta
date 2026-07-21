import {
  type AgentRunRequest,
  type ToolPermission,
} from "../../protocol.ts";
import { claimSessionOwnership, REPLICA_ID } from "../../sessions/alive.ts";
import { PendingApprovalPauseController } from "./pause.ts";

type Log = (message: string) => void;

/** Extract the run credential from the OTLP export headers (initial value, constant for the run). */
export function runCredential(request: AgentRunRequest): string {
  const headers = (request.telemetry?.exporters?.otlp?.headers ?? {}) as Record<
    string,
    string
  >;
  return (headers["authorization"] ?? headers["Authorization"] ?? "").trim();
}

export function serverPermissionsFromRequest(
  request: AgentRunRequest,
): ReadonlyMap<string, ToolPermission> {
  const permissions = new Map<string, ToolPermission>();
  for (const server of request.mcpServers ?? []) {
    if (server.policy?.permission !== undefined) {
      permissions.set(server.name, server.policy.permission);
    }
  }
  return permissions;
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
  return pause.isPausedToolCall(toolCallId);
}

const CLAUDE_STRICT_DEPLOYMENTS = new Set([
  "custom",
  "bedrock",
  "vertex",
  "vertex_ai",
]);

export function applyClaudeConnectionEnv(
  env: Record<string, string>,
  request: AgentRunRequest,
  acpAgent: string,
  logger: Log,
): void {
  if (acpAgent !== "claude") return;

  // Disable the Claude Agent SDK's Tool-Search feature for every Claude run. The bundled
  // SDK defaults Tool-Search ON, which makes Claude DEFER the `agenta-tools` MCP tools and
  // call them before their `inputSchema` is loaded — so it emits an empty `input: {}` and
  // tools-with-args (reference workflows, commit_revision) never receive their arguments.
  // Our tool count is small, so deferral buys nothing and only strips the schema. The SDK
  // treats only `false`/`0`/`no`/`off` as off, so the string must be "false" (not "0"/"100").
  // This is applied after `buildDaemonEnv`'s clear and is not in `KNOWN_PROVIDER_ENV_VARS`,
  // so it is never stripped, and it reaches the Daytona sandbox like `ANTHROPIC_BASE_URL`.
  env.ENABLE_TOOL_SEARCH = "false";

  const deployment = request.deployment;
  const selectedModel = request.model;
  const baseUrl = request.endpoint?.baseUrl;
  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
    logger(`claude base_url: ${baseUrl}`);
  }

  if (deployment === "bedrock") {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    const region = request.endpoint?.region;
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
