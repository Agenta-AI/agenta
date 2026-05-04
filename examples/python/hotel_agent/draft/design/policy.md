# Hotel Agent — Policy

Status: **Done**. The set of rules the agent must reason over and obey. Designed to be:

- **Explicit** enough to encode in service-layer enforcement.
- **Compact** enough to embed in the system prompt.
- **Edge-case-rich** enough to be the basis of meaningful evals (tau-bench style).

When a rule changes, both the system prompt and the service-layer check change together. Treat this doc as the source of truth.

## Hotel context

- Single property: **The Agenta Grand Hotel**, ~120 rooms.
- Local time zone applies to all "before check-in" cutoffs.
- Check-in time is **3pm local**; checkout is **11am local** (unless modified per §9).
- All amounts in USD.

## 1. Identity & authentication

The agent must verify guest identity before any modification or in-stay request. Verification is one of:

- An authenticated session (guest is logged in), or
- Booking confirmation ID + last name on the booking.

Policy lookups, search, and pricing are public — no auth required.

## 2. Guest tiers

| Tier | How earned (out of scope to enforce) | Overrides |
|---|---|---|
| Standard | Default | None |
| Gold | Set in seed data | Cancellation cutoff −18h; free late checkout to 2pm; mod fee waived |
| Platinum | Set in seed data | All Gold benefits; one complimentary single-tier upgrade per stay (subject to availability, day-of only); resort fee waived (§4) |

## 3. Rate types

| Rate | Cancellable? | Modifiable? | Notes |
|---|---|---|---|
| Flexible | Yes, free up to cutoff | Yes, free up to cutoff | Default rate |
| Advance | Yes, but 50% credit only (no cash refund) up to cutoff | Yes, but only date shift; no room-class change | ~15% cheaper |
| Non-refundable | No | No | ~25% cheaper; only escalation can override |

## 4. Fees & taxes

The agent must always quote **all-in totals** when booking or modifying. Search results may show the base room rate, but a quote leading to confirmation must include every charge below.

- **Room rate** × number of nights, per the rate type (§3).
- **Occupancy tax**: 14% on the room rate (not on resort fee).
- **Resort fee**: **$35/night**, mandatory on all rates and all room types. **Waived for Platinum** (§2). Charged in full to Gold and Standard.
- **Pet fee**: $100/stay per pet (see §10).
- **Add-ons**: breakfast, late checkout, etc. — at posted prices.

A common failure mode is quoting the room rate alone and surprising the guest at checkout — this is a refusal-equivalent failure and a top eval target.

## 5. Cancellation

- **Cutoff**: 24h before check-in (Standard), 6h before (Gold/Platinum).
- **Inside cutoff**: cancellation requires escalation; no agent authority.
- **Flexible**: full refund.
- **Advance**: 50% as future-stay credit.
- **Non-refundable**: no refund; escalation only.

A cancellation must be **initiated** before the cutoff to qualify. If the guest neither cancels nor checks in, see §6 (no-show).

## 6. No-show

A no-show is failing to check in by **11:59pm local time on the scheduled check-in date** without a prior cancellation. Distinct from cancellation in two important ways:

- **No agent override.** At 11:59pm on the check-in date the booking is auto-marked no-show by the system. Reversing a no-show charge requires escalation, *regardless of amount* (see §11).
- **Different financial treatment by rate type:**

| Rate | No-show treatment |
|---|---|
| Flexible | First night charged in full; remaining nights released (no further charge, no refund) |
| Advance | First night charged in full (no 50% credit); remaining nights released as 50% future-stay credit |
| Non-refundable | Full booking forfeit (all nights, no credit) |

**Proactive behavior**: if a guest is on the line close to the no-show cutoff and hasn't checked in or canceled, the agent should warn them and offer to cancel or extend.

## 7. Modifications

- Free if ≥ 48h before check-in, otherwise $25 fee (waived for Gold/Platinum).
- Maximum **2 modifications** per booking; further modifications require escalation.
- Date change cannot cross a rate-season boundary (peak/off-peak) without rebooking.
- Room class **upgrade** is treated as a modification + price difference (always allowed if available).
- Room class **downgrade** is treated as a modification + refund of the difference (Flexible only).
- Guest count can increase up to room capacity; decrease is free.

## 8. Upgrades

- **Paid**: always allowed when inventory exists; charge difference.
- **Complimentary** (Platinum only): one per stay; same-day request only; one tier up only; subject to availability.
- The agent must *offer* the complimentary upgrade if eligible and inventory exists, without being asked.

## 9. In-stay services

| Service | Default | Overrides |
|---|---|---|
| Late checkout | Up to 1pm free; $25/hr after; max 4pm | Free to 2pm for Gold/Platinum; max 4pm |
| Housekeeping request | Free | — |
| Wake-up call | Free; max one active per booking | — |
| Room service | Free to order; menu prices apply | — |

## 10. Pets

- **Pet fee**: $100 per stay, per pet (not per night).
- **Limits**: maximum **2 pets** per booking; **weight limit 50 lbs** per pet.
- **Inventory**: pet-friendly rooms are a *subset* of inventory. Search and booking must check pet-room availability separately — a room being available does not mean it accepts pets.
- **Service animals**: always permitted regardless of pet limits, weight, fee, or pet-room inventory. The agent must **accept a guest's statement** that an animal is a service animal — no documentation required, no questions asked (matches ADA).
- **Refusal alternatives**: when refusing on weight or count, the agent should offer the kennel-partner referral. When refusing on pet-room inventory, the agent should offer alternative dates or pet-friendly room types.

## 11. Agent authority limits (escalation triggers)

The agent must hand off to a human when:

- A refund or credit > **$200** is requested.
- **Any** override of a no-show charge is requested (regardless of amount).
- A non-refundable rate is being challenged (illness, bereavement, weather, etc.).
- A modification beyond the cap (2) is requested.
- A complaint involves another guest, staff conduct, or property damage.
- The guest explicitly asks for a human.
- Confidence in policy interpretation is low (escalate rather than guess).

## 12. Refusal behavior

When the agent declines a request on policy grounds it must:

1. State *which* rule applies.
2. State the cutoff/limit numerically (don't be vague — "24 hours before check-in", not "shortly before").
3. Offer the closest available alternative (e.g., "I can't refund this, but I can hold it as a future-stay credit"; or for pets, the kennel-partner referral).
4. Offer escalation if the guest pushes back.

## 13. Eval-friendly edge cases

Deliberate ambiguity points designed to surface in evals:

- **Gold + Advance + 8h before check-in** → inside Gold cutoff (6h)? yes → cancellable → 50% credit. (Not cash, not full refund.)
- **Platinum has 2 mods, asks for a 3rd** → policy says escalate, *not* refuse. Does the agent escalate?
- **Non-refundable + illness** → escalate (compassion exception is human authority, not the agent's).
- **Date change crossing peak boundary** → must rebook, not modify.
- **Comp upgrade requested 3 days out** → policy says day-of only → refuse but offer paid upgrade.
- **Standard guest, mod 30h out** → free cancel window (24h) but inside free-mod window (48h) — mod costs $25, cancel-and-rebook is free. Does the agent surface the cheaper option?
- **Quote pricing for Platinum** → must exclude resort fee from total. Common failure: agent forgets the override and includes it.
- **Quote pricing for Gold** → resort fee charged in full ($35/night). Common failure: agent assumes all elite tiers are waived.
- **Search shows room at $200, guest asks for "total for 2 nights"** → must include taxes + resort fee + any pet fee, not just $400.
- **Flexible-rate booking, no-show** → first night charged, remaining released. Did the agent over-refund?
- **Non-refundable, no-show** → full forfeit. Did the agent under-charge by applying the §6 first-night-only rule?
- **60-lb dog request** → refuse on weight; offer kennel referral. Don't accept.
- **"My emotional support animal weighs 80 lbs"** → service animal exception applies in the agent's policy interpretation; no fee, no weight check. (Note: ESAs and service animals have different legal statuses in real life — the demo simplifies by treating the guest's declaration as authoritative.)
- **3-pet booking** → refuse on count cap.
- **Pet-friendly room not available on requested dates** → must offer alt dates or alt room types, not silently book a non-pet-friendly room.

## Decisions

These were open during draft and are now resolved.

- **Agent does not quote manager-only overrides.** Refusal must be grounded in what the agent (or escalation) *can* deliver, not speculation about what a manager *might* do. Avoids setting expectations the system can't honor; cleaner eval rubric.
- **Policy is encoded as a Pydantic-validated dict** the service consults — not a rules engine. Transparency (one human-readable source of truth), easy to embed in the system prompt, easy to A/B as prompt variants in Agenta. Refactor only if complexity outgrows the dict.
- **Refusals offer escalation on pushback only, not by default.** Default refusal = rule + numerical limit + closest alternative. Escalation surfaces if the guest expresses frustration or asks again. Offering escalation on every refusal trains guests to push every refusal up, defeating the agent's authority. This becomes its own eval target: did the agent escalate too eagerly?
- **ESA / service-animal simplification stays.** The demo treats any guest declaration as authoritative regardless of label, no fee or weight check. Real chains distinguish ADA service animals from FHA emotional support animals; modeling that requires a legal-knowledge sub-domain that's beside the point of the demo. Documented as a known simplification.
