import { createHmac } from "node:crypto";
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

function fail(message: string): never {
  throw new Error(`Invalid Daytona secret plan: ${message}`);
}

function assertBinding(name: string): void {
  if (!name || name.includes("=") || name.startsWith("AGENTA_") || name.startsWith("DAYTONA_") || PROHIBITED_BINDINGS.has(name)) {
    fail(`credential binding '${name}' is reserved`);
  }
}

function privateIpv4(host: string): boolean {
  const [a, b] = host.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 2 || b === 88 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Return the exact HTTPS hostname accepted by Daytona's host restriction. */
export function exactHttpsHost(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("credential endpoint is not a valid URL");
  }
  if (url.protocol !== "https:") fail("credential endpoint must use HTTPS");
  if (url.username || url.password || url.hash) fail("credential endpoint contains prohibited URL components");
  if (url.port && url.port !== "443") fail("explicit non-default ports are not supported");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.includes("*")) {
    fail("credential endpoint host is prohibited");
  }
  const ipVersion = isIP(host);
  if ((ipVersion === 4 && privateIpv4(host)) || ipVersion === 6) {
    fail("credential endpoint must not be a private, reserved, or IPv6 literal");
  }
  return host;
}

/** Split remote opaque credentials from environment values safe to pass directly at create. */
export function buildDaytonaSecretPlan(input: {
  modelConnection?: ModelConnection;
  mcpServers?: McpServerConfig[];
}): DaytonaSecretPlan {
  const environment: Record<string, string> = { ...(input.modelConnection?.environment ?? {}) };
  const candidates: DaytonaSecretCandidate[] = [];
  const seen = new Set<string>();

  const add = (candidate: Omit<DaytonaSecretCandidate, "ordinal">): void => {
    assertBinding(candidate.binding.name);
    const key = `${candidate.consumer.kind}:${"server" in candidate.consumer ? candidate.consumer.server : ""}:${candidate.binding.kind}:${candidate.binding.name}`;
    if (seen.has(key)) fail(`duplicate credential binding '${candidate.binding.name}'`);
    seen.add(key);
    candidates.push({ ...candidate, ordinal: candidates.length });
  };

  const connection = input.modelConnection;
  if (connection) {
    const host = connection.endpoint?.baseUrl ? exactHttpsHost(connection.endpoint.baseUrl) : undefined;
    for (const credential of connection.credentials ?? []) {
      if (credential.usage === "local_use") {
        assertBinding(credential.binding.name);
        environment[credential.binding.name] = credential.value;
        continue;
      }
      if (!host) fail("opaque model credentials require endpoint.baseUrl for exact-host restriction");
      add({ consumer: { kind: "model" }, binding: credential.binding, allowedHost: host, value: credential.value });
    }
  }

  for (const server of input.mcpServers ?? []) {
    for (const credential of server.credentials ?? []) {
      if (credential.usage !== "opaque_http") fail("HTTP MCP credentials must use opaque_http");
      if ((server.transport ?? "stdio") !== "http" || !server.url) {
        fail(`credential on MCP server '${server.name}' requires HTTP transport and URL`);
      }
      add({
        consumer: { kind: "http_mcp", server: server.name },
        binding: credential.binding,
        allowedHost: exactHttpsHost(server.url),
        value: credential.value,
      });
    }
  }
  return { candidates, environment };
}

/** Non-reversible version marker; values never enter labels, lease records, or logs. */
export function credentialEpochHmac(plan: DaytonaSecretPlan, key: string): string {
  if (Buffer.byteLength(key) < 32) fail("credential epoch HMAC key must contain at least 32 bytes");
  const canonical = [...plan.candidates]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((candidate) => [candidate.consumer, candidate.binding, candidate.allowedHost, candidate.value]);
  return `hmac-sha256:${createHmac("sha256", key).update(JSON.stringify(canonical)).digest("hex")}`;
}


/** Metadata-only reservation rows. This is the only plan projection allowed across control auth. */
export function daytonaLeaseResources(plan: DaytonaSecretPlan) {
  return plan.candidates.map((candidate) => ({
    consumer: candidate.consumer.kind === "model" ? { kind: "model" as const } : { kind: "http_mcp" as const, key: candidate.consumer.server },
    binding: candidate.binding,
    usage: "opaque_http" as const,
    allowedHost: candidate.allowedHost,
  }));
}
