# Open wallet designs

This is the working register for design decisions that are still open. It is deliberately
shorter than the research corpus: each item contains enough context to discuss it without
having read the surrounding reports.

## How to use this document

- Discuss one open item at a time. Update its decision and status here when it closes.
- Do not rely on chat history or another document for essential context: add a concise
  explanation, concrete example, and the consequences of each choice to the item itself.
- `Open` means no decision yet. `Blocked` means a fact or external decision is needed.
  `Decided` means the outcome is recorded here and the canonical documents still need (or
  have received) the corresponding edit.
- `entities.md` is canonical for Wave 1 names, schema, stream contracts, and store placement.
  `mechanics.md` remains canonical only for the three-class model, enumerations, and conversions.
  Earlier proposals and the report remain evidence, but may contain superseded terminology or schema.

## Next checkpoint design gate

Checkpoint 0 is the relational/lifecycle foundation. Wave 1 is planned to reach checkpoint 1. That
foundation established
the wallet transaction unit, internal FKs, external-ID rule, and no-cascade lifecycle. Physical
database placement and retention duration remain separate architecture work.

Wave 1 uses the selected portions of items 9–12: a gateway owns raw measurements and charge
calculation; the wallet receives an immutable, gateway-decided posting. The remaining L1 exposure,
concurrency, reconciliation, and broader store-topology questions are later-wave design work; they do
not block this kernel.

The Wave 1 graph—cleanup nodes (CU), independent work packages (WP), and reviewed intermediate merges
(IM)—is in [wave-1.md](wave-1.md). A following wave can add gateway admission and exposure control
around the proven settlement authority.

### Wave 1 planning status

The tracing-style asynchronous handoff is now decided: an API request publishes a best-effort
measurement message to `streams:measurements`; the gateway worker persists an idempotent measurement
and emits an idempotent debit command to `streams:debits`; the wallet worker settles the debit/balances
atomically. An initial measurement-publish
failure produces neither record nor charge; once accepted, normal stream retry is safe.

Wave 1 now has checkpoint boundaries, a node graph, and per-node specifications/tasks. The following
items are the design assumptions captured by that plan and must be confirmed in graph/spec review before
any node work starts:

| Remaining choice | Context and decision required | Why it blocks a work graph |
| --- | --- | --- |
| Canonical measurement vocabulary | **Decided:** existing `records` keeps its name; the new gateway analytics fact is `measurements`. | Determines gateway table/model, worker names, migration scope, and test fixtures. |
| Two stream contracts | **Decided and delivered:** `WP-1-00`'s seed committed versioned `MeasurementCommandV1`/`DebitCommandV1` envelopes (`ee/src/core/wallets/contracts.py`) — required IDs, scope/actor dimensions, resource key/locator, optional metrics/costs, `amount_musd`, idempotency key, and ACK-after-write ownership — and `WP-1-01`/`WP-1-02`/`WP-1-03` built against them unchanged. | WPs cannot independently build the API producer, gateway worker, and wallet worker without one stable contract. |
| Wallet settlement topology and idempotency | **Decided placement:** `wallet_credits`, `wallet_debits`, and `wallet_balances` remain in core. Set the exact replay constraint for a posting that can split over several credits. | Keeps financial history and state atomic; the replay constraint determines migrations and concurrent-delivery tests. |
| First checkpoint slice and physical target | **Decided slice:** fake built-in LLM and fake built-in MCP; the atomic wallet transaction is in core. | Defines acceptance fixtures, test topology, and the CU/WP/IM dependency graph. |

Items such as Redis L1 exposure estimation, concurrency-cap policy, real provider reconciliation,
rollups, subscription renewal, and hierarchy-scoped budgets are not blockers for this first kernel
checkpoint; they remain later work. Restricted-credit selection is already decided in principle, but
its configuration interface belongs in the wallet-settlement schema decision above.

## Open-design register

| Item | Status | Design question |
| --- | --- | --- |
| 1 | Open | Canonical resource taxonomy and debit fields for vendor pass-through and platform-capacity resources. |
| 3 | Open | Immutable cancellation, expiry, clawback, refund, and plan-change history. |
| 5 | Open | Subscription allowance, rollover, credit line, and auto-recharge policy. |
| 6 | Open | LLM/MCP/SBX chargeable measurements and their collector-provided representation. |
| 8 | Blocked | Provider-cost proof/reconciliation and commercial confirmation needed before launch. |
| 9 | Decided | Existing `records`, new gateway `measurements`, existing periodic `meters`, and wallet entities have distinct boundaries. |
| 10 | Open | Gateway/wallet write path: concurrency, adaptive exposure, idempotency, L1/L2, and recovery. |
| 11 | Open | Restricted-credit applicability, selection order, and admission. |
| 12 | Open | Store classes, same-database co-location units, financial-history authority, and cross-store recovery. |
| 13 | Open | Whether earned value expires at all, and what decides spend order between lots. |

Items 2, 4, and 7 are decided. The table is an index only; each numbered item below contains the
context, examples, and consequences needed for its discussion.

## 1. Canonical resource taxonomy and schema

**Status:** Open

### Context

The intended model has one organization wallet with three resource classes:

| Class | Examples | Accounting behavior |
| --- | --- | --- |
| A — vendor pass-through | LLM tokens, MCP execution, SBX sandbox compute, egress | Check before dispatch; write one attributed wallet debit from raw meter data afterward. Variable cost is non-strict/soft; the gateway bounds provider work separately. |
| B — platform capacity | spans, telemetry events, ACP/coding-agent session records, evaluations, storage | Count in existing meters as events arrive; periodically post one organization/resource/period wallet rollup if that resource moves from arrears to prepaid. Fail open. |
| C — entitlements | audit-log access, RBAC, SSO, seats, domains, retention tier | Never charged to the wallet; enforced as flags, limits, and feature boundaries. |

The older report schema only permits `model`, `tool`, and `sandbox` in its rate and usage tables,
and its immutable accounting-record codes have the same limitation. It therefore cannot represent the class-B
rollups the newer mechanics document proposes. It also uses older names (`credit_entry`,
`credit_grant`, `credit_rate_card`) while an earlier candidate vocabulary was `gateway_record`,
`wallet_credit`, and versioned pricing configuration in the codebase.

### Decision needed

Define the canonical, version-one taxonomy and the fields/enums that measurements and wallet
debits carry. Pricing rules are versioned code configuration, not database price lines. In
particular, decide whether every wallet debit stores both:

- `resource_class` (`vendor_pass_through`, `platform_capacity`, or null for funding and adjustments); and
- `resource_family` (`llm`, `mcp`, `sbx`, `telemetry_span`, `telemetry_event`,
  `agent_record`, `evaluation`, `storage`, etc.).

### Why it matters

Without this decision, the first migration can implement the model-only schema and make later
telemetry or record charging a migration rather than a configuration change. A stable taxonomy
also makes the basic product question — “what did we spend on models, sandboxes, and telemetry?” —
a `GROUP BY`, not a backfill.

### Current direction

Adopt the three classes above, one wallet, and explicit class/family fields on the wallet debit. Keep pricing
rules in versioned code and record the applied pricing version on a priced wallet debit. Update the report
schema to accept every Class A and Class B family before it is treated as build-ready.

### Decision

_Unresolved._

---

## 2. Non-strict admission does not reserve credits

**Status:** Decided

### Context

A non-strict Class-A call has an unknown cost. `check` only verifies that the general wallet balance is not
already at or below its allowed floor; it does not reserve money or a credit. After the provider reports
actual usage, gateway work creates its record and decides whether/how much to post to the wallet.
Gateway limits (such as an output cap or SBX time slice)
bound external work, but are not monetary holds.

Example: an organization has a $1 allowance expiring at midnight and $10 purchased credit. A call
accepted at 23:59 receives its actual $0.80 wallet debit at 00:02. The debit selects the
credit spendable then; it does not claim the expired allowance merely because the
request was admitted earlier.

### Decision needed

No billing reservation or hold is created for non-strict variable cost. Choose the credit source and
write the actual wallet debit only after trustworthy measurement arrives. Expiry and plan
changes affect credits spendable at that time; they do not need to reason about in-flight reservations.

### Why it matters

This keeps soft admission honest: it allows a bounded overrun but does not pretend the unknown final
cost was already funded. It also avoids a second pending-money state and makes credit selection a
single atomic operation with the actual debit.

### Current direction

Do not create a hold or debit at check time. `check` is admission only; record and debit only after
the trustworthy actual measurement arrives.

### Decision

No monetary hold/reservation for the non-strict variable-cost path.

---

## 3. Immutable cancellation, expiry, and plan changes

**Status:** Open

### Context

The wallet’s core promise is an append-only history: a balance is explainable as the sum of billing
debits, and a correction is a new wallet debit rather than an edit. At the same time, the current schema allows a
credit/grant’s `voided_at` field to be updated later. The mechanics document says that a mid-period
plan change voids the unused remainder of its current plan-allowance credit and mints a replacement.

Updating a credit can be useful operational state, but it is not itself a wallet debit. If a
$20 allowance changes to “voided” without an outbound wallet debit, the ledger balance can still include
the $20 while the spendable-credit calculation does not. The same issue applies to ordinary expiry,
clawbacks, and campaign cancellation.

### Decision needed

Define one event model for removing unspent credit value. It must state:

- whether expiry, plan-change cancellation, clawback, and invalidation create outbound
  `wallet_debit` rows (recommended);
- how each debit points to the affected credit and records its reason/idempotency key;
- what mutable credit state is permitted solely as a projection or operational convenience.

### Why it matters

This preserves reconciliation, customer explanations, and safe support corrections. It also avoids
the impossible situation where a wallet balance says value exists but credit-selection logic says it cannot
be spent.

### Current direction

Use append-only billing debits or immutable credit events for every removal of value. Keep mutable
state only for derived projections.

### Decision

_Unresolved._

---

## 4. Class-B prepaid rollups and the Stripe cutover

**Status:** Decided

### Context

Spans, telemetry events, ACP/coding-agent session records, evaluations, and storage are internal platform
capacity. Existing metering already counts several of these per organization and applies plan
allowances and retention. Some resources are currently reported to Stripe in arrears. The proposed
future is optional prepaid wallet charging: keep the ingestion path unchanged, use the meter as the
journal, and have a periodic job post one wallet debit per organization, resource, and period.

A resource cannot be charged both ways: reporting its overage to Stripe and debiting wallet credit
for the same measured units is double charging. Moving one resource therefore needs a lossless,
idempotent cutover.

### Decision needed

For each Class-B resource, define:

- whether it remains entitlement-only, stays Stripe arrears, or moves to wallet prepaid;
- the billing window and how overage above a plan allowance is calculated;
- the rollup identity/idempotency key (at least organization, resource, window, and pricing version);
- storage sampling semantics (time-weighted level, rather than cumulative writes);
- the switch state that prevents overlap or gaps during the Stripe-to-wallet transition; and
- whether insufficient wallet value merely creates a deficit/credit-line exposure, or changes
  entitlements only for the following period. It must never discard telemetry to protect billing.

### Why it matters

This is the bridge between already-shipped metering/Stripe work and the wallet. If it is unspecified,
the apparently small “monthly job” change can double charge, omit a period, or turn an ingestion
failure posture into a billing decision.

### Current direction

Keep Class B fail-open and meter-first. Make the cutover a per-resource configuration/state-machine
decision, not a global wallet switch.

### Decision

_Unresolved._

---

## 5. Subscription allowance, rollover, and credit line

**Status:** Open

### Context

A subscription has three independent effects: it grants entitlements (features, seats, retention,
and caps), it can mint a recurring allowance credit, and it sets commercial wallet terms. Separating
these prevents a periodic meter reset from becoming a reset of monetary value.

The proposed allowance is a credit minted once per subscription period and normally spent before
longer lived promotional, earned, and purchased credits. A credit line is a numeric, time-bounded permission for
a wallet debit to take the account below zero; it replaces a boolean “hard stop versus allow
negative” policy. Auto-recharge, if
enabled, also needs a threshold, amount, payment method, concurrency lock, and period ceiling.

### Decision needed

Decide:

- whether plan allowances expire or roll over, and any rollover cap;
- how a mid-period plan change handles unspent allowance and in-flight managed requests;
- whether launch starts with a zero credit line everywhere or supports selected customers;
- which wallet terms are per organization: pricing configuration, credit line, auto-recharge permissions, and
  per-period recharge ceiling.

### Why it matters

These are product/commercial policies, but they define permanent ledger history and customer
expectations. The implementation should support them as configuration without embedding plan-specific
branches in charging code.

### Current direction

Spend soonest-expiring value first; treat plan allowance as the earliest-expiring credit. Carry the
credit-line column from the first migration even if its launch value is zero.

### Decision

_Unresolved._

---

## 6. Metering and billing entities for LLM, MCP, and SBX

**Status:** Open

### Context

There are three resource-specific gateway surfaces:

| Gateway | Canonical path | Billable resource |
| --- | --- | --- |
| LLM gateway | `/gateways/llms/` | model-provider requests and token usage |
| MCP gateway | `/gateways/mcps/` | managed MCP/tool execution |
| SBX gateway | `/gateways/sbxs/` | managed sandbox lifecycle and provider compute |

Each gateway is a caller of the same billing check and record boundary; they are not three
independent billing systems and must not develop three pricing or ledger systems. The LLM gateway can check before
dispatch and receive provider usage afterward. The MCP and SBX gateways have different execution
boundaries:

- The MCP gateway knows whether managed MCP execution ran and its external cost/category.
- Sandbox billing may come from a provider webhook or poll, with provider-specific billable windows;
  code inside a user-controlled sandbox must not be trusted to report its own duration.

All three gateways should call the same wallet check/record interface and carry organization,
`secret_origin`, credential owner, raw measurement, and an idempotency identity. Workflow artifact,
variant, revision, endpoint, and other cross-domain facts remain in `data.references`. A
customer-owned key zero-rates the external model cost, but does not automatically make MCP or SBX cost
free.

### Candidate chargeable measurements

These are optional chargeable quantities and their corresponding optional provider-reported costs. A
versioned pricing configuration in the codebase decides which components are billed to a wallet. This table deliberately excludes
correlation and identity data; that data has a separate purpose below.

| Gateway | Measurement | Notes |
| --- | --- | --- |
| LLM | `request_count` → `request_cost_musd` | Optional count of upstream requests and an optional fixed per-request cost. One request carries an outcome: attempted, provider-accepted, succeeded, failed, or ambiguous. |
| LLM | `input_tokens` → `input_cost_musd` | Optional provider-reported non-cached input quantity and its corresponding actual provider cost in micro-USD. |
| LLM | `cached_tokens` → `cached_cost_musd` | Optional provider-reported cached-input quantity and its corresponding actual provider cost in micro-USD. Provider-specific cache-read/write detail remains in raw provider data until separately needed. |
| LLM | `output_tokens` → `output_cost_musd` | Optional provider-reported output quantity and its corresponding actual provider cost in micro-USD. |
| MCP | `request_count` → `request_cost_musd` | Optional count of requests through the MCP gateway and an optional fixed per-request cost. It is distinct from an internal MCP protocol message where that distinction matters. |
| MCP | `input_tokens` → `input_cost_musd` | Optional provider-reported input quantity and cost in micro-USD for an MCP execution. MCP does not guarantee token accounting, so both fields may be absent. |
| MCP | `cached_tokens` → `cached_cost_musd` | Optional provider-reported cached-input quantity and cost in micro-USD for an MCP execution. MCP does not guarantee cache accounting, so both fields may be absent. |
| MCP | `output_tokens` → `output_cost_musd` | Optional provider-reported output quantity and cost in micro-USD for an MCP execution. |
| SBX | `request_count` → `request_cost_musd` | Optional count of requests made to the SBX gateway and an optional fixed per-request cost. Keep it separate from a sandbox lifecycle transition. |
| SBX | `vcpu_core_time_msec` → `vcpu_core_cost_musd` | Allocated vCPU cores × provider-billable elapsed milliseconds and its optional cost. |
| SBX | `vmem_gibi_time_msec` → `vmem_gibi_cost_musd` | Allocated virtual-memory GiB × provider-billable elapsed milliseconds and its optional cost. |
| SBX | `disk_gibi_time_msec` → `disk_gibi_cost_musd` | Provisioned/billable disk GiB × provider-billable elapsed milliseconds and its optional cost; not disk I/O bytes. |
| SBX | `vgpu_core_time_msec` → `vgpu_core_cost_musd` | Allocated virtual-GPU cores × provider-billable elapsed milliseconds and its optional cost. GPU model/count belongs in SKU when pricing differs. |
| SBX | `blob_gibi_time_msec` → `blob_gibi_cost_musd` | Optional persistent blob, image, snapshot, or volume storage in GiB-milliseconds and its optional cost. |

`network_egress_bytes` is intentionally not a current SBX charge component. Public Daytona pricing
lists compute, GPU, memory, and storage, while its network documentation describes egress controls
rather than a usage charge. E2B's public workload estimator likewise models vCPUs, RAM, runtime, and
concurrency, with no egress-price input. Keep egress in provider raw data only if a future selected
provider invoices and exposes it as a material, attributable quantity; then add it as a new explicit
price component rather than assuming it is universal.

### Identity and references (not chargeable metrics)

Every measured activity needs identity and correlation data, but none of that is a chargeable metric.
The schema discussion below will decide the exact entities and fields. The established rule from the
channels entity design applies: a fact becomes a column only when it is a key, foreign key, uniqueness
member, index, or constant worker predicate. Typed payload and cross-domain artifact references belong
in `data`, including `data.references`; they must not be promoted to columns merely because they may be
useful to inspect.

All quantities and reported-cost fields are optional. **Missing is not zero:** `NULL` means the
gateway-owned collector did not receive or cannot safely derive the measurement; `0` means it observed
zero. Values are never supplied by the user-controlled client or sandbox.

### Entity-first design

Before naming operations, define the entities, their responsibilities, their relationships, and their
life-cycle state. **Use the channels entity design as the structural template.** First say what every
table *is* and *is not*; then identify which values require columns and which belong in typed `data`
or `data.references`. Do not use the gateways entity design as a structural authority: it still needs
review. Gateway-specific documents may provide facts about traffic, endpoints, and collectors, but not
the table-model pattern for this work.

The first entity discussion must answer, with a concrete example row for every proposed table:

1. Which entity records a collector's post-hoc LLM/MCP/SBX measurement, including the optional metric
   key/value pairs above?
2. Which entity records wallet value, if it is separate from measurement, and which entity (if any)
   is a mutable projection needed to perform a `check(delta)` safely?
3. How does a measurement refer to a wallet change without duplicating chargeable metrics?
4. Which identities are keys/constraints/indexed lookup values, and which are typed `data.references`
   to an artifact, variant, revision, endpoint, provider object, or other external object?
5. Which times are resource facts (`start_time`, `end_time`) and which are row lifecycle fields
   (`created_at`, `updated_at`, `deleted_at`)? Periodic meter fields such as year/month/day are not
   assumed for an event/value model.

Only after those entities are decided should the public domain operations be named. They use
one-word verbs and must reuse the existing `check` meaning: `check(delta)` is the authoritative
boundary whenever it applies the delta atomically. Whether the later collector interaction is named
`record`, `adjust`, or something else follows from the entities and is not decided here.

### Decision

_Unresolved: define the entities and example rows before defining operations or columns._

---

## 7. Actual-usage overflow and missing-measurement policy

**Status:** Decided

### Context

Every Class-A gateway checks that the general wallet balance is not already over its allowed floor before it
sends work to a provider. The LLM, MCP, or SBX gateway then submits an actual post-hoc metering
record for billing. The actual charge can exceed expectations: a model can produce more billable
usage than expected; an MCP provider can return an unexpected external charge; or an SBX collector
can report longer or more resource-intensive provider usage than expected. An actual measurement can
also arrive late or not arrive at all.

Example: the SBX gateway allows a sandbox while the general wallet balance is above its floor and bounds
execution to a five-minute provider slice. A delayed collector event says the sandbox was billable
for seven minutes. The provider cost has already been incurred, so rejecting the measurement or
silently capping it at five minutes hides a real loss.

### Existing entitlement precedent: strict and soft admission

The existing entitlement system has two relevant policies. This is not merely a cache-versus-database
choice: **strictness is the authoritative admission rule**, while the cache is an optional L1 fast
path that mirrors that rule before the L2 transaction.

| Policy | Authoritative rule | Result |
| --- | --- | --- |
| Strict | Atomically apply `current + delta <= limit`. | The operation that would cross the limit is rejected. This fits a known, exact quantity such as a seat, a fixed allowance, or a fixed-price action. |
| Non-strict / soft | Atomically allow a bounded delta when the current value is below the limit; reject when it is already at or above it. | One operation may cross the limit. Later operations are rejected until the value is brought back below the threshold or a new period begins. |

For high-volume ingestion, the system also has two execution layers: L1 reads a cached meter at the
publish boundary and can drop clearly over-limit work early; L2 batches events by organization and
uses the atomic database check-and-adjust as the source of truth. The cache never writes the meter.
If the L1 cache is stale or unavailable, L2 remains authoritative.

Variable-cost LLM, MCP, and SBX work cannot use a truly exact strict check because actual cost is not
known until after the provider responds or the collector reports. They therefore need the non-strict
admission model: admit one bounded exposure from a non-overflowed wallet, record the real post-hoc
cost, then reject new managed work once the wallet is at or below its allowed floor. The resulting
negative balance is an accounted overflow, not a lost event and not an entitlement reset.

### Why it matters

This is the boundary between a conservative check and a truthful ledger. The provider can
charge us even when the local estimate was wrong; failing to record that fact destroys reconciliation.
At the same time, a non-bounded overflow rule can expose a customer or the business to unexpected
unlimited spend.

### Decision

Use the existing entitlement meanings of **strict** and **non-strict/soft** for wallet admission:

1. **Strict request-count pricing.** When a resource has a defined fixed price per request, its
   `request_count` is an exact, known quantity. The request must fit before dispatch; the crossing
   request is rejected.
2. **Soft variable-cost pricing.** Token quantities/costs and SBX capacity-time quantities/costs are
   learned post hoc from a gateway-owned collector. Check while the general wallet balance is above its
   allowed floor, then record the actual debit. That debit may cross the floor.
3. **Already overflown rejects.** Once an actual debit leaves the general wallet balance at or below its allowed floor,
   new managed LLM, MCP, and SBX work rejects. Legitimate inbound wallet value — a purchase, plan
   allowance, award, or other wallet credit — absorbs the deficit and restores eligibility when the
   wallet moves above the floor. A credit line changes the floor; it never erases recorded spend.

L1 cached checks and L2 authoritative transactions are implementation mechanics of these policies,
as are late/missing collector observations, idempotency, reconciliation, and circuit
breakers. They must preserve the actual immutable observation; they are not separate policy choices.

---

## 8. Launch-blocking proof and reconciliation scope

**Status:** Blocked on verification and commercial confirmation

### Context

The model gateway’s first pricing model assumes provider-reported raw usage, including cached versus
uncached input, on streamed OpenAI-compatible responses. Gateway execution limits can be
conservative, but the final charge cannot be cache-aware if the upstream does not supply the necessary measurements.
The design also needs a way to reconcile measurements with the provider invoice and identify
ambiguous calls where work may have happened but an actual wallet debit was not written.

### Decision needed

Run and record the provider/harness probes, then choose the launch pricing mode:

1. Cache-aware usage pricing when streamed usage and cache attribution are available.
2. A transparent flat per-call/model price, while retaining raw usage for later re-pricing, if they
   are not available.

Also define the first reconciliation artifact: matching key(s), cadence, owner, tolerance, and how a
discrepancy affects customer charges versus internal write-offs.

### Why it matters

These facts determine whether the intended cost-plus pricing configuration is technically honest. Reconciliation
is the only control that detects a gateway/provider gap after a process failure.

### Current direction

Do not launch cache-aware billing based on estimates. Treat the flat-rate model as a valid
contingency, not as an accounting redesign. Preserve upstream request identifiers and raw provider
payloads needed for later reconciliation.

### Decision

_Unresolved._

---

## 9. Measurements, meters, records, and wallet domain boundary

**Status:** Decided

### Context

There are three adjacent but different kinds of data in this design:

| Kind | Meaning | Existing/candidate shape |
| --- | --- | --- |
| Audit/product event | A user- or system-visible action, recorded for audit log, product history, or automation. | Existing events/audit-log model. |
| Measurement | A trusted gateway/provider measurement for one managed operation or bounded SBX interval. It may be free or BYOK and may have no debit. | New `measurements`. |
| Meter aggregate | A scoped/periodic counter used by an entitlement or rollup. | Existing `meters`. |
| Record | An internal coding-agent/ACP session fact. | Existing `records` table; it keeps its name. |

The audit event and measurement must remain distinct. An audit event says *what happened in the
product*; a measurement says *what resource use an authoritative collector measured*. The same
operation may have both, one, or neither. They have different idempotency, retention, and query
requirements. A session record is also distinct: it describes internal coding-agent/ACP work rather
than gateway-collected use of an external resource.

The earlier candidate names `wallet_usages` and `wallet_checks` blur this boundary. A gateway
collector record supports billing even when it has no debit (for example, free or BYOK activity).
That is the new gateway name `measurements`, even though wallet later consumes a debit command derived
from it. `check(delta)`
is an operation with two meanings: an entitlement
check tests a meter against a limit; a billing check tests available value against its allowed floor.
Neither meaning alone proves that a `checks` table should exist. The non-strict variable-cost path
does not create durable provisional monetary state.

| Domain | Responsibility | Existing/candidate entities |
| --- | --- | --- |
| Metering | Measurements and scoped/periodic aggregates. | New `measurements`; existing `meters`. |
| Wallet | Code pricing, spendable credits, debits, and current available value. | Candidate `wallet_balances`, `wallet_credits`, and `wallet_debits`. |

The candidate `wallet_*` prefix names the financial domain without creating a table named `wallets`.
The organization general `wallet_balances` row is the current monetary balance projection. This is not
a “meter balance.” The existing `meters` rows remain resource aggregates; we can describe them as
*meter aggregate/state* in prose without a disruptive table rename solely to mirror `measurements`.

### Decision

The per-operation gateway fact is `measurements`. The existing ACP table remains `records`; it is not
renamed. The existing `meters` table keeps its deployed name. Financial state retains the `wallet_*`
prefix. There is no `checks`, allocations, or reservation/hold entity in the non-strict variable-cost
path. `entities.md` is canonical for all names and schema shapes; `mechanics.md` remains canonical only
for its resource-class model, enumerations, and conversions.

### Why it matters

Without this boundary, audit events, gateway measurements, entitlement aggregates, balance admission,
and financial history will accumulate under one namespace despite having different ownership,
retention, and correctness rules. The split lets metering stay truthful even when activity is free or
BYOK, and lets wallet state remain auditable even when the measured quantity arrives late.

### Current direction

Keep the existing `meters` aggregate in metering. Use `measurements` for gateway collector observations
and `wallet_*` for monetary state. Treat `check` as an operation. Do not
rename meters to `metering_balances`: a meter is a scoped, periodic resource counter, while a wallet
account has a monetary balance.

### Decision

_Decided above._

---

## 10. Gateway/wallet write-path stress test: concurrency, volume, and recovery

**Status:** Open

### Context

The candidate Class-A path is: gateway dispatch → trusted collector produces a raw measurement →
gateway pricing decides a wallet posting amount → wallet selects eligible credits → one or more debit
rows update `wallet_balances`. The existing
`meters` table is suitable for Class-B high-volume aggregates, not for individual gateway requests.

This path must survive three different loads:

1. **Concurrent unbilled work.** Non-strict `check` does not reserve value. If an organization has
   1 `musd` available and 100 requests are accepted before any collector result writes its debit,
   all 100 can incur provider cost. Output/token caps and SBX time slices bound each request but do
   not by themselves bound the total unless gateway concurrency is also limited. The intended cap is
   an entitlement, but the fast acquisition/release state must be operational rather than a new
   monetary ledger state.
2. **Many records.** An LLM/MCP call can need a provider-correlated row; an SBX must emit a final or
   bounded-interval record rather than one row per resource sample. Spans/events/session records stay
   on the existing aggregate-meter/periodic-rollup path, not the per-call record path.
3. **Concurrent credit consumption.** Two debits must not consume the same credit. Selecting credits,
   inserting debit rows, and updating general/per-credit balance rows must be one transaction with a stable
   lock order. One account row also becomes a per-organization write hotspot.

Reliability adds two further cases: collector writes must be idempotent using a gateway-minted
request ID, and a provider-success/database-failure gap needs durable retry plus reconciliation.
Late or corrected provider usage must create a later correction record/debit, not rewrite history.

### Proposed next implementation/test wave: wallet posting kernel

This wave is a deliberately narrow vertical slice. The gateway owns collector behavior, measurements,
raw metrics, provider details, and its pricing/markup decision. The wallet receives a
gateway-decided immutable posting and applies its financial consequence. The operation’s eventual
public one-word name remains open—this section calls it *posting* as a concept, not as an API-name
decision.

**Goal.** Prove that a gateway-decided amount becomes exactly one immutable wallet movement and the
correct balance changes, without losing, duplicating, or overspending value under retry and concurrent
credit selection. A custom/standard external-resource request creates no wallet posting; only built-in
managed resource use reaches this boundary.

**In scope.** A wallet posting contains the organization, positive debit amount in `musd`,
gateway-supplied idempotency key, and resource key/locator needed for credit applicability. The wallet
selects eligible credits, inserts debit rows, and updates general/per-credit balances in one database
transaction. The gateway retains its own request/record/measurement identifiers; the wallet does not
mint, interpret, or foreign-key them.

**Out of scope for this wave.** Provider SDK calls, customer-facing gateway dispatch, live vendor
invoices, Redis leases/concurrency caps/unsettled-exposure estimation, rollups, and subscription
renewal. Wave 1 does create and store fake LLM/MCP measurements; those are its selected gateway-owned
test boundary.

#### Test plan and proof target

| Level | What is mocked or real | Proof cases |
| --- | --- | --- |
| Unit | Wallet posting/credit-selection functions; repository/clock are fakes. | The same idempotency key replays without another debit; a custom/standard request has no posting; a built-in LLM/MCP/SBX posting uses its supplied amount; restricted/expiry priority selects the intended credit; a permitted deficit creates a debit with no credit. |
| Database integration | Disposable Postgres with the real wallet schema/transaction; no provider or Redis. | Retry of the same posting key is a no-op/replay, not a second debit; credit FKs reject invalid rows; a split charge updates two credit rows plus the general balance atomically; competing postings cannot consume the same credit twice; an injected failure rolls back debit rows and balances together. |
| Gateway-to-wallet contract integration | Fake LLM/MCP/SBX gateway callers, but the real wallet service and Postgres. | Each gateway supplies an amount, idempotency key, and selector/reference without exposing provider metrics to the wallet; duplicate deliveries are safe. No live vendor account is needed. |
| Narrow acceptance | Local application plus fake gateway caller, after the gateway-to-wallet adapter exists. | A built-in managed request reaches the posting boundary, then produces exactly the expected debit/balance result. This is not a live-provider or Stripe end-to-end test. |

The existing meter tests are the useful style precedent: they test strict/non-strict predicates with
mocked database execution. The wallet posting kernel needs that unit layer **and** real-Postgres
transaction tests, because its central promise is multi-row atomicity and concurrency rather than a
single SQL predicate.

#### Boundary decisions now closed

1. **Gateway-supplied idempotency.** The wallet receives an opaque gateway-supplied
   `idempotency_key`; it does not mint one or try to interpret the gateway request ID. Different
   gateways may mint request/measurement identities differently. Repeating the same key replays the
   original posting without another debit.
2. **Append-only deltas.** Gateway and wallet rows are never updated to replace a prior measurement.
   Each new measurement delta is a new immutable gateway action with its own idempotency key; the
   gateway is responsible for making its resource/measurement identity unique before it calls the
   wallet.
3. **Gateway-decided amount.** Custom and standard external-resource credentials are not wallet
   charged. Built-in managed resource use is charged by an amount supplied by its gateway. Provider
   reported cost/metrics are measurement facts only; the gateway may apply markup before it sends
   `amount_musd`. The wallet is domain-agnostic and does not read provider pricing or metrics.
4. **Forward adjustments.** An adjustment changes value now; it does not repair or rewrite historical
   ledger rows. It is a new credit or debit with its own kind and idempotency key. Any linkage to a
   provider measurement/reconciliation belongs outside the wallet ledger.

#### Closed boundaries for the candidate kernel

1. **Gateway/wallet handoff.** Measurements are gateway-owned. The API request publishes one
   observation to Redis; the gateway worker persists the measurement and emits an idempotent wallet
   adjustment; the wallet worker settles its financial effect. There is no database outbox, shared
   transaction, or debit-to-measurement foreign key. The initial observation publish is best effort:
   failure produces neither a measurement nor a charge.
2. **Credit applicability and selection.** Resource identity follows the channels key/locator pattern;
   applicability belongs to credit-kind configuration; each issued credit has priority and `end_time`;
   eligible credits sort by priority, then `end_time`, then ID.

##### Credit applicability and selection: decided direction

The gateway supplies two resource values, following the channels external-key/external-locator
pattern:

- `resource_key` is the stable, deterministic identity used by configuration matching and indexes.
  It is composed by the gateway from the identity fields its configuration declares significant.
- `resource_locator` is the structured resource identity retained alongside the key—for example
  provider, model, endpoint, sandbox class, region, or another gateway-specific field. It replaces a
  catch-all `data` blob for resource identity and gives configuration/rule evolution enough context.

Credit applicability is not copied onto every issued credit. Versioned configuration defines a
`credit_kind` and its resource rule. An issued `wallet_credit` identifies its `credit_kind` and carries
the economic instance values: amount, explicit `priority`, and `end_time`. The rule decides whether a
posting’s resource key/locator is eligible. The wallet does not understand Gemini, MCP, or GPU; it
only evaluates the configured rule.

For a posting, select all eligible, unexpired credit balances and consume them in this order:
`priority`, then earliest `end_time`, then stable credit ID. Priority is explicit policy: configuration
or issuance can give a restricted/sponsor credit precedence over general value without adding
resource-specific logic to the wallet. Any remaining amount follows the already-defined allowed-floor
policy as an uncredited deficit debit.

| Gateway posting | Candidate credits | Result under this rule |
| --- | --- | --- |
| Built-in LLM, Gemini model, `amount_musd = 12,000`, `resource_key = llm:google:gemini` | General purchased credit; 10,000 `musd` Gemini-only promotional credit. | Both are eligible. Priority selects the first credit; if the Gemini credit is first, 10,000 comes from it, then 2,000 from general value or a permitted deficit. |
| Built-in LLM, Anthropic model, `resource_key = llm:anthropic:claude` | General purchased credit; Gemini-only promotional credit. | Gemini-only rule does not match. Consume general credit; any remainder is a permitted deficit only within the allowed floor. |
| Built-in managed MCP endpoint, `resource_key = mcp:built-in:browser` | General credit; browser-MCP sponsor credit. | Browser rule matches the configured key/locator. Priority determines whether sponsor value precedes general value. |
| Built-in SBX GPU execution, `resource_key = sbx:gpu` | General credit; GPU promotional credit. | GPU rule matches the configured resource key/locator. Priority determines consumption before general value. |
| Custom or standard LLM/MCP/SBX credential | Any credit. | Gateway sends no wallet posting, so no credit is selected and no wallet debit exists. |

The checkpoint’s implementation wave is ready to plan only when this handoff has fixtures and an
agreed service/spec contract. Its final IM plus final CU is then locally deployed by the user;
integration and acceptance tests run at that deployment node, while unit tests run in individual WPs.

##### Tracing-like asynchronous measurement-to-wallet chain

The current tracing path is: ingress `XADD`s an immutable span message to durable Redis; a consumer
group reads it, writes its database rows, then ACKs and deletes the stream entry. The gateway request
path should follow that shape. Apart from admission and the managed resource work needed to answer the
caller, it does no measurement persistence, cost calculation, or wallet settlement:

```text
gateway non-strict check
  → managed LLM/MCP/SBX work and response
  → best-effort measurement message to streams:measurements
  → gateway measurement worker normalizes metrics, computes gateway charge,
    writes immutable measurement, and emits debit command to streams:debits
  → wallet worker applies idempotent adjust, commits debit/balances, ACKs its message
```

The request path asynchronously emits one immutable, gateway-owned **observation** message. It carries
the response/collector information from which the gateway worker can build a measurement: correlation
identity, scope/actor/resource dimensions, and optional raw quantities/costs. The worker owns
normalization, provider-cost interpretation, markup, and its gateway-decided `amount_musd`. It writes
the complete immutable measurement, then emits an adjustment only when a charge applies. The adjustment
carries the opaque idempotency key the wallet uniquely enforces. Retries can create duplicates, which
the measurement identity and wallet idempotency key must tolerate.

This is deliberately not a database outbox or a cross-database transaction. If the request path cannot
publish the observation, no measurement and no charge are created; that lost charge is accepted. The
wallet must never infer and create a charge merely because a measurement exists.

Once the observation has been accepted by Redis, the gateway measurement worker follows the existing
tracing-consumer pattern: it ACKs only after the idempotent measurement write and any applicable
debit-message publish succeed. A failure leaves the observation pending for retry; idempotent
measurement identity and wallet idempotency make that safe. This is not a database outbox. The accepted
best-effort loss boundary is the initial API request’s observation publish: if that `XADD` fails, no
measurement and no charge are created.

##### Measurement is the unit-economics and analytics fact

A gateway measurement is not merely a delivery trigger for the wallet. It is the complete append-only
analytics fact for one gateway measurement delta. It carries the dimensions needed to analyze
consumption without reading wallet balances or joining to financial debit rows:

- `project_id`, `user_id`, and `agent_id`; organization/workspace are derived through project rather
  than duplicated;
- `gateway_kind` (`llm`, `mcp`, or `sbx`), gateway/request/measurement identities, and relevant
  endpoint/provider identifiers;
- `resource_key` and structured `resource_locator`;
- `start_time` and `end_time` when the measured resource has an interval; and
- the optional measurement components and their unit economics—for example `input_tokens` with
  `input_cost_musd`, `output_tokens` with `output_cost_musd`, or SBX core/GiB-time with its component
  cost.

The gateway measurement worker also records its final `amount_musd` for the paired debit command. This must remain
distinct from provider/component `*_cost_musd`: component costs answer “what did this resource use
cost?”; `amount_musd` answers “what did the gateway charge the wallet?”, which can include configured
markup or another gateway pricing decision. The adjustment’s debit may later split over several
credits, but that funding split is wallet state—not a replacement for measurement analytics.

Measurement metric values use the structured/versioned measurement representation and may have
multiple rows per measurement when it has multiple components. Resource identity is explicit
`resource_key`/`resource_locator`, not hidden in generic `data`.

Do **not** put both workers in consumer groups on one stream using the existing generic consumer
unchanged: its successful consumer ACKs **and deletes** the entry, which can starve the other group.
Use dedicated measurement and debit streams (or introduce a fan-out component with an
explicit all-consumers-ack rule). The wallet stream needs capacity/retention handling that does not
silently evict an unprocessed adjustment; this is an operational requirement of the selected stream
path, not a database-outbox requirement.

### Candidate L1/L2 path

The existing entitlement pattern suggests an option, not yet a decision:

1. **L1 gateway/Redis:** one atomic script per organization reads the plan’s concurrency cap,
   acquires an expiring active-work lease, and updates a non-durable `unsettled_exposure` estimate.
   The estimate is an admission margin—not a wallet debit, credit allocation, or hold. It can use
   the active count plus a configured typical/minimum expected cost for the request’s resource
   selector, with an extra safety margin. It may intentionally be wrong; actual later debits remain
   authoritative.
2. **L2 database:** after gateway work has trustworthy data and decides a posting amount, one wallet
   transaction writes every split debit needed for the selected credits and the general/per-credit
   balance rows. It consumes the independent debit stream message; the measurement worker
   is separate. L2 then atomically
   reconciles/removes the corresponding L1 estimate and releases the active-work lease.

An L1 outage or stale key needs an explicit decision: fail the managed request closed, fall back to a
synchronous L2 path, or accept a known larger exposure. It cannot silently be treated as authoritative.

The Redis lease must be request-keyed rather than a bare `INCR` counter. The candidate atomic script
uses the gateway-minted `request_id` to: prune expired leases; return success without double-counting
an existing lease; reject when the remaining active-lease count is at the entitlement cap; and create
or refresh the request lease with a TTL. Gateway completion releases the same key. Long-lived SBX
work refreshes the lease while it is alive. This makes Redis fast and recoverable after a gateway
crash, while the database remains the financial authority.

### Candidate adaptive exposure estimate

The configured estimate need not stay static. When a collector settles a measurement, it has the
actual duration and whichever quantities/costs the provider supplied. A derived, rolling estimate can
therefore be updated for a selector such as an endpoint, project, gateway family, and resource key.
At request admission, the Redis script adds the selected estimate to the organization’s
`unsettled_exposure`; it admits only if the available wallet value, less that unsettled exposure and
the new estimate, remains above the allowed floor. Completion removes the estimate and L2 writes the
actual debit. It is still not a credit/debit/hold: it is a recoverable prediction of work already
admitted but not yet settled.

The estimate can use a rolling average/EWMA of completed records, possibly with a conservative margin
or an upper percentile once enough samples exist. For sparse, new, or rapidly changing selectors it
falls back through a hierarchy—for example endpoint → project → gateway/resource selector → configured
default. SBX may also refresh its predicted exposure as a bounded interval completes. The concurrency
cap remains necessary: it bounds concurrent error when averages lag a cost spike or a provider omits
usage.

### Decision needed

Define:

- the entitlement keys and plan limits for concurrent managed LLM/MCP/SBX work, and whether the cap
  is shared or separately scoped by gateway family/resource;
- the L1 Redis key/script shape: active-work lease, TTL/heartbeat, atomic acquisition/release, and
  recovery after gateway failure or a lost release;
- the estimator used for `unsettled_exposure` (typical/minimum cost, active-count margin, selector
  factors, and a cap), including selector hierarchy, rolling-window/EWMA versus percentile rule,
  sample threshold, fallback/default, the L1 refresh source from L2 account state, and L1-outage
  behavior;
- the maximum provider work per request/slice, so the non-strict worst-case overrun is calculable;
- whether account/debit updates are synchronous per request or durably queued and batched per
  organization, and the accepted admission staleness in the latter case;
- the gateway-minted request ID/idempotency key. For SBX, define the collector measurement identity or
  bounded-interval locator when one operation legitimately creates multiple measurements; it is not an
  ordinal sequence;
- the raw-record retention/partitioning and metric storage shape (typed nullable columns, child rows,
  or payload) at the expected write volume; and
- the recovery/reconciliation workflow when provider work succeeded but its collector/billing write
  did not.

### Why it matters

Without a per-organization concurrency bound, non-strict admission has an unbounded concurrent
overrun even if each individual request is capped. Without an idempotent durable write path, retries
can either double-debit or lose provider cost. Without a volume shape, a seemingly harmless set of
optional metric rows can multiply database writes beyond the gateway’s useful throughput.

### Current direction

Do not use a durable monetary hold. Bound exposure with gateway work caps plus an explicit
entitlement-backed concurrency limit. A Redis L1 may add a non-durable, atomic unsettled-exposure
margin using typical/minimum expected work; L2 records all operation rows together and is the
financial authority. The estimator, L1 outage behavior, lease/recovery mechanism, transaction shape,
and storage layout are open.

### Decision

_Unresolved._

---

## 11. Restricted-credit applicability and admission

**Status:** Open

### Context

`wallet_credits` are the immutable credit-side records. They carry source, expiry, priority, and
applicability rules. `wallet_debits` are the immutable outgoing records. A debit points directly to
its optional `wallet_credit_id`; if a charge consumes several credits, wallet writes several debit
rows with the same gateway-supplied wallet-posting idempotency key. This replaces a separate allocation table without losing the
credit-to-debit explanation.

Example: Agenta receives GCP credits and grants an organization 100,000 `musd` usable only for
managed Gemini models. That is a restricted `wallet_credit`. A Gemini debit may point to that
credit. An Anthropic debit, MCP execution, or SBX compute debit must not. A general purchased credit
may be eligible for all managed resource families.

This reveals a limit in a single general `wallet_balances` row: a balance showing 100,000 `musd`
must not admit an Anthropic request merely because the only available credit is Gemini-restricted.
Non-strict admission still creates no monetary hold; it needs an applicability-aware notion of
available value when deciding whether new work is already over its applicable floor.

### Decision needed

Define:

- the resource selectors a credit may restrict (gateway family, provider, model/resource key, or another
  stable selector);
- whether selectors are versioned code configuration with a credit storing an applicability key/version,
  or are stored as an immutable selector snapshot on the credit;
- whether one account plus eligible credits is sufficient, or whether restricted credits instead need
  separate balance/budget buckets;
- the credit-selection order when both restricted and general credits are eligible; and
- what `check` does when the overall account is positive but no eligible value exists for this request.

### Why it matters

Without it, provider-funded credits can be accidentally spent on unrelated providers or resources,
and the current account balance can give a false admission result. It determines the credit
applicability and debit-selection logic required in version one.

### Current direction

Treat provider-funded, resource-restricted value as a `wallet_credit`; do not represent it as a
separate kind of metering. Preserve the no-hold, actual-debit decision from item 2.

### Decision

_Unresolved._

---

## 12. Store classes, financial-history placement, and cross-store correctness

**Status:** Open

### Wave 1 placement decision

For Wave 1 only, `measurements` are new EE tracing rows in `tracing_ee`, while authoritative
`wallet_credits`, `wallet_debits`, and `wallet_balances` are new EE core rows in `core_ee`. This is the
smallest placement that preserves the wallet’s one-transaction credit/debit/balance invariant. It does
not decide a future physical database split for wallet history; that requires measured volume,
retention, and operational evidence.

### Context

The system has more than two data shapes with different operational needs. The desired architecture
must not collapse these into a single “core versus tracing” choice:

| Store | Candidate contents | Write behaviour |
| --- | --- | --- |
| Tracing / append-only record store | Existing spans, events, and `records`; Wave 1 `measurements`. | High-volume immutable observations/history for telemetry, audit/product history, analytics, retention, and reconciliation. |
| Core transactional state store | `subscriptions`, existing `meters`, and Wave 1 `wallet_credits`, `wallet_debits`, and `wallet_balances`. | Mutable organization/plan state, exact entitlement aggregates, and one atomic wallet transaction unit. |
| Schema-versioned record store | Record families whose payload/schema changes must be read by version rather than rewritten in place. | Old versions remain interpretable through versioned readers; it may be a separate database/schema or a storage policy, which is not yet decided. |
| Redis | Active-work leases and `unsettled_exposure`. | Ephemeral admission state with TTL; reconstructable and never financial authority. |

The proposed measurement is valuable in an append-only workload because it is the raw,
potentially high-volume collector fact. The same argument applies to wallet debits, and perhaps
credits: they are immutable history with retention and analytical value. But that workload property
does not decide database placement. First enumerate the operations: required joins, real foreign
keys, cascading lifecycle behaviour, and atomic writes. Every required relational edge creates a
same-database co-location unit.

`wallet_debits.wallet_credit_id` needs a real foreign key, join, and one transaction with
`wallet_credits`, so those wallet tables must be in the same database. The gateway-owned measurement
has no real relation to the posting in Wave 1. If changing a debit and the general/per-credit wallet-balance
projection must also be atomic, that projection joins the same unit. This does **not** create two
financial ledgers: one financial-history store must be authoritative, and any separate projection
must be exactly-once derived from it.

### Relationship/operation matrix (to decide)

| Relationship or operation | Candidate entities | Required semantic | Placement consequence |
| --- | --- | --- | --- |
| Gateway measurement to wallet debit | gateway-owned `measurements` → `wallet_debits` | **Decided:** separate Redis Streams. The request publishes a message to `streams:measurements`; a gateway worker writes the measurement, then emits an applicable debit command to `streams:debits` with gateway-decided amount and opaque idempotency key. No debit-to-measurement FK. | Does not require measurements and wallet tables to share a database. |
| Debit consumes a restricted or general credit | `wallet_debits` → `wallet_credits` | **Decided:** nullable real FK; restrict deletion. It is non-null when a debit consumes a credit and null only for a permitted deficit debit. Atomic eligible-credit selection is required. | Same financial database. |
| Per-credit available value | non-null `wallet_balances.wallet_credit_id` → `wallet_credits` | **Decided:** real unique FK; restrict deletion. It is the mutable projection of that specific credit. | Same financial database. |
| Debit changes displayed available value | `wallet_debits` ↔ general/per-credit `wallet_balances` rows | **Decided:** atomic update for settled history. | Same wallet database unit. |
| Incoming credit changes displayed available value | `wallet_credits` ↔ general/per-credit `wallet_balances` rows | **Decided:** atomic update for settled history. | Same wallet database unit. |
| Organization/workspace/user/agent ownership or attribution | wallet and gateway rows → scope/identity tables | **Decided:** validated logical IDs, not FKs; no cross-domain cascade. Parent removal retains financial/gateway history until an explicit retention job acts. | Does not force the core scope tables into the wallet unit. |
| Project attribution | `measurements.project_id` → project | **Decided:** real FK only when the project table is physically local in the same core database; otherwise validated logical ID, as tracing records do. Parent removal never cascades into history. | The eventual wallet/project topology determines the physical constraint. |
| Entitlement check/adjust | existing `meters` | Existing transactional aggregate update. | Keep with the exact meter operation; no implied wallet join yet. |
| Product/audit/session observability | events/spans/`records` | Append/query/retention; no financial referential requirement identified. | May remain outside the financial co-location unit. |

The current `meters.organization_id` foreign key and cascade are not the target precedent for this
design. Wallet scope ownership is deliberately a validated logical ID, so deleting an organization
cannot cascade-delete its financial history. Removing that existing meter FK is a separate schema
cleanup to assess for migration and retention consequences; it is not required to ship the wallet.

### First relationship to close: debit consumes credit

One `wallet_credit` represents a specific incoming value and can carry expiry, priority, and resource
applicability—for example, GCP-funded value limited to managed Gemini models. A `wallet_debit` records
value leaving that credit. When a charge consumes two credits, the current candidate is two immutable
debit rows with the same gateway-supplied wallet-posting idempotency key, each pointing directly to one credit; there is no
allocation table. A debit allowed to take the account below zero has no credit reference.

**Decided:** `wallet_debits.wallet_credit_id` is a nullable real foreign key to `wallet_credits`.
It is non-null when a debit consumes a credit and null only for a permitted deficit debit. A referenced
credit is restrict/no-delete, never cascade deleted. Choosing eligible credit, inserting debit rows,
and changing the affected general/per-credit balance rows occur in one transaction; all involved rows
are in the same database unit.

### Gateway-measurement to wallet boundary: decided

One `measurement` is a gateway-owned collector fact for a managed LLM, MCP, or SBX operation (or
an SBX bounded interval). The gateway—not the wallet—owns its raw metrics, provider detail, record
identity, and charge calculation. It may create no wallet posting, for example custom/standard
external credentials; built-in managed use may create a gateway-decided amount.

**Decided:** gateway work publishes a measurement to its tracing-style stream, then independently
publishes the applicable debit command to `streams:debits`. The wallet receives only the
gateway-decided amount and opaque idempotency key; it never calculates amount from gateway metrics.
There is no database outbox, cross-database transaction, or debit-to-measurement foreign key. A failed
debit-message publish is an accepted uncharged measurement, not a reason for the wallet to infer and
create a debit later.

### Third relationship to close: financial history and available value

`wallet_credits` and `wallet_debits` are immutable explanations of incoming and outgoing value.
The general `wallet_balances` row is the mutable projection for `check(delta)`: a fast answer to “is
this organization already beyond its allowed floor?” Restricted credits complicate that projection: a
positive general balance does not make Gemini-only credit available for an Anthropic request. The
result may therefore need both an organization-level available value and eligible-value state by
selector/credit, rather than a single scalar.

Two models are possible:

| Model | On a credit/debit write | Admission consequence |
| --- | --- | --- |
| **Atomic projection** | Insert immutable history and update the applicable general/per-credit balance rows in the same transaction. | `check(delta)` can use exact committed state at L2. The records and balances must co-locate. **Selected.** |
| **Derived projection** | Insert immutable history; an idempotent projector later updates general/per-credit balance rows. | `check(delta)` is necessarily stale even at L2. Redis exposure/concurrency limits can bound the error, but the projector, replay, lag, and correction rules become financial correctness requirements. **Not selected for settled wallet value.** |

This is independent from the no-hold policy. A soft variable-cost check may admit work without a
durable reservation in either model. The question here is whether *settled* history immediately
changes the authoritative available value, or only changes it after asynchronous projection.

### Decision

For settled wallet value, use an **atomic projection**. The wallet worker writes its immutable debit
rows, credit selection, and authoritative general/per-credit balance rows in one transaction. The
gateway measurement is written by its own worker through its own stream. The projection must represent
applicability-aware available value as well as any
organization-level total; a Gemini-only credit cannot admit unrelated work. The exact projection
tables/fields remain a schema decision.

L1 admission remains non-strict: Redis leases and estimated unsettled exposure can be approximate and
recoverable. That does not make settled L2 value eventually consistent. Strict fixed-cost work uses
the same atomic wallet unit for its L2 check-and-write; variable-cost work performs its actual debit
there after collection.

### Projection schema alternatives (open)

The immutable history answers *why* value arrived or left. The projection answers, under a lock,
*what value is available now and which request may spend it*. Consider one organization with a
100,000 `musd` Gemini-only credit and a 50,000 `musd` general credit. Its total available value can
be 150,000 `musd`, but an Anthropic request may spend only 50,000 `musd`. An organization-level
balance alone cannot make that admission decision.

| Alternative | Mutable state | Advantages | Problem |
| --- | --- | --- | --- |
| A. General balance only | General `wallet_balances` row; select eligibility by scanning immutable credits/debits. | Fewest balance rows; total is cheap to read. | Every restricted-credit check/settlement must derive eligible remaining value under concurrency; expensive and difficult to lock safely at volume. |
| B. General plus per-credit balances | One `wallet_balances` table: a general row with `wallet_credit_id = NULL`, plus one per-credit row with its currently available `musd`. | Immutable credit remains immutable; direct, lockable selection of eligible credits; split debit can atomically decrement exactly the referenced credits. | One additional mutable row per spendable credit and an invariant to maintain. |
| C. Selector/bucket totals | Account total plus mutable balance rows keyed by resource selector (for example Gemini or Anthropic). | Very fast eligibility lookup for a fixed selector vocabulary. | General credits apply to several selectors and are double-counted unless an additional per-credit source state/allocation rule exists; insufficient by itself. |

The current leading shape is **B**. It does not reintroduce the removed allocation entity: a debit
still points directly to `wallet_credit_id`. The per-credit balance row is only the mutable projection of
how much of that immutable credit remains; it is not a second financial history.

For the example above, adding the credits atomically writes immutable credit rows, the general
balance row, and two per-credit balance rows. A 20,000 `musd` Gemini wallet posting funded 10,000 from each
credit atomically writes two debit rows sharing its opaque idempotency key, reduces the general balance by
20,000, and reduces each referenced per-credit balance by 10,000. An Anthropic check later sees only
the remaining general-credit balance as eligible.

The required invariants would be:

- a per-credit balance has one row per credit and never falls below zero;
- every debit with `wallet_credit_id` atomically reduces that credit’s balance by its debit amount;
- the general balance reflects every settled credit/debit, including uncredited negative residual
  debits; and
- credit selection locks eligible per-credit balance rows in a stable order (for example priority, expiry,
  then ID) so concurrent debits cannot overspend or deadlock.

Open schema choices are the projection table name, whether the account keeps one total or several
derived totals, the exact applicability selector representation, and which columns/indexes support
the credit-selection order. The projection is rebuildable from immutable history for repair, but it
is the authoritative current-state input for normal transactional admission after each atomic update.

### Active decision: one general/per-credit balance table

The selected version-one shape is alternative B, represented by one `wallet_balances` table:

| Balance-row kind | Minimal responsibility | Not its responsibility |
| --- | --- | --- |
| general `wallet_balances` row | One organization-level current total, used for a fast overall wallet check and display. | Determining whether a resource-restricted credit is eligible for a particular request. |
| `wallet_credits` | Immutable source, amount, expiry/priority, and applicability of incoming value. | Mutable remaining value. |
| per-credit `wallet_balances` row | Exactly one mutable available-value row for each credit, selected and locked during credit selection. | A second debit/credit history or an allocation table. |

`wallet_credit_id = NULL` marks the general row; a non-null value marks the individual credit row.
An applicability-aware check joins the per-credit balance to the immutable credit rule, then
selects nonzero eligible rows in the agreed priority/expiry/ID order. It does not treat the account
total as proof that the request has eligible value. The general balance remains useful for overall
admission and display, while exact restricted eligibility comes from the selected per-credit rows.

The required unique constraints are one general row per organization and one per-credit row per
credit. The remaining narrow schema choice is the credit-selection index; `balance_musd` is selected.
No new financial-history or allocation entity is introduced.

### Functional balance versus analytical scope views

The functional wallet balance is organization-level. It is persisted and updated in the atomic wallet
transaction because `check(delta)`, credit selection, and negative-balance policy depend on it. The
per-credit available-value projection is likewise functional because resource applicability must be
enforced.

Workspace and project views have a different purpose: analytics, reporting, and navigation. Every
measurement is project-attributed and carries `project_id`, `user_id`, and `agent_id`, plus gateway,
resource, endpoint, and request identifiers. Organization and workspace are normalized through the
project when the project hierarchy is local to the wallet database; they are copied onto records only
when that hierarchy would otherwise require a cross-database lookup or when history must preserve the
then-current membership. Measurements and debits are separate journal queries in Wave 1; there is no
cross-store debit-to-measurement foreign key. Workflow artifact, variant, and revision remain
`data.references`. Provider request/response, sandbox, and other identifiers are promoted to columns
when an expected analytics, idempotency, or reconciliation query needs them.

Calling such a view a *project balance* needs care. With one shared organization wallet, consider a
100,000 `musd` general credit, 10,000 `musd` spent by project A, and 20,000 `musd` spent by project B.
The organization balance is 70,000 `musd`; neither project has an independent remaining balance unless
the credit was actually scoped/allocated to that project. A project dashboard can truthfully show:

- project-attributed debits and usage;
- project-attributed credits, when a credit itself is project-scoped; and
- net activity over a selected period.

It must not present a share of unrestricted organization value as an enforceable project balance
without first introducing project-owned credit/budget semantics.

### Decision: no version-one analytics materialization

Version one has no `gateway_rollups`, `wallet_credit_rollups`, `wallet_debit_rollups`, or
`wallet_balance_snapshots`. The indexed immutable journal is the reporting source: measurements
provide usage attribution; debits provide priced spend; credits provide incoming value; and the live
organization row in `wallet_balances` provides current available value. None of those report queries
participates in `check(delta)`.

The journal rows are deliberately narrow compared with trace payloads. Add appropriate indexes and
measure the actual report latency and cost before creating any derived table. A point-in-time balance
chart is not a reason to persist snapshots until that feature and its query load exist. If a measured
report cannot meet its target, introduce only the separate derived table for that report's grain and
freshness requirement; do not add a generalized rollup table pre-emptively.

Hierarchy-scoped credits/budgets, scope-specific balance rows, copied gateway hierarchy IDs, and any
future analytics materialization are deferred in [out-of-scope.md](out-of-scope.md). The existing
Class-B periodic calculation is separate: if a resource moves from Stripe arrears to wallet prepaid,
it can create an idempotent debit from existing `meters`; that does not require an analytics rollup
table.

This exposes a constraint in the earlier L2 shorthand that “one transaction writes all operation
rows.” The transaction’s rows must be in one database. If a needed relationship crosses databases,
there is no foreign key, cascade, join, or atomic transaction—only an explicitly weaker logical
reference and a delivery/reconciliation protocol. “Core” and “tracing” must therefore be defined
after the relationship matrix, not used to pre-decide where financial rows go.

### Decision needed

Define:

- a relationship/operation matrix for `measurements`, `wallet_credits`, `wallet_debits`, wallet
  general/per-credit `wallet_balances` rows, and `meters`: every required foreign key, join, cascade, uniqueness
  constraint, and atomic write;
- the same-database co-location units implied by that matrix, before naming them core, tracing, or
  another database/schema;
- which proposed edges are deliberately logical cross-store references, together with the operation
  that is being given up (foreign key, join, cascade, or atomic transaction);
- the exact mutable balance and restricted-credit eligibility projection, whether it belongs in the
  financial co-location unit, and which append-only record(s) are its authority;
- the selected Redis-Stream handoff’s write order, idempotency constraints, failure visibility,
  duplicate handling, and safe retention/capacity policy; and
- per-store retention/partitioning and the minimum retained financial and measurement fields after
  a provider invoice or customer dispute.

### Current direction

Do not place entities based only on their label or append-only workload. The working wallet unit is
`wallet_credits`, `wallet_debits`, and general/per-credit `wallet_balances` rows, because financial
history and its projection are atomic. Gateway measurements are gateway-owned and use the selected
best-effort Redis-Stream handoff; they do not join the wallet database.

### Decision

_Unresolved._

---

## 13. Does earned value expire, and what decides spend order

### Context

Every lot today carries a `priority` and an optional `end_time`, and the settlement planner
sorts candidates by `(priority, end_time, wallet_credit_id)` — **priority first**.

`report.md` §6.2, decision 3, chose the opposite and called it "not close": soonest expiry
first, with priority only as the tie-break. Its argument is a stranding scenario. An
organization holds a signup grant expiring in ninety days and a contribution award expiring
tomorrow. Under expiry-first the award is spent and the contributor keeps what they earned.
Under priority-first the signup grant is spent first and the award expires unused.

The delivered order came from the `WP-1-01` specification, which said "priority/end-time/
credit-ID order". Nothing recorded that this reversed a stated decision.

Today the divergence is inert: `plan_allowance` is priority 10 and expires at period end,
the signup grant is priority 20 and lasts twelve months, so both orders agree. It becomes
live the first time a short-lived lot sits at a higher priority number than a long-lived one
— which is exactly what the grant catalog's next entries introduce.

### The question behind the question

Expiry order only matters because things expire. So the prior question is whether earned
value should expire at all.

A plan allowance expiring at period end is obvious: it is what the subscription bought for
that period, and rolling it over would mean selling the same month twice. A purchase expiring
is a liability decision. But **a contribution award is payment for work already done**, and
expiring it takes back something the person earned. That is a different moral object from an
unspent monthly allowance, and treating them identically because both are rows in one table
is a data-model convenience, not a policy.

### The options

1. **Expiry-first, as `report.md` decided.** Short-lived value is always spent first, so
   nothing is stranded. Priority becomes a pure tie-break. Simple, and it never strands
   earned value — but it also spends a promotional grant before money somebody paid us
   whenever the promotion expires sooner, which may not be what we want.
2. **Priority-first, as delivered.** Source is what decides, and expiry only breaks ties.
   Predictable and easy to explain, and it can strand earned value.
3. **Earned value never expires.** Removes the problem for the case that motivated it, at
   the cost of an unbounded liability we carry forever and cannot clear.
4. **A weighted heuristic.** Rank lots by something combining the value remaining and the
   time remaining — spend most urgently what is largest and closest to expiring. Strictly
   more expressive than either sort, and strictly harder to explain to a user who asks why
   their balance moved the way it did. It also has to stay deterministic and stable, because
   the settlement planner's ordering has to be reproducible on replay.

### Why it matters

Spend order is cheap to change — it is a sort key over an indexed column, named in
`report.md` §7.5 as one of the decisions that stays cheap. **Expiry policy is not.** Once
awards have been issued under a stated rule, shortening it is a public failure and extending
it is free. So the expiry question should be answered before the earning path ships, and the
sort question can follow it.

### Current direction

Priority-first, as delivered, with signup at twelve months. No contribution award has ever
been issued, so nothing is stranded yet and no rule has been published.

### Decision

_Unresolved. Deferred deliberately: the weighted-heuristic option needs a product judgement
about what a user should be told about their own balance, and the expiry question needs a
position on whether earned value is payment or promotion._
