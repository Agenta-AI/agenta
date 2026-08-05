/**
 * The Daytona half of `CredentialDeliveryPort`: how a rotated value reaches a LIVE sandbox.
 *
 * LIFECYCLE MIGRATION, STEP 8. The port TYPE and its trusted coordinator live in
 * `credential-delivery-port.ts`, which carries the security review and the Q5 ruling. This file is
 * the untrusted half that ruling describes: one provider's implementation, reachable only through
 * `runCredentialDelivery`, holding no ability to mint applied state, to choose its own quarantine,
 * or to log.
 *
 * WHAT ROTATION MEANS HERE, precisely. The sandbox holds `dtn_secret_<id>` placeholders, never
 * values; Daytona substitutes the real value at its egress layer for requests to the record's one
 * allowed host. So replacing the VALUE on an existing record changes nothing the sandbox can
 * observe — the placeholder it was created with is still the placeholder it holds. That is the
 * whole reason a rotation can be cheaper than a rebuild, and it is also why this implementation
 * MUST verify that the record identity did not move: a moved id or placeholder would leave the
 * sandbox holding a reference to a record that no longer carries the credential, and the run would
 * fail later, somewhere else, for a reason nobody could trace back to here.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *  - It does not compensate. A partial update leaves the environment in a state no request
 *    described, and the caller's answer to that is to destroy the sandbox, which is always sound.
 *    An unwind here could only add a third state.
 *  - It does not log. Not the record id, not the name, not the placeholder, not the host, not the
 *    provider's error text (provider messages echo request content). The coordinator logs, from a
 *    closed union of values it derived itself.
 *  - It does not touch mount credentials. Those expire rather than rotate.
 */
import type { AgentRunRequest } from "../protocol.ts";
import {
  buildDaytonaSecretPlan,
  credentialSlotFor,
} from "../engines/sandbox_agent/daytona-secret-plan.ts";
import type {
  DaytonaSecretApi,
  DaytonaSecretRecord,
} from "../engines/sandbox_agent/daytona-secrets.ts";
import {
  DisclosableSecret,
  daytonaCredentialCapabilities,
  slotKey,
  type CredentialDeliveryCapabilities,
  type CredentialDeliveryOutcome,
  type CredentialDeliveryPlan,
  type CredentialDeliveryPort,
  type CredentialSlotKey,
  type DesiredCredentialSet,
  type OpaqueCredentialEpoch,
} from "./credential-delivery-port.ts";

export interface DaytonaCredentialDeliveryDeps {
  /** The sandbox this port is bound to. The key the coordinator serializes deliveries on. */
  readonly environmentId: string;
  readonly api: DaytonaSecretApi;
  /**
   * The record handles this sandbox's allocation produced, per slot. PRIVATE to the port: a
   * handle is how a value is updated and deleted, so it is treated as secret-equivalent and is
   * deliberately absent from `CredentialDeliveryPort`.
   */
  readonly bySlot: ReadonlyMap<CredentialSlotKey, DaytonaSecretRecord>;
  /**
   * Capability override, for tests and for the day the provider's propagation statement changes.
   * Eligibility for the live route is a CAPABILITY VALUE, not a branch: take the bound away and
   * `runCredentialDelivery` refuses this port without another line changing anywhere.
   */
  readonly capabilities?: CredentialDeliveryCapabilities;
}

/**
 * Build the port for one already-created Daytona sandbox.
 *
 * Bound to one environment because the record handles are: a port that could reach another
 * sandbox's records would be a way to rotate a credential the current request never described.
 */
export function createDaytonaCredentialDeliveryPort(
  deps: DaytonaCredentialDeliveryDeps,
): CredentialDeliveryPort {
  const capabilities = deps.capabilities ?? daytonaCredentialCapabilities;
  return {
    capabilities,
    environmentId: deps.environmentId,
    deliver: (plan, desired) =>
      deliverDaytonaRotation(deps.api, deps.bySlot, plan, desired),
  };
}

/**
 * Perform one rotation. ALL-OR-NOTHING, in the order the port contract fixes.
 *
 * Only `rotate-in-place` is implementable here. A `restart-runtime` delivery would mean restarting
 * the consumer process, and behind a placeholder that installs the SAME reference and delivers
 * nothing — the trap `planCredentialDelivery`'s rule 2 exists to stop. Refusing it is not a
 * limitation to fix later; it is the honest answer for a reference-indirection provider.
 */
async function deliverDaytonaRotation(
  api: DaytonaSecretApi,
  bySlot: ReadonlyMap<CredentialSlotKey, DaytonaSecretRecord>,
  plan: CredentialDeliveryPlan,
  desired: DesiredCredentialSet,
): Promise<CredentialDeliveryOutcome> {
  if (plan.mechanism !== "rotate-in-place") {
    return { ok: false, reason: "mechanism-unsupported" };
  }

  const desiredKeys = desired.entries.map((entry) => slotKey(entry.slot));
  // The installed set must END UP exactly the desired set, and a value rotation cannot add or
  // remove a reference: the sandbox was created holding these placeholders and nothing short of a
  // new sandbox changes which ones it holds. So a desired slot with no record, or a retained
  // record no desired slot names, is a SLOT-SET change this mechanism cannot perform. Checking it
  // before the first update keeps the refusal free of side effects.
  if (desiredKeys.length !== bySlot.size) {
    return { ok: false, reason: "slot-set-update-failed" };
  }
  const records: Array<{
    key: CredentialSlotKey;
    record: DaytonaSecretRecord;
  }> = [];
  for (const key of desiredKeys) {
    const record = bySlot.get(key);
    if (!record) return { ok: false, reason: "slot-set-update-failed" };
    records.push({ key, record });
  }

  // Sequential, never concurrent: two updates against one organization's records have no ordering
  // guarantee worth relying on, and a failure part-way through is the case the caller's destroy
  // already covers. Speed is not the constraint here — there are a handful of slots at most.
  for (const [index, { record }] of records.entries()) {
    const entry = desired.entries[index]!;
    let updated: Pick<DaytonaSecretRecord, "id" | "placeholder">;
    try {
      updated = await entry.secret.useOnce((value) =>
        api.update(record.id, { value }),
      );
    } catch {
      // The provider's message is deliberately not read: provider errors echo request content.
      return { ok: false, reason: "vault-update-failed" };
    }
    // THE CHECK THE SECURITY REVIEW REQUIRED. The vault value is replaced atomically and the
    // placeholder is documented as stable across an update, so a moved id or placeholder means the
    // reference the sandbox holds no longer names the record we just wrote. Fail closed: the
    // caller destroys, and the next turn creates a sandbox holding references that exist.
    if (
      updated.id !== record.id ||
      updated.placeholder !== record.placeholder
    ) {
      return { ok: false, reason: "reference-identity-moved" };
    }
  }

  return { ok: true, slotKeys: records.map(({ key }) => key) };
}

/**
 * The COMPLETE desired credential set for a request, in delivery vocabulary.
 *
 * Built from `buildDaytonaSecretPlan`, which is the runner's one decomposition of a request into
 * credential slots — the same function the create path allocates from. Deriving the delivery set
 * any other way would let the two drift, and a drifted slot key rotates nothing while reporting
 * success.
 *
 * LEVEL-TRIGGERED: every hideable credential the CURRENT request carries, never a delta. Returns
 * undefined when the request has none, because a delivery with nothing to deliver is not a cheaper
 * rotation, it is a claim that one happened.
 *
 * It never throws. `buildDaytonaSecretPlan` validates and rejects (a prohibited binding, a missing
 * endpoint), and on this path a rejection means "this request cannot be delivered live" — which is
 * a rebuild, not a failed turn.
 */
export function desiredCredentialSetFor(
  request: AgentRunRequest,
  epoch: OpaqueCredentialEpoch,
): DesiredCredentialSet | undefined {
  let candidates;
  try {
    candidates = buildDaytonaSecretPlan({
      ...(request.modelConnection
        ? { modelConnection: request.modelConnection }
        : {}),
      ...(request.mcpServers ? { mcpServers: request.mcpServers } : {}),
    }).candidates;
  } catch {
    return undefined;
  }
  if (candidates.length === 0) return undefined;
  return {
    entries: candidates.map((candidate) => ({
      slot: credentialSlotFor(candidate),
      secret: new DisclosableSecret(candidate.value),
    })),
    epoch,
  };
}
