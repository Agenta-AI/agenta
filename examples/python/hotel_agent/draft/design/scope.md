# Hotel Agent — Functional Scope

Status: **Done**. Working scope for the demo agent. Frames *what the agent can accomplish*, not what tools it has — tool decomposition lives in `architecture.md` once stable.

## Framing

Capabilities are picked to **exercise the Agenta features we're demoing** (prompt management, evaluation, observability, online evaluation, annotation queues), not just for product realism. Every capability in this scope earns its keep against at least one of those.

The differentiator from a CRUD demo is the **policy layer** (see [`policy.md`](policy.md)) — concrete rules the agent must reason over, with edge cases that interact (rate type × tier × timing). This is the tau-bench-style core.

## Functional capabilities

Six things a guest can accomplish through the agent:

1. **Information & policy Q&A** — hotel info, amenities, neighborhood, and the policy itself. The KB must explicitly cover: wifi, parking, breakfast (hours/included?), pet policy, check-in/out times, amenities (pool, gym, spa), nearby restaurants/transit, accessibility, smoking, and the cancellation/modification policy itself. ("Can I cancel for free?", "are pets allowed?", "is breakfast included on my rate?")
2. **Discovery** — search availability for date ranges, see live pricing, compare room types/rates, see what's included.
3. **Booking lifecycle** — create, view, modify (dates, room, guest count), cancel — all subject to policy.
4. **In-stay support** — service requests (late checkout, housekeeping, maintenance, room service). Each request creates a **service ticket** routed to the right department (housekeeping, maintenance, F&B, front desk) with a priority — the agent doesn't fulfill in-stay tasks itself, it dispatches them. Subject to policy.
5. **Personalization** — recognize the guest, apply tier/preferences, surface tier-eligible offers/overrides.
6. **Escalation** — hand off when policy blocks the request, when authority is exceeded, on complaints, or on low confidence.

## Cross-cutting agent behaviors

Behaviors layered on top of the capabilities above. Worth calling out because they're prompt-engineerable (good targets for prompt variants in Agenta) and have their own eval rubrics.

- **Proactive upselling** — the agent should *offer* (not just respond to) at the right moments:
  - At booking: paid room upgrade if available and price-diff is reasonable.
  - Pre-arrival: late checkout (paid for Standard, free for Gold/Platinum at applicable hours), breakfast add-on if not included, airport transport if relevant.
  - At check-in (Platinum): the comp upgrade if eligible and inventory exists (per `policy.md` §6).
  - Eval rubric: did the agent offer when appropriate? Did it *not* offer when inappropriate (already-upgraded guest, hostile mood, just-resolved complaint)?

## Policy layer (cross-cutting)

All write operations and many reads are gated by an explicit policy. The policy is a first-class artifact — documented in [`policy.md`](policy.md), encoded as data in the service layer where it must be enforced, and surfaced in the system prompt where it must be reasoned about.

Eval surfaces this gives us:

- **Faithfulness** — does the agent quote the policy correctly?
- **Compliance** — does it refuse violations and not invent exceptions?
- **Edge-case handling** — tier × rate-type × timing interactions.
- **Annotation fodder** — "did the agent correctly apply the Platinum override?" is a great human-review task.

**Policy delivery: embed *and* RAG.** The policy *rules* (numbers, cutoffs, tier overrides) are embedded directly in the system prompt as compact tables — they need to be authoritative to minimize hallucination. The policy *rationales* and worked examples live in the KB and are retrieved on demand. This maximizes both demo surfaces: a tight system prompt and a real RAG flow.

## Foundational reads

Always available to the agent (no policy gate beyond authentication scope):

- **Live availability** by date range / room type
- **Live pricing** including taxes, fees, tier discounts, promo applicability
- **Guest profile** — tier, stay history, stored preferences
- **Existing bookings** for the authenticated guest

## Out of scope

Cuts to keep the demo from sprawling. Each row would add a service method, seed data, and test cases across **four runtimes**.

| Cut | Why |
|---|---|
| Real payments / Stripe | Big surface; not differentiating for an Agenta demo |
| Loyalty point math | Adds combinatorial load to evals without new pedagogy |
| Multi-language | Eval surface explodes; orthogonal to what we want to show |
| Calendar / OTA sync | External integration burden |
| Group bookings / events | Whole separate policy domain |

## Sizing target

~8–12 policy rules with documented edge cases. ~8–10 service methods total (the agent's effective "tool surface"). Caps the per-runtime port cost.

## Decisions

These were open during draft and are now resolved.

- **Async at the service layer.** All service methods are `async`. Every runtime targeted (OpenAI Agents SDK, Claude Agent SDK, PydanticAI, LangGraph) is async-native, and the SQLite layer will use `aiosqlite`. Sync would force per-runtime adapters.
- **"Current user" is an explicit param on service methods.** No contextvars, no implicit lookup. Explicit DI matches each runtime's tool-injection idiom (PydanticAI `RunContext[Deps]`, OpenAI `RunContext`, etc.) — see `inversion-of-control.md`. Tests stay simple.
- **No tau-bench-style env harness.** Service-level unit tests + Agenta evals cover what we need. A replay harness is a heavyweight separate workstream; revisit only if we hit a need the simpler stack can't address.
