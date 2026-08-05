/**
 * `CredentialDeliveryPort` — how a rotated credential reaches an ALREADY-CREATED sandbox.
 *
 * LIFECYCLE MIGRATION, STEP 8 (lane s7e). REVISION 2, after an external security review REJECTED
 * revision 1. That review's findings are recorded at the bottom of this file, because each one
 * describes a way the type could have looked correct and enforced nothing. This follows the
 * `AcquireContext` precedent from s7b, which went the same way for the same reason.
 *
 * Revision 1 was rejected on three overstated guarantees and one unresolvable conflict: a false
 * account of where secrets live, a "structurally fail-closed" commit token that any caller could
 * fabricate, a logging union that provider-controlled numbers could ride, and a propagation window
 * that Daytona does not bound. Every one is addressed below; none is argued away.
 *
 * WHAT THIS FILE CONTAINS. Types, plus the few CONCRETE primitives the review required to be real
 * code rather than an interface someone could implement wrongly: the secret holder, the slot-key
 * canonicalizer, the duration validator, and the trusted coordinator that mints the commit token.
 * The untrusted half — a provider's actual delivery implementation — lives elsewhere and can only
 * reach applied state through the coordinator here.
 *
 * ============================================================================================
 * THE PROBLEM, STATED EXACTLY
 * ============================================================================================
 *
 * Credential VALUES are excluded from every facet digest, because digests are logged and a digest
 * over a small field space is guessable. So a rotated secret moves no facet and the reconciliation
 * router cannot see it. Rotation is tracked separately by the credential EPOCH, an opaque
 * timing-safe comparison. Today the coordinator's answer to a changed epoch is to evict and
 * cold-start: `mismatch:credentials-rotated` maps to the `runtime-incompatible` teardown reason,
 * which DELETES the sandbox.
 *
 * Mahmoud's Q5 requirement is that a rotated Daytona model key restarts AT MOST the daemon and
 * never rebuilds the sandbox. THE SECURITY REVIEW RULED THAT DAYTONA CANNOT MEET IT TODAY, and
 * section "RULING B" below records why, what would change it, and what this file does meanwhile.
 * Q5 is reopened with Mahmoud rather than quietly satisfied by a weaker mechanism.
 *
 * ============================================================================================
 * THE FIVE REVIEWER QUESTIONS, ANSWERED — CORRECTED IN REVISION 2
 * ============================================================================================
 *
 * ---- 1. WHERE THE SECRET IS, IN TRANSIT AND AT REST ----
 *
 * REVISION 1 CLAIMED "exactly two places, for one dispatch". THAT WAS FALSE, and the review was
 * right to fail it. The accurate account:
 *
 *   a. The decoded `AgentRunRequest` holds raw values for the life of the dispatch.
 *   b. `CredentialMaterial` (session-identity.ts:144) holds the RAW CANONICAL JSON of every
 *      credential value in `#canonical`. It is deliberately NOT a hash — that file explains that
 *      hashing a low-entropy key protects little and invites the misreading that it is a password
 *      hash. So the epoch IS credential material, not a digest of it.
 *   c. `LiveSession.credentialEpoch` (session-pool.ts:52) retains that material for the WHOLE
 *      PARKED LIFETIME of a session, which is the point of the epoch: a parked session must be
 *      able to answer "is the incoming material the same?" without re-deriving anything.
 *   d. This port adds one more residency, and it is why the port is bound to an environment: the
 *      private slot-to-record state below, holding provider record HANDLES (id, name, placeholder,
 *      hosts). A handle is not a value, but it is how the value is updated and deleted, so it is
 *      treated as secret-equivalent and never leaves the port.
 *
 * WHAT THIS PORT DOES NOT ADD: no new copy of a VALUE. Values reach the port through
 * `DisclosableSecret` and leave it only through a provider control-plane call.
 *
 * ON `DisclosableSecret`. Revision 1 declared it as an interface and claimed a private field. An
 * interface cannot enforce a private field, and no type can stop a consumer callback from
 * retaining the string it is handed. Revision 2 therefore ships a CONCRETE class (below) and
 * narrows the claim to what the class actually does:
 *
 *   IT DOES: keep the value in a true `#private` field with no accessor; drop that field before
 *   the consumer runs; refuse a second read by throwing rather than returning undefined; and stub
 *   all three stringification hooks, so a value cannot surface through `console.log` of any object
 *   that merely contains the holder.
 *
 *   IT DOES NOT: erase the string (JavaScript cannot), or prevent the one callback that
 *   legitimately receives the value from copying it. That second one is a CODE REVIEW obligation
 *   on a single named call site, not a property of this type, and it is written here so nobody
 *   mistakes it for one.
 *
 * ---- 2. PUSH OR PULL ----
 *
 * PUSH. Unchanged from revision 1, and the one claim the review passed outright.
 *
 * PULL IS REFUSED because the fetch grant is itself a bearer credential, and it would live inside
 * the sandbox — where `adapter-matrix.md` 4.3.1 has already established that no channel can be
 * trusted. Pull trades a secret the sandbox never sees for a credential the sandbox must hold.
 *
 * ---- 3. WHAT INVALIDATES THE OLD CREDENTIAL, AND WHEN ----
 *
 * REVISION 1 CLAIMED install and invalidate are the same call, "so there is no window". The review
 * ruled that PARTIAL: the SDK does update a record by id and keep the placeholder stable, but a
 * rotated value takes effect at egress only "within seconds". Corrected:
 *
 *   THE VAULT RECORD IS REPLACED ATOMICALLY. `secret.update(id, {value})` replaces the stored
 *   value on an existing record, and the placeholder is documented as `dtn_secret_<id>`, so the
 *   reference the sandbox holds is stable across the update. The port MUST assert that the
 *   returned id and placeholder are unchanged and fail closed if either moved, because a moved
 *   placeholder means the sandbox now holds a dangling reference.
 *
 *   INVALIDATION IS NOT COMPLETE UNTIL PROPAGATION IS. Between the update returning and the egress
 *   layer applying it, an outbound request may still be substituted with the PREVIOUS value. So
 *   the old credential is invalidated "at the vault" immediately and "in effect" only after
 *   propagation, and no comment, log line, or document may collapse those two into one.
 *
 * For the restart mechanism the old value lives in the running consumer's environment and its
 * invalidation IS the death of that process: install, restart, CONFIRM the restart, and only then
 * delete references the new set dropped. Deleting first would break a sandbox that is still
 * serving; if the restart cannot be confirmed, the old process may still hold the old value, so
 * that path fails closed to a rebuild.
 *
 * WHAT THE RUNNER CANNOT DO, AND MUST NOT CLAIM: it cannot revoke the UPSTREAM key. Deleting or
 * replacing a vault record removes this environment's ability to USE a credential; the key stays
 * valid at the model provider until its owner revokes it there. Always "invalidated FOR THIS
 * ENVIRONMENT", never "revoked".
 *
 * ---- 4. FAIL-CLOSED SEMANTICS ON PARTIAL DELIVERY ----
 *
 * REVISION 1 CLAIMED this was structural because only the success variant carried applied state.
 * The review failed it: those were ordinary exported structural objects, so any caller could
 * fabricate a success — including one with `holdTurnForMs: 0` — and the PROVIDER returned the very
 * duration that was supposed to constrain it.
 *
 * REVISION 2 MAKES IT ACTUALLY STRUCTURAL, in three moves:
 *
 *   a. `AppliedCredentialState` carries a brand keyed by a module-private `unique symbol`. The
 *      symbol is not exported, so no code outside this module can name the key, so no code outside
 *      this module can construct the value — not with an object literal, and not with a cast that
 *      typechecks.
 *   b. The PORT no longer returns applied state or any duration. It returns a narrow outcome. The
 *      only thing that mints applied state is `runCredentialDelivery` below, on an outcome it
 *      validated itself.
 *   c. The hold duration is DERIVED BY THE COORDINATOR from the validated capability, never taken
 *      from the provider's result. A provider cannot shorten its own quarantine.
 *
 * A partial delivery remains worse than no delivery, so a failure carries the teardown reason the
 * caller must use, and that reason DELETES the sandbox rather than parking it.
 *
 * ---- 5. LOGGING ----
 *
 * REVISION 1's union had no free-text field, but the review ruled it PARTIAL: TypeScript object
 * types are open to extra properties, provider-controlled numbers were neither derived nor
 * bounded, and `slotCount` leaked credential topology while being ambiguous for removals.
 *
 * REVISION 2: `slotCount` IS GONE. The port receives NO logger at all. The coordinator constructs
 * every event itself, from values it derived — the mechanism it validated, a reason from a closed
 * union, and the hold it computed. Nothing a provider returns is ever formatted into a log line.
 * That is the "construct events inside a trusted logger" ruling, taken literally.
 *
 * Forbidden everywhere, restated because it is the rule people break by accident: no value, no
 * digest of a value, no length, no record name, no placeholder, no binding name, no allowed host,
 * and no provider error text.
 *
 * ============================================================================================
 * RULING B: WHY ROTATE-IN-PLACE IS INELIGIBLE ON DAYTONA TODAY
 * ============================================================================================
 *
 * The security review mandated REBUILD for Daytona, and this file implements that ruling as DATA
 * rather than as a missing mechanism, so re-enabling it later is a capability flip and not a
 * redesign. Two reasons, both of which must be answered before the flip:
 *
 *   1. "WITHIN SECONDS" IS NOT A BOUND. There is no honest value for `withinMs`. A number chosen
 *      by us would be a guess presented as a guarantee, which is the failure mode this project has
 *      already refused once (the reopen verification that would have verified nothing).
 *
 *   2. HOLDING THE TURN IS NOT ENOUGH ANYWAY, and this is the deeper objection. Holding the turn
 *      quiesces only the turn. Under the untrusted-sandbox premise the sandbox may be running
 *      resident code of its own, and that code can keep making outbound requests throughout the
 *      wait — with the previous value still being substituted. A quiescence that does not quiesce
 *      the actual threat is theatre.
 *
 * WHAT WOULD MAKE IT ELIGIBLE, stated so the ask to the provider is concrete: atomic EFFECTIVE
 * replacement (the update returns only once no further egress can use the old value), or a hard
 * propagation bound COMBINED with sandbox-wide egress quiescence for its duration, or an
 * equivalent proof. Any one of those turns `daytonaCredentialCapabilities` below from `unbounded`
 * into a bounded declaration, and nothing else in the design moves.
 *
 * CONSEQUENCE FOR Q5: with Daytona ineligible, a credential rotation rebuilds the sandbox today,
 * which is what Q5 asked us to stop doing. That conflict is Mahmoud's to resolve; it is recorded
 * here rather than resolved by weakening the mechanism.
 */
import { inspect } from "node:util";

// ============================================================================================
// SECRET HOLDERS
// ============================================================================================

/**
 * An opaque, comparison-only credential epoch.
 *
 * Structural on purpose: the existing `CredentialMaterial` satisfies it as-is, so there is exactly
 * one secret-comparison idiom in the runner. Note what this interface does NOT imply — see
 * residency point (b) above: `CredentialMaterial` holds raw canonical material, not a digest, and
 * the pool retains it for a parked session's whole life.
 */
export interface OpaqueCredentialEpoch {
  equals(other: OpaqueCredentialEpoch): boolean;
}

/**
 * A raw secret value on its way to the provider control plane, readable exactly once.
 *
 * A CONCRETE CLASS, not an interface, because the review ruled that an interface cannot enforce
 * any of what revision 1 claimed. Read the class body as the whole of the guarantee.
 *
 * WHAT IT GUARANTEES: one reader, enforced by throwing on the second call; no accessor to grep
 * for; no accidental stringification through any of the three hooks.
 *
 * WHAT IT DOES NOT GUARANTEE, stated plainly so it is never mistaken for more:
 *   - It does not ERASE anything. Dropping the field makes the holder inert and lets the string
 *     become collectable; JavaScript offers no way to zero it.
 *   - It does not stop `consume` from retaining the value. Exactly one call site is allowed to
 *     receive it — the provider control-plane call — and keeping that site free of copies is a
 *     code-review obligation on that site, not a property of this class.
 */
export class DisclosableSecret {
  #value: string | undefined;

  constructor(value: string) {
    this.#value = value;
  }

  /** True once the value has been handed over. A spent holder is inert, not empty. */
  get spent(): boolean {
    return this.#value === undefined;
  }

  /**
   * Hand the value to exactly one consumer.
   *
   * THROWS on a second call rather than returning `undefined`, because a silent second read is how
   * a use-once rule quietly stops being one. The field is cleared BEFORE `consume` runs, so a
   * re-entrant call cannot get a second look either.
   */
  async useOnce<R>(consume: (value: string) => Promise<R>): Promise<R> {
    const value = this.#value;
    if (value === undefined) {
      throw new Error("credential holder already spent");
    }
    this.#value = undefined;
    return consume(value);
  }

  toString(): string {
    return "[disclosable-secret]";
  }

  toJSON(): string {
    return "[disclosable-secret]";
  }

  [inspect.custom](): string {
    return "[disclosable-secret]";
  }
}

// ============================================================================================
// SLOT IDENTITY
// ============================================================================================

/**
 * Which consumer a credential belongs to.
 *
 * `mount` is deliberately absent: mount credentials EXPIRE rather than rotate and are repaired by
 * re-signing and remounting. Conflating the two is risk 9 of the lifecycle research, by name.
 */
export type CredentialConsumer =
  | { readonly kind: "model" }
  | { readonly kind: "mcp"; readonly server: string };

/**
 * The full, typed identity of one credential slot.
 *
 * REVISION 2 CHANGE. Revision 1 keyed secrets by a bare `string`, which the review ruled not
 * collision-safe. It also required the DELIVERY POLICY to travel with the identity, because where
 * a credential lands (`environment` vs `header`) and which host it may be substituted into are
 * what make delivery correct — and `allowedHost` in particular is the whole basis of the hiding
 * feature: a wrong host lets the agent exfiltrate the key with one request to a server it controls.
 *
 * These fields mirror `DaytonaSecretCandidate` deliberately, so there is one vocabulary for a
 * credential slot across the create-time and delivery-time paths.
 */
export interface CredentialSlot {
  readonly consumer: CredentialConsumer;
  readonly binding: {
    readonly kind: "environment" | "header";
    readonly name: string;
  };
  /** The single DNS hostname this credential may be substituted into. Never a wildcard. */
  readonly allowedHost: string;
}

/**
 * A collision-safe key for a slot. Branded so it cannot be confused with any other string, and so
 * it can only come from `slotKey` below.
 */
export type CredentialSlotKey = string & { readonly __slotKey: unique symbol };

/**
 * Canonical, collision-safe key for a slot.
 *
 * LENGTH-PREFIXED, not delimiter-joined. A delimiter is only unambiguous if it cannot appear in
 * the parts, and MCP server names and binding names are caller-supplied — so `a:b` and `a` + `:b`
 * would collide under any fixed separator. Prefixing each part with its length removes the
 * question entirely.
 */
export function slotKey(slot: CredentialSlot): CredentialSlotKey {
  const parts =
    slot.consumer.kind === "model"
      ? ["model", "", slot.binding.kind, slot.binding.name, slot.allowedHost]
      : [
          "mcp",
          slot.consumer.server,
          slot.binding.kind,
          slot.binding.name,
          slot.allowedHost,
        ];
  return parts
    .map((part) => `${part.length}:${part}`)
    .join("|") as CredentialSlotKey;
}

/** One slot and the value destined for it. */
export interface CredentialDeliveryEntry {
  readonly slot: CredentialSlot;
  readonly secret: DisclosableSecret;
}

/**
 * The COMPLETE desired credential set for this request. Never a delta.
 *
 * LEVEL-TRIGGERED, AS AN INVARIANT, matching `desired-state.ts`. Delivery installs the whole
 * desired set computed from the CURRENT request alone. A delta-based delivery would be
 * edge-triggered, and one missed dispatch would leave an environment holding material no request
 * ever described — undetectably, because values are in no digest.
 */
export interface DesiredCredentialSet {
  readonly entries: readonly CredentialDeliveryEntry[];
  /** The opaque epoch over the whole set. The router compares it; nothing else may read it. */
  readonly epoch: OpaqueCredentialEpoch;
}

// ============================================================================================
// CAPABILITIES AND THE PURE PLANNER
// ============================================================================================

/**
 * How a delivery reaches an already-created sandbox, cheapest first.
 *
 * The mapping onto the router's existing `ActionKind` vocabulary adds no new kind:
 *
 *   `rotate-in-place` -> `apply-live`      on the `runtime` facet
 *   `restart-runtime` -> `restart-runtime` on the `runtime` facet
 *   `rebuild-sandbox` -> `rebuild-sandbox` on the `runtime` facet
 *
 * RULING A, RECORDED HERE BECAUSE IT IS A SAFETY PROPERTY: mapping onto `apply-live` puts a
 * CREDENTIAL change on a live route for the first time, and the exact-set guard over
 * `LIVE_ACTION_KINDS` stays SILENT about it, because `apply-live` is already a member. The review
 * accepted the mapping on three conditions, all of them lane obligations: a dedicated
 * credential-route test, a REWRITE (not a deletion) of the router's KNOWN DISAGREEMENTS block, and
 * a fix to that file's stale "EXACTLY TWO" comment, which now guards four kinds.
 */
export type CredentialDeliveryMechanism =
  | "rotate-in-place"
  | "restart-runtime"
  | "rebuild-sandbox";

/**
 * How long a provider may take to apply a rotated value at its EGRESS layer.
 *
 * `unbounded` is not a missing measurement, it is a refusal: a provider that cannot state a bound
 * is ineligible for `rotate-in-place`, full stop. Daytona declares `unbounded` today (RULING B),
 * and eligibility returns by changing this value alone.
 */
export type EgressPropagation =
  | { readonly kind: "bounded"; readonly withinMs: number }
  | { readonly kind: "unbounded" };

/**
 * The longest hold the coordinator will ever accept from a capability declaration.
 *
 * A cap rather than a trusted number, per the review's "validate bounds as finite, non-negative,
 * capped durations". A provider claiming a ten-minute propagation window has not described a live
 * route; it has described a rebuild with extra steps.
 */
export const MAX_PROPAGATION_HOLD_MS = 30_000;

/** What a provider can do about credentials on a LIVE sandbox. A pure, synchronous declaration. */
export interface CredentialDeliveryCapabilities {
  /** Whether the sandbox holds REFERENCES rather than values. Required for `rotate-in-place`. */
  readonly referenceIndirection: boolean;
  /** Whether the mounted reference SET can be replaced on a live sandbox at all. */
  readonly canReplaceSlotSet: boolean;
  /** Whether a consumer process can be restarted without rebuilding the sandbox. */
  readonly canRestartConsumer: boolean;
  /** Meaningful only when `referenceIndirection` is true. */
  readonly egressPropagation: EgressPropagation;
}

/**
 * Daytona, as ruled by the security review. THIS IS THE DATA THE RULING LIVES IN.
 *
 * Everything needed for `rotate-in-place` is present EXCEPT a propagation bound, and that one
 * absence is what makes the cheap route ineligible. When the provider offers atomic effective
 * replacement, or a hard bound with egress quiescence, this becomes
 * `{ kind: "bounded", withinMs: <their number> }` and nothing else in the design moves.
 */
export const daytonaCredentialCapabilities: CredentialDeliveryCapabilities = {
  referenceIndirection: true,
  canReplaceSlotSet: true,
  canRestartConsumer: true,
  egressPropagation: { kind: "unbounded" },
};

/** The local provider: the daemon environment is frozen before it starts, so nothing is live. */
export const localCredentialCapabilities: CredentialDeliveryCapabilities = {
  referenceIndirection: false,
  canReplaceSlotSet: false,
  canRestartConsumer: false,
  egressPropagation: { kind: "unbounded" },
};

/** What changed between the applied set and the desired one. Derived, never supplied. */
export interface CredentialDelta {
  /** True when the epochs differ. The only rotation signal that exists; it names no slot. */
  readonly rotated: boolean;
  /** True when the desired slot IDENTITIES differ from the applied ones. */
  readonly slotSetChanged: boolean;
}

/**
 * A delivery plan: what delivering this set would cost, decided WITHOUT touching a secret.
 *
 * Terraform's plan-then-apply, the same split the reconciliation router already uses. The planner
 * is pure and secret-free so the router (which must stay pure) can call it; only `deliver` ever
 * holds a value. Note there is NO duration here: revision 1 put one in the plan and let the
 * provider echo it back, which the review failed. The coordinator derives the hold.
 */
export interface CredentialDeliveryPlan {
  readonly mechanism: CredentialDeliveryMechanism;
  readonly delta: CredentialDelta;
}

/**
 * Decide the mechanism. PURE: no I/O, no secret, no environment.
 *
 * Each rule fails toward the more expensive answer:
 *
 *   1. Nothing changed                                     -> no delivery at all (`undefined`).
 *   2. The sandbox holds REFERENCES and the provider does
 *      not bound its egress propagation                    -> `rebuild-sandbox`.
 *   3. The slot SET changed, and the provider can replace
 *      it and restart the consumer                         -> `restart-runtime`.
 *   4. Values changed behind a stable reference set, and
 *      the provider BOUNDS its egress propagation          -> `rotate-in-place`.
 *   5. Values changed, the sandbox holds VALUES, and the
 *      consumer can be restarted                           -> `restart-runtime`.
 *   6. Anything else                                       -> `rebuild-sandbox`.
 *
 * RULE 2 IS RULING B, AND IT IS FIRST FOR A REASON THAT COST ME A BUG. My first draft ordered the
 * rules so an unbounded reference provider fell through to `restart-runtime`, which LOOKS
 * conservative — a restart is more expensive than a rotation — and is in fact WRONG AND UNSAFE.
 * When the sandbox holds a placeholder, restarting the consumer hands the new process THE SAME
 * PLACEHOLDER. Nothing about the value changes; only the provider's egress substitution can do
 * that, on its own unbounded schedule. So a restart would report a delivery it did not perform,
 * and applied state would advance over a credential that may still resolve to the old value.
 *
 * A more expensive action is only "safer" when it actually delivers. Rule 2 says: if the material
 * lives behind a reference the runner cannot make effective within a known bound, the only honest
 * answer is to replace the thing that holds the reference. That is the rebuild the review
 * mandated, reached by the rules rather than by a special case for Daytona.
 *
 * Returns `undefined` for "no delivery needed" rather than a no-op plan, so a caller cannot run a
 * delivery that has nothing to deliver.
 */
export function planCredentialDelivery(
  capabilities: CredentialDeliveryCapabilities,
  desired: DesiredCredentialSet,
  applied: AppliedCredentialState | undefined,
): CredentialDeliveryPlan | undefined {
  const desiredKeys = new Set(
    desired.entries.map((entry) => slotKey(entry.slot)),
  );
  const appliedKeys = applied?.slotKeys;
  const rotated = applied ? !applied.epoch.equals(desired.epoch) : true;
  const slotSetChanged =
    !appliedKeys ||
    appliedKeys.length !== desiredKeys.size ||
    appliedKeys.some((key) => !desiredKeys.has(key));

  if (!rotated && !slotSetChanged) return undefined;

  const delta = { rotated, slotSetChanged };
  const boundedReferences =
    capabilities.referenceIndirection &&
    capabilities.egressPropagation.kind === "bounded";

  // RULE 2 / RULING B. Behind an unbounded reference no runner action makes the new material
  // effective, so nothing short of replacing the sandbox delivers. Restarting would install the
  // same placeholder and report a success it did not earn.
  if (capabilities.referenceIndirection && !boundedReferences) {
    return { mechanism: "rebuild-sandbox", delta };
  }
  if (slotSetChanged) {
    return capabilities.canReplaceSlotSet && capabilities.canRestartConsumer
      ? { mechanism: "restart-runtime", delta }
      : { mechanism: "rebuild-sandbox", delta };
  }
  if (boundedReferences) return { mechanism: "rotate-in-place", delta };
  return capabilities.canRestartConsumer
    ? { mechanism: "restart-runtime", delta }
    : { mechanism: "rebuild-sandbox", delta };
}

/**
 * The mechanism for a VALUE-ONLY rotation across an unchanged slot set.
 *
 * WHY THIS EXISTS SEPARATELY FROM `planCredentialDelivery`. That function needs an
 * `AppliedCredentialState`, which is branded and can only be minted by a successful delivery — so
 * nothing can call it until an environment has already delivered once. The coordinator needs an
 * answer BEFORE that: today it knows only that the credential epoch moved, because the epoch
 * comparison is all that exists until the Daytona identity split lands.
 *
 * This is the same rule set with `slotSetChanged` fixed to false, so the two can never disagree
 * about a rotation. It is deliberately NOT a general entry point: it answers one question.
 */
export function mechanismForRotation(
  capabilities: CredentialDeliveryCapabilities,
): CredentialDeliveryMechanism {
  const boundedReferences =
    capabilities.referenceIndirection &&
    capabilities.egressPropagation.kind === "bounded";
  // RULING B first, for the reason on `planCredentialDelivery`: behind an unbounded reference a
  // restart delivers nothing, so it must not be offered as if it were the safer answer.
  if (capabilities.referenceIndirection && !boundedReferences) {
    return "rebuild-sandbox";
  }
  if (boundedReferences) return "rotate-in-place";
  return capabilities.canRestartConsumer ? "restart-runtime" : "rebuild-sandbox";
}

// ============================================================================================
// APPLIED STATE — THE COMMIT TOKEN
// ============================================================================================

/**
 * The brand that makes applied state unforgeable.
 *
 * `unique symbol`, declared here and NOT exported. Code outside this module cannot name the
 * property key, so it cannot write an object literal of this type and cannot cast its way into one
 * either. This is the structural half the review failed revision 1 for missing.
 */
declare const CREDENTIAL_COMMIT_BRAND: unique symbol;

/**
 * What an environment has actually INSTALLED. The `status` to `DesiredCredentialSet`'s `spec`.
 *
 * NO VALUES AND NO DIGESTS OF VALUES. The epoch is the opaque holder and the slots are branded
 * keys. There is deliberately no field a later change could widen into something loggable.
 *
 * IT IS MINTED ONLY BY `runCredentialDelivery`. That is what makes "applied state advances only on
 * full success" a property of the type system rather than of everyone's good intentions.
 */
export interface AppliedCredentialState {
  readonly [CREDENTIAL_COMMIT_BRAND]: true;
  readonly epoch: OpaqueCredentialEpoch;
  readonly slotKeys: readonly CredentialSlotKey[];
  readonly installedBy: CredentialDeliveryMechanism;
}

// ============================================================================================
// THE PORT: BOUND TO ONE ENVIRONMENT
// ============================================================================================

/** Why a delivery failed. A CLOSED union: it is the only thing logged about a failure. */
export type CredentialDeliveryFailureReason =
  /** The provider refused or errored while updating a stored value. */
  | "vault-update-failed"
  /** The update returned a different record id or placeholder: the reference moved. */
  | "reference-identity-moved"
  /** The mounted reference set could not be replaced. */
  | "slot-set-update-failed"
  /** The consumer process did not restart, or its restart could not be confirmed. */
  | "consumer-restart-unconfirmed"
  /** A reference the new set dropped could not be deleted, so it may still be usable. */
  | "stale-reference-not-removed"
  /** The plan's mechanism is not something this provider can perform. */
  | "mechanism-unsupported"
  /** The entries did not match the plan, or a holder was already spent. A runner bug. */
  | "invalid-delivery-input"
  /** The port threw. Treated as a failure, never as a partial success. */
  | "port-threw";

/**
 * What a provider's delivery implementation returns. DELIBERATELY NARROW.
 *
 * It carries NO applied state and NO duration — revision 1 let the provider supply both, and the
 * review failed it because a provider could then fabricate its own success and shorten its own
 * quarantine. A provider reports only whether every step it performed succeeded, and which slots
 * it ended up with.
 */
export type CredentialDeliveryOutcome =
  | {
      readonly ok: true;
      /** The slots now installed. The coordinator checks these against the desired set. */
      readonly slotKeys: readonly CredentialSlotKey[];
    }
  | { readonly ok: false; readonly reason: CredentialDeliveryFailureReason };

/**
 * One provider's credential-delivery implementation, BOUND TO ONE ENVIRONMENT.
 *
 * REVISION 2 CHANGE, per the review: revision 1 had neither a sandbox target nor the record handles
 * needed to update and clean up, which made it unimplementable. A port instance is created for one
 * sandbox and privately retains the slot-to-record state — `{id, name, placeholder, hosts}` per
 * slot — for that sandbox's lifetime. THAT STATE IS NOT IN THIS INTERFACE and must not be exposed
 * by any implementation: a record handle is how a value is updated and deleted, so it is
 * secret-equivalent.
 *
 * DELIBERATELY NOT PART OF `SandboxProviderAdapter`: a provider that cannot deliver credentials
 * declares capabilities saying so and implements nothing, rather than carrying a method that
 * throws at the one moment a real secret is in flight.
 */
export interface CredentialDeliveryPort {
  /** Pure, synchronous, secret-free. Safe for the router to consult. */
  readonly capabilities: CredentialDeliveryCapabilities;

  /** Identifies the environment, for the coordinator's per-environment serialization. */
  readonly environmentId: string;

  /**
   * Perform the plan. ALL-OR-NOTHING. Called ONLY by `runCredentialDelivery`.
   *
   * Contract, in the order it must hold:
   *
   *  1. Install the new material. For `rotate-in-place` that is one update per slot against the
   *     retained record id; it MUST assert the returned id and placeholder are unchanged and
   *     return `reference-identity-moved` if either did.
   *  2. For `restart-runtime`, install first, then restart the consumer, then CONFIRM the restart.
   *  3. Remove references the new set dropped — LAST, and never before the steps above succeeded.
   *  4. Report `ok: true` only when every step succeeded.
   *
   * It must not attempt compensation that could leave a third state: the caller destroys, which is
   * always sound. It must never throw for an environment condition; a throw is a runner bug and
   * the coordinator records it as `port-threw`.
   *
   * NOTE ON WHAT IT MAY NOT DO: it may not log. Logging is the coordinator's, from values the
   * coordinator derived.
   */
  deliver(
    plan: CredentialDeliveryPlan,
    desired: DesiredCredentialSet,
  ): Promise<CredentialDeliveryOutcome>;
}

// ============================================================================================
// THE TRUSTED COORDINATOR
// ============================================================================================

/**
 * The teardown reason a failed delivery forces. Part of the failure VALUE rather than a rule in a
 * comment, so a caller holding the failure holds the correct disposition. `runtime-incompatible`
 * deletes the sandbox; that is the existing mapping for `credentials-*`, not weakened here.
 */
export type CredentialTeardownReason = "runtime-incompatible";

export type CredentialDeliveryResult =
  | {
      readonly ok: true;
      readonly applied: AppliedCredentialState;
      /** Derived by the coordinator from the validated capability. Never provider-supplied. */
      readonly holdTurnForMs: number;
    }
  | {
      readonly ok: false;
      readonly reason: CredentialDeliveryFailureReason;
      readonly teardown: CredentialTeardownReason;
    };

/**
 * Everything that may be said about a delivery. Constructed ONLY by the coordinator, from values it
 * derived itself. No `slotCount` (the review removed it: it leaks credential topology and is
 * ambiguous for removals), no provider numbers, no free text.
 */
export type CredentialDeliveryLogEvent =
  | {
      readonly event: "planned";
      readonly mechanism: CredentialDeliveryMechanism;
    }
  | {
      readonly event: "delivered";
      readonly mechanism: CredentialDeliveryMechanism;
      readonly holdTurnForMs: number;
    }
  | {
      readonly event: "failed";
      readonly mechanism: CredentialDeliveryMechanism;
      readonly reason: CredentialDeliveryFailureReason;
    };

export type CredentialDeliveryLog = (event: CredentialDeliveryLogEvent) => void;

/**
 * Per-environment serialization. Two deliveries against one sandbox must never interleave: they
 * would race on the same records, and the loser could leave the environment holding a mixture no
 * request ever described.
 *
 * Module-level and keyed by environment id, so serialization holds even if more than one
 * coordinator exists in the process. Entries are removed when their chain drains.
 */
const inFlightByEnvironment = new Map<string, Promise<unknown>>();

/** The validated hold for a mechanism, derived from the capability. Never from the provider. */
function holdForMechanism(
  mechanism: CredentialDeliveryMechanism,
  capabilities: CredentialDeliveryCapabilities,
): number | undefined {
  if (mechanism !== "rotate-in-place") return 0;
  const propagation = capabilities.egressPropagation;
  if (propagation.kind !== "bounded") return undefined;
  const { withinMs } = propagation;
  if (!Number.isFinite(withinMs) || withinMs < 0) return undefined;
  if (withinMs > MAX_PROPAGATION_HOLD_MS) return undefined;
  return withinMs;
}

/** Whether this provider could ever perform `mechanism`. The gate a caller cannot talk past. */
function mechanismIsSupported(
  mechanism: CredentialDeliveryMechanism,
  capabilities: CredentialDeliveryCapabilities,
): boolean {
  if (mechanism === "rotate-in-place") {
    return (
      capabilities.referenceIndirection &&
      capabilities.egressPropagation.kind === "bounded"
    );
  }
  if (mechanism === "restart-runtime") return capabilities.canRestartConsumer;
  return false; // `rebuild-sandbox` is not a delivery at all.
}

/**
 * Run a delivery. THE ONLY WAY TO OBTAIN AN `AppliedCredentialState`.
 *
 * This is the trusted wrapper the review required, and it owns four things the port may not:
 *
 *  1. PLAN VALIDATION. The mechanism must be one THIS capability set supports, so a caller cannot
 *     hand a `rotate-in-place` plan to a provider that declared `unbounded`.
 *  2. BOUND VALIDATION. The hold is derived here, checked finite, non-negative and capped, and an
 *     unusable bound fails the delivery instead of defaulting to zero.
 *  3. PROPAGATION WAITING. The coordinator waits before returning success, so a caller cannot skip
 *     the quarantine by ignoring a field. (RULING B: this wait is NOT sufficient on its own under
 *     the untrusted-sandbox premise, which is exactly why Daytona is ineligible today. It exists
 *     for a provider that also quiesces egress.)
 *  4. COMMIT-TOKEN MINTING. The brand is private to this module, so this function is the only place
 *     applied state can come into existence.
 *
 * It also verifies that what the provider says it installed MATCHES the desired set. A provider
 * that reports success with the wrong slots has not succeeded.
 */
export async function runCredentialDelivery(
  port: CredentialDeliveryPort,
  plan: CredentialDeliveryPlan,
  desired: DesiredCredentialSet,
  log: CredentialDeliveryLog,
  deps: { readonly wait?: (ms: number) => Promise<void> } = {},
): Promise<CredentialDeliveryResult> {
  const fail = (
    reason: CredentialDeliveryFailureReason,
  ): CredentialDeliveryResult => {
    log({ event: "failed", mechanism: plan.mechanism, reason });
    return { ok: false, reason, teardown: "runtime-incompatible" };
  };

  if (!mechanismIsSupported(plan.mechanism, port.capabilities)) {
    return fail("mechanism-unsupported");
  }
  const hold = holdForMechanism(plan.mechanism, port.capabilities);
  if (hold === undefined) return fail("mechanism-unsupported");
  if (desired.entries.length === 0) return fail("invalid-delivery-input");
  if (desired.entries.some((entry) => entry.secret.spent)) {
    return fail("invalid-delivery-input");
  }

  log({ event: "planned", mechanism: plan.mechanism });

  // Serialize per environment: chain onto whatever is in flight for this sandbox, and never
  // inherit its failure.
  const previous =
    inFlightByEnvironment.get(port.environmentId) ?? Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(async (): Promise<CredentialDeliveryResult> => {
      let outcome: CredentialDeliveryOutcome;
      try {
        outcome = await port.deliver(plan, desired);
      } catch {
        // The provider error is deliberately not read: provider messages echo request content.
        return fail("port-threw");
      }
      if (!outcome.ok) return fail(outcome.reason);

      // What it says it installed must be what was asked for.
      const desiredKeys = desired.entries
        .map((entry) => slotKey(entry.slot))
        .sort();
      const installed = [...outcome.slotKeys].sort();
      const matches =
        installed.length === desiredKeys.length &&
        installed.every((key, index) => key === desiredKeys[index]);
      if (!matches) return fail("invalid-delivery-input");

      if (hold > 0) await (deps.wait ?? defaultWait)(hold);

      log({
        event: "delivered",
        mechanism: plan.mechanism,
        holdTurnForMs: hold,
      });
      return {
        ok: true,
        applied: {
          [CREDENTIAL_COMMIT_BRAND]: true,
          epoch: desired.epoch,
          slotKeys: desiredKeys,
          installedBy: plan.mechanism,
        },
        holdTurnForMs: hold,
      };
    });

  inFlightByEnvironment.set(port.environmentId, run);
  try {
    return await run;
  } finally {
    if (inFlightByEnvironment.get(port.environmentId) === run) {
      inFlightByEnvironment.delete(port.environmentId);
    }
  }
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * ============================================================================================
 * WHAT THIS PORT DOES NOT DO, ON PURPOSE
 * ============================================================================================
 *
 * 1. IT DOES NOT TOUCH MOUNT CREDENTIALS. Those expire rather than rotate; risk 9 by name.
 * 2. IT DOES NOT DECIDE WHETHER TO DELIVER. The router does, from the epoch comparison.
 * 3. IT DOES NOT EXPOSE A RAW-SECRET ACCESSOR, and no revision may add one.
 * 4. IT DOES NOT VERIFY THAT THE HARNESS TOOK THE CREDENTIAL, because nothing observable does.
 *    The ordering in question 3 is what makes a silent failure loud; a fabricated check would only
 *    make it invisible.
 *
 * ============================================================================================
 * DEPENDENCY ON THE DAYTONA CREATION-IDENTITY SPLIT (lifecycle step 9)
 * ============================================================================================
 *
 * This port is inert until that split lands, and the reason is concrete: `provider.ts` builds the
 * create fingerprint over `{image, create, secretPlan}`, `DaytonaSecretCandidate.value` is inside
 * that plan, and `daytona-secret-provider.ts` DESTROYS the sandbox on reconnect when the
 * fingerprint differs. So today a rotated value fails the create-fingerprint comparison and the
 * sandbox is gone before any delivery could run. The split moves credential material OUT of
 * `SandboxGenerationId` and into mutable applied state reconciled on reconnect, failing closed.
 *
 * ============================================================================================
 * REVIEW RECORD
 * ============================================================================================
 *
 * Revision 1 was REJECTED by external security review. Every finding is addressed above; none was
 * argued away.
 *
 * | Finding | Ruling | Where it is fixed |
 * |---|---|---|
 * | "Exactly two places" was false: `CredentialMaterial` retains raw canonical material and the pool retains the epoch while parked | Fail | Question 1, rewritten with the four real residencies and file references |
 * | An interface cannot enforce a private field, nor stop the callback retaining the string | Fail | `DisclosableSecret` is a concrete class; the claim is narrowed to what it does, and the callback obligation is named as code review |
 * | `install == invalidate` does not mean "no window": rotated egress values take effect only "within seconds" | Partial | Question 3 splits vault invalidation from effective invalidation; the port must assert id and placeholder are unchanged (`reference-identity-moved`) |
 * | Success token was an ordinary structural object any caller could fabricate, with a provider-supplied hold | Fail | Private `unique symbol` brand; the port returns a narrow outcome; the coordinator derives the hold and mints the token |
 * | Logging union: object types are open, provider numbers unbounded, `slotCount` leaks topology | Partial | `slotCount` removed; the port receives no logger; the coordinator constructs every event from its own values |
 * | No environment binding and no record handles, so the port was unimplementable | Required | `environmentId` plus privately retained slot-to-record state, explicitly outside this interface |
 * | `ReadonlyMap<string, …>` is not a collision-safe key | Required | Typed composite `CredentialSlot` with binding and allowed host, and a length-prefixed `slotKey` |
 * | Plan validation, propagation waiting, and minting were spread across untrusted callers | Required | `runCredentialDelivery`, which also caps durations and serializes per environment |
 *
 * RULING A adopted: `apply-live` accepted, with the credential-route test, the KNOWN GAP rewrite,
 * and the stale "EXACTLY TWO" comment fix as lane obligations.
 *
 * RULING B adopted: Daytona declares `unbounded`, so `rotate-in-place` is ineligible and a rotation
 * rebuilds today. The conflict with Q5 is Mahmoud's to resolve, and re-enabling the route is a
 * change to `daytonaCredentialCapabilities` alone.
 */
export type CredentialDeliveryPortReviewRecord = never;
