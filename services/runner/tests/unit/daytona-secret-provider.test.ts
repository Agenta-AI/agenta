import { describe, expect, it, vi } from "vitest";
import { createDaytonaSecretLeaseRuntime, daytonaWithSecretLease } from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
describe("lease-aware provider", () => {
  it("attaches names and preserves reconnect/pause forwarding", async () => {
    const events: string[] = []; const runtime = { prepare: async () => ({ lease: {} as any, attachments: { MODEL_KEY: "secret-name" }, mcpHeaderPlaceholders: {} }), prepareForCreate: async () => ({ lease: {} as any, attachments: { MODEL_KEY: "secret-name" }, mcpHeaderPlaceholders: {} }), activate: async () => { events.push("activate"); }, compensate: vi.fn(), cleanup: vi.fn(), currentMcpHeaderPlaceholders: () => ({}) };
    const provider = daytonaWithSecretLease((attachments) => ({ create: async () => { events.push(JSON.stringify(attachments)); return "sandbox"; }, reconnect: async () => { events.push("reconnect"); }, pause: async () => { events.push("pause"); } } as any), runtime);
    await provider.create(); await (provider.reconnect as any)("sandbox"); await (provider.pause as any)("sandbox");
    expect(events).toEqual(['{"MODEL_KEY":"secret-name"}', "activate", "reconnect", "pause"]);
  });
  it("surfaces activation plus incomplete compensation", async () => {
    const provider = daytonaWithSecretLease(() => ({ create: async () => "sandbox", destroy: async () => { throw new Error("delete-fault"); } }), { prepare: async () => ({ lease: {} as any, attachments: {}, mcpHeaderPlaceholders: {} }), prepareForCreate: async () => ({ lease: {} as any, attachments: {}, mcpHeaderPlaceholders: {} }), activate: async () => { throw new Error("activation-fault"); }, compensate: async () => { throw new Error("cleanup-fault"); }, cleanup: vi.fn(), currentMcpHeaderPlaceholders: () => ({}) });
    await expect(provider.create()).rejects.toBeInstanceOf(AggregateError);
  });
});


describe("durable lease convergence", () => {
  const base = { id: "old", version: 1, state: "active", owner: { kind: "session", id: "session" }, credentialEpochDigest: "epoch-old", sandboxId: "sandbox-old", sandboxLabel: "label", resources: [] } as any;
  const input = (control: any) => ({ plan: { candidates: [], environment: {} }, reservation: { owner: { kind: "session" as const, id: "session" }, idempotencyKey: "daytona-secret:session:session", credentialEpochDigest: "epoch-new", resources: [] }, control, api: { get: vi.fn(), create: vi.fn(), delete: vi.fn(), list: vi.fn() }, deleteSandbox: vi.fn(), confirmSandboxAbsent: vi.fn(async () => true) });

  it("reuses exactly one same-epoch active lease without reserving", async () => {
    const active = { ...base, credentialEpochDigest: "epoch-new" };
    const control: any = { query: vi.fn(async () => ({ count: 1, leases: [active], windowing: {} })), reserve: vi.fn(), mutate: vi.fn() };
    const prepared = await createDaytonaSecretLeaseRuntime(input(control)).prepare();
    expect(prepared.lease.id).toBe("old");
    expect(control.reserve).not.toHaveBeenCalled();
  });

  it("resumes a same-epoch provisioning attempt instead of creating another lease", async () => {
    const provisioning = { ...base, state: "provisioning", credentialEpochDigest: "epoch-new", sandboxId: undefined };
    const control: any = { query: vi.fn(async () => ({ count: 1, leases: [provisioning], windowing: {} })), reserve: vi.fn(), mutate: vi.fn(async (_id: string, mutation: any) => ({ ...provisioning, version: provisioning.version + 1, state: mutation.transition === "beginProvisioning" ? "provisioning" : provisioning.state })) };
    await createDaytonaSecretLeaseRuntime(input(control)).prepare();
    expect(control.reserve).not.toHaveBeenCalled();
    expect(control.mutate).toHaveBeenCalledWith("old", expect.objectContaining({ transition: "beginProvisioning" }));
  });

  it("cleans a rotated active lease before reserving a durable next attempt", async () => {
    const events: string[] = [];
    const fresh = { ...base, id: "new", state: "reserved", credentialEpochDigest: "epoch-new", sandboxId: undefined, version: 1 };
    let old = base;
    const control: any = {
      query: vi.fn(async () => ({ count: 1, leases: [base], windowing: {} })),
      reserve: vi.fn(async (reservation: any) => { events.push(`reserve:${reservation.idempotencyKey}`); return fresh; }),
      mutate: vi.fn(async (id: string, mutation: any) => {
        events.push(`${id}:${mutation.transition}`);
        if (id === "new") return { ...fresh, version: fresh.version + 1, state: "provisioning" };
        const state = mutation.transition === "requestCleanup" ? "cleanup_pending" : mutation.transition === "beginCleanup" ? "cleaning" : mutation.transition === "markDeleted" ? "deleted" : old.state;
        old = { ...old, version: old.version + 1, state }; return old;
      }),
    };
    const options = input(control); (options.deleteSandbox as any).mockImplementation(async () => { events.push("sandbox:delete"); });
    await createDaytonaSecretLeaseRuntime(options).prepare();
    expect(events.indexOf("old:requestCleanup")).toBeLessThan(events.findIndex((event) => event.startsWith("reserve:")));
    expect(events.indexOf("sandbox:delete")).toBeLessThan(events.findIndex((event) => event.startsWith("reserve:")));
    expect(control.reserve.mock.calls[0][0].idempotencyKey).not.toBe("daytona-secret:session:session");
  });
});


describe("reconnect fallback safety", () => {
  const base = { id: "old", version: 1, state: "active", owner: { kind: "session", id: "session" }, credentialEpochDigest: "epoch-old", sandboxId: "sandbox-old", sandboxLabel: "label", resources: [] } as any;
  const input = (control: any) => ({ plan: { candidates: [], environment: {} }, reservation: { owner: { kind: "session" as const, id: "session" }, idempotencyKey: "daytona-secret:session:session", credentialEpochDigest: "epoch-new", resources: [] }, control, api: { get: vi.fn(), create: vi.fn(), delete: vi.fn(), list: vi.fn() }, deleteSandbox: vi.fn(), confirmSandboxAbsent: vi.fn(async () => true) });

it("retires an unreconnected active lease before creating and activating a fresh sandbox", async () => {
  const events: string[] = [];
  const resource = { id: "old-resource", version: 1, ordinal: 0, consumer: { kind: "model" }, binding: { kind: "environment", name: "MODEL_KEY" }, usage: "opaque_http", allowedHost: "api.example.com", providerSecretName: "old-name", providerSecretId: "old-secret", state: "created" };
  let old: any = { id: "old", version: 1, state: "active", owner: { kind: "session", id: "session" }, credentialEpochDigest: "epoch-new", sandboxId: "sandbox-old", sandboxLabel: "label-old", resources: [resource] };
  let fresh: any;
  const control: any = {
    query: vi.fn(async () => ({ count: fresh ? 2 : 1, leases: fresh ? [old, fresh] : [old], windowing: {} })),
    reserve: vi.fn(async () => { events.push("reserve"); fresh = { id: "fresh", version: 1, state: "reserved", owner: old.owner, credentialEpochDigest: "epoch-new", sandboxLabel: "label-fresh", resources: [{ ...resource, id: "fresh-resource", providerSecretName: "fresh-name", providerSecretId: undefined, state: "planned" }] }; return fresh; }),
    mutate: vi.fn(async (id: string, mutation: any) => {
      events.push(`${id}:${mutation.transition}`);
      let lease = id === "old" ? old : fresh;
      const state: any = { requestCleanup: "cleanup_pending", beginCleanup: "cleaning", markDeleted: "deleted", beginProvisioning: "provisioning", recordSandbox: "provisioning", activate: "active" };
      lease = { ...lease, version: lease.version + 1, state: state[mutation.transition] ?? lease.state, sandboxId: mutation.sandboxId ?? lease.sandboxId, resources: lease.resources.map((entry: any) => { const update = mutation.resourceUpdates?.find((item: any) => item.resourceId === entry.id); return update ? { ...entry, ...update, version: entry.version + 1 } : entry; }) };
      if (id === "old") old = lease; else fresh = lease;
      return lease;
    }),
  };
  const api: any = {
    get: vi.fn(async (id: string) => ({ id, name: id === "old-secret" ? "old-name" : "fresh-name", placeholder: "dtn", hosts: ["api.example.com"] })),
    create: vi.fn(async ({ name, hosts }: any) => { events.push(`secret:create:${name}`); return { id: "fresh-secret", name, placeholder: "dtn", hosts }; }),
    delete: vi.fn(async (id: string) => { events.push(`secret:delete:${id}`); }),
  };
  const runtime = createDaytonaSecretLeaseRuntime({ ...input(control), plan: { environment: {}, candidates: [{ ordinal: 0, consumer: { kind: "model" }, binding: { kind: "environment", name: "MODEL_KEY" }, allowedHost: "api.example.com", value: "plaintext" }] } as any, api, deleteSandbox: async (id) => { events.push(`sandbox:delete:${id}`); }, confirmSandboxAbsent: async () => true });
  await runtime.prepare();
  const provider = daytonaWithSecretLease((attachments) => ({ reconnect: async () => { events.push("reconnect:old"); throw new Error("gone"); }, create: async () => { events.push(`sandbox:create:${attachments.MODEL_KEY}`); return "sandbox-fresh"; } } as any), runtime);
  await expect((provider.reconnect as any)("sandbox-old")).rejects.toThrow("gone");
  await expect(provider.create()).resolves.toBe("sandbox-fresh");
  expect(events.indexOf("sandbox:delete:sandbox-old")).toBeLessThan(events.indexOf("secret:create:fresh-name"));
  expect(events).toContain("sandbox:create:fresh-name");
  expect(events).toContain("fresh:activate");
});

it("compensation deletes the newly created sandbox even when the lease still names an older sandbox", async () => {
  const active = { ...base, credentialEpochDigest: "epoch-new", state: "cleanup_pending", sandboxId: "sandbox-old" };
  const events: string[] = [];
  const control: any = { query: vi.fn(), reserve: vi.fn(), mutate: vi.fn(async (_id: string, mutation: any) => ({ ...active, version: active.version + 1, state: mutation.transition === "beginCleanup" ? "cleaning" : mutation.transition === "markDeleted" ? "deleted" : active.state })) };
  const options = input(control); options.deleteSandbox = vi.fn(async (id: string) => { events.push(id); });
  const runtime = createDaytonaSecretLeaseRuntime(options);
  await runtime.compensate({ lease: active, attachments: {}, mcpHeaderPlaceholders: {} }, "sandbox-fresh");
  expect(events[0]).toBe("sandbox-fresh");
  expect(events).toContain("sandbox-old");
});

it("fails closed while reconstructing an active lease with wrong Secret metadata", async () => {
  const active = { ...base, credentialEpochDigest: "epoch-new", resources: [{ id: "resource", version: 1, ordinal: 0, consumer: { kind: "model" }, binding: { kind: "environment", name: "MODEL_KEY" }, usage: "opaque_http", allowedHost: "api.example.com", providerSecretName: "expected", providerSecretId: "provider-id", state: "created" }] };
  const control: any = { query: vi.fn(async () => ({ count: 1, leases: [active], windowing: {} })), reserve: vi.fn(), mutate: vi.fn() };
  const options = input(control); options.api.get = vi.fn(async () => ({ id: "provider-id", name: "expected", placeholder: "dtn", hosts: ["wrong.example.com"] }));
  await expect(createDaytonaSecretLeaseRuntime(options).prepare()).rejects.toThrow("unexpected host restriction");
});

});
