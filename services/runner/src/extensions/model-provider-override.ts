export const PI_MODEL_PROVIDER_OVERRIDE_ENV =
  "AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE";

/** Never a secret; see `PiModelProviderOverride.apiKey`. */
export const PI_GATEWAY_PLACEHOLDER_API_KEY = "agenta-gateway";

export interface PiModelProviderOverride {
  provider: string;
  baseUrl: string;
  /**
   * OUR gateway credential (D31/W1), keyed by header name. Present only on a gateway-routed
   * connection. Unlike `models.json`'s `$ENV` indirection, this rides the raw value directly:
   * the payload travels through a runner-set env var the extension reads at startup, never a
   * file on disk, the same delivery `ANTHROPIC_CUSTOM_HEADERS` already uses for Claude.
   */
  headers?: Record<string, string>;
  /**
   * A non-secret placeholder, present only alongside `headers`. A gateway route's credentialMode
   * is "none" — no provider key exists anywhere in this run's environment, and Pi's own built-in
   * credential state for the overridden provider must not be assumed present either (a gateway
   * run's Pi agent dir carries no seeded auth.json) — so without SOME `apiKey` Pi may treat the
   * model as unavailable for selection (bundled Pi `docs/models.md`, Value Resolution: "if no
   * auth is configured, the models load but stay unavailable"). The real auth rides `headers`;
   * this literal is never a value anything downstream reads.
   */
  apiKey?: string;
}

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Validate the public routing config shared by the runner and the in-Pi extension. */
export function validatePiModelProviderOverride(
  value: unknown,
): PiModelProviderOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("model provider override must be an object");
  }

  const provider = (value as { provider?: unknown }).provider;
  if (typeof provider !== "string" || !PROVIDER_ID.test(provider)) {
    throw new Error("model provider override has an invalid provider");
  }

  const baseUrl = (value as { baseUrl?: unknown }).baseUrl;
  if (typeof baseUrl !== "string" || baseUrl.trim() !== baseUrl) {
    throw new Error("model provider override has an invalid baseUrl");
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("model provider override baseUrl must be a valid URL");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "model provider override baseUrl must be an HTTPS URL without credentials, query, or fragment",
    );
  }

  const rawHeaders = (value as { headers?: unknown }).headers;
  let headers: Record<string, string> | undefined;
  if (rawHeaders !== undefined) {
    if (
      !rawHeaders ||
      typeof rawHeaders !== "object" ||
      Array.isArray(rawHeaders)
    ) {
      throw new Error("model provider override headers must be an object");
    }
    headers = {};
    for (const [name, headerValue] of Object.entries(
      rawHeaders as Record<string, unknown>,
    )) {
      if (!name.trim() || typeof headerValue !== "string" || !headerValue) {
        throw new Error(
          "model provider override headers require non-empty names and values",
        );
      }
      headers[name] = headerValue;
    }
  }

  const rawApiKey = (value as { apiKey?: unknown }).apiKey;
  let apiKey: string | undefined;
  if (rawApiKey !== undefined) {
    if (typeof rawApiKey !== "string" || !rawApiKey) {
      throw new Error("model provider override apiKey must be a non-empty string");
    }
    apiKey = rawApiKey;
  }

  return {
    provider,
    baseUrl,
    ...(headers ? { headers } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

export function encodePiModelProviderOverride(value: unknown): string {
  return JSON.stringify(validatePiModelProviderOverride(value));
}

export function decodePiModelProviderOverride(
  raw: string,
): PiModelProviderOverride {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("model provider override must be valid JSON");
  }
  return validatePiModelProviderOverride(parsed);
}
