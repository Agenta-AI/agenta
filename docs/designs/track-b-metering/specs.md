# Track B — wallet-debit meter definitions (metering)

Track B owns **metering**: measurement pipelines and the meter **definitions**.
It does not populate billing meters and does not charge. The boundary with the
other tracks:

- **Track B (this track)** — meters exist as defined things: enum members,
  quotas, DB enum migration, and measurement-only collection
  (webhook/poll → usage DTO). No credit math, no sink calls, no gating.
- **Track C (billing)** — populates the debit meters from measured usage
  (rate table + sink), gates on them, and builds the wallet.
- **Track D (BYOS)** — bring-your-own secrets for sandbox/gateway providers and
  `secret_origin` zero-rating on top of C.

Companion design docs (big-agents-audit collection): `monetization-integration.md`
(audited facts), `tiers-and-unified-wallet.md` (wallet + tier model, meter
taxonomy §6), `wallet-enforcement-matrix.md` (credit/debit/measure/enforce per
family).

## Meter taxonomy — end state

Direction is uniform: every meter measures consumption **out** of the wallet,
so every meter is `*_DEBITS`. Money **in** lives in the `wallet_credits` table
(Track C). The raw `*_SECONDS` breakdown ("what did RAM cost me") is
cost-explainer data that belongs in traces/analytics, **not** in billing
meters — it is deleted here, including its migration labels.

`Counter` members (in `api/ee/src/core/access/entitlements/types.py`), mirrored
in `Meters` (`api/ee/src/core/meters/types.py`):

| Member | Value | Role |
|---|---|---|
| `SANDBOX_CPU_CORE_DEBITS` | `sandbox_cpu_core_debits` | per-dimension visibility |
| `SANDBOX_RAM_GIBI_DEBITS` | `sandbox_ram_gibi_debits` | per-dimension visibility |
| `SANDBOX_SSD_GIBI_DEBITS` | `sandbox_ssd_gibi_debits` | per-dimension visibility |
| `SANDBOX_GPU_CORE_DEBITS` | `sandbox_gpu_core_debits` | per-dimension visibility |
| `SANDBOX_DEBITS` | `sandbox_debits` | family roll-up |
| `LLM_DEBITS` | `llm_debits` | family roll-up (sink lands later) |
| `GATEWAY_DEBITS` | `gateway_debits` | family roll-up (sink lands later) |
| `WALLET_DEBITS` | `wallet_debits` | cross-family grand total; what the wallet gate reads |

Removed everywhere: `SANDBOX_CPU_CORE_SECONDS`, `SANDBOX_RAM_GIBI_SECONDS`,
`SANDBOX_SSD_GIBI_SECONDS`, `SANDBOX_GPU_CORE_SECONDS`.

Unchanged: `CREDITS_CONSUMED` (the legacy hosted-keys-gate counter — a
different mechanism; no migration of it), `TRACES_INGESTED` and the rest of the
our-infra pay-as-you-go set, and `REPORTS` (wallet debits are prepaid — billed
at top-up time — and are **never** reported to Stripe in arrears, so no
`*_DEBITS` key ever enters `REPORTS`).

## File-by-file end state

1. `api/ee/src/core/access/entitlements/types.py`
   - `Counter`: remove the 4 `*_SECONDS` members; add the 8 `*_DEBITS` members
     above.
   - `DEFAULT_ENTITLEMENTS`: for every plan, remove the 4 `*_SECONDS` quotas and
     add the 8 `*_DEBITS` quotas as bare `Quota(period=Period.MONTHLY)` (no
     free/limit numbers — `TODO(pricing)`; the wallet supplies the ceiling in
     Track C).
   - `DEFAULT_CATALOG` comments: the pricing TODO notes reference
     `sandbox_debits` and state the prepaid/no-REPORTS rule.
   - Any `CONSTRAINTS`/read-only counter list that enumerates the `*_SECONDS`
     members: swap to the `*_DEBITS` set.
2. `api/ee/src/core/meters/types.py` — mirror the same member swap in `Meters`.
3. Migration `ee0000000005` (new file in this track,
   `api/ee/databases/postgres/migrations/core_ee/versions/`) — docstring
   "add sandbox + wallet debit meters to meters_type"; `ADD VALUE IF NOT EXISTS`
   for the 8 uppercase `*_DEBITS` labels; revises `ee0000000004`.
4. Migration `ee0000000004_add_sandbox_and_storage_meters.py` — remove the 4
   `*_SECONDS` `ADD VALUE` lines; keep `BYTES`. (Branch-local migration, not
   shipped; editing in place is correct — no follow-up migration.)
5. `api/ee/src/core/sandboxes/service.py` — measurement-only:
   - `record_usage()` keeps webhook/poll parsing, delivery-id dedup, and the
     usage DTO handling; **remove** the `meter_deltas` block that adjusted the
     4 `*_SECONDS` counters.
   - **No sink call** — `record_usage_credits`/`record_usage_debits` and its
     import belong to Track C (the one-line populate patch lands there).
   - Remove imports left unused (`check_entitlements`, `Counter`, `MeterScope`,
     the sink import).

## Also in scope: Daytona poll idempotency

The Daytona poller delta-adjusts without diffing provider-cumulative totals
against the current meter value; the Redis lock guards concurrent polls, not
double-counting across overlapping windows (monetization-integration.md F7).
This is a measurement-correctness bug and must be fixed before a wallet makes
every debit balance-affecting: persist/diff the provider's cumulative totals and
adjust only the positive delta. Verify current behavior first — recent Track B
commits touched adjacent conversion code.

## Out of scope for Track B

`sink.py`, `gating.py`, `credits.py`/`debits.py`, gating tests, any wallet
table/cron/webhook/tier work (all Track C); vault/secret work (Track D).
