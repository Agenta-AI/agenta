export const PI_MODEL_PROVIDER_OVERRIDE_ENV =
  "AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE";

export interface PiModelProviderOverride {
  provider: string;
  baseUrl: string;
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

  return { provider, baseUrl };
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
