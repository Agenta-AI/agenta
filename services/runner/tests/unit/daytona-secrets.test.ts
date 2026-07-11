import { describe, expect, it, vi } from "vitest";
import { cleanupDaytonaLease, provisionDaytonaSecrets } from "../../src/engines/sandbox_agent/daytona-secrets.ts";
import type { SecretLease } from "../../src/engines/sandbox_agent/secret-lease-control.ts";
function makeLease(state: SecretLease["state"] = "reserved"): SecretLease { return { id: "lease", version: 1, state, owner: { kind: "run", id: "run" }, credentialEpochDigest: "h", sandboxLabel: "agenta.lease_id=lease", resources: [0,1].map((ordinal) => ({ id: `resource-${ordinal}`, version: 1, ordinal, consumer: { kind: "model" }, binding: { kind: "environment", name: `KEY_${ordinal}` }, usage: "opaque_http", allowedHost: "api.example.com", providerSecretName: `name-${ordinal}`, state: "planned" })) }; }
function fakeControl(initial: SecretLease) { let current = structuredClone(initial); return { reserve: vi.fn(), get: vi.fn(async () => current), query: vi.fn(), claim: vi.fn(), mutate: vi.fn(async (_id: string, mutation: any) => { current = { ...current, version: current.version + 1, state: ({ beginProvisioning: "provisioning", requestCleanup: "cleanup_pending", beginCleanup: "cleaning", recordRetry: "cleanup_pending", markDeleted: "deleted" } as any)[mutation.transition] ?? current.state, resources: current.resources.map((r) => { const u = mutation.resourceUpdates?.find((x: any) => x.resourceId === r.id); return u ? { ...r, ...u, version: r.version + 1 } : r; }) }; return current; }) } as any; }
const plan = { environment: {}, candidates: [0,1].map((ordinal) => ({ ordinal, consumer: { kind: "model" as const }, binding: { kind: "environment" as const, name: `KEY_${ordinal}` }, allowedHost: "api.example.com", value: `plaintext-${ordinal}` })) };
describe("Daytona Secret lifecycle", () => {
  it("persists intent before side effects and records provider IDs", async () => {
    const control = fakeControl(makeLease()); const api = { get: vi.fn(), create: vi.fn(async ({ name }: any) => ({ id: `id-${name}`, name, placeholder: `dtn_${name}`, hosts: ["api.example.com"] })), delete: vi.fn() };
    const result = await provisionDaytonaSecrets({ plan, lease: makeLease(), control, api });
    expect(control.mutate.mock.invocationCallOrder[0]).toBeLessThan(api.create.mock.invocationCallOrder[0]);
    expect(result.attachments).toEqual({ KEY_0: "name-0", KEY_1: "name-1" });
    expect(control.mutate.mock.calls[1][1].resourceUpdates[0]).toMatchObject({ providerSecretId: "id-name-0", state: "created" });
  });
  it("compensates provider IDs in reverse order with no plaintext fallback", async () => {
    const control = fakeControl(makeLease()); const deleted: string[] = [];
    const api = { get: vi.fn(), create: vi.fn(async ({ name }: any) => { if (name === "name-1") throw new Error("fault"); return { id: `id-${name}`, name, placeholder: `dtn_${name}`, hosts: ["api.example.com"] }; }), delete: vi.fn(async (id: string) => { deleted.push(id); }) };
    await expect(provisionDaytonaSecrets({ plan, lease: makeLease(), control, api })).rejects.toThrow("fault");
    expect(deleted).toEqual(["id-name-0"]); expect(JSON.stringify(control.mutate.mock.calls)).not.toContain("plaintext-0");
  });
  it("recovers a deterministic Secret after crash-before-CAS conflict", async () => {
    const partial = makeLease("provisioning"); partial.resources = partial.resources.slice(0, 1);
    const control = fakeControl(partial);
    const conflict = Object.assign(new Error("conflict"), { statusCode: 409 });
    const api = { get: vi.fn(), create: vi.fn(async () => { throw conflict; }), list: vi.fn(async () => ({ items: [{ id: "recovered-id", name: "name-0", placeholder: "dtn_recovered", hosts: ["api.example.com"] }], nextCursor: null })), delete: vi.fn() };
    const result = await provisionDaytonaSecrets({ plan: { ...plan, candidates: plan.candidates.slice(0, 1) }, lease: partial, control, api });
    expect(result.attachments).toEqual({ KEY_0: "name-0" });
    expect(control.mutate).toHaveBeenCalledWith("lease", expect.objectContaining({ resourceUpdates: [expect.objectContaining({ providerSecretId: "recovered-id" })] }));
  });

  it("confirms sandbox absence before reverse provider-ID deletion", async () => {
    const inputLease = makeLease("cleanup_pending"); inputLease.sandboxId = "sandbox"; inputLease.resources = inputLease.resources.map((r) => ({ ...r, state: "created", providerSecretId: `id-${r.ordinal}` }));
    const control = fakeControl(inputLease); const events: string[] = [];
    await cleanupDaytonaLease({ lease: inputLease, control, api: { get: vi.fn(), create: vi.fn(), delete: async (id) => { events.push(`secret:${id}`); } }, deleteSandbox: async () => { events.push("sandbox:delete"); }, confirmSandboxAbsent: async () => { events.push("sandbox:absent"); return true; } });
    expect(events).toEqual(["sandbox:delete", "sandbox:absent", "secret:id-1", "secret:id-0"]);
  });
});


describe("Daytona Secret metadata invariants", () => {
  const one = () => { const lease = makeLease(); lease.resources = lease.resources.slice(0, 1); return lease; };
  const onePlan = { ...plan, candidates: plan.candidates.slice(0, 1) };

  it.each([
    ["missing hosts", { id: "id", name: "name-0", placeholder: "dtn" }],
    ["multiple hosts", { id: "id", name: "name-0", placeholder: "dtn", hosts: ["api.example.com", "other.example.com"] }],
    ["wrong host", { id: "id", name: "name-0", placeholder: "dtn", hosts: ["other.example.com"] }],
    ["wrong deterministic name", { id: "id", name: "wrong", placeholder: "dtn", hosts: ["api.example.com"] }],
  ])("fails closed when create returns %s", async (_label, record) => {
    const control = fakeControl(one());
    const api = { get: vi.fn(), create: vi.fn(async () => record), delete: vi.fn() };
    await expect(provisionDaytonaSecrets({ plan: onePlan, lease: one(), control, api })).rejects.toThrow(/unexpected/);
    expect(api.delete).toHaveBeenCalledWith("id");
  });

  it("fails closed when an existing created resource has wrong host metadata", async () => {
    const lease = one(); lease.state = "provisioning"; lease.resources[0] = { ...lease.resources[0], state: "created", providerSecretId: "id" };
    const control = fakeControl(lease);
    const api = { get: vi.fn(async () => ({ id: "id", name: "name-0", placeholder: "dtn", hosts: ["wrong.example.com"] })), create: vi.fn(), delete: vi.fn() };
    await expect(provisionDaytonaSecrets({ plan: onePlan, lease, control, api })).rejects.toThrow("unexpected host restriction");
  });

  it("fails closed when deterministic recovery finds duplicate provider records", async () => {
    const lease = one(); const control = fakeControl(lease);
    const conflict = Object.assign(new Error("conflict"), { statusCode: 409 });
    const record = { id: "id", name: "name-0", placeholder: "dtn", hosts: ["api.example.com"] };
    const api = { get: vi.fn(), create: vi.fn(async () => { throw conflict; }), list: vi.fn(async () => ({ items: [record, { ...record, id: "id-2" }], nextCursor: null })), delete: vi.fn() };
    await expect(provisionDaytonaSecrets({ plan: onePlan, lease, control, api })).rejects.toThrow("multiple provider records");
  });
});
