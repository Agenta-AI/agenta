import { createHash } from "node:crypto";
import { assertDaytonaSecretMetadata, cleanupDaytonaLease, provisionDaytonaSecrets, type DaytonaSecretApi } from "./daytona-secrets.ts";
import type { DaytonaSecretPlan } from "./daytona-secret-plan.ts";
import type { LeaseReservation, SecretLease, SecretLeaseControl } from "./secret-lease-control.ts";

export interface SecretLeasePreparation { lease: SecretLease; attachments: Record<string, string>; mcpHeaderPlaceholders: Record<string, Record<string, string>> }
export interface SecretLeaseProviderRuntime { prepare(): Promise<SecretLeasePreparation>; prepareForCreate(): Promise<SecretLeasePreparation>; activate(prepared: SecretLeasePreparation, sandboxId: string): Promise<void>; compensate(prepared: SecretLeasePreparation, sandboxId?: string): Promise<void>; cleanup(sandboxId: string): Promise<void>; currentMcpHeaderPlaceholders(): Record<string, Record<string, string>> }
export interface ProviderLike { create(...args: unknown[]): Promise<string>; destroy?(sandboxId: string): Promise<void>; deleteSandbox?(sandboxId: string): Promise<void> }
async function compensateOrAggregate(runtime: SecretLeaseProviderRuntime, prepared: SecretLeasePreparation, cause: unknown): Promise<never> { try { await runtime.compensate(prepared); } catch (compensationError) { throw new AggregateError([cause, compensationError], "Sandbox creation failed and secret compensation also failed."); } throw cause; }

/** The lease runtime owns deletion so cleanup intent is durable before Daytona side effects. */
export function daytonaWithSecretLease<T extends ProviderLike>(buildProvider: (attachments: Record<string, string>) => T, runtime: SecretLeaseProviderRuntime): T {
  let provider: T | undefined;
  const facade = {
    async create(...args: unknown[]): Promise<string> {
      const prepared = await runtime.prepareForCreate(); provider = buildProvider(prepared.attachments);
      let sandboxId: string;
      try { sandboxId = await provider.create(...args); } catch (error) { return compensateOrAggregate(runtime, prepared, error); }
      try { await runtime.activate(prepared, sandboxId); return sandboxId; }
      catch (activationError) { try { await runtime.compensate(prepared, sandboxId); } catch (compensationError) { throw new AggregateError([activationError, compensationError], "Lease activation failed and cleanup was incomplete."); } throw activationError; }
    },
    async destroy(sandboxId: string): Promise<void> { await runtime.cleanup(sandboxId); },
    async deleteSandbox(sandboxId: string): Promise<void> { await runtime.cleanup(sandboxId); },
  } as unknown as T;
  return new Proxy(facade, { get(target, property, receiver) { if (Reflect.has(target, property)) return Reflect.get(target, property, receiver); if (!provider) provider = buildProvider({}); const value = Reflect.get(provider, property); return typeof value === "function" ? value.bind(provider) : value; } });
}

function nextAttemptKey(base: string, leases: SecretLease[]): string {
  if (leases.length === 0) return base;
  const tail = leases[leases.length - 1].id;
  return `${base.slice(0, 180)}:${createHash("sha256").update(tail).digest("hex").slice(0, 32)}`;
}

export function createDaytonaSecretLeaseRuntime(input: { plan: DaytonaSecretPlan; reservation: LeaseReservation; control: SecretLeaseControl; api: DaytonaSecretApi; deleteSandbox: (id: string) => Promise<void>; confirmSandboxAbsent: (id: string) => Promise<boolean> }): SecretLeaseProviderRuntime {
  const bySandbox = new Map<string, SecretLeasePreparation>(); let cached: SecretLeasePreparation | undefined;
  const reconstruct = async (lease: SecretLease): Promise<SecretLeasePreparation> => {
    const attachments: Record<string, string> = {}; const mcpHeaderPlaceholders: Record<string, Record<string, string>> = {};
    for (const resource of lease.resources) {
      if (resource.state !== "created" || !resource.providerSecretId) throw new Error("Active secret lease is missing a created provider resource.");
      const secret = assertDaytonaSecretMetadata(await input.api.get(resource.providerSecretId), resource.providerSecretName, resource.allowedHost);
      if (resource.consumer.kind === "model") attachments[resource.binding.name] = resource.providerSecretName;
      else { if (!secret.placeholder) throw new Error("Daytona did not return a Secret placeholder for an HTTP MCP credential."); attachments[`AGENTA_MCP_SECRET_${resource.ordinal}`] = resource.providerSecretName; (mcpHeaderPlaceholders[resource.consumer.key] ??= {})[resource.binding.name] = secret.placeholder; }
    }
    return { lease, attachments, mcpHeaderPlaceholders };
  };
  const cleanupLease = async (original: SecretLease): Promise<void> => {
    if (original.state === "deleted") return;
    if (original.state === "quarantined") throw new Error(`Secret lease '${original.id}' is quarantined and requires operator reconciliation.`);
    let lease = original;
    if (lease.state === "reserved" || lease.state === "provisioning" || lease.state === "active") lease = await input.control.mutate(lease.id, { expectedVersion: lease.version, transition: "requestCleanup" });
    await cleanupDaytonaLease({ lease, control: input.control, api: input.api, deleteSandbox: input.deleteSandbox, confirmSandboxAbsent: input.confirmSandboxAbsent });
  };
  const ownerLeases = async (): Promise<SecretLease[]> => {
    const leases: SecretLease[] = []; let next: string | undefined;
    do { const page = await input.control.query({ provider: "daytona", states: [], owner: input.reservation.owner, windowing: { next, limit: 100 } }); leases.push(...page.leases); next = page.windowing.next; } while (next);
    return leases;
  };
  const prepare = async (): Promise<SecretLeasePreparation> => {
      if (cached) return cached;
      const leases = await ownerLeases();
      const live = leases.filter((lease) => lease.state !== "deleted" && lease.state !== "quarantined");
      const sameEpoch = live.filter((lease) => lease.credentialEpochDigest === input.reservation.credentialEpochDigest);
      const reusable = sameEpoch.filter((lease) => lease.state === "active");
      if (reusable.length === 1) {
        for (const lease of live) if (lease.id !== reusable[0].id) await cleanupLease(lease);
        cached = await reconstruct(reusable[0]); return cached;
      }
      const resumable = sameEpoch.filter((lease) => lease.state === "reserved" || lease.state === "provisioning");
      if (reusable.length === 0 && resumable.length === 1) {
        for (const lease of live) if (lease.id !== resumable[0].id) await cleanupLease(lease);
        const provisioned = await provisionDaytonaSecrets({ plan: input.plan, lease: resumable[0], control: input.control, api: input.api });
        cached = { lease: provisioned.lease, attachments: provisioned.attachments, mcpHeaderPlaceholders: provisioned.mcpHeaderPlaceholders }; return cached;
      }
      for (const lease of live) await cleanupLease(lease);
      const reservation = { ...input.reservation, idempotencyKey: nextAttemptKey(input.reservation.idempotencyKey, leases) };
      const reserved = await input.control.reserve(reservation);
      const provisioned = await provisionDaytonaSecrets({ plan: input.plan, lease: reserved, control: input.control, api: input.api });
      cached = { lease: provisioned.lease, attachments: provisioned.attachments, mcpHeaderPlaceholders: provisioned.mcpHeaderPlaceholders }; return cached;
  };
  return {
    prepare,
    async prepareForCreate() {
      let prepared = await prepare();
      if (prepared.lease.state === "active") {
        if (!prepared.lease.sandboxId) throw new Error("Active secret lease is missing its reconnectable sandbox id.");
        await cleanupLease(prepared.lease);
        cached = undefined;
        prepared = await prepare();
        if (prepared.lease.state === "active") throw new Error("Active secret lease could not be retired before fresh sandbox creation.");
      }
      return prepared;
    },
    async activate(prepared, sandboxId) { prepared.lease = await input.control.mutate(prepared.lease.id, { expectedVersion: prepared.lease.version, transition: "recordSandbox", sandboxId }); prepared.lease = await input.control.mutate(prepared.lease.id, { expectedVersion: prepared.lease.version, transition: "activate", sandboxId }); bySandbox.set(sandboxId, prepared); },
    async compensate(prepared, sandboxId) {
      let lease = prepared.lease;
      if (lease.state !== "cleanup_pending" && lease.state !== "cleaning") lease = await input.control.mutate(lease.id, { expectedVersion: lease.version, transition: "requestCleanup", errorCode: "sandbox_create_failed" });
      if (sandboxId) { await input.deleteSandbox(sandboxId); if (!(await input.confirmSandboxAbsent(sandboxId))) throw new Error("Sandbox deletion was not confirmed during compensation."); }
      await cleanupDaytonaLease({ lease, control: input.control, api: input.api, deleteSandbox: input.deleteSandbox, confirmSandboxAbsent: input.confirmSandboxAbsent });
    },
    async cleanup(sandboxId) {
      let prepared = bySandbox.get(sandboxId);
      if (!prepared) { const leases = await ownerLeases(); const lease = leases.find((candidate) => candidate.sandboxId === sandboxId); if (!lease) return; prepared = { lease, attachments: {}, mcpHeaderPlaceholders: {} }; }
      await cleanupLease(prepared.lease); bySandbox.delete(sandboxId); cached = undefined;
    },
    currentMcpHeaderPlaceholders() { return cached?.mcpHeaderPlaceholders ?? {}; },
  };
}
