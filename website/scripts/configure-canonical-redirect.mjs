const API = "https://api.cloudflare.com/client/v4";
export const RULE_REF = "agenta_canonical_host_and_protocol";

export const canonicalRedirectRule = {
  ref: RULE_REF,
  description: "Canonicalize agenta.ai to HTTPS without www",
  expression:
    '(http.host eq "www.agenta.ai") or (http.host eq "agenta.ai" and not ssl)',
  action: "redirect",
  action_parameters: {
    from_value: {
      target_url: {
        expression: 'concat("https://agenta.ai", http.request.uri.path)',
      },
      status_code: 308,
      preserve_query_string: true,
    },
  },
  enabled: true,
};

async function api(fetchImpl, token, path, init = {}) {
  const response = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const detail = payload.errors?.map((error) => error.message).join("; ");
    throw new Error(`Cloudflare API ${response.status}: ${detail || "request failed"}`);
  }
  return payload.result;
}

export async function configureCanonicalRedirect({
  token,
  fetchImpl = fetch,
  zoneName = "agenta.ai",
}) {
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required");

  const zones = await api(
    fetchImpl,
    token,
    `/zones?name=${encodeURIComponent(zoneName)}`,
  );
  if (zones.length !== 1) {
    throw new Error(`Expected one Cloudflare zone named ${zoneName}, found ${zones.length}`);
  }
  const zoneId = zones[0].id;
  const phasePath = `/zones/${zoneId}/rulesets/phases/http_request_dynamic_redirect/entrypoint`;

  let ruleset;
  try {
    ruleset = await api(fetchImpl, token, phasePath);
  } catch (error) {
    // Cloudflare returns 404 when this zone has no Single Redirects ruleset yet.
    if (!String(error.message).includes("Cloudflare API 404")) throw error;
    return api(fetchImpl, token, `/zones/${zoneId}/rulesets`, {
      method: "POST",
      body: JSON.stringify({
        name: "Redirect rules",
        description: "Zone-level URL canonicalization and forwarding",
        kind: "zone",
        phase: "http_request_dynamic_redirect",
        rules: [canonicalRedirectRule],
      }),
    });
  }

  const existing = ruleset.rules.find((rule) => rule.ref === RULE_REF);
  const rulesPath = `/zones/${zoneId}/rulesets/${ruleset.id}/rules`;
  if (!existing) {
    return api(fetchImpl, token, rulesPath, {
      method: "POST",
      body: JSON.stringify(canonicalRedirectRule),
    });
  }

  return api(fetchImpl, token, `${rulesPath}/${existing.id}`, {
    method: "PATCH",
    body: JSON.stringify(canonicalRedirectRule),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await configureCanonicalRedirect({ token: process.env.CLOUDFLARE_API_TOKEN });
  console.log("Canonical host and protocol redirect is configured.");
}
