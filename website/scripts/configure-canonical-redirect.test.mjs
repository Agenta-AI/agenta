import { describe, expect, it, vi } from "vitest";
import {
  RULE_REF,
  canonicalRedirectRule,
  configureCanonicalRedirect,
} from "./configure-canonical-redirect.mjs";

const ok = (result) =>
  new Response(JSON.stringify({ success: true, errors: [], result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("canonical redirect configuration", () => {
  it("uses one permanent redirect that preserves path and query", () => {
    expect(canonicalRedirectRule.expression).toContain('http.host eq "www.agenta.ai"');
    expect(canonicalRedirectRule.expression).toContain("not ssl");
    expect(canonicalRedirectRule.action_parameters.from_value).toEqual({
      target_url: {
        expression: 'concat("https://agenta.ai", http.request.uri.path)',
      },
      status_code: 308,
      preserve_query_string: true,
    });
  });

  it("updates only its stable rule when the phase ruleset exists", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok([{ id: "zone-id" }]))
      .mockResolvedValueOnce(ok({ value: "off" }))
      .mockResolvedValueOnce(
        ok({
          id: "ruleset-id",
          rules: [
            { id: "other-id", ref: "unrelated" },
            { id: "canonical-id", ref: RULE_REF },
          ],
        }),
      )
      .mockResolvedValueOnce(ok({ id: "canonical-id" }));

    await configureCanonicalRedirect({ token: "test", fetchImpl });

    const [url, request] = fetchImpl.mock.calls[3];
    expect(url.endsWith("/zones/zone-id/rulesets/ruleset-id/rules/canonical-id")).toBe(true);
    expect(request.method).toBe("PATCH");
    expect(JSON.parse(request.body)).toEqual({
      ...canonicalRedirectRule,
      position: { before: "" },
    });
  });

  it("adds its rule without replacing existing rules", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok([{ id: "zone-id" }]))
      .mockResolvedValueOnce(ok({ value: "off" }))
      .mockResolvedValueOnce(ok({ id: "ruleset-id", rules: [] }))
      .mockResolvedValueOnce(ok({ id: "canonical-id" }));

    await configureCanonicalRedirect({ token: "test", fetchImpl });

    const [url, request] = fetchImpl.mock.calls[3];
    expect(url.endsWith("/zones/zone-id/rulesets/ruleset-id/rules")).toBe(true);
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({
      ...canonicalRedirectRule,
      position: { before: "" },
    });
  });

  it("rejects the legacy HTTPS redirect to prevent redirect chains", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok([{ id: "zone-id" }]))
      .mockResolvedValueOnce(ok({ value: "on" }));

    await expect(
      configureCanonicalRedirect({ token: "test", fetchImpl }),
    ).rejects.toThrow("Cloudflare Always Use HTTPS must be off");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
