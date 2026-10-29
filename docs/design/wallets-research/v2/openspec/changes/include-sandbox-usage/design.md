## Context

Mahmoud confirmed the included-sandbox approach for specification. Final run limits, second allowances, reset anchoring, supported compute classes, idle/storage treatment and overage default remain unselected. Start with one fixed compute class and seconds rather than unbounded run-count pricing. Reuse existing entitlement and meter concepts, but add real reservation/settlement state where current counters are insufficient. A shared billing coordinator selects coverage; the sandbox controller starts/stops bounded provider work. It is not the managed-tool executor. Free, lifetime and subscription offers use the same mechanism with different configuration. General credits remain optionally grantable to any eligible offer. A mixed allowance-and-wallet reservation needs atomic coordination or a durable compensating state machine; a check-then-debit pair is not sufficient. Unknown outcomes remain pending until provider work is bounded or reconciled.

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
