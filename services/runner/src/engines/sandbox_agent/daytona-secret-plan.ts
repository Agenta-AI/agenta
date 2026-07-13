import { isIP } from "node:net";

import type { McpServerConfig, ModelConnection } from "../../protocol.ts";

export interface DaytonaSecretCandidate {
  ordinal: number;
  consumer: { kind: "model" } | { kind: "http_mcp"; server: string };
  binding: { kind: "environment" | "header"; name: string };
  allowedHost: string;
  value: string;
}

export interface DaytonaSecretPlan {
  candidates: DaytonaSecretCandidate[];
  /** Non-secret config and local-use credentials that Daytona may receive directly. */
  environment: Record<string, string>;
}

const PROHIBITED_BINDINGS = new Set([
  "AGENTA_API_KEY",
  "AGENTA_AUTH_KEY",
  "AGENTA_RUNNER_TOKEN",
  "DAYTONA_API_KEY",
  "DAYTONA_API_URL",
  "OTEL_EXPORTER_OTLP_HEADERS",
]);

// Keep this runner-side boundary aligned with the resolver-owned contract in
// sdks/python/agenta/sdk/agents/connections/endpoints.py. Environment is public config;
// every other provider value must arrive as a typed credential.
const PUBLIC_MODEL_ENVIRONMENT_BINDINGS = new Set([
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
]);

// These credentials must be read locally by the provider SDK and therefore cannot use
// Daytona's outbound HTTP substitution. No opaque provider key belongs in this allowlist.
const LOCAL_USE_MODEL_CREDENTIAL_BINDINGS = new Set([
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "GOOGLE_APPLICATION_CREDENTIALS",
]);

function fail(message: string): never {
  throw new Error(`Invalid Daytona secret plan: ${message}`);
}

function assertBinding(name: string): void {
  if (
    !name ||
    name.includes("=") ||
    name.startsWith("AGENTA_") ||
    name.startsWith("DAYTONA_") ||
    PROHIBITED_BINDINGS.has(name)
  ) {
    fail(`credential binding '${name}' is reserved`);
  }
}

function assertPublicEnvironmentBinding(name: string): void {
  assertBinding(name);
  if (!PUBLIC_MODEL_ENVIRONMENT_BINDINGS.has(name)) {
    fail(
      `model environment binding '${name}' is not approved public config; send credentials through modelConnection.credentials`,
    );
  }
}

function assertLocalUseBinding(name: string): void {
  assertBinding(name);
  if (!LOCAL_USE_MODEL_CREDENTIAL_BINDINGS.has(name)) {
    fail(
      `local_use credential binding '${name}' is not approved for local provider-SDK use`,
    );
  }
}

/** Return the exact HTTPS hostname accepted by Daytona's outbound Secret restriction. */
export function exactHttpsHost(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("credential endpoint is not a valid URL");
  }
  if (url.protocol !== "https:") fail("credential endpoint must use HTTPS");
  if (url.username || url.password || url.hash) {
    fail("credential endpoint contains prohibited URL components");
  }
  if (url.port && url.port !== "443") {
    fail("explicit non-default ports are not supported");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipCandidate =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home") ||
    host.endsWith(".lan") ||
    host.includes("*")
  ) {
    fail("credential endpoint host is prohibited");
  }
  // Daytona host restrictions are DNS names. Reject every literal, including public IPv4 and
  // bracketed IPv6, so an author cannot bypass hostname-scoped substitution with a raw address.
  if (isIP(ipCandidate) !== 0) {
    fail(
      "credential endpoint must use a public DNS hostname, not an IP literal",
    );
  }
  const labels = host.split(".");
  if (
    host.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    fail("credential endpoint must use a normalized fully qualified DNS name");
  }
  return host;
}

/** Split remote opaque credentials from values that remain safe to pass directly at create. */
export function buildDaytonaSecretPlan(input: {
  modelConnection?: ModelConnection;
  mcpServers?: McpServerConfig[];
}): DaytonaSecretPlan {
  const environment: Record<string, string> = {};
  const candidates: DaytonaSecretCandidate[] = [];
  const seen = new Set<string>();
  const directBindings = new Set<string>();

  for (const [name, value] of Object.entries(
    input.modelConnection?.environment ?? {},
  )) {
    assertPublicEnvironmentBinding(name);
    if (!value) fail(`model environment binding '${name}' is empty`);
    const normalized = name.toLowerCase();
    if (directBindings.has(normalized)) {
      fail(`duplicate direct environment binding '${name}'`);
    }
    directBindings.add(normalized);
    environment[name] = value;
  }

  const add = (candidate: Omit<DaytonaSecretCandidate, "ordinal">): void => {
    assertBinding(candidate.binding.name);
    const consumerKey =
      candidate.consumer.kind === "model" ? "model" : candidate.consumer.server;
    const key = `${candidate.consumer.kind}:${consumerKey}:${candidate.binding.kind}:${candidate.binding.name.toLowerCase()}`;
    if (seen.has(key)) {
      fail(`duplicate credential binding '${candidate.binding.name}'`);
    }
    seen.add(key);
    candidates.push({ ...candidate, ordinal: candidates.length });
  };

  const connection = input.modelConnection;
  if (connection) {
    const opaqueCredentials = (connection.credentials ?? []).filter(
      (credential) => credential.usage === "opaque_http",
    );
    const host =
      opaqueCredentials.length > 0 && connection.endpoint?.baseUrl
        ? exactHttpsHost(connection.endpoint.baseUrl)
        : undefined;
    for (const credential of connection.credentials ?? []) {
      if (credential.usage === "local_use") {
        assertLocalUseBinding(credential.binding.name);
        const normalized = credential.binding.name.toLowerCase();
        if (directBindings.has(normalized)) {
          fail(
            `duplicate direct environment binding '${credential.binding.name}'`,
          );
        }
        directBindings.add(normalized);
        environment[credential.binding.name] = credential.value;
        continue;
      }
      if (!host) {
        fail(
          "opaque model credentials require endpoint.baseUrl for exact-host restriction",
        );
      }
      add({
        consumer: { kind: "model" },
        binding: credential.binding,
        allowedHost: host,
        value: credential.value,
      });
    }
  }

  for (const server of input.mcpServers ?? []) {
    const hasHeaders =
      Object.keys(server.headers ?? {}).length > 0 ||
      (server.credentials?.length ?? 0) > 0;
    if (
      hasHeaders &&
      ((server.transport ?? "stdio") !== "http" || !server.url)
    ) {
      fail(
        `headers on MCP server '${server.name}' require HTTP transport and URL`,
      );
    }
    const host = hasHeaders ? exactHttpsHost(server.url!) : undefined;
    for (const [name, value] of Object.entries(server.headers ?? {})) {
      if (!name.trim() || !value) {
        fail(
          `HTTP MCP header on server '${server.name}' requires a non-empty name and value`,
        );
      }
      add({
        consumer: { kind: "http_mcp", server: server.name },
        binding: { kind: "header", name },
        allowedHost: host!,
        value,
      });
    }
    for (const credential of server.credentials ?? []) {
      if (credential.usage !== "opaque_http") {
        fail("HTTP MCP credentials must use opaque_http");
      }
      add({
        consumer: { kind: "http_mcp", server: server.name },
        binding: credential.binding,
        allowedHost: host!,
        value: credential.value,
      });
    }
  }

  return { candidates, environment };
}

export function daytonaOpaqueSecretsEnabled(
  value: string | undefined = process.env.AGENTA_DAYTONA_OPAQUE_SECRETS,
): boolean {
  return value === "process_local";
}

export function assertDaytonaOpaqueSecretsEnabled(
  plan: DaytonaSecretPlan,
  value?: string,
): void {
  if (plan.candidates.length > 0 && !daytonaOpaqueSecretsEnabled(value)) {
    throw new Error(
      "Daytona opaque credentials are disabled. Set " +
        "AGENTA_DAYTONA_OPAQUE_SECRETS=process_local to enable process-local Secret cleanup; " +
        "plaintext fallback is not allowed.",
    );
  }
}
