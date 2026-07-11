export type LeaseState = "reserved" | "provisioning" | "active" | "cleanup_pending" | "cleaning" | "deleted" | "quarantined";
export type LeaseTransition = "beginProvisioning" | "recordSandbox" | "activate" | "requestCleanup" | "beginCleanup" | "recordRetry" | "markDeleted" | "quarantine";
export type SafeErrorCode = "provision_failed" | "sandbox_create_failed" | "provider_unavailable" | "provider_conflict" | "persistence_failed" | "sandbox_delete_failed" | "secret_delete_failed" | "ownership_ambiguous" | "invalid_provider_response";
export interface LeaseClaim { id: string; generation: number; expiresAt?: string }
export interface ClaimResponse { claimId: string; claimGeneration: number; claimExpiresAt: string }
export interface ClaimRequest { claimOwner: string; ttlSeconds: number }
export interface LeaseResource { id: string; version: number; ordinal: number; consumer: { kind: "model" } | { kind: "http_mcp"; key: string }; binding: { kind: "environment" | "header"; name: string }; usage: "opaque_http"; allowedHost: string; providerSecretName: string; providerSecretId?: string; state: "planned" | "created" | "deleted" }
export interface SecretLease { id: string; version: number; state: LeaseState; owner: { kind: "session" | "run"; id: string }; credentialEpochDigest: string; sandboxId?: string; sandboxLabel: string; claim?: LeaseClaim; resources: LeaseResource[] }
export interface LeaseReservation { owner: { kind: "session" | "run"; id: string }; idempotencyKey: string; credentialEpochDigest: string; sandboxFingerprint?: string; resources: Array<{ consumer: { kind: "model" } | { kind: "http_mcp"; key: string }; binding: { kind: "environment" | "header"; name: string }; usage: "opaque_http"; allowedHost: string }> }
export interface ResourceUpdate { resourceId: string; expectedVersion: number; providerSecretId?: string; state: "created" | "deleted" }
type MutationBase = { expectedVersion: number; claim?: { id: string; generation: number }; sandboxId?: string; resourceUpdates?: ResourceUpdate[] };
export type LeaseMutation = (MutationBase & { transition: "recordRetry"; errorCode: SafeErrorCode; nextAttemptAt: string }) | (MutationBase & { transition: Exclude<LeaseTransition, "recordRetry">; errorCode?: SafeErrorCode; nextAttemptAt?: never });
export interface LeaseQuery { states: LeaseState[]; provider?: "daytona"; retryBefore?: string; owner?: { kind: "session" | "run"; id: string }; windowing?: { next?: string; limit?: number } }
export interface LeasePage { count: number; leases: SecretLease[]; windowing: { next?: string } }
export interface SecretLeaseControl { reserve(input: LeaseReservation): Promise<SecretLease>; get(id: string): Promise<SecretLease | undefined>; mutate(id: string, mutation: LeaseMutation): Promise<SecretLease>; query(input: LeaseQuery): Promise<LeasePage>; claim(id: string, request: ClaimRequest): Promise<ClaimResponse | undefined> }
export type SecretLeaseControlAuth = { tenantAuthorization: string; controlToken?: never } | { tenantAuthorization?: never; controlToken: string };
export class SecretLeaseControlError extends Error { constructor(readonly code: "transport" | "unauthorized" | "conflict" | "invalid_response") { super(`Secret lease control request failed (${code}).`); this.name = "SecretLeaseControlError"; } }

function invalid(): never { throw new SecretLeaseControlError("invalid_response"); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function text(value: unknown): string { if (typeof value !== "string" || !value) invalid(); return value; }
function integer(value: unknown): number { if (!Number.isInteger(value) || Number(value) < 0) invalid(); return Number(value); }
function optionalText(value: unknown): string | undefined { return value === undefined || value === null ? undefined : text(value); }
const STATES = new Set<LeaseState>(["reserved", "provisioning", "active", "cleanup_pending", "cleaning", "deleted", "quarantined"]);
function decodeResource(value: unknown): LeaseResource {
  const v = record(value); const consumer = record(v.consumer); const binding = record(v.binding);
  const consumerKind = text(consumer.kind); const bindingKind = text(binding.kind); const state = text(v.state);
  if (consumerKind !== "model" && consumerKind !== "http_mcp") invalid();
  if (bindingKind !== "environment" && bindingKind !== "header") invalid();
  if (state !== "planned" && state !== "created" && state !== "deleted") invalid();
  const decodedConsumer = consumerKind === "model" ? { kind: "model" as const } : { kind: "http_mcp" as const, key: text(consumer.key) };
  return { id: text(v.id), version: integer(v.version), ordinal: integer(v.ordinal), consumer: decodedConsumer, binding: { kind: bindingKind, name: text(binding.name) }, usage: v.usage === "opaque_http" ? "opaque_http" : invalid(), allowedHost: text(v.allowedHost), providerSecretName: text(v.providerSecretName), providerSecretId: optionalText(v.providerSecretId), state };
}
export function decodeSecretLease(value: unknown): SecretLease {
  const v = record(value); const owner = record(v.owner); const ownerKind = text(owner.kind); const state = text(v.state);
  if (ownerKind !== "session" && ownerKind !== "run") invalid(); if (!STATES.has(state as LeaseState)) invalid();
  if (!Array.isArray(v.resources)) invalid();
  const claimValue = v.claim; let claim: LeaseClaim | undefined;
  if (claimValue !== undefined && claimValue !== null) { const c = record(claimValue); claim = { id: text(c.id), generation: integer(c.generation), expiresAt: optionalText(c.expiresAt) }; }
  return { id: text(v.id), version: integer(v.version), state: state as LeaseState, owner: { kind: ownerKind, id: text(owner.id) }, credentialEpochDigest: text(v.credentialEpochDigest), sandboxId: optionalText(v.sandboxId), sandboxLabel: text(v.sandboxLabel), claim, resources: v.resources.map(decodeResource) };
}
function decodePage(value: unknown): LeasePage { const v = record(value); if (!Array.isArray(v.leases)) invalid(); const w = v.windowing == null ? {} : record(v.windowing); return { count: integer(v.count), leases: v.leases.map(decodeSecretLease), windowing: { next: optionalText(w.next) } }; }
function decodeClaim(value: unknown): ClaimResponse { const v = record(value); return { claimId: text(v.claimId), claimGeneration: integer(v.claimGeneration), claimExpiresAt: text(v.claimExpiresAt) }; }

export class HttpSecretLeaseControl implements SecretLeaseControl {
  constructor(private readonly options: { baseUrl: string; fetch?: typeof fetch } & SecretLeaseControlAuth) {}
  private async request(path: string, init: RequestInit): Promise<unknown | undefined> {
    const authHeaders = this.options.tenantAuthorization ? { authorization: this.options.tenantAuthorization } : { "x-agenta-runner-control-token": this.options.controlToken };
    let response: Response;
    try { response = await (this.options.fetch ?? fetch)(new URL(path, this.options.baseUrl), { ...init, headers: { "content-type": "application/json", ...authHeaders, ...(init.headers ?? {}) } }); } catch { throw new SecretLeaseControlError("transport"); }
    if (response.status === 404) return undefined;
    if (response.status === 401 || response.status === 403) throw new SecretLeaseControlError("unauthorized");
    if (response.status === 409 || response.status === 412) throw new SecretLeaseControlError("conflict");
    if (!response.ok) throw new SecretLeaseControlError("transport");
    try { return await response.json(); } catch { throw new SecretLeaseControlError("invalid_response"); }
  }
  async reserve(input: LeaseReservation): Promise<SecretLease> { const value = await this.request("/agent-secret-leases/", { method: "POST", body: JSON.stringify(input) }); return decodeSecretLease(value); }
  async get(id: string): Promise<SecretLease | undefined> { const value = await this.request(`/agent-secret-leases/${encodeURIComponent(id)}`, { method: "GET" }); return value === undefined ? undefined : decodeSecretLease(value); }
  async mutate(id: string, mutation: LeaseMutation): Promise<SecretLease> { const value = await this.request(`/agent-secret-leases/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(mutation) }); return decodeSecretLease(value); }
  async query(input: LeaseQuery): Promise<LeasePage> { return decodePage(await this.request("/agent-secret-leases/query", { method: "POST", body: JSON.stringify(input) })); }
  async claim(id: string, request: ClaimRequest): Promise<ClaimResponse | undefined> { const value = await this.request(`/agent-secret-leases/${encodeURIComponent(id)}/claim`, { method: "POST", body: JSON.stringify(request) }); return value === undefined ? undefined : decodeClaim(value); }
}
