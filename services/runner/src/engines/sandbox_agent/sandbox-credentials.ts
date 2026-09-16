import type { AgentRunRequest } from "../../protocol.ts";

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const RESERVED_SANDBOX_CREDENTIAL_NAMES: ReadonlySet<string> = new Set([
  "PATH", "HOME", "LD_PRELOAD", "NODE_OPTIONS", "PYTHONPATH",
  "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_ACP_PI_COMMAND",
  "CODEX_HOME", "CODEX_SQLITE_HOME", "CLAUDE_CONFIG_DIR",
  "AGENTA_AGENT_TOOLS_RELAY_DIR", "AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE",
  "AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED",
  "AGENTA_AGENT_TELEMETRY_CONTROL_PATH", "AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE",
  "AGENTA_AGENT_BUILTIN_ACTIVATION", "AGENTA_AGENT_BUILTIN_GATING",
  "AGENTA_AGENT_USAGE_CAPTURE_PATH", "ENABLE_TOOL_SEARCH",
]);

const RESERVED_SANDBOX_CREDENTIAL_PREFIXES = [
  "AGENTA_AGENT_", "SANDBOX_AGENT_", "PI_CODING_AGENT_",
] as const;

/**
 * Whether a caller-supplied environment name belongs to the runtime rather than to the caller.
 *
 * M20: this rule was applied to `sandboxCredentials` alone, while `modelConnection.environment`
 * and its credential bindings land in the same process environment and were never screened. The
 * names below are how the runner configures its own harnesses — `AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE`
 * is read by the bundled Pi extension, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` decide where a harness
 * reads its credentials from, `NODE_OPTIONS` and `LD_PRELOAD` decide what code loads at all — so a
 * request that can set them reconfigures the runtime rather than its own model connection.
 */
export function isReservedSandboxEnvironmentName(name: string): boolean {
  return (
    RESERVED_SANDBOX_CREDENTIAL_NAMES.has(name) ||
    RESERVED_SANDBOX_CREDENTIAL_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

export type SandboxCredentialsResult =
  | { ok: true; environment: Record<string, string> }
  | { ok: false; error: string };

export function materializeSandboxCredentials(request: AgentRunRequest): SandboxCredentialsResult {
  const environment: Record<string, string> = {};
  const occupied = new Set<string>([
    ...Object.keys(request.modelConnection?.environment ?? {}),
    ...(request.modelConnection?.credentials ?? []).map((credential) => credential.binding?.name),
  ]);

  for (const credential of request.sandboxCredentials ?? []) {
    const name = credential?.binding?.name;
    if (credential?.binding?.kind !== "environment" || !name) {
      return { ok: false, error: "sandboxCredentials require environment bindings with non-empty names" };
    }
    if (!ENVIRONMENT_NAME.test(name)) {
      return { ok: false, error: `sandboxCredentials binding '${name}' is not a valid environment variable name` };
    }
    if (typeof credential.value !== "string" || credential.value.length === 0) {
      return { ok: false, error: `sandboxCredentials binding '${name}' requires a non-empty value` };
    }
    if (isReservedSandboxEnvironmentName(name)) {
      return { ok: false, error: `sandboxCredentials binding '${name}' is reserved by the runtime` };
    }
    if (occupied.has(name)) {
      return { ok: false, error: `sandboxCredentials binding '${name}' collides with another environment owner` };
    }
    occupied.add(name);
    environment[name] = credential.value;
  }
  return { ok: true, environment };
}
