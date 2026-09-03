import { randomBytes } from "node:crypto";

import { DaytonaNotFoundError } from "@daytonaio/sdk";

import {
  slotKey,
  type CredentialSlotKey,
} from "../../providers/credential-delivery-port.ts";
import {
  credentialSlotFor,
  type DaytonaSecretCandidate,
  type DaytonaSecretPlan,
} from "./daytona-secret-plan.ts";

export interface DaytonaSecretRecord {
  id: string;
  name: string;
  placeholder: string;
  hosts?: string[];
}

export interface DaytonaSecretApi {
  create(input: {
    name: string;
    value: string;
    description?: string;
    hosts: string[];
  }): Promise<DaytonaSecretRecord>;
  /**
   * Replace the stored value on an EXISTING record, leaving id, name, placeholder and hosts alone.
   *
   * This is what makes a rotation cheaper than a rebuild: the sandbox holds the placeholder, not
   * the value, so replacing the value behind a stable placeholder changes nothing the sandbox can
   * observe. The SDK's `secret.update(id, {value})` returns the updated record, and the caller
   * MUST check that the identity did not move — see `deliverDaytonaRotation`.
   */
  update(
    id: string,
    input: { value: string },
  ): Promise<Pick<DaytonaSecretRecord, "id" | "placeholder">>;
  delete(id: string): Promise<void>;
}

export interface DaytonaSecretAllocation {
  attachments: Record<string, string>;
  mcpHeaderPlaceholders: Record<string, Record<string, string>>;
  created: DaytonaSecretRecord[];
  /**
   * Which provider record backs which credential SLOT.
   *
   * `created` alone cannot answer that: it is an ordered list kept for reverse-order compensation,
   * and it says nothing about which candidate produced which record. A delivery needs the record
   * HANDLE for a named slot, so the allocation retains the association at the one moment it is
   * known for free. Handles are secret-equivalent (a handle is how a value is updated and deleted),
   * so this map never leaves the provider layer and nothing in it is ever logged.
   */
  bySlot: ReadonlyMap<CredentialSlotKey, DaytonaSecretRecord>;
}

/**
 * Who owns one allocation right now, and therefore whether `release` may delete it.
 *
 *  - `detached`      No sandbox holds these Secrets. A release deletes them.
 *  - `attached`      A live sandbox was registered against them. Its teardown deletes them, so a
 *                    release from anywhere else must do nothing.
 *  - `indeterminate` A sandbox create failed WITHOUT proving remote absence. Daytona may hold a
 *                    partially created sandbox that mounts these Secrets, so a release must not
 *                    delete them. This is the same fail-safe the fresh-allocation create path has
 *                    always applied, named instead of implied.
 *  - `released`      The Secrets were deleted. Terminal.
 */
export type DaytonaSecretLeaseState =
  | "detached"
  | "attached"
  | "indeterminate"
  | "released";

/**
 * A move-only claim on one Secret allocation, so exactly one owner can delete it.
 *
 * WHY THIS EXISTS. A sandbox the credential preflight convicts is destroyed while its Secrets are
 * KEPT, because a new sandbox on the same Secret works and a new Secret often does not. The
 * allocation therefore outlives its sandbox and moves to the next one, and "who deletes this, and
 * when" stops being answerable from any single object's own fields. The lease answers it: the
 * provider moves the state as ownership moves, and every other holder just calls `release`, which
 * deletes only from `detached`.
 *
 * The state is the ONLY ownership signal. Do not infer ownership from the registry, from a
 * sandbox id, or from call order.
 */
export class DaytonaSecretLease {
  private leaseState: DaytonaSecretLeaseState = "detached";

  constructor(
    readonly allocation: DaytonaSecretAllocation,
    private readonly api: DaytonaSecretApi,
    private readonly log: (message: string) => void = () => {},
  ) {}

  get state(): DaytonaSecretLeaseState {
    return this.leaseState;
  }

  /** A sandbox now holds these Secrets. Called by the provider when it registers the sandbox. */
  attach(): void {
    this.leaseState = "attached";
  }

  /** The sandbox that held these Secrets is gone, and nothing has claimed them yet. */
  detach(): void {
    this.leaseState = "detached";
  }

  /** A create failed without proving remote absence. Nothing may delete these Secrets. */
  markIndeterminate(): void {
    this.leaseState = "indeterminate";
  }

  /**
   * Delete the Secrets if this lease still owns them.
   *
   * Safe to call on every exit path, safe to call twice, and safe to call CONCURRENTLY. Two
   * things make that true, and both matter:
   *
   *  - The state advances to `released` only after the delete resolves, so a failed delete leaves
   *    the lease releasable and a later call retries it. The error is re-raised so the caller can
   *    log it.
   *  - Overlapping callers share the one in-flight delete. Without that, the second caller would
   *    read a state that is still `detached` (the first has not finished) and issue a second
   *    delete of the same records. Both would then be racing the same provider ids, and the
   *    loser's 404 would be swallowed as success, which is a wrong answer arrived at by luck.
   */
  release(): Promise<void> {
    if (this.leaseState === "attached" || this.leaseState === "released") {
      return Promise.resolve();
    }
    if (this.leaseState === "indeterminate") {
      // Once, however many callers ask. The refusal is one fact about one allocation, and the
      // create catch has already said the same thing; repeating it per release would make a
      // retried teardown look like several separate leaks.
      if (this.allocation.created.length > 0 && !this.refusalLogged) {
        this.refusalLogged = true;
        const hosts = [
          ...new Set(this.allocation.created.flatMap((s) => s.hosts ?? [])),
        ];
        this.log(
          `[daytona-secrets] retained n=${this.allocation.created.length} ` +
            `hosts=[${hosts.join(",")}] reason=create-outcome-unknown`,
        );
      }
      return Promise.resolve();
    }
    this.pendingRelease ??= this.deleteAndMarkReleased();
    return this.pendingRelease;
  }

  private pendingRelease?: Promise<void>;
  /** Whether the `indeterminate` refusal has already been said. See `release`. */
  private refusalLogged = false;

  /** The one delete every overlapping `release` awaits. Clears itself so a failure can retry. */
  private async deleteAndMarkReleased(): Promise<void> {
    try {
      await deleteDaytonaSecrets(this.allocation, this.api, this.log);
      this.leaseState = "released";
    } finally {
      this.pendingRelease = undefined;
    }
  }
}

/**
 * True when a Daytona failure means "the resource is already gone": the SDK's typed
 * not-found error, or any 404-shaped error object. The one absence predicate shared by
 * Secret cleanup here and the sandbox lifecycle wrapper (`daytona-secret-provider.ts`).
 */
export function isDaytonaNotFound(error: unknown): boolean {
  return (
    error instanceof DaytonaNotFoundError ||
    (typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 404)
  );
}

/**
 * True when a Daytona failure means "this API key is not allowed to do that".
 *
 * Worth recognizing on its own because it has exactly one cause in practice and a completely
 * different fix from every other failure here. A Daytona API key is minted with a set of
 * permissions, and a key that can create sandboxes does not necessarily have the separate
 * permission to manage Secrets. When it does not, every run with a hideable credential fails at
 * sandbox creation, and the raw provider message says nothing about the flag that caused it.
 */
export function isDaytonaPermissionDenied(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = "statusCode" in error ? error.statusCode : undefined;
  if (status === 401 || status === 403) return true;
  const message = "message" in error ? String(error.message) : "";
  return /\b(403|401)\b|forbidden|not authorized|unauthorized|permission/i.test(
    message,
  );
}

/** The message an operator can act on, instead of a bare provider status code. */
export const DAYTONA_SECRETS_PERMISSION_MESSAGE =
  "Daytona refused to manage Secrets with this API key. " +
  "This runner hides each model and MCP key by storing it as a Daytona Secret, which is the " +
  "default, and that needs an API key allowed to manage Secrets, not only to create " +
  "sandboxes. Grant that permission to the key in AGENTA_RUNNER_DAYTONA_API_KEY. If you " +
  "would rather send credentials to the sandbox as plain environment variables, which lets " +
  "the agent read them, set AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS=off.";

async function deleteIdempotently(
  api: DaytonaSecretApi,
  id: string,
): Promise<void> {
  try {
    await api.delete(id);
  } catch (error) {
    if (!isDaytonaNotFound(error)) throw error;
  }
}

function assertCreatedSecret(
  secret: DaytonaSecretRecord,
  expectedName: string,
  candidate: DaytonaSecretCandidate,
): DaytonaSecretRecord {
  if (secret.name !== expectedName) {
    throw new Error("Daytona Secret has an unexpected generated name.");
  }
  if (
    !secret.hosts ||
    secret.hosts.length !== 1 ||
    secret.hosts[0] !== candidate.allowedHost
  ) {
    throw new Error("Daytona Secret has an unexpected host restriction.");
  }
  if (
    !secret.id ||
    !secret.placeholder ||
    !secret.placeholder.startsWith("dtn_secret_") ||
    secret.placeholder === candidate.value
  ) {
    throw new Error(
      "Daytona did not return a valid opaque Secret placeholder.",
    );
  }
  return secret;
}

function generatedName(candidate: DaytonaSecretCandidate): string {
  return `agenta_${randomBytes(18).toString("hex")}_${candidate.ordinal}`;
}

/**
 * Allocate every Secret before sandbox create, compensating in reverse order on any failure.
 *
 * `log` gets one line per allocation and deletion with the COUNT, the allowed HOSTS, and the
 * elapsed time — never an id, a generated name, a placeholder, or a value. This is a deliberate,
 * narrow exception to the delivery layer's log-nothing rule: Daytona applies a new Secret's
 * substitution rule asynchronously, and diagnosing a raw-placeholder 401 (see
 * `classifyRunError`'s `credential_delivery_failed`) needs the create/delete timeline that today
 * has to be reconstructed by inference from eviction lines. Hosts are config, not credential
 * material (the same hosts appear in the vault UI and in the resolved-model log line).
 */
export async function allocateDaytonaSecrets(
  plan: DaytonaSecretPlan,
  api: DaytonaSecretApi,
  nameFor: (candidate: DaytonaSecretCandidate) => string = generatedName,
  log: (message: string) => void = () => {},
): Promise<DaytonaSecretAllocation> {
  const startedAt = Date.now();
  const created: DaytonaSecretRecord[] = [];
  const attachments: Record<string, string> = {};
  const mcpHeaderPlaceholders: Record<string, Record<string, string>> = {};
  const bySlot = new Map<CredentialSlotKey, DaytonaSecretRecord>();
  try {
    for (const candidate of plan.candidates) {
      const name = nameFor(candidate);
      let rawSecret: DaytonaSecretRecord;
      try {
        rawSecret = await api.create({
          name,
          value: candidate.value,
          description: "Agenta process-local sandbox credential",
          hosts: [candidate.allowedHost],
        });
      } catch (error) {
        // Re-raise a permission refusal as an actionable message. Everything else keeps its
        // original error, and either way the catch below compensates for what was created.
        if (isDaytonaPermissionDenied(error)) {
          throw new Error(DAYTONA_SECRETS_PERMISSION_MESSAGE, { cause: error });
        }
        throw error;
      }
      // Track the provider record before validating returned metadata. If the provider returns a
      // malformed placeholder or host list, compensation must still delete the record it made.
      if (rawSecret.id) created.push(rawSecret);
      const secret = assertCreatedSecret(rawSecret, name, candidate);
      bySlot.set(slotKey(credentialSlotFor(candidate)), secret);
      if (candidate.consumer.kind === "model") {
        attachments[candidate.binding.name] = secret.name;
      } else {
        attachments[`AGENTA_MCP_SECRET_${candidate.ordinal}`] = secret.name;
        (mcpHeaderPlaceholders[candidate.consumer.server] ??= {})[
          candidate.binding.name
        ] = secret.placeholder;
      }
    }
    if (created.length > 0) {
      const hosts = [...new Set(plan.candidates.map((c) => c.allowedHost))];
      log(
        `[daytona-secrets] allocated n=${created.length} hosts=[${hosts.join(",")}] ` +
          `ms=${Date.now() - startedAt}`,
      );
    }
    return { attachments, mcpHeaderPlaceholders, created, bySlot };
  } catch (cause) {
    const cleanupFailures: unknown[] = [];
    for (const secret of [...created].reverse()) {
      try {
        await deleteIdempotently(api, secret.id);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [cause, ...cleanupFailures],
        "Daytona Secret allocation failed and compensation was incomplete.",
      );
    }
    throw cause;
  }
}

/** Delete one allocation in reverse creation order. Missing provider records are success. */
export async function deleteDaytonaSecrets(
  allocation: DaytonaSecretAllocation,
  api: DaytonaSecretApi,
  log: (message: string) => void = () => {},
): Promise<void> {
  const startedAt = Date.now();
  const failures: unknown[] = [];
  for (const secret of [...allocation.created].reverse()) {
    try {
      await deleteIdempotently(api, secret.id);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Daytona Secret cleanup was incomplete.",
    );
  }
  if (allocation.created.length > 0) {
    const hosts = [
      ...new Set(allocation.created.flatMap((s) => s.hosts ?? [])),
    ];
    log(
      `[daytona-secrets] deleted n=${allocation.created.length} hosts=[${hosts.join(",")}] ` +
        `ms=${Date.now() - startedAt}`,
    );
  }
}
