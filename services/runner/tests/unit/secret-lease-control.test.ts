import { describe, expect, it, vi } from "vitest";
import { HttpSecretLeaseControl, SecretLeaseControlError } from "../../src/engines/sandbox_agent/secret-lease-control.ts";

describe("lease control client", () => {
  it("keeps tenant Authorization distinct and sends metadata-only reserve", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "l" }), { status: 200 }));
    const client = new HttpSecretLeaseControl({ baseUrl: "https://control.example", tenantAuthorization: "Secret caller", fetch: fetch as any });
    await client.reserve({ owner: { kind: "run", id: "r" }, idempotencyKey: "i", credentialEpochDigest: "h", resources: [] });
    const [, init] = (fetch.mock.calls as any[][])[0];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("tenantId");
    expect(init.headers).toMatchObject({ authorization: "Secret caller" });
    expect(init.headers).not.toHaveProperty("x-agenta-runner-control-token");
  });

  it("uses the dedicated janitor header, windowing body, and claim-only request", async () => {
    const fetch = vi.fn(async (url: URL) => new Response(JSON.stringify(String(url).endsWith("/claim") ? { claimId: "c", claimGeneration: 3, claimExpiresAt: "later" } : { count: 0, leases: [], windowing: {} }), { status: 200 }));
    const client = new HttpSecretLeaseControl({ baseUrl: "https://control.example", controlToken: "janitor-token", fetch: fetch as any });
    await client.query({ provider: "daytona", states: ["cleanup_pending"], windowing: { next: "cursor", limit: 50 } });
    const [, query] = (fetch.mock.calls as any[][])[0];
    expect(query.headers).toMatchObject({ "x-agenta-runner-control-token": "janitor-token" });
    expect(query.headers).not.toHaveProperty("authorization");
    expect(JSON.parse(String(query.body))).toMatchObject({ windowing: { next: "cursor", limit: 50 } });
    const claim = await client.claim("lease", { claimOwner: "runner-1", ttlSeconds: 60 });
    expect(claim).toEqual({ claimId: "c", claimGeneration: 3, claimExpiresAt: "later" });
    expect(JSON.parse(String((fetch.mock.calls as any[][])[1][1].body))).toEqual({ claimOwner: "runner-1", ttlSeconds: 60 });
  });

  it("sends named CAS transitions and sanitizes upstream failures", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = new HttpSecretLeaseControl({ baseUrl: "https://control.example", tenantAuthorization: "x", fetch: fetch as any });
    await client.mutate("l", { expectedVersion: 4, claim: { id: "c", generation: 3 }, transition: "activate", sandboxId: "s" });
    expect(JSON.parse(String((fetch.mock.calls as any[][])[0][1].body))).toEqual({ expectedVersion: 4, claim: { id: "c", generation: 3 }, transition: "activate", sandboxId: "s" });
    const broken = new HttpSecretLeaseControl({ baseUrl: "https://control.example", tenantAuthorization: "x", fetch: vi.fn(async () => { throw new Error("plaintext-secret"); }) as any });
    await expect(broken.get("l")).rejects.toEqual(new SecretLeaseControlError("transport"));
  });
});
