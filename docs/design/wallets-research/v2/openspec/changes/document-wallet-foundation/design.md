## Context

Source: [Wave 1](../../../../v1/wave-1.md), [entities](../../../../v1/entities.md), and `api/ee/src/core/wallets/`, `measurements/`, and their PostgreSQL and worker implementations at the pinned PR head. The foundation code is implemented, but this documentation change is not an archived main-branch specification. Current settlement serialization prevents duplicate settlement; it does not prevent two provider requests from passing an earlier non-reserving check. Restricted selection exists at settlement, not action-aware admission. The current expiry and repeated-plan-transition gaps are tracked in the hardening change. Existing test reports are historical evidence; no runtime suite was rerun for this package.

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
