import { describe, expect, it } from "vitest";
import { buildDaytonaSecretPlan, credentialEpochHmac, exactHttpsHost } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
describe("Daytona secret planning", () => {
  it("keeps opaque values out of direct environment while retaining local_use", () => {
    const plan = buildDaytonaSecretPlan({ modelConnection: { provider: "x", deployment: "x", credentialMode: "managed", endpoint: { baseUrl: "https://api.example.com/v1" }, environment: { REGION: "eu" }, credentials: [{ binding: { kind: "environment", name: "MODEL_KEY" }, value: "opaque-secret", usage: "opaque_http" }, { binding: { kind: "environment", name: "LOCAL_SETTING" }, value: "local", usage: "local_use" }] } as any });
    expect(plan.environment).toEqual({ REGION: "eu", LOCAL_SETTING: "local" });
    expect(plan.candidates).toMatchObject([{ allowedHost: "api.example.com", binding: { name: "MODEL_KEY" } }]);
    expect(JSON.stringify(plan.environment)).not.toContain("opaque-secret");
  });
  it.each(["http://api.example.com", "https://localhost/x", "https://127.0.0.1/x", "https://192.0.2.1/x", "https://198.51.100.1/x", "https://203.0.113.1/x", "https://user:x@api.example.com", "https://api.example.com:8443"])("rejects unsafe host %s", (url) => expect(() => exactHttpsHost(url)).toThrow(/Invalid Daytona secret plan/));
  it("excludes control credentials and requires an exact model endpoint", () => {
    expect(() => buildDaytonaSecretPlan({ modelConnection: { provider: "x", deployment: "x", credentialMode: "managed", endpoint: { baseUrl: "https://x.example" }, credentials: [{ binding: { kind: "environment", name: "AGENTA_CUSTOM_SECRET" }, value: "x", usage: "opaque_http" }] } as any })).toThrow(/reserved/);
    expect(() => buildDaytonaSecretPlan({ modelConnection: { provider: "x", deployment: "x", credentialMode: "managed", credentials: [{ binding: { kind: "environment", name: "MODEL_KEY" }, value: "x", usage: "opaque_http" }] } as any })).toThrow(/endpoint\.baseUrl/);
  });
  it("creates a stable keyed epoch without plaintext", () => {
    const plan = buildDaytonaSecretPlan({ modelConnection: { provider: "x", deployment: "x", credentialMode: "managed", endpoint: { baseUrl: "https://x.example" }, credentials: [{ binding: { kind: "environment", name: "MODEL_KEY" }, value: "do-not-persist", usage: "opaque_http" }] } as any });
    const epoch = credentialEpochHmac(plan, "k".repeat(32));
    expect(epoch).toMatch(/^hmac-sha256:[a-f0-9]{64}$/); expect(epoch).not.toContain("do-not-persist");
  });
});
