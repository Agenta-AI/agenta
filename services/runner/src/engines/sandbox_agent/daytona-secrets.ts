import type { DaytonaSecretCandidate, DaytonaSecretPlan } from "./daytona-secret-plan.ts";
import type { LeaseClaim, SecretLease, SecretLeaseControl } from "./secret-lease-control.ts";

export interface DaytonaSecretRecord { id: string; name: string; placeholder: string }
export interface DaytonaSecretApi {
  create(input: { name: string; value: string; description?: string; hosts: string[] }): Promise<DaytonaSecretRecord>;
  get(id: string): Promise<DaytonaSecretRecord>;
  delete(id: string): Promise<void>;
  list?(input?: { cursor?: string; limit?: number }): Promise<{ items: DaytonaSecretRecord[]; nextCursor?: string | null }>;
}
export interface ProvisionedDaytonaSecrets {
  lease: SecretLease;
  attachments: Record<string, string>;
  mcpHeaderPlaceholders: Record<string, Record<string, string>>;
  createdNames: string[];
  createdIds: string[];
}
function claimOf(lease: SecretLease): { id: string; generation: number } | undefined {
  return lease.claim && { id: lease.claim.id, generation: lease.claim.generation };
}
function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404;
}
function resourceFor(lease: SecretLease, candidate: DaytonaSecretCandidate) {
  const resource = lease.resources.find((item) => item.ordinal === candidate.ordinal);
  if (!resource) throw new Error("Secret lease response did not contain every reserved resource.");
  return resource;
}
async function deleteIdempotently(api: DaytonaSecretApi, id: string): Promise<void> {
  try { await api.delete(id); } catch (error) { if (!isNotFound(error)) throw error; }
}
async function compensate(api: DaytonaSecretApi, ids: string[]): Promise<void> {
  const failures: unknown[] = [];
  for (const id of [...ids].reverse()) { try { await deleteIdempotently(api, id); } catch (error) { failures.push(error); } }
  if (failures.length) throw new AggregateError(failures, "Daytona Secret compensation was incomplete.");
}

/** Durable reservation must exist before this function; no plaintext is accepted by control calls. */
export async function provisionDaytonaSecrets(input: { plan: DaytonaSecretPlan; lease: SecretLease; control: SecretLeaseControl; api: DaytonaSecretApi }): Promise<ProvisionedDaytonaSecrets> {
  let lease = await input.control.mutate(input.lease.id, { expectedVersion: input.lease.version, claim: claimOf(input.lease), transition: "beginProvisioning" });
  const createdNames: string[] = [];
  const createdIds: string[] = [];
  const attachments: Record<string, string> = {};
  const mcpHeaderPlaceholders: Record<string, Record<string, string>> = {};
  try {
    for (const candidate of input.plan.candidates) {
      const resource = resourceFor(lease, candidate);
      const created = await input.api.create({ name: resource.providerSecretName, value: candidate.value, description: `Agenta ephemeral credential lease ${lease.id}`, hosts: [candidate.allowedHost] });
      createdNames.push(resource.providerSecretName);
      const providerSecretId = created.id;
      createdIds.push(providerSecretId);
      try {
        lease = await input.control.mutate(lease.id, {
          expectedVersion: lease.version, claim: claimOf(lease), transition: "beginProvisioning",
          resourceUpdates: [{ resourceId: resource.id, expectedVersion: resource.version, providerSecretId, state: "created" }],
        });
      } catch (error) {
        await deleteIdempotently(input.api, providerSecretId).catch(() => undefined);
        throw error;
      }
      if (candidate.consumer.kind === "model") attachments[candidate.binding.name] = resource.providerSecretName;
      else {
        if (!created.placeholder) throw new Error("Daytona did not return a Secret placeholder for an HTTP MCP credential.");
        (mcpHeaderPlaceholders[candidate.consumer.server] ??= {})[candidate.binding.name] = created.placeholder;
        attachments[`AGENTA_MCP_SECRET_${candidate.ordinal}`] = resource.providerSecretName;
      }
    }
    return { lease, attachments, mcpHeaderPlaceholders, createdNames, createdIds };
  } catch (error) {
    let compensationError: unknown;
    try { await compensate(input.api, createdIds); } catch (failure) { compensationError = failure; }
    let durableError: unknown;
    try { await input.control.mutate(lease.id, { expectedVersion: lease.version, claim: claimOf(lease), transition: "requestCleanup", errorCode: "provider_unavailable" }); } catch (failure) { durableError = failure; }
    if (compensationError || durableError) throw new AggregateError([error, compensationError, durableError].filter(Boolean), "Secret provisioning failed and cleanup was incomplete.");
    throw error;
  }
}

/** Sandbox absence is a hard precondition for deleting credential Secrets. */
export async function cleanupDaytonaLease(input: { lease: SecretLease; control: SecretLeaseControl; api: DaytonaSecretApi; deleteSandbox: (sandboxId: string) => Promise<void>; confirmSandboxAbsent: (sandboxId: string) => Promise<boolean> }): Promise<SecretLease> {
  let lease = await input.control.mutate(input.lease.id, { expectedVersion: input.lease.version, claim: claimOf(input.lease), transition: "beginCleanup" });
  if (lease.sandboxId) {
    await input.deleteSandbox(lease.sandboxId);
    if (!(await input.confirmSandboxAbsent(lease.sandboxId))) {
      return input.control.mutate(lease.id, { expectedVersion: lease.version, claim: claimOf(lease), transition: "recordRetry", errorCode: "sandbox_delete_failed", nextAttemptAt: new Date(Date.now() + 30_000).toISOString() });
    }
  }
  for (const resource of [...lease.resources].sort((a, b) => b.ordinal - a.ordinal)) {
    if (resource.state === "created") {
      if (!resource.providerSecretId) throw new Error("Created lease resource is missing providerSecretId.");
      await deleteIdempotently(input.api, resource.providerSecretId);
    }
    lease = await input.control.mutate(lease.id, {
      expectedVersion: lease.version, claim: claimOf(lease), transition: "beginCleanup",
      resourceUpdates: [{ resourceId: resource.id, expectedVersion: resource.version, state: "deleted" }],
    });
  }
  return input.control.mutate(lease.id, { expectedVersion: lease.version, claim: claimOf(lease), transition: "markDeleted" });
}
