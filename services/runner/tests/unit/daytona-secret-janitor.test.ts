import { describe, expect, it, vi } from "vitest";
import { SecretLeaseControlError } from "../../src/engines/sandbox_agent/secret-lease-control.ts";
import { runDaytonaSecretJanitorPage } from "../../src/engines/sandbox_agent/daytona-secret-janitor.ts";

const lease = { id: "l", version: 1, state: "cleanup_pending", owner: { kind: "run", id: "r" }, sandboxLabel: "x", credentialEpochDigest: "h", resources: [] } as any;

describe("Daytona secret janitor", () => {
  it("uses nested windowing and claim-only fencing before cleanup", async () => {
    const events: string[] = [];
    const control: any = {
      query: vi.fn(async () => ({ count: 1, leases: [lease], windowing: { next: "cursor-2" } })),
      claim: vi.fn(async () => { events.push("claim"); return { claimId: "claim", claimGeneration: 2, claimExpiresAt: "later" }; }),
      mutate: vi.fn(async (_id: string, mutation: any) => { events.push(mutation.transition); return { ...lease, claim: mutation.claim, version: lease.version + 1, state: "deleted" }; }),
      get: vi.fn(),
    };
    const next = await runDaytonaSecretJanitorPage({ control, api: { get: vi.fn(), create: vi.fn(), delete: vi.fn() }, workerId: "worker", cursor: "cursor-1", claimTtlSeconds: 45, deleteSandbox: vi.fn(), confirmSandboxAbsent: vi.fn() });
    expect(next).toBe("cursor-2");
    expect(events).toEqual(["claim", "beginCleanup", "markDeleted"]);
    expect(control.query).toHaveBeenCalledWith(expect.objectContaining({ provider: "daytona", states: ["cleanup_pending", "cleaning"], windowing: { next: "cursor-1", limit: 100 } }));
    expect(control.claim).toHaveBeenCalledWith("l", { claimOwner: "worker", ttlSeconds: 45 });
    expect(control.mutate.mock.calls[0][1].claim).toEqual({ id: "claim", generation: 2 });
  });

  it("records a safe retry code with nextAttemptAt after reconciliation failure", async () => {
    const current = { ...lease, version: 2, claim: { id: "claim", generation: 2 } };
    const control: any = {
      query: vi.fn(async () => ({ count: 1, leases: [{ ...lease, sandboxId: "sandbox" }], windowing: {} })),
      claim: vi.fn(async () => ({ claimId: "claim", claimGeneration: 2, claimExpiresAt: "later" })),
      mutate: vi.fn(async (_id: string, mutation: any) => mutation.transition === "beginCleanup" ? { ...current, sandboxId: "sandbox" } : current),
      get: vi.fn(async () => current),
    };
    await expect(runDaytonaSecretJanitorPage({ control, api: { get: vi.fn(), create: vi.fn(), delete: vi.fn() }, workerId: "worker", deleteSandbox: async () => { throw new Error("fault"); }, confirmSandboxAbsent: vi.fn() })).rejects.toBeInstanceOf(AggregateError);
    const retry = control.mutate.mock.calls.find((call: any[]) => call[1].transition === "recordRetry")?.[1];
    expect(retry).toMatchObject({ errorCode: "provider_unavailable", claim: { id: "claim", generation: 2 } });
    expect(Date.parse(retry.nextAttemptAt)).toBeGreaterThan(Date.now());
  });
});


describe("janitor claim races", () => {
  it("continues after a normal claim conflict", async () => {
    const second = { ...lease, id: "second" };
    const control: any = {
      query: vi.fn(async () => ({ count: 2, leases: [lease, second], windowing: {} })),
      claim: vi.fn(async (id: string) => { if (id === "l") throw new SecretLeaseControlError("conflict"); return { claimId: "c", claimGeneration: 1, claimExpiresAt: "later" }; }),
      mutate: vi.fn(async (_id: string, mutation: any) => ({ ...second, version: second.version + 1, state: mutation.transition === "markDeleted" ? "deleted" : "cleaning", claim: mutation.claim })),
      get: vi.fn(),
    };
    await runDaytonaSecretJanitorPage({ control, api: { get: vi.fn(), create: vi.fn(), delete: vi.fn() }, workerId: "worker", deleteSandbox: vi.fn(), confirmSandboxAbsent: vi.fn() });
    expect(control.claim).toHaveBeenCalledTimes(2);
    expect(control.mutate).toHaveBeenCalledWith("second", expect.objectContaining({ transition: "beginCleanup" }));
  });
});
