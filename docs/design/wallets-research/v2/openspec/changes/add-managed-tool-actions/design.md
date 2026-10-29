## Context

The agreed structure separates public actions, integration-specific implementations, transport adapters, and shared financial coverage. Proposed OSS module: managed_tools/{types,registry,service,interfaces}.py, integrations/apollo/{actions,implementation}.py, and adapters for reused Composio/MCP/HTTP mechanics as actually needed. Add other integrations only when selected; do not create empty provider frameworks. Proposed EE module: usage_billing/{service,configuration,types}.py, injected through the OSS contract. No OSS import of EE implementation. Existing access, meters, wallets and measurements remain owners of their data. An illustrative apollo.enrich_person action can call an approved Composio operation, API or MCP server. No provider-specific action name, resale right, cost or production support is asserted. MCP client compatibility does not require Composio's upstream transport to be MCP. Preserve runner approvals and private-context handling when offering an MCP entry point.

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
