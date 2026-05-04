# Cancellation — Rationale and Worked Examples

This page explains *why* the cancellation rules at The Agenta Grand Hotel work the way they do, and walks through common cases. The rules themselves are authoritative in the agent's system prompt; this document is for context, paraphrasing, and edge-case reasoning.

## Cutoffs

A cancellation must be **initiated before the cutoff** to qualify for the rate-type refund treatment below.

- **Standard tier:** 24 hours before scheduled check-in.
- **Gold and Platinum tiers:** 6 hours before scheduled check-in.

The shorter elite cutoff exists because elite guests cancel less frequently and we trust them to give us as much notice as they reasonably can. "Initiated" means the guest told the agent (or the front desk) to cancel — not that paperwork has finished. The timestamp of the request is what counts.

Inside the cutoff, the agent has no authority to cancel. It must offer escalation to a human, who may approve a goodwill exception.

## Refund treatment by rate type

What a guest gets back depends on which rate they booked:

- **Flexible:** full refund to the original payment method.
- **Advance:** 50% of the room charge as future-stay credit (no cash refund). Advance is sold at roughly 15% off Flexible because the guest accepts this softer cancellation outcome.
- **Non-refundable:** no refund and no credit. The agent cannot override this — only escalation can, and only on compassionate grounds (illness, bereavement, weather, etc.).

Resort fees and pet fees follow the room charge: when the booking is fully refunded, those are refunded too; when the booking is held as credit, those are folded into the credit; when the booking is forfeit, the guest is not charged the resort or pet fee on top.

## No-show is not the same as cancellation

If the guest neither cancels before the cutoff nor checks in by **11:59pm local time on the check-in date**, the booking is auto-marked **no-show** at midnight. No-show treatment is harsher than late cancellation and the agent has **no authority** to reverse a no-show charge — *every* no-show override goes to a human, regardless of dollar amount. See `policy/escalation.md`.

Worked examples for no-show treatment live in `policy/escalation.md` and the rate-type tables in the system prompt.

## Worked examples

**Sarah is Standard, books Flexible, cancels 30 hours before check-in.**
30h is outside the 24h Standard cutoff. The Flexible rate gets a full refund. The agent confirms the refund will go to Sarah's original payment method.

**Marco is Gold, books Advance, cancels 8 hours before check-in.**
8h is outside the 6h Gold cutoff. Advance does not get cash; Marco gets 50% of the room charge as future-stay credit. The agent quotes the credit amount and the resort/pet fees that are refunded.

**Priya is Standard, books Non-refundable, cancels 3 days before check-in.**
Plenty of time, but Non-refundable means no refund and no credit. The agent declines, names the rule and the cutoff, and notes that escalation is the only path to a discretionary exception.

**Liam is Platinum, books Flexible, calls 4 hours before check-in.**
Inside the 6h Platinum cutoff. The agent cannot cancel. It offers to escalate, and as an alternative offers to hold the reservation so Liam can decide later whether to check in.
