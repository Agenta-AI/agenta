/**
 * Whether a run's model is served through the user's own model connection, so its model spans
 * carry CUSTOM_CONNECTION and the platform does not price them from the public price list.
 *
 * `deployment: "custom"` is not the only such case. A vault custom-provider record that names a
 * known provider family (an "openai"-kind record with its own base URL) resolves to
 * `deployment: "direct"` (`sdks/python/agenta/sdk/agents/platform/connections.py`), so the
 * route is what tells it apart:
 *   - through the Agenta LLM gateway, a custom record routes via `/gateways/llms/custom/{slug}`
 *     and a provider key via `/gateways/llms/standard/{provider}` (`gateway_target`);
 *   - without the gateway, a provider key carries the family's registered direct base URL
 *     (`_DIRECT_ENDPOINTS` in `sdks/python/agenta/sdk/agents/connections/endpoints.py`, which
 *     this table mirrors), and any other base URL is the record's own.
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
    "provider" | "deployment" | "endpoint" | "gatewayCredentials"
  >,
): boolean {
  if (!connection) return false;
  const deployment = connection.deployment?.trim().toLowerCase();
  if (deployment === "custom") return true;
  if (deployment !== "direct") return false;

  const baseUrl = connection.endpoint?.baseUrl?.trim();
  if (!baseUrl) return false;
  const url = parseUrl(baseUrl);
  // An unparseable explicit URL is not a registered provider base, so it is the record's own.
  if (!url) return true;

  if (connection.gatewayCredentials) {
    const namespace = gatewayNamespace(url);
    if (namespace) return namespace === "custom";
  }

  const canonical =
    DIRECT_BASE_URLS[connection.provider?.trim().toLowerCase() ?? ""];
  return !canonical || !sameBase(url, canonical);
}
