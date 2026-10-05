## Context

Source: [open designs](../../../../v1/open-designs.md), [deferred scope](../../../../v1/out-of-scope.md), and [handoff](../../../../v1/HANDOFF.md). `decision-register.md` is the complete item-by-item mapping. The original pipeline intentionally tolerates loss of the first usage message and does not reserve at admission. Durable recovery and bounded paid dispatch here are proposed production refinements, not silent restatements of delivered behavior. Wallet core accounting remains authoritative; measurement storage remains a distinct usage record. Reuse existing components and introduce only the durable reservation/recovery state needed for the selected paid capability. Do not preselect Redis exposure estimation, separate stores, or a new analytics database.

## Goals / Non-Goals

Implement only the capability boundaries described here after separate implementation authorization. Do not create another ledger, replace existing entitlements, or require every backlog item for one release. Numeric examples are synthetic, not approved prices.

## Decisions

Reuse organization identity, permissions, secrets, entitlements, meters, wallet accounting and measurement infrastructure. A plan entitlement is not an active Stripe subscription. Keep provider credentials server-side and separate policy, routing, request data, usage facts, and financial records.

## Risks / Trade-offs

Concurrent execution, duplicate events, expired value, unknown provider outcomes and delayed measurements can create incorrect balances if treated as ordinary request retries. Validate enabled behavior against exact source revisions and provider evidence. Passing OpenSpec validation is not runtime evidence.

## Migration Plan

Land focused changes behind independent controls. Preserve existing credentials and balances. Test flag-off and open-source behavior. Enable only the approved subset with monitoring and rollback; never erase financial history to roll back behavior.

## Open Questions

See ../../../decision-register.md for unresolved policy and technical choices. Resolve only those needed by the selected implementation slice. Do not infer approval of a price, provider, expiry, or overage policy from this specification.
