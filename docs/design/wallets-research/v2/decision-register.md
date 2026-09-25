# Original decisions and new refinements

The source register's status is not implementation proof or approval of commercial terms. Every original numbered item is retained below. Source: [JP wallet open-design register](../v1/open-designs.md). Original terminology is preserved in the topic column; short change names refer to the README mapping.

| Original item | Source status | Topic | Spec destination | Disposition |
| --- | --- | --- | --- | --- |
| 1 | Open | Resource taxonomy and fields | hardening; models; sandbox | Retain model/tool/compute units and distinguish included coverage from money; platform-capacity charging is not automatically in scope. |
| 2 | Decided: soft admission does not reserve | Non-reserving admission | baseline; model phase; hardening | Preserve the original behavior in its spec. Bounded reservation is a later safety refinement, not a delivered guarantee. |
| 3 | Open; machinery partly implemented | Immutable cancellation, expiry, clawback and plan changes | baseline; hardening; funding | Keep append-only history; resolve exact adjustment rules and recovery before enabling affected flows. |
| 4 | Decided direction; future implementation | Platform-capacity prepaid rollups and Stripe cutover | hardening (deferred) | Do not double-bill prepaid and Stripe arrears. Defer cutover unless selected; preserve late-event accounting. |
| 5 | Open | Allowance, rollover, credit line and auto-recharge | funding; hardening | Configure supported allowances. Final rollover/expiry/credit-line terms remain open. Automatic recharge is deferred. |
| 6 | Decided for model/tool representation; sandbox open | Metering entities | baseline; models; sandbox; managed tools | Retain measurement identity and trusted collector data; implement sandbox lifecycle separately. |
| 7 | Decided original behavior | Overflow and missing measurements | baseline; hardening | Original deficit settlement and best-effort first handoff remain documented; paid-launch recovery is a separate refinement. |
| 8 | Blocked on verification/commercial evidence | Provider proof and reconciliation | hardening; managed tools; release | Verify actual provider cost/rights and reconcile the selected enabled capability; no mock equals live proof. |
| 9 | Decided | Records, measurements, meters and wallets | baseline; all extensions | Keep existing domain ownership. No second ledger or replacement entitlement system. |
| 10 | Open; settlement serialization implemented | Concurrency, exposure, volume and recovery | baseline; hardening; sandbox | Do not confuse atomic settlement with pre-dispatch reservation. Redis exposure estimation is not selected. |
| 11 | Open; restricted settlement exists | Restricted credit applicability | baseline; hardening (optional) | Do not require restricted wallet allowances by default. Sandbox included units are a resource entitlement, not a general wallet grant. |
| 12 | Open; initial placement implemented | Store placement and cross-store correctness | baseline; hardening; reporting | Core wallet transaction stays together; tracing measurements remain separate. No new analytics/store topology without evidence. |
| 13 | Open; branch selection implemented | Earned-value expiry and spending order | baseline; funding | Preserve current behavior until an explicit policy change; do not reinterpret sold credit terms. |
| 14 | Decided and implemented | Missing wallet row after flag-off signup | baseline | Lazy provisioning restores the row, not missed monetary value. |
| 15 | Decided | Missed grants during flag-off period | hardening; funding | One-off job `entrypoints.backfill_wallet_signup_grants` over the idempotent award, run by an operator before the flag is turned on. Eligibility and amount stay product decisions. |
| 16 | Open | Rate-card ownership and review | models; configuration | Resolve operator ownership and review path; shared pricing must not multiply by transport. |
| 17 | Open | Meaning/enforcement of admission ceiling | models; hardening | Original phase carries ceiling without enforcing it. Later paid execution needs an enforceable exposure policy. |
| 18 | Open | Provider-cost unit and rounding | models; hardening | Document units and precision, store evidence, and round customer debit once at its defined boundary. |
| 19 | Open | Model catalog and rate-card synchronization | models; configuration | Unpriced paid routes stay disabled; update rates with model catalog changes through validation. |
| 20 | Open | Terminal messages and stream retention | hardening | Define inspectable failure handling, recovery and capacity assumptions; no unbounded blind retry or silent financial loss claim. |
| 21 | Decided | Expired value in general balance | hardening | Admission reads a derived spendable value (general minus expired remainder, one statement). An expiry debit that reconciles the two projections is still item 3's. |
| 22 | Decided 2026-09-25: subscription lock serializes changes (option 2); failed-adjustment recovery (option 3) deferred | Identity of a plan transition | hardening; funding | Distinct genuine changes within one period need distinct identities; retries must retain the same identity. |

## New direction from this conversation

- Confirmed: lifetime credit purchases do not require a recurring subscription.
- Confirmed for specification: included sandbox usage independent of wallet credit, and a managed integration/action structure with provider-independent contracts.
- Confirmed: commercial amounts and rules should be configurable; final numbers are not required before implementation.
- Not selected: included quantities, machine classes, reset anchor, automatic wallet overage default, expiry/rollover terms, launch models or connector actions, provider resale permission and final release scope.
- Proposed refinement: reserve bounded paid execution and durably recover financial outcomes. JP's original second phase intentionally has no reservations, prices asynchronously and permits loss of the first measurement handoff. Do not change that phase's scope silently.
- Proposed refinement: pin the applicable rate for a reserved request. Original second-phase worker-version stamping is not equivalent to request-time rate pinning.
- MCP is an optional client/transport surface for managed actions. The existing gateway design calls for a common enforcement boundary. Do not infer approval to remove a gateway, migrate all Composio execution to MCP, or bypass existing approvals.

## Deferred work retained

Hierarchy-owned wallets/budgets, speculative analytics rollup tables, historical balance snapshots, broad store separation, automatic recharge, enterprise credit lines, all-provider coverage and advertising/media spend are not selected for this package's initial implementation. Platform-capacity prepaid cutover must avoid overlap with existing Stripe billing if later selected. Lifetime marketplace redemption integration is separate from the confirmed top-up requirement.
