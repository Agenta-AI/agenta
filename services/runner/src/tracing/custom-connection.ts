/**
 * Whether a run's model is served through the user's own model connection, so its model spans
 * carry CUSTOM_CONNECTION and the platform does not price them from the public price list.
 *
 * The SDK resolver knows which vault record it chose and states it as `customConnection`. When
 * that field is present it decides. URL equality cannot tell a custom-provider record that uses
 * the family's registered base URL (with its own key) from a provider key, so the explicit field
 * is the only reliable signal on that route.
 *
 * Older SDKs omit the field, and the route is the fallback:
 *   - `deployment: "custom"` is always the user's own endpoint;
 *   - through the Agenta LLM gateway, a custom record routes via `/gateways/llms/custom/{slug}`
 *     and a provider key via `/gateways/llms/standard/{provider}` (`gateway_target`). This is
 *     checked for every deployment: a custom record keeps its own deployment (bedrock, azure,
 *     ...) and still routes through the `custom` namespace;
 *   - without the gateway, a `direct` route whose base URL differs from the family's registered
 *     direct base URL (`_DIRECT_ENDPOINTS` in
 *     `sdks/python/agenta/sdk/agents/connections/endpoints.py`, which this table mirrors) is the
 *     record's own. A family with no registered URL is not marked: an unknown URL there says
 *     nothing about the record.
 */
import type { ModelConnection } from "../protocol.ts";

const DIRECT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  mistral: "https://api.mistral.ai/v1",
  mistralai: "https://api.mistral.ai/v1",
  minimax: "https://api.minimax.io/v1",
  groq: "https://api.groq.com/openai/v1",
  together_ai: "https://api.together.xyz/v1",
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
};

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value.trim());
  } catch {
    return undefined;
  }
}

function sameBase(url: URL, canonical: string): boolean {
  const expected = new URL(canonical);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.protocol === expected.protocol &&
    url.host === expected.host &&
    url.pathname.replace(/\/+$/, "") === expected.pathname.replace(/\/+$/, "")
  );
}

/** The gateway namespace (`standard` / `custom`) of a gateway LLM route, if it is one. */
function gatewayNamespace(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter(Boolean);
  for (let i = 0; i + 2 < segments.length; i++) {
    if (segments[i] === "gateways" && segments[i + 1] === "llms") {
      return segments[i + 2];
    }
  }
  return undefined;
}

export function servedByCustomConnection(
  connection?: Pick<
    ModelConnection,
    | "provider"
    | "deployment"
    | "endpoint"
    | "gatewayCredentials"
    | "customConnection"
  >,
): boolean {
  if (!connection) return false;
  if (typeof connection.customConnection === "boolean") {
    return connection.customConnection;
  }
  const deployment = connection.deployment?.trim().toLowerCase();
  if (deployment === "custom") return true;

  const baseUrl = connection.endpoint?.baseUrl?.trim();
  const url = baseUrl ? parseUrl(baseUrl) : undefined;

  // The gateway namespace comes from the record kind, whatever the deployment.
  if (url && connection.gatewayCredentials) {
    const namespace = gatewayNamespace(url);
    if (namespace) return namespace === "custom";
  }

  if (deployment !== "direct" || !baseUrl) return false;
  // An unparseable explicit URL is not a registered provider base, so it is the record's own.
  if (!url) return true;

  const canonical =
    DIRECT_BASE_URLS[connection.provider?.trim().toLowerCase() ?? ""];
  return canonical !== undefined && !sameBase(url, canonical);
}
