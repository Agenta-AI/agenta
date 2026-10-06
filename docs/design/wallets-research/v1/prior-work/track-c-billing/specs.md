# Track C — billing: debit population, gating, and the wallet

Track C owns **billing**: converting measured usage into wallet debits
(populate), checking and enforcing balances (charge/gate), and the wallet
itself — funding ledger, allowance cron, tier, top-ups, auto-recharge. Track B
(metering) defines the meters and measures; Track D (BYOS) adds
bring-your-own-secrets zero-rating on top of this track.

Companion design docs (big-agents-audit collection): `tiers-and-unified-wallet.md`
(the model: billing boundary §0, grant kinds + amounts §1.5/§3.5, promotion §2,
Stripe §3, data model §3.5, entitlement chain §4, tier-change §5, meter taxonomy
§6) and `wallet-enforcement-matrix.md` (credit/debit/measure/enforce per
resource family; the preventive rule §4). This spec is the build cut of those
docs; where they conflict, they win and this file gets fixed.

Stacked on `feat/metering-track-b` — rebase onto its re-partitioned tip first
(see tasks C1).

## Part 1 — sandbox debit population + gating (reconcile existing work)

End state of `api/ee/src/core/sandboxes/` on this track:

- **`debits.py`** (renamed from `credits.py`): the provider × dimension rate
  table and `to_debits()` (renamed from `to_credits()`). Millicredit int
  convention unchanged (1 credit ≈ $0.01 list price; millicredits = credits ×
  1000, truncated). A `local` provider row is all-zero (local sandboxes are
  free).
- **`sink.py`**: `record_usage_debits()` (renamed from
  `record_usage_credits()`). Per usage event: per-dimension
  `SANDBOX_{CPU_CORE,RAM_GIBI,SSD_GIBI,GPU_CORE}_DEBITS`, their sum into
  `SANDBOX_DEBITS`, and the same total into `WALLET_DEBITS` (the cross-family
  grand total). The total stays reconcilable with the per-dimension writes
  (sum of written millicredits, not a re-truncation).
- **`gating.py`**: both layers read `WALLET_DEBITS` (the wallet gates on the
  cross-family total, not the sandbox sub-total). Layer 1
  `check_sandbox_quota()` at kickoff; Layer 2 `check_sandbox_credits_true_up()`
  post-debit. Keep the limit an injected/quota-supplied parameter — Part 2
  swaps its source from the static plan quota to the wallet balance.
- **`service.py`**: the one-line populate patch on Track B's measurement-only
  `record_usage()` — call `record_usage_debits(...)` after dedup/parsing. This
  is the only Track C edit to a Track B file.
- **tests**: `test_sandbox_gating.py` (and any sink tests) against the
  `*_DEBITS` names.

The `Counter`/`Meters` enum members and the `ee0000000005` migration belong to
Track B; after the rebase, any enum edits still in this track are redundant and
must be dropped.

## Part 2 — the wallet

### 2.1 `wallet_credits` table — the funding ledger

Append-only ledger of credits INTO the wallet. New EE table, reusing the house
mixins (`IdentifierDBA` uuid7 `id`, `OrganizationScopeDBA`, `LifecycleDBA`):

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (uuid7) | PK. Mint the id explicitly in DAO insert mappings (ORM `default=` does not fire on `insert().values()`). |
| `organization_id` | UUID FK, indexed | scope |
| `kind` | Enum `credit_kind` | `signup_gift`, `plan_allowance`, `card_topup`, `admin_promotion`, `support_adjustment` — exactly five, flat, full words |
| `amount_millicredits` | BigInteger | list-price credits added, millicredit int convention |
| `granted_at` | TIMESTAMP | when spendable |
| `expires_at` | TIMESTAMP nullable | null = never. Set for `plan_allowance` (month-end) and optionally time-boxed `admin_promotion`; null for `signup_gift`, `card_topup`, `support_adjustment` |
| `source_reference` | String nullable | Stripe object id or period key; **UNIQUE(organization_id, source_reference) WHERE source_reference IS NOT NULL** — the idempotency key |
| `metadata` | JSONB nullable | e.g. `{"tier_at_grant": 2}` |

**Balance** (the only hot-path read):

```
balance(organization) =
    Σ amount_millicredits WHERE expires_at IS NULL OR expires_at > now()
  − WALLET_DEBITS meter value
```

One filtered sum — no FIFO, no per-grant allocation, no stored mutable balance.
Only `plan_allowance` reliably expires, so expiry is just the `WHERE` predicate
ceasing to count a row. Cache the balance in the entitlements Redis namespace;
invalidate on any credit mint and on debit writes. Balance CAN go negative
(post-flight debits land after pre-flight estimates); that is expected and
bounded — see 2.6.

No new "payments"/"transactions" table: cumulative income (the tier promotion
signal) is `Σ amount_millicredits` over kinds
(`plan_allowance`, `card_topup`, `admin_promotion`) on this same table.

### 2.2 `subscriptions` extension — tier + auto-recharge

```
tier                                = Column(SmallInteger, nullable=False, default=0)
autorecharge_threshold_millicredits = Column(BigInteger, nullable=True)   # null = off
autorecharge_target_millicredits    = Column(BigInteger, nullable=True)
```

`tier` is a materialized derivation (recompute writes it; nothing else does),
stored here because the gate already loads the subscription row per request.
Extend `SubscriptionDTO` + DAO read/update mechanically.

### 2.3 Minting — daily cron + signup hook + webhooks

All amounts are config dials (env-configured like the existing billing
settings); zero = no-op mint. Candidates: signup gift $5; allowance free $1 /
Pro $10 / Business $100 / Enterprise $1000 per month.

- **`signup_gift`** — minted once, at first-organization provisioning (the
  user's signup org only; later orgs get nothing). Never expires.
- **`plan_allowance`** — minted by a **daily cron for everyone** (reuse the
  meters cron host): per org, "is the period due, and (for paid plans) is it
  paid?" → mint once, idempotently, `source_reference =
  allowance:<organization_id>:<period>`; `expires_at` = period end. Payment
  gates the mint (the cron reads subscription state the existing webhooks
  maintain); the cron is only the trigger. Amount = the allowance dial for the
  plan actually invoiced (Stripe proration means mid-cycle plan changes come
  out right by construction). The mint is **never suspended** — with a negative
  balance it applies against the debt.
- **`card_topup`** — one-time Checkout `mode="payment"` ("credits" product) →
  `checkout.session.completed` webhook (a **new** case in the closed 4-event
  switch) mints with `source_reference` = the session id. Auto-recharge mints
  arrive via `payment_intent.succeeded`; handle `payment_intent.payment_failed`
  (no mint, log/notify — the org simply drifts toward the gate). Mandate the
  webhook secret in production while touching the switch.
- **`admin_promotion` / `support_adjustment`** — admin endpoints (Access-header
  gated, with an audit log line).

### 2.4 Auto-recharge

Scheduled check (same cron host): `balance < autorecharge_threshold` → create
an off-session PaymentIntent (`off_session=true, confirm=true`) for
`target − balance` against the stored payment method. Success mints via the
webhook path above; decline mints nothing.

### 2.5 Tier recompute — plain sum, monotonic

```
computed = highest threshold T in {25, 250, 2500} credits such that
           Σ mints(plan_allowance, card_topup, admin_promotion) ≥ T
tier     = max(computed, manual_override)      # + card-on-file required above the floor
```

No weights, no rolling windows, no demotion of any kind: nothing pulls a tier
down except an admin action. Wallet exhaustion **blocks** (gate fails) but
never demotes. Recompute triggers: any credit mint, subscription change
webhooks, card attach/detach, admin override. Each recompute writes
`subscriptions.tier` and bumps the entitlements cache.

Tier gates a four-axis vector per family (concurrency / power / duration /
wallet ceiling) — ship the tier→limits table as config; sandbox first, the
power axis dormant until resource-class selection exists.

### 2.6 Gating — the preventive rule, soft at launch

Shared gate logic (callable from API, services, runner), per invocation site:

```
allow ⇔ balance ≥ f × max_run_cost(family, tier, request)
```

`max_run_cost` is computable because the tier caps resources: sandbox =
duration_cap × class rate; LLM = max token windows × model rates; gateway =
flat per-call. `f` is a per-family config fraction (1.0 = fully preventive).
**Launch posture: all three families non-strict (soft)** via the existing
`Quota.strict` semantics — compute and warn, don't block; flip per family by
config. Sandbox is wired now (sessions router + runner kickoff already call
`check_sandbox_quota`); LLM (services level — the agent path passes through the
services handler via `AgentResult.usage`) and gateway sinks/gates land after
this track against the same interface.

The gate's ceiling source becomes the wallet balance (2.1) instead of the
static plan quota; `check_entitlements`/`adjust(delta, limit)` stays the atom.

### 2.7 True-up → kill caller

After each debit lands, recompute balance; if ≤ 0, terminate the org's
in-flight sessions. The targeted-kill primitive (parameterized runner
`POST /kill` with a session/stream/sandbox identifier; the bare form stays the
orphan hatch) is mainline sessions/runner work outside this track — C ships the
true-up caller with the kill invocation behind a feature flag/log until that
lands (today's behavior: warn).

## Out of scope

LLM/gateway sinks (later, same interface), BYOS `secret_origin` zero-rating
(Track D), the runner-side per-turn LLM gate (optional tightening), wallet UI.
