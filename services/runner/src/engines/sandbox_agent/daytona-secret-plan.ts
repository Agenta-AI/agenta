import { isIP } from "node:net";

import type { McpServerConfig, ModelConnection } from "../../protocol.ts";
import {
  slotKey,
  type CredentialSlot,
  type CredentialSlotKey,
} from "../../providers/credential-delivery-port.ts";

/**
 * One credential that QUALIFIES to be hidden behind a Daytona Secret, before any Secret record
 * exists.
 *
 * "Candidate" rather than "secret" because this object is the output of a pure decision and the
 * input to a side effect. Building it decides, from the request alone, that a value can be
 * hidden: nothing is created, nothing is called, and the same request always produces the same
 * list. The provider then takes each candidate and actually creates the Daytona Secret record,
 * which can fail, needs cleanup, and turns the candidate into a real `dtn_secret_<id>`
 * placeholder. Keeping the two apart is what makes the decision unit-testable without a Daytona
 * account, and what would let a caller build the same plan and simply not act on it.
 */
export interface DaytonaSecretCandidate {
  /**
   * Position in the plan, assigned in build order. It is the stable name each MCP candidate gets
   * in the sandbox (`AGENTA_MCP_SECRET_<n>`), so the same request always produces the same
   * variable names and a warm sandbox can be compared against a new request field by field.
   */
  ordinal: number;
  /**
   * WHO reads this credential. Two consumers exist today because two things in a run hold
   * credentials: the model, and each HTTP MCP server (named, because a run can attach several
   * and each has its own key). This is the field that was missing from the old flat `secrets`
   * map, and without it the runner could not tell which host a given key was allowed to reach,
   * which is what a Daytona Secret restriction requires.
   */
  consumer: { kind: "model" } | { kind: "http_mcp"; server: string };
  /**
   * WHERE the value lands in the sandbox. `environment` for a model key (harnesses read provider
   * keys from environment variables); `header` for an MCP credential (an HTTP MCP server reads
   * its key from a request header). These are the only two delivery points that exist in the
   * run today, and they follow from the two consumers above rather than being an open set.
   */
  binding: { kind: "environment" | "header"; name: string };
  /**
   * The single DNS hostname this credential may be substituted into, e.g. `api.openai.com`.
   *
   * It cannot be a wildcard and cannot be omitted, and that is the point of the whole feature.
   * Daytona substitutes the real value into an outbound request only when the request goes to
   * this exact host; anywhere else the agent sends the placeholder instead. A wildcard, or an
   * unknown host, would mean the agent could exfiltrate the real key by making one request to a
   * server it controls, which is the attack this exists to prevent.
   *
   * It is always knowable in practice because a credential only qualifies as `opaque_http` when
   * we already know the endpoint it authenticates against: the model connection carries
   * `endpoint.baseUrl`, and an MCP server carries its own `url`. A credential whose destination
   * we do not know is not hideable at all, and `buildDaytonaSecretPlan` rejects the run rather
   * than guessing (see the `opaque model credentials require endpoint.baseUrl` failure).
   */
  allowedHost: string;
  value: string;
}

export interface DaytonaSecretPlan {
  candidates: DaytonaSecretCandidate[];
  /** Non-secret config and local-use credentials that Daytona may receive directly. */
  environment: Record<string, string>;
}

/**
 * The candidate's identity in the credential-delivery vocabulary, WITHOUT its value.
 *
 * One vocabulary across the create-time and delivery-time paths (`CredentialSlot` says so by
 * name). This is the only place the two consumer spellings are reconciled: the plan calls an MCP
 * consumer `http_mcp` because that is the transport it qualified, and the port calls it `mcp`
 * because delivery does not care about the transport. Deriving delivery slots anywhere else would
 * let the create-time and delivery-time keys drift, and a drifted key means a rotation silently
 * updates nothing.
 */
export function credentialSlotFor(
  candidate: DaytonaSecretCandidate,
): CredentialSlot {
  return {
    consumer:
      candidate.consumer.kind === "model"
        ? { kind: "model" }
        : { kind: "mcp", server: candidate.consumer.server },
    binding: candidate.binding,
    allowedHost: candidate.allowedHost,
  };
}

/** The plan's slot identities, sorted. The create-time half of the slot-set comparison. */
export function planSlotKeys(plan: DaytonaSecretPlan): CredentialSlotKey[] {
  return plan.candidates.map((c) => slotKey(credentialSlotFor(c))).sort();
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
//
// Kept (WP13 Phase 3): the gateway-routed vault resolver never emits a `local_use` credential
// any more (`platform/connections.py` `_resolve_from_secrets` discards `env` after a fail-loud
// check and routes even Bedrock/Vertex through the gateway) — the offline standalone-SDK
// resolvers (`connections/resolver.py`) still do, and this allowlist is theirs.
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
    // A model credential and a direct environment binding land in ONE create request as
    // `secrets` and `envVars` respectively; a shared name would leave precedence to Daytona.
    // (MCP candidates attach under generated AGENTA_MCP_SECRET_<n> names, so only the model
    // consumer can collide.)
    if (
      candidate.consumer.kind === "model" &&
      directBindings.has(candidate.binding.name.toLowerCase())
    ) {
      fail(
        `credential binding '${candidate.binding.name}' collides with a direct environment binding`,
      );
    }
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
    // Two passes: settle every direct (local_use) binding first, so the collision check in
    // `add` sees the complete direct set regardless of credential order on the wire.
    for (const credential of connection.credentials ?? []) {
      if (credential.usage !== "local_use") continue;
      assertLocalUseBinding(credential.binding.name);
      const normalized = credential.binding.name.toLowerCase();
      if (directBindings.has(normalized)) {
        fail(
          `duplicate direct environment binding '${credential.binding.name}'`,
        );
      }
      directBindings.add(normalized);
      environment[credential.binding.name] = credential.value;
    }
    for (const credential of connection.credentials ?? []) {
      if (credential.usage === "local_use") continue;
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
    const headers = server.connection?.headers ?? {};
    const credentials = server.connection?.credentials ?? [];
    const hasHeaders =
      Object.keys(headers).length > 0 || credentials.length > 0;
    if (hasHeaders && !server.connection?.url) {
      fail(`headers on MCP server '${server.name}' require a URL`);
    }
    const host = hasHeaders
      ? exactHttpsHost(server.connection!.url)
      : undefined;
    for (const [name, value] of Object.entries(headers)) {
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
    for (const credential of credentials) {
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

/** The values that turn credential hiding OFF. Everything else leaves it on. */
const OPAQUE_SECRETS_OFF_VALUES = new Set([
  "off",
  "false",
  "0",
  "no",
  "disabled",
  "plaintext",
]);

/**
 * Whether a Daytona run hides its model and MCP keys behind Daytona Secrets.
 *
 * **On by default.** An operator who does nothing gets the protected behavior, and the variable
 * exists only to turn it off. The reasoning is that the unprotected path is the one that needs a
 * deliberate choice: leaving keys readable inside a sandbox that runs model-written code is the
 * surprising option, so it should be the one someone has to ask for in writing.
 *
 * Unrecognized values leave hiding ON rather than off. A typo in this variable then fails safe:
 * the operator keeps the protection they would have had by doing nothing, instead of silently
 * losing it. `process_local` is still accepted and still names the cleanup guarantee (the runner
 * tracks the Secret records it created in its own memory), so it stays meaningful as more modes
 * arrive.
 *
 * Note the operational consequence of the default: the runner's Daytona API key now needs
 * permission to manage Secrets on every deployment that uses Daytona, not only on ones that
 * opted in. See `DAYTONA_SECRETS_PERMISSION_MESSAGE` in `daytona-secrets.ts` for what an
 * under-permissioned key looks like, and the upgrade note in the configuration reference.
 */
export function daytonaOpaqueSecretsEnabled(
  value: string | undefined = process.env.AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS,
): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return !OPAQUE_SECRETS_OFF_VALUES.has(normalized);
}

export function assertDaytonaOpaqueSecretsEnabled(
  plan: DaytonaSecretPlan,
  value?: string,
): void {
  if (plan.candidates.length > 0 && !daytonaOpaqueSecretsEnabled(value)) {
    throw new Error(
      "Daytona credential hiding is switched off, but this run has credentials that would " +
        "have been hidden. Unset AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS to restore the default " +
        "(hide them behind Daytona Secrets); there is no plaintext fallback.",
    );
  }
}
