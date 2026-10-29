## Context

Source: [Wave 2](../../../../v1/wave-2.md), [work packages](../../../../v1/wps-2.md), [integration checks](../../../../v1/ims-2.md), and [cleanup](../../../../v1/cus-2.md). The original ownership split used two branches, but gateway PR #6049 is now merged; refresh implementation placement before starting. Sequence: shared contracts and component vocabulary, review, usage capture and pricing in parallel, integration proof, admission and composition-root wiring, final acceptance, removal of production dependence on test fakes. Original design prices asynchronously using the worker's applied version. Pinning price before dispatch and reserving funds are later refinements, not claims about JP's phase. The phase cannot become real revenue without a real platform-funded endpoint.

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
