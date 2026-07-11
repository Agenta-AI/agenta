import { describe, expect, it, vi } from "vitest";
import { createDaytonaSecretLeaseRuntime, daytonaWithSecretLease } from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
describe("lease-aware provider", () => {
  it("attaches names and preserves reconnect/pause forwarding", async () => {
    const events: string[] = []; const runtime = { prepare: async () => ({ lease: {} as any, attachments: { MODEL_KEY: "secret-name" }, mcpHeaderPlaceholders: {} }), activate: async () => { events.push("activate"); }, compensate: vi.fn(), cleanup: vi.fn(), currentMcpHeaderPlaceholders: () => ({}) };
    const provider = daytonaWithSecretLease((attachments) => ({ create: async () => { events.push(JSON.stringify(attachments)); return "sandbox"; }, reconnect: async () => { events.push("reconnect"); }, pause: async () => { events.push("pause"); } } as any), runtime);
    await provider.create(); await (provider.reconnect as any)("sandbox"); await (provider.pause as any)("sandbox");
    expect(events).toEqual(['{"MODEL_KEY":"secret-name"}', "activate", "reconnect", "pause"]);
  });
  it("surfaces activation plus incomplete compensation", async () => {
    const provider = daytonaWithSecretLease(() => ({ create: async () => "sandbox", destroy: async () => { throw new Error("delete-fault"); } }), { prepare: async () => ({ lease: {} as any, attachments: {}, mcpHeaderPlaceholders: {} }), activate: async () => { throw new Error("activation-fault"); }, compensate: async () => { throw new Error("cleanup-fault"); }, cleanup: vi.fn(), currentMcpHeaderPlaceholders: () => ({}) });
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
