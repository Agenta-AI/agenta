# Metering and wallet: entities

The candidate data model for gateway metering and wallet value.

This is the selected Wave 1 entity design, not a migration plan. It follows the **Channels:
entities** structure: establish what each entity is and is not, show a concrete example row, then
decide which facts merit columns. It does not use the gateways entity document as a structural
source.

The broader wallet product still has open designs. The Wave 1 names, measurement identity,
header dimensions, metric-row shape, and core/tracing placement below are selected inputs to the
work graph. In particular, `check(delta)` describes an operation; it does not imply a `checks`
table.

The selected names are: existing `records` remains the internal coding-agent/ACP record table;
existing `meters` remains the scoped/periodic meter aggregate; and new gateway-owned `measurements`
are raw LLM/MCP/SBX usage facts. `wallet_*` is the financial namespace. There is no table named
`wallets`.

---

## 1. The entities

### Metering and billing boundary

**Metering** keeps the existing scoped/periodic `meters` aggregate and, for managed gateway work,
the new `measurements` fact. A measurement is not an audit event: it is a trusted
provider/gateway measurement for one operation or bounded SBX interval. Whether every managed call
must persist one is a reliability/volume decision; spans/events/records stay on their existing paths.
**Wallet** owns monetary state: credits, debits, and accounts. A measurement
can have no debit—for example, free or BYOK activity.

A **wallet** is the financial aggregate a customer sees: its wallet balances, wallet credits, and
debits. Measurements are gateway-owned source facts, not wallet entities. `wallet_balances` is the mutable numeric projection of value
available now. It does not become a `wallets` table. Credits and debits explain why a balance has its
displayed value, while the balance row makes that value and `check(delta)` atomic.

`check(delta)` is an operation, not an entity. An entitlement check examines a meter against a limit.
A wallet check examines the organization’s general wallet balance against its allowed floor. A stored
`checks` table would conflate those two meanings.

Two existing tables stay in place. The wallet does not replace either of them. The rest are selected
new entities, separated by the question each answers.

| Entity / table | Status | What it is | What it is not |
| --- | --- | --- | --- |
| `subscriptions` | existing, reused | The organization’s current plan and Stripe customer/subscription identity. | Not a wallet balance, a payment history, or a provider-usage record. |
| `meters` | existing, reused | One mutable, periodic aggregate for an entitlement or volume key at a scope. | Not a per-request usage journal and not a monetary balance. |
| `measurements` | gateway-owned, selected name | One append-only, collector-supplied LLM/MCP/SBX measurement for one operation or bounded interval, with optional measured values/costs. | Not a wallet entity, an audit event, a debit, or necessarily a charge. |
| `measurement_values` | selected, new | Immutable optional metric values belonging to one measurement, each with a stable metric key and optional provider cost. | Not a meter aggregate or a widened sparse measurement header. |
| `records` | existing | An internal coding-agent/ACP session fact. | Not a gateway measurement or a monetary debit. |
| `wallet_balances` | selected, new | Mutable organization-general and per-credit available-value projections in one table. | Not the wallet domain itself, financial history, or an allocation table. |
| `wallet_credits` | selected, new | One immutable incoming, spendable credit: signup grant, plan allowance, purchase, promotion, contribution award, referral bonus, goodwill, or correction. | Not a debit, the displayed balance, or a mutable “remaining credits” counter. |
| `wallet_debits` | selected, new | One immutable outgoing value: usage, expiry, clawback, refund, or negative correction. | Not raw provider usage; it says value left the general balance, not how it was measured. |

### Candidate store placement

This is an open multi-store boundary, not an assumption that there are only tracing and core
databases. It also is not a claim that every core row is mutable or every tracing row is unimportant.
The relevant properties are transactional state, append-only/analytic access, retention, and whether
old records are interpreted by a versioned schema rather than rewritten by migrations.

| Store | Entities | Reason |
| --- | --- | --- |
| Tracing / append-only record store | existing spans, events, and `records`; new `measurements` | High-volume immutable observations/history with analytics and retention needs. Measurements belong here. |
| Transactional core wallet unit | `wallet_credits`, `wallet_debits`, and `wallet_balances` | Financial history, credit selection, and the authoritative available-value projection are written atomically. |
| Gateway measurement workload | `measurements` | The request emits a tracing-style gateway-observation stream message. A gateway worker builds the measurement, provider details, and gateway charge calculation, then emits a separate debit message when applicable. |
| Analytics record workload | measurements and core wallet history | Measurements provide unit-economics analytics; wallet history provides organization-level financial reporting. Derived rollups/snapshots are deferred and never used by `check(delta)`. |
| Core transactional state store | `subscriptions` and existing `meters` | Mutable organization/plan state and exact entitlement aggregates. No wallet join is implied. |
| Schema-versioned record store | record families whose payload/schema must evolve without in-place row migration | Old record versions remain readable through versioned readers/interpretation; the physical database or schema is not decided here. |
| Redis | active-work leases and `unsettled_exposure` | Ephemeral, recoverable admission state; never the source of financial truth. |
| Code configuration | entitlement and pricing configuration | Versioned deployment configuration, not database rows. |

Workload type does not decide physical placement. First enumerate the required foreign keys, joins,
cascades, and atomic operations. Every required relational edge defines a same-database co-location
unit: it cannot be replaced with a cross-store logical reference without deliberately giving up that
operation. `wallet_debits.wallet_credit_id` makes credits, debits, and general/per-credit balances one
core transaction unit. Gateway measurements are gateway-owned and do not share a transaction or foreign
key with wallet postings: the selected boundary is two separate Redis Streams.

Only after that matrix is settled should we name the resulting database “core,” “tracing,” or another
store class. Separate stores cannot imply an atomic transaction. The deliberate gateway/wallet edge
uses a gateway-supplied opaque idempotency key; the wallet transaction is idempotent, while a failed
debit-message publish is intentionally uncharged.

Read it as a sentence: *a subscription determines the plan; meters enforce and aggregate periodic
entitlements; a measurement preserves what a gateway collector measured; the gateway decides a
posting amount; credits and debits explain how value changed; and balances project available value.*

### Measurement, wallet credit, and wallet debit

A **measurement** is the raw collector fact: LLM/MCP/SBX measured quantities and optional provider
costs. The request path emits its observation asynchronously; a gateway worker builds the measurement
and decides whether it emits a wallet posting and its amount. A **wallet debit** is the immutable outgoing value created from that posting, or from an
accounting reason such as expiry, clawback, refund, or adjustment. A **wallet credit** is the immutable
incoming, spendable value — see `credit_kind` below for the enumerated kinds.

Credits carry their spendability rules: source, priority, start/end time, and any resource
applicability. A debit points directly to the credit it consumes. This is why a restricted Gemini
credit cannot fund an Anthropic debit, and why expiry can remove unspent credit without rewriting
history.

### Rejected version-one split: tracing debits / core state

Measurements are append-only analytical facts in tracing, while credits, debits, and live balances are
transactional core state. Moving work behind workers does **not** make separate databases atomic.
Consider a 1,850 `musd` adjustment funded by a Gemini credit:

1. If the wallet worker writes the tracing debit first and crashes before decrementing the core
   balance, a retry must know that the debit exists but the core state was not applied.
2. If it decrements the core balance first and crashes before writing the tracing debit, a retry must
   know that the core state was applied but the analytic debit is missing.

Neither database can answer both questions atomically. A tracing-debit/core-state split would therefore
need one of two additional designs:

| Design | Core transaction | Tracing debit | Consequence |
| --- | --- | --- | --- |
| Core settlement receipt | Insert a small immutable `wallet_settlements` receipt keyed by adjustment idempotency key while selecting credits and updating balances. | Write/upsert the tracing debit after the core transaction; retries use the receipt and converge. | Adds a core receipt entity, but keeps `wallet_debits` in tracing and makes balance application exact. |
| Core debit as authority | Insert the debit with credits/balances in core. | Replicate a tracing debit for analytics later. | Avoids the receipt, but means the authoritative debit is in core; tracing is a copy. |

The first adds a receipt at roughly the same order of magnitude as debits; the second makes the tracing
debit merely a copy. Neither earns its complexity in version one. **Decision:** keep authoritative
`wallet_credits`, `wallet_debits`, and `wallet_balances` in core. Reconsider physical separation only
after measured volume, retention, or database-operational evidence requires it.

### Prior proposal reconciliation

`report.md` contains a useful but earlier candidate schema named `credit_*`.  It is not present in
the database.  The following is a review map, not an adoption of either vocabulary:

| Earlier candidate | This draft’s responsibility | Review outcome |
| --- | --- | --- |
| `credit_rate_card`, `credit_rate`, `credit_pricing_state` | versioned pricing and active-price selection | Keep the responsibility, but move the configuration into versioned code rather than new database tables. |
| `credit_account` | current organization monetary account | Replace with the general row in `wallet_balances`; it has `wallet_credit_id = NULL`. |
| `credit_grant` | independently spendable incoming value | Rename as `wallet_credits`. |
| `credit_entry` | immutable change in wallet value | Split into `wallet_credits` and `wallet_debits`; do not use it for raw measurement. |
| `credit_hold` | mutable state for a provisional check / later correlation | Excluded from the non-strict variable-cost path. |
| `credit_allocation` | portion of a debit covered by a credit | Fold into `wallet_debits.wallet_credit_id`; split a debit across rows when it consumes several credits. |
| `credit_usage_record` | raw, collector-supplied gateway measurement | Rename as `measurements` and redesign around the agreed LLM/MCP/SBX metrics and references. |
| `model_gateway_request` attribution | gateway/request facts and workflow-artifact references | Do not carry this forward as a wallet entity. Keep workflow artifact, variant, revision, endpoint, and other cross-domain facts in `data.references`; its exact shape is still to be specified. |

The old proposal also used `model`, `tool`, and `sandbox` as resource kinds. This draft uses the
agreed gateway families `llm`, `mcp`, and `sbx`; it does not settle the eventual enum/value names.

The relationship is deliberately one-way:

```text
measurement ──> code pricing configuration ──> wallet_debit ──writes with──> wallet_balances
                                                     │
                                                     └──> wallet_credit

wallet_credit ──writes with──> wallet_balances
```

Class-B platform capacity follows a different cardinality, not a different accounting system:
the existing meter is its measurement aggregate, and a periodic rollup can produce a wallet debit
if that resource is moved from Stripe arrears to wallet prepaid.

---

## 2. Existing entities

### `subscriptions`

One row per organization. Today it holds `plan`, `active`, `anchor`, `customer_id`, and
`subscription_id`.

```json
{
  "organization_id": "org_7a...",
  "plan": "cloud_v0_pro",
  "active": true,
  "anchor": 12,
  "customer_id": "cus_...",
  "subscription_id": "sub_...",
  "created_at": "2026-08-13T14:00:00Z",
  "updated_at": "2026-08-13T14:00:00Z"
}
```

It is the source of current subscription facts. A subscription period may cause a plan allowance
credit to be created, but it does not itself store that credit or overwrite prior allowance history.

### `meters`

One deterministic row per `(scope, key, period)`, with a mutable `value` and `synced` watermark.
The scope currently supports organization, workspace, project, and user; the period supports
year/month/day. Existing examples include `TRACES_INGESTED`, `EVENTS_INGESTED`, and
`RECORDS_INGESTED`.

```json
{
  "meter_id": "uuid5(scope + traces_ingested + 2026-08)",
  "organization_id": "org_7a...",
  "workspace_id": null,
  "project_id": null,
  "user_id": null,
  "key": "traces_ingested",
  "year": 2026,
  "month": 8,
  "day": null,
  "value": 1284000,
  "synced": 1000000,
  "created_at": "2026-08-01T00:00:00Z",
  "updated_at": "2026-08-13T16:12:00Z"
}
```

This is correct for periodic entitlement and high-volume internal-resource aggregation. It is not
the right shape for a model, MCP, or SBX observation: those need provider correlation, optional
component values, and an immutable record of what was observed.

---

## 3. Candidate billing entities

### `wallet_balances`

One mutable projection table serves both the organization’s general balance and each immutable
credit’s available value. A nullable `wallet_credit_id` is the discriminator:

- `wallet_credit_id = NULL` is the one general balance row per organization, used by the overall
  wallet check and allowed-floor policy.
- `wallet_credit_id != NULL` is the one available-value row for that credit, used to select and lock
  eligible restricted/general value.

The discriminator is the individual credit (or final equivalent lot ID), not a credit/lot **kind**:
two credits of the same kind can have different priority, expiry, and applicability. Immutable wallet
credits and debits remain the historical explanation; balance rows are their mutable current-state
projection.

The required constraints are a partial unique key for the general row,
`UNIQUE (organization_id) WHERE wallet_credit_id IS NULL`, and one row per credit,
`UNIQUE (wallet_credit_id) WHERE wallet_credit_id IS NOT NULL`. The exact database syntax follows the
chosen store, but the two invariants do not.

The non-null `wallet_credit_id` is also a real foreign key to `wallet_credits`, with restrict/no-delete
lifecycle behavior. It makes the per-credit projection an internal relationship of the wallet unit,
not an independently owned balance. No equivalent FK is used for the organization owner.

`organization_id` is the validated logical owner of wallet rows, not a foreign key to an organization
table. The same rule applies to any workspace/user attribution carried for reporting: do not introduce
cross-domain cascades into financial history. `project_id` on a measurement is a real foreign key
only when the project table is physically local in the same core database; otherwise it is a validated
logical identifier, as in the tracing record families. Removing an organization or project never
cascades into gateway or wallet history; any later retention deletion/anonymization is an explicit
policy-driven job, not a referential action.

```json
{
  "organization_id": "org_7a...",
  "wallet_credit_id": null,
  "balance_musd": 480000,
  "floor_musd": 0,
  "created_at": "2026-08-01T00:00:00Z",
  "updated_at": "2026-08-13T16:12:00Z",
  "deleted_at": null
}
```

```json
{
  "organization_id": "org_7a...",
  "wallet_credit_id": "wcr_01...",
  "balance_musd": 315000,
  "floor_musd": null,
  "created_at": "2026-08-01T00:00:00Z",
  "updated_at": "2026-08-13T16:13:04Z",
  "deleted_at": null
}
```

The general row may become negative within the allowed credit line; a per-credit row must never fall
below zero. Every settled credit/debit updates the general row atomically; every debit that names a
credit also updates its per-credit row atomically. `balance_musd` is the selected amount-field name.

### `wallet_debits`

One immutable outgoing value record: a gateway-decided charge, expiry, clawback, refund, or negative
adjustment. A debit funded by an existing credit points directly to that `wallet_credit` through a real
foreign key. If a charge consumes two credits, it creates two debit rows with the same wallet-posting
idempotency identity; each directly records its credit source, so no separate table is needed. A debit
permitted to take the general balance below zero has no `wallet_credit_id`. Referenced credits are
restrict/no-delete, never cascade deleted. It has no gateway-measurement foreign key: the gateway
and wallet communicate through independent Redis stream messages.

```json
{
  "id": "wde_01...",
  "organization_id": "org_7a...",
  "debit_kind": "gateway_usage",
  "amount_musd": 1850,
  "wallet_credit_id": "wcr_01...",
  "idempotency_key": "gateway-supplied-opaque-key",
  "debit_key": "composed-from-posting-key-and-wcr_01",
  "data": {
    "references": {
      "workflow": {"id": "...", "variant_id": "...", "revision_id": "..."}
    },
    "reason": null
  },
  "created_at": "2026-08-13T16:13:04Z",
  "updated_at": null,
  "deleted_at": null
}
```

`debit_kind` distinguishes the debit’s economic reason without embedding a gateway protocol state in
financial history. Its initial values are `gateway_usage`, `credit_expiry`, `clawback`, `refund`, and
`adjustment`. A `gateway_usage` debit has a gateway-supplied posting identity and no measurement FK;
the other kinds carry their own immutable, external provenance as needed. An adjustment changes value
now; it does not repair or rewrite historical ledger rows.

### `wallet_credits`

One immutable incoming, spendable value record. Credits make expiry, spend order, refunds, source
provenance, and resource applicability explainable while the product still shows one balance. Its
`credit_kind` selects the versioned configuration rule that evaluates a gateway posting’s
`resource_key`/`resource_locator`; the issued credit carries the concrete priority and `end_time`.
A credit is the credit-side record; it is not duplicated in `measurements`.

```json
{
  "id": "wcr_01...",
  "organization_id": "org_7a...",
  "credit_kind": "plan_allowance",
  "amount_musd": 500000,
  "priority": 10,
  "start_time": "2026-08-01T00:00:00Z",
  "end_time": "2026-09-01T00:00:00Z",
  "data": {
    "references": {
      "subscription": {"id": "sub_..."}
    }
  },
  "created_at": "2026-08-01T00:00:00Z",
  "updated_at": null,
  "deleted_at": null
}
```

Expiry, cancellation, and clawback create new wallet debits against the affected credit. They must
not silently rewrite this arrival row.

**Delivered (`WP-1-04`, `WP-1-05`; no migration beyond `ee0000000005`).** Organization creation
provisions each organization's general `wallet_balances` row (`wallet_credit_id IS NULL`)
idempotently; migration `ee0000000005_backfill_wallet_general_balances.py` backfills it for
organizations that predate this change. A mid-period plan change prorates a `plan_allowance`
credit: `ee.src.core.wallets.proration.compute_plan_change_proration` computes the outgoing
remainder debit and the incoming share (pure, DB-free arithmetic), and
`WalletsDAO.apply_plan_change` applies both — debiting the outgoing credit's balance and minting a
NEW `wallet_credits` row for the incoming share, never mutating an existing row — idempotent on
the subscription's `plan_change:{subscription_id}:{period_start}` key.

`ee.src.core.wallets.plans` carries real, PRODUCT-DECIDED (2026-08-14) per-plan allowance and floor
amounts — see `nodes/im-1-02-pipeline/acceptance.md` §"2b" for the table. Every floor is 0 at
launch (a hard stop everywhere once the general balance is spent); individual customers get an
overdraft by hand later.

`ee.src.core.wallets.grants` adds a catalog of named activities (a `GrantRule` per activity code)
that award wallet credit outside the plan-change path — `WalletsService.award()` is the idempotent
entry point, keyed `award:{activity_code}:organization:{organization_id}` (once-per-organization)
or `...:reference:{reference}` (repeatable). One entry exists today: `signup` — $1
(`credit_kind="signup_grant"`, its own `GENERAL_CREDIT_KINDS` entry, matching `mechanics.md` §4's
name exactly), awarded once per organization on every plan including free, twelve-month expiry
(`report.md` §9.5/§9.6), wired into the signup organization-creation path only
(`provision_signup_subscription`, never `provision_user_subscription`/explicit `POST
/organizations/`, per `report.md` §9.2), after the general balance row already exists.

**`credit_kind` (delivered set, `WP-1-04`).** `GENERAL_CREDIT_KINDS` in `ee.src.core.wallets.types`
carries eight of `mechanics.md` §4's thirteen inbound kinds — enough to distinguish a signup grant
from a contribution award from the row alone, which a single catch-all `"award"` value could not
do. Only `signup_grant` and `plan_allowance` are wired to a real code path today; the rest are
valid, validated values with no producer yet.

| `credit_kind` | Spend priority | Wired? |
| --- | --- | --- |
| `plan_allowance` | 10 | yes — `ee.src.core.wallets.plans` / plan-change proration |
| `signup_grant` | 20 | yes — `ee.src.core.wallets.grants.GRANT_CATALOG["signup"]` |
| `promotion` | 30 | no — catalog row not yet added |
| `referral_bonus` | 40 | no — catalog row not yet added |
| `contribution_award` | 50 | no — catalog row not yet added |
| `goodwill` | 60 | no — catalog row not yet added |
| `purchase` | 70 | no — checkout path not yet built |
| `correction` | 80 | no — operator tooling not yet built |

`credit_kind` is a `sa.String()` column with no CHECK constraint (`ee0000000004_add_wallet_tables`
— validation is application-level via `GENERAL_CREDIT_KINDS`/`is_resource_eligible`), so adding a
kind is a Python-only change; no migration is needed for the eight above.

Deliberately deferred (`mechanics.md` §4 names these; do not reuse one of the eight above for
them when they land): `auto_recharge`, `charge_refund`, `chargeback_reversal`,
`opening_balance`, `partner_allocation`.

**Two kinds this document previously listed were removed, deliberately.**

`adjustment` is gone from the credit side and stays a `debit_kind`, which is where it is
actually used. A positive adjustment is better recorded as `correction` when it repairs
arithmetic, or `goodwill` when a human decided to give value — those say *why*, and
`adjustment` does not.

`provider_credit` is gone and its removal is **not** a naming variant of anything in the eight.
It named value funded by a provider grant rather than by us, which is the funding source
behind this entire project. Nothing produces one today, so nothing broke. But the moment we
want provider-funded value distinguishable from a promotion in reporting or in a
reconciliation against a provider invoice, it is a ninth kind, and naming it before rows exist
is free. Open, and cheap to close either way.

### `measurements`

One immutable observation produced by an LLM, MCP, or SBX gateway collector. It preserves what was
measured, whether or not it is priced today. A provider response, a provider push, a provider pull,
or a gateway-derived collection can all create a row; user-controlled code cannot.

```json
{
  "id": "msr_01...",
  "project_id": "prj_5c...",
  "user_id": "usr_4d...",
  "agent_id": "agt_6e...",
  "request_id": "req_01...",
  "gateway": "llm",
  "resource_key": "vertex_ai:gemini-2.5-flash",
  "endpoint_id": "end_2f...",
  "endpoint_kind": "managed",
  "data": {
    "references": {
      "workflow": {"id": "...", "variant_id": "...", "revision_id": "..."},
      "endpoint": {"id": "..."},
      "provider_request": {"id": "..."}
    },
    "measurement_source": "response",
    "secret_origin": "agenta"
  },
  "start_time": "2026-08-13T16:12:57Z",
  "end_time": "2026-08-13T16:13:04Z",
  "created_at": "2026-08-13T16:13:04Z",
  "updated_at": null,
  "deleted_at": null
}
```

`measurement_values` is the selected child table for optional, repeatable metric values. It has an
immutable parent `measurement_id` FK, stable `key`, integer `value`, nullable `cost_musd`, and ordinary
`created_at` lifecycle time. `(measurement_id, key)` is unique in Wave 1: a collector aggregates a
component before publishing rather than emitting two rows for one metric key. One
measurement-worker transaction inserts the measurement and all of its value rows; it never needs one
independent transaction per metric. This write is separate from the wallet-worker transaction. A new
metric is therefore a new stable key, not a migration or a widening collection of nullable columns:

```json
[
  {"measurement_id": "msr_01...", "key": "request_count", "value": 1},
  {"measurement_id": "msr_01...", "key": "input_tokens", "value": 1200},
  {"measurement_id": "msr_01...", "key": "input_cost_musd", "value": 240},
  {"measurement_id": "msr_01...", "key": "cached_tokens", "value": 1000},
  {"measurement_id": "msr_01...", "key": "cached_cost_musd", "value": 20},
  {"measurement_id": "msr_01...", "key": "output_tokens", "value": 380},
  {"measurement_id": "msr_01...", "key": "output_cost_musd", "value": 760}
]
```

For SBX, the same child collection holds `vcpu_core_time_msec`, `vcpu_core_cost_musd`,
`vmem_gibi_time_msec`, `vmem_gibi_cost_musd`, `disk_gibi_time_msec`,
`disk_gibi_cost_musd`, `vgpu_core_time_msec`, `vgpu_core_cost_musd`,
`blob_gibi_time_msec`, and `blob_gibi_cost_musd` when the collector has them.

Every measurement belongs to a project, so it carries `project_id`, optional `user_id` and `agent_id`,
plus `gateway_kind`, `resource_key`, optional `endpoint_id`, `endpoint_kind`, the gateway-minted
`request_id`, and a gateway-minted `measurement_id`. `measurement_id` is an opaque identity that the
emitting gateway makes unique among all of its measurement emissions; `UNIQUE (measurement_id)` makes
the tracing write replay-safe. `request_id` correlates one managed request with one or more measurements;
it is deliberately not the uniqueness constraint because a bounded SBX interval or a later collector
report may produce several measurements for one request.
Whether it also copies `organization_id` and `workspace_id` is a database-topology decision, not an
analytics default: when the wallet unit and project hierarchy are in one database, organization and
workspace are normalized through the project; when they are not, those values must be copied to avoid
a cross-database hierarchy lookup. These are identifiers and selectors, not chargeable metric rows.
Workflow artifact/variant/revision and provider correlation remain in `data.references`; provider
request/response IDs, sandbox IDs, and additional endpoint or resource identifiers are promoted to
columns only when a concrete analytics, idempotency, or reconciliation query needs them.

`gateway_kind`, `resource_key`, `endpoint_id`, and `endpoint_kind` are selected header dimensions
because the gateway pricing/configuration path and ordinary analytics predicate on them. Provider,
model, endpoint URL, sandbox, and other provider-specific selectors belong in the structured
`resource_locator`; workflow artifact/variant/revision and provider correlation belong in
`data.references`. These are not chargeable metric rows.

The gateway mints `request_id` before dispatch and mints `measurement_id` for each collected fact.
Provider request IDs remain reconciliation references; they are not assumed to be present or safe
enough to be the sole local idempotency key.

### Gateway stream contracts: proposed version-one shape

The current tracing, event, and record streams use the same transport shape: Redis `XADD` has one
`data` field containing a compressed JSON Pydantic envelope; a dedicated consumer group deserializes
it and ACKs plus deletes only after its work succeeds. The gateway pipeline should reuse that shape,
not invent a second serialization protocol. It needs two dedicated streams because the measurement
worker consumes the first and produces the second; the generic shared consumer deletes successfully
processed stream entries and therefore cannot safely fan out one entry to both workers.

Like the existing `streams:spans`, `streams:events`, and `streams:records` producers, both new streams
use bounded approximate `MAXLEN` trimming and successful consumers ACK plus delete messages. Their
configured maximum lengths may differ by workload, but the transport/retention mechanism is the same
for all streams.

#### `streams:measurements`

The API request publishes this best-effort message after it has the managed gateway result. It is the
only producer-side loss boundary: if its `XADD` fails, no measurement and no charge are created.
`organization_id` follows the existing events/records convention: it is optional on this envelope.
When absent, the measurement worker resolves organization from `project_id` before it emits the debit
message. The persisted measurement does not duplicate organization; project remains the analytics
hierarchy anchor.

```json
{
  "version": 1,
  "measurement_id": "gateway-minted-opaque-measurement-key",
  "organization_id": "org_7a...",
  "project_id": "prj_5c...",
  "user_id": "usr_4d...",
  "agent_id": "agt_6e...",
  "gateway_kind": "llm",
  "request_id": "gateway-request-id",
  "resource_key": "llm:google:gemini-2.5-flash",
  "resource_locator": {
    "provider": "google",
    "model": "gemini-2.5-flash",
    "endpoint_id": "end_2f..."
  },
  "start_time": "2026-08-13T16:12:57Z",
  "end_time": "2026-08-13T16:13:04Z",
  "components": [
    {"key": "request_count", "value": 1},
    {"key": "input_tokens", "value": 1200, "cost_musd": 240},
    {"key": "cached_tokens", "value": 1000, "cost_musd": 20},
    {"key": "output_tokens", "value": 380, "cost_musd": 760}
  ],
  "references": {
    "workflow": {"id": "...", "variant_id": "...", "revision_id": "..."},
    "provider_request": {"id": "..."}
  },
  "created_at": "2026-08-13T16:13:04Z"
}
```

`components` are optional and repeatable: an MCP observation may provide only `request_count`, while
an SBX observation can provide `vcpu_core_time_msec`, `vmem_gibi_time_msec`, and each optional
component cost. Their metric-specific unit is encoded by the stable key. `resource_locator` and
`references` are structured objects; neither is an unbounded raw provider payload or secret store.

The measurement worker validates the envelope, inserts exactly one immutable `measurements` row and its
`measurement_values` under the gateway-supplied `measurement_id`, calculates the final charge, and
publishes the second message. It ACKs the measurement message only after those actions complete. A
malformed/unsupported version is logged and terminally ACKed—there is no way to safely price an
envelope the worker cannot interpret.

#### `streams:debits`

Only the gateway measurement worker publishes this message, and only for managed use that the gateway
chooses to charge. It deliberately contains no provider metrics, provider pricing, measurement ID, or
workflow references: the wallet needs the amount and resource selector for its domain work, not the
analytics fact that led to them.

```json
{
  "version": 1,
  "idempotency_key": "opaque-gateway-posting-key",
  "organization_id": "org_7a...",
  "debit_kind": "gateway_usage",
  "amount_musd": 1020,
  "pricing_version": "wallet-v1-fake-llm-1",
  "resource_key": "llm:google:gemini-2.5-flash",
  "resource_locator": {
    "provider": "google",
    "model": "gemini-2.5-flash",
    "endpoint_id": "end_2f..."
  },
  "created_at": "2026-08-13T16:13:04Z"
}
```

`amount_musd` is a strictly positive integer debit amount; `pricing_version` is immutable evidence of
the gateway-side configuration that computed it. An uncharged custom/standard request emits no debit
message rather than a zero debit. Re-delivering the exact same idempotency key must have no second core
financial effect. The wallet worker performs that idempotency check, credit selection, debit insert,
and balance transaction before ACKing its stream entry.

### Version-one analytics

Measurements and immutable wallet history are the analytical journal. Version one has **no**
measurement rollup, credit/debit rollup, or balance-snapshot table. Measurements carry the identifiers
and measured values for resource/use analytics; wallet debits and credits carry the financial history;
and the live general `wallet_balances` row answers the current wallet value. There is intentionally no
measurement-to-debit foreign key across the two databases.

The raw tables are expected to be substantially narrower than spans because they do not carry tracing
payload blobs. Indexing, time partitioning, and query measurement come before introducing a derived
analytics table. If an observed report cannot meet its latency/cost target, its exact query pattern
determines a later, separate derived table; that work is recorded in `out-of-scope.md`.

### Operational and analytical query paths

| Query or operation | Reads/writes | Consistency requirement |
| --- | --- | --- |
| `check(delta)` | General `wallet_balances` row and eligible per-credit rows/credits; Redis L1 estimate where applicable | Functional path. L2 reads committed atomic wallet state; it never reads analytics aggregates. |
| gateway posting | Wallet debit rows and selected `wallet_balances` rows, keyed by a gateway-supplied idempotency key | One core transaction for the financial effect. The gateway measurement worker independently delivers it through `streams:debits` and ACKs its measurement message only after that succeeds; retry is safe through the two idempotency identities. |
| workspace/project/user/agent analytics | Indexed gateway/credit/debit journal queries | Reports attributed activity unless value is actually scoped. |

### Pricing configuration (codebase, not a database entity)

The pricing rules belong with entitlement and plan configuration in the codebase. They are versioned
and deployed as code; changing a price adds a new explicit configuration version rather than writing
a database row. This document does not prescribe the language or file shape of that configuration.

The database keeps only the evidence needed to explain a historic debit: its `pricing_version`, the
raw measurement, and its resulting amount. A pricing selector or evaluated detail
may live in `data.pricing` if needed for disputes or reconciliation. It is evidence of the code that
ran, not a mutable copy of the price catalogue.

---

## 4. Column rule, applied here

Following the channels entity design, a value is a column only when the database must act on it:
a foreign key, uniqueness member, index, or constant worker predicate. The first decisions to make
for each candidate entity are therefore concrete rather than speculative:

| Fact | Candidate home | Why this needs a decision |
| --- | --- | --- |
| balance owner/discriminator | `wallet_balances.organization_id` plus nullable `wallet_credit_id` | `NULL` identifies the one general organization balance; a non-null credit ID identifies that credit’s available-value projection and is a real restrict/no-delete FK. Organization is a validated logical owner, not an FK. |
| record scope and actor | `project_id`, `user_id`, and `agent_id` columns; organization/workspace normalized through project when local | Organization/workspace/user/agent attribution is validated rather than foreign-keyed. `project_id` has an FK only if its core project table is physically local; otherwise it is also a validated logical ID. Copy organization/workspace only when the project hierarchy is outside the wallet database or history must be frozen without a local join. |
| gateway family | `measurements.gateway_kind` column | LLM/MCP/SBX is a small closed selector used by pricing and analytics. |
| resource identity | `resource_key` plus structured `resource_locator` | Following the channels key/locator pattern, the gateway composes a stable key from configured identity fields and retains the fuller locator beside it. Wallet credit rules match the key/locator; provider-specific semantics remain gateway-owned. |
| debit kind and source | `wallet_debits.debit_kind`, gateway-supplied idempotency key, and optional `wallet_credit_id` | `gateway_usage` is produced only by a gateway wallet-posting message; non-gateway kinds use their own immutable provenance. A funded debit names its credit source, eliminating the allocation table. |
| applied pricing | `wallet_debits.pricing_version` column and optional `data.pricing` | The version is immutable evidence of the code configuration that produced a debit; it is not a foreign key to a table. |
| workflow/artifact, variant, revision | `data.references` | These are cross-domain artifact references; do not make them columns without a key/index/query reason. |
| provider request/response, sandbox, and collector IDs | column only if an idempotency/reconciliation/index requirement proves it; otherwise `data.references` | They are necessary facts, but necessity does not by itself make them columns. |
| measured metric | `measurement_values` child row | Metric keys evolve and values are optional; they are not header dimensions. One parent/children transaction keeps an observation complete. |
| period year/month/day | derived rollup, not assumed on measurements | They are meter-bucket fields, not automatically facts of an immutable observation. |

---

## 5. Wave 1 selections used by the work graph

1. `measurement_id` is a gateway-minted opaque unique identity, persisted under `UNIQUE
   (measurement_id)`. `request_id` is correlation only; one request may have several measurements.
2. `project_id`, `user_id`, `agent_id`, `gateway_kind`, `resource_key`, `endpoint_id`, and
   `endpoint_kind` are measurement header columns. Provider-specific selectors and all workflow/
   artifact references remain structured data.
3. Optional metrics are immutable `measurement_values` child rows with a stable `key`, integer
   `value`, and optional `cost_musd`; the parent and all children are inserted together.
4. The canonical vocabulary is existing `records`, existing `meters`, new `measurements` and
   `measurement_values`, and `wallet_credits`, `wallet_debits`, and `wallet_balances`.

### Delivered (Wave 1)

All four selections above are answered questions, not open ones, as of the merged `IM-1-02`
pipeline: measurement metrics **are** child rows, not sparse header columns — `measurement_values`
exists with `UNIQUE (measurement_id, key)` (constraint `uq_measurement_values_measurement_id_key`
in `ee0000000002_add_measurements.py`), and one measurement-worker transaction inserts the parent
`measurements` row and every `measurement_values` row together. The measurement header columns in
selection 2 are exactly the columns the delivered migration creates; nothing further was widened
into columns.

The delivered migration ids are `core_ee` `ee0000000004` (`down_revision = "ee0000000003"`) for
`wallet_credits`/`wallet_debits`/`wallet_balances`, and `tracing_ee` `ee0000000002`
(`down_revision = "ee0000000001"`) for `measurements`/`measurement_values`. This differs from the
`ee0000000006`/`ee0000000005` numbers named earlier in node planning (`wp-1-01-core-wallet/`,
`im-1-01-foundations/`): those two revisions exist only on unmerged sandbox-metering draft
branches and do not resolve on this base's `core_ee` chain, whose head was `ee0000000003`. This is
an approved deviation, not a drift — see `ee0000000004_add_wallet_tables.py`'s own docstring. The
sandbox-metering drafts must renumber past `ee0000000004` when they land; `wave-1.md` and
`preflight.md` record the same correction.

The delivered streams are `streams:measurements` (consumer group `worker-measurements`) and
`streams:debits` (consumer group `worker-debits`), both `MAXLEN 100_000` (approximate trimming),
registered in `api/entrypoints/worker_streams.py` and gated into `ALL_STREAMS` only when `is_ee()`.
The debit idempotency key the measurement worker mints is `"measurement:{measurement_id}"`. Wave 1
pricing is an explicit fixture (`PRICING_VERSION = "wallet-v1-fake-1"` in
`ee/src/core/measurements/pricing.py`), chargeable only when `endpoint_kind == "managed"` — it is
not the versioned production pricing configuration this document describes elsewhere.
