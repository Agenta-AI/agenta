export type LeaseState = "reserved" | "provisioning" | "active" | "cleanup_pending" | "cleaning" | "deleted" | "quarantine";
export type LeaseTransition = "beginProvisioning" | "recordSandbox" | "activate" | "requestCleanup" | "beginCleanup" | "recordRetry" | "markDeleted" | "quarantine";
export type SafeErrorCode = "provider_unavailable" | "provider_conflict" | "persistence_failed" | "sandbox_delete_failed" | "secret_delete_failed" | "ownership_ambiguous" | "invalid_provider_response";

export interface LeaseClaim { id: string; generation: number; expiresAt?: string }
export interface ClaimResponse { claimId: string; claimGeneration: number; claimExpiresAt: string }
export interface ClaimRequest { claimOwner: string; ttlSeconds: number }
export interface LeaseResource {
  id: string; version: number; ordinal: number;
  consumer: { kind: "model" } | { kind: "http_mcp"; key: string };
  binding: { kind: "environment" | "header"; name: string };
  usage: "opaque_http"; allowedHost: string; providerSecretName: string;
  providerSecretId?: string; state: "planned" | "created" | "deleted";
}
export interface SecretLease {
  id: string; version: number; state: LeaseState;
  owner: { kind: "session" | "run"; id: string };
  credentialEpochDigest: string; sandboxId?: string; sandboxLabel: string;
  claim?: LeaseClaim; resources: LeaseResource[];
}
export interface LeaseReservation {
  owner: { kind: "session" | "run"; id: string };
  idempotencyKey: string; credentialEpochDigest: string; sandboxFingerprint?: string;
  resources: Array<{ consumer: { kind: "model" } | { kind: "http_mcp"; key: string }; binding: { kind: "environment" | "header"; name: string }; usage: "opaque_http"; allowedHost: string }>;
}
export interface ResourceUpdate { resourceId: string; expectedVersion: number; providerSecretId?: string; state: "created" | "deleted" }
type MutationBase = { expectedVersion: number; claim?: { id: string; generation: number }; sandboxId?: string; resourceUpdates?: ResourceUpdate[] };
export type LeaseMutation =
  | (MutationBase & { transition: "recordRetry"; errorCode: SafeErrorCode; nextAttemptAt: string })
  | (MutationBase & { transition: Exclude<LeaseTransition, "recordRetry">; errorCode?: SafeErrorCode; nextAttemptAt?: never });
export interface LeaseQuery {
  states: LeaseState[]; provider?: "daytona"; retryBefore?: string;
  owner?: { kind: "session" | "run"; id: string };
  windowing?: { next?: string; limit?: number };
}
export interface LeasePage { count: number; leases: SecretLease[]; windowing: { next?: string } }
export interface SecretLeaseControl {
  reserve(input: LeaseReservation): Promise<SecretLease>;
  get(id: string): Promise<SecretLease | undefined>;
  mutate(id: string, mutation: LeaseMutation): Promise<SecretLease>;
  query(input: LeaseQuery): Promise<LeasePage>;
  claim(id: string, request: ClaimRequest): Promise<ClaimResponse | undefined>;
}
export type SecretLeaseControlAuth =
  | { tenantAuthorization: string; controlToken?: never }
  | { tenantAuthorization?: never; controlToken: string };
export class SecretLeaseControlError extends Error {
  constructor(readonly code: "transport" | "unauthorized" | "conflict" | "invalid_response") { super(`Secret lease control request failed (${code}).`); this.name = "SecretLeaseControlError"; }
}
export class HttpSecretLeaseControl implements SecretLeaseControl {
  constructor(private readonly options: { baseUrl: string; fetch?: typeof fetch } & SecretLeaseControlAuth) {}
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    const authHeaders = this.options.tenantAuthorization
      ? { authorization: this.options.tenantAuthorization }
      : { "x-agenta-runner-control-token": this.options.controlToken };
    try { response = await (this.options.fetch ?? fetch)(new URL(path, this.options.baseUrl), { ...init, headers: { "content-type": "application/json", ...authHeaders, ...(init.headers ?? {}) } }); }
    catch { throw new SecretLeaseControlError("transport"); }
    if (response.status === 404) return undefined as T;
    if (response.status === 401 || response.status === 403) throw new SecretLeaseControlError("unauthorized");
    if (response.status === 409 || response.status === 412) throw new SecretLeaseControlError("conflict");
    if (!response.ok) throw new SecretLeaseControlError("transport");
    try { return (await response.json()) as T; } catch { throw new SecretLeaseControlError("invalid_response"); }
  }
  reserve(input: LeaseReservation): Promise<SecretLease> { return this.request("/agent-secret-leases/", { method: "POST", body: JSON.stringify(input) }); }
  get(id: string): Promise<SecretLease | undefined> { return this.request(`/agent-secret-leases/${encodeURIComponent(id)}`, { method: "GET" }); }
  mutate(id: string, mutation: LeaseMutation): Promise<SecretLease> { return this.request(`/agent-secret-leases/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(mutation) }); }
  query(input: LeaseQuery): Promise<LeasePage> { return this.request("/agent-secret-leases/query", { method: "POST", body: JSON.stringify(input) }); }
  claim(id: string, request: ClaimRequest): Promise<ClaimResponse | undefined> { return this.request(`/agent-secret-leases/${encodeURIComponent(id)}/claim`, { method: "POST", body: JSON.stringify(request) }); }
}
