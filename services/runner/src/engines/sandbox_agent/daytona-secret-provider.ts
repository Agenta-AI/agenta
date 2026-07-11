import { cleanupDaytonaLease, provisionDaytonaSecrets, type DaytonaSecretApi } from "./daytona-secrets.ts";
import type { DaytonaSecretPlan } from "./daytona-secret-plan.ts";
import type { LeaseReservation, SecretLease, SecretLeaseControl } from "./secret-lease-control.ts";

export interface SecretLeasePreparation { lease: SecretLease; attachments: Record<string, string>; mcpHeaderPlaceholders: Record<string, Record<string, string>> }
export interface SecretLeaseProviderRuntime {
  prepare(): Promise<SecretLeasePreparation>;
  activate(prepared: SecretLeasePreparation, sandboxId: string): Promise<void>;
  compensate(prepared: SecretLeasePreparation): Promise<void>;
  cleanup(sandboxId: string): Promise<void>;
  currentMcpHeaderPlaceholders(): Record<string, Record<string, string>>;
}
export interface ProviderLike {
  create(...args: unknown[]): Promise<string>;
  destroy?(sandboxId: string): Promise<void>;
  deleteSandbox?(sandboxId: string): Promise<void>;
}
async function compensateOrAggregate(runtime: SecretLeaseProviderRuntime, prepared: SecretLeasePreparation, cause: unknown): Promise<never> {
  try { await runtime.compensate(prepared); }
  catch (compensationError) { throw new AggregateError([cause, compensationError], "Sandbox creation failed and secret compensation also failed."); }
  throw cause;
}

/** Factory-seam decorator: Secret names exist before create; all other lifecycle methods forward. */
export function daytonaWithSecretLease<T extends ProviderLike>(buildProvider: (attachments: Record<string, string>) => T, runtime: SecretLeaseProviderRuntime): T {
  let provider: T | undefined;
  const facade = {
    async create(...args: unknown[]): Promise<string> {
      const prepared = await runtime.prepare();
      provider = buildProvider(prepared.attachments);
      let sandboxId: string;
      try { sandboxId = await provider.create(...args); }
      catch (error) { return compensateOrAggregate(runtime, prepared, error); }
      try { await runtime.activate(prepared, sandboxId); return sandboxId; }
      catch (activationError) {
        let deletionError: unknown;
        try { await provider.destroy?.(sandboxId); } catch (error) { deletionError = error; }
        try { await runtime.compensate(prepared); }
        catch (compensationError) { throw new AggregateError([activationError, deletionError, compensationError].filter(Boolean), "Lease activation failed and cleanup was incomplete."); }
        if (deletionError) throw new AggregateError([activationError, deletionError], "Lease activation failed and sandbox deletion was not confirmed.");
        throw activationError;
      }
    },
    async destroy(sandboxId: string): Promise<void> {
      if (!provider) provider = buildProvider({});
      await provider.destroy?.(sandboxId);
      await runtime.cleanup(sandboxId);
    },
    async deleteSandbox(sandboxId: string): Promise<void> {
      if (!provider) provider = buildProvider({});
      if (provider.deleteSandbox) await provider.deleteSandbox(sandboxId); else await provider.destroy?.(sandboxId);
      await runtime.cleanup(sandboxId);
    },
  } as unknown as T;
  return new Proxy(facade, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (!provider) provider = buildProvider({});
      const value = Reflect.get(provider, property);
      return typeof value === "function" ? value.bind(provider) : value;
    },
  });
}


/** Concrete durable runtime used at the provider factory seam. */
export function createDaytonaSecretLeaseRuntime(input: {
  plan: DaytonaSecretPlan;
  reservation: LeaseReservation;
  control: SecretLeaseControl;
  api: DaytonaSecretApi;
  deleteSandbox: (id: string) => Promise<void>;
  confirmSandboxAbsent: (id: string) => Promise<boolean>;
}): SecretLeaseProviderRuntime {
  const bySandbox = new Map<string, SecretLeasePreparation>();
  let cached: SecretLeasePreparation | undefined;
  return {
    async prepare() {
      if (cached) return cached;
      const reserved = await input.control.reserve(input.reservation);
      if (reserved.state === "active") {
        const attachments: Record<string, string> = {};
        const mcpHeaderPlaceholders: Record<string, Record<string, string>> = {};
        for (const resource of reserved.resources) {
          if (resource.state !== "created" || !resource.providerSecretId) throw new Error("Active secret lease is missing a created provider resource.");
          if (resource.consumer.kind === "model") attachments[resource.binding.name] = resource.providerSecretName;
          else {
            const secret = await input.api.get(resource.providerSecretId);
            attachments[`AGENTA_MCP_SECRET_${resource.ordinal}`] = resource.providerSecretName;
            (mcpHeaderPlaceholders[resource.consumer.key] ??= {})[resource.binding.name] = secret.placeholder;
          }
        }
        cached = { lease: reserved, attachments, mcpHeaderPlaceholders };
        return cached;
      }
      if (reserved.state !== "reserved") throw new Error(`Secret lease '${reserved.id}' requires janitor reconciliation before reuse.`);
      const provisioned = await provisionDaytonaSecrets({ plan: input.plan, lease: reserved, control: input.control, api: input.api });
      cached = { lease: provisioned.lease, attachments: provisioned.attachments, mcpHeaderPlaceholders: provisioned.mcpHeaderPlaceholders };
      return cached;
    },
    async activate(prepared, sandboxId) {
      prepared.lease = await input.control.mutate(prepared.lease.id, { expectedVersion: prepared.lease.version, transition: "recordSandbox", sandboxId });
      prepared.lease = await input.control.mutate(prepared.lease.id, { expectedVersion: prepared.lease.version, transition: "activate", sandboxId });
      bySandbox.set(sandboxId, prepared);
    },
    async compensate(prepared) {
      let lease = prepared.lease;
      if (lease.state !== "cleanup_pending") lease = await input.control.mutate(lease.id, { expectedVersion: lease.version, transition: "requestCleanup", errorCode: "provider_unavailable" });
      await cleanupDaytonaLease({ lease, control: input.control, api: input.api, deleteSandbox: input.deleteSandbox, confirmSandboxAbsent: input.confirmSandboxAbsent });
    },
    async cleanup(sandboxId) {
      let prepared = bySandbox.get(sandboxId);
      if (!prepared) {
        const page = await input.control.query({ provider: "daytona", states: ["active", "cleanup_pending", "cleaning"], owner: input.reservation.owner, windowing: { limit: 100 } });
        const lease = page.leases.find((candidate) => candidate.sandboxId === sandboxId);
        if (!lease) return;
        prepared = { lease, attachments: {}, mcpHeaderPlaceholders: {} };
      }
      let lease = prepared.lease;
      if (lease.state === "active") lease = await input.control.mutate(lease.id, { expectedVersion: lease.version, transition: "requestCleanup" });
      await cleanupDaytonaLease({ lease, control: input.control, api: input.api, deleteSandbox: input.deleteSandbox, confirmSandboxAbsent: input.confirmSandboxAbsent });
      bySandbox.delete(sandboxId);
      cached = undefined;
    },
    currentMcpHeaderPlaceholders() { return cached?.mcpHeaderPlaceholders ?? {}; },
  };
}
