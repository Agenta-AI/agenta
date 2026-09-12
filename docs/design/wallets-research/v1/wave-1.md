# Wave 1: managed-gateway measurement and wallet debit kernel

**Status:** code-complete and switched off. Every node in the graph is delivered, the unit suites
and the integration suites pass, and nothing runs in production until `AGENTA_WALLETS_ENABLED` is
turned on. Wave 1 takes the application from checkpoint 0 to checkpoint 1; checkpoint 1 itself is
reached when the acceptance procedure in
[nodes/im-1-02-pipeline/acceptance.md](nodes/im-1-02-pipeline/acceptance.md) has been run against a
deployment with the flag on.

**Fork point:** `IM-1-00` reviewed and merged `WP-1-00` (contract seed) at commit `659e7ac5db1e0d0987acdc1beb654ea2becfc14b`
(merging `WP-1-00` commit `676a96e054940b166461a43217de81214aaf8cff`) on `wallets/im-1-00-seed`. `WP-1-01`
and `WP-1-02` forked from this commit. The branch was later squashed and rebased onto
`feat/add-gateways`, so these commits are no longer reachable from its history.

## Checkpoint boundary

Checkpoint 0 is the current foundation: the wallet design exists, but no managed gateway path creates a
measurement or changes a wallet balance.

Checkpoint 1 is reached when a local fake built-in LLM request and a local fake built-in MCP request can each:

```text
API request → wallet check → fake managed gateway result
  → streams:measurements → measurement worker → tracing measurement
  → streams:debits → wallet worker → core debit, credit selection, balances
```

The caller does not wait for measurement persistence, pricing, or wallet settlement. A failed initial
`XADD` produces neither a measurement nor a charge. Once a message has entered a stream, its worker
uses normal pending-message retry; immutable measurement identity and wallet idempotency make retry
safe.

## Fixed inputs

- Existing ACP `records` keeps its name. Gateway usage facts are new tracing `measurements`.
- The streams are `streams:measurements` (consumer group `worker-measurements`) and `streams:debits`
  (consumer group `worker-debits`); both use the current compressed JSON `data` envelope and bounded
  approximate `MAXLEN` trimming, delivered at `MAXLEN 100_000` for each stream
  (`ee/src/core/wallets/streaming.py`). Both are registered in `api/entrypoints/worker_streams.py`,
  included in `ALL_STREAMS` only when `is_ee()` is true and the wallet feature flag is on
  (see [Feature flag](#feature-flag)).
- `measurements` live in tracing. Authoritative `wallet_credits`, `wallet_debits`, and
  `wallet_balances` live together in core.
- Tables are EE-only. **Delivered migration ids** (superseding the reserved numbers below): `core_ee`
  `ee0000000004` (`down_revision = "ee0000000003"`), `tracing_ee` `ee0000000002`
  (`down_revision = "ee0000000001"`, unchanged from the original plan). `WP-1-04` later added
  `core_ee` `ee0000000005` (the general-balance backfill), which is the current `core_ee` head; the
  `tracing_ee` head is `ee0000000002`.

  Node planning reserved `core_ee` `ee0000000006` after `ee0000000005`, expecting the sandbox-metering
  Track B/C migrations to occupy `ee0000000004`/`ee0000000005` first. Those two revisions exist only
  on unmerged sandbox-metering draft branches and do not resolve on this checkpoint's base, whose
  `core_ee` head was `ee0000000003`. This is an **approved deviation**: `WP-1-01` shipped as
  `ee0000000004` with `down_revision = "ee0000000003"` instead. The sandbox-metering drafts must
  renumber past `ee0000000004` when they land, since that slot is now occupied.
- Only fake built-in LLM and fake built-in MCP are in this checkpoint. Custom/standard credentials,
  SBX, live providers, Stripe, rollups, L1 exposure estimates, and concurrency-cap enforcement are
  not.
- Gateway code owns provider/metric interpretation and the final positive `amount_musd`. Wallet code
  never derives price from tokens, duration, or provider data.
- Fake built-in LLM/MCP implementations are wallet-owned test support, under
  `api/ee/tests/pytest/acceptance/wallets/fakes/`. They do not touch the gateway wave’s
  `core/gateways/*/providers/fake/` paths.
- `WP-1-00` and `IM-1-00` land the stream DTOs/ports before any implementation worktree forks.

## Wallet replay invariant

A debit posting has one opaque gateway `idempotency_key`. In one core transaction, the worker locks
the organization general balance, returns successfully if debit rows for that posting key already
exist, otherwise selects credits, inserts every debit row, and updates the general and per-credit
balances. Each resulting debit has its own `debit_key`: it is composed from the posting key and the
actual funding source—its `wallet_credit_id`, or the explicit `deficit` source when no credit funds the
row. A unique `(organization_id, debit_key)` constraint is the final duplicate guard. This uses source
identity, not an invented sequence; the organization-balance lock serializes simultaneous first
deliveries of the same posting key.

## Completion evidence

- Unit tests cover the non-strict `check`, two message serializers, worker acknowledgement order, amount boundary,
  duplicate delivery, restricted-credit selection, split debit, and allowed deficit. **Delivered:**
  126 pass.
- Real-Postgres integration tests prove all debit and balance changes commit or roll back together and
  concurrent deliveries cannot overspend one credit. **Delivered and run** on 12 September 2026
  against a throwaway Postgres 17 and Redis 8 at `core_ee` head `ee0000000005` / `tracing_ee`
  `ee0000000002`: the concurrency guarantee, the migration invariants, the debit-worker duplicate
  guard and the measurement chain all pass. The first run found four defects, two of them in
  production code — `WalletsDAO.award_credit` and `apply_plan_change` both inserted a credit's
  balance row before the credit itself, and the `measurements` tables broke the repo's
  lifecycle-column convention. All four are fixed, and the suites are 20 passed, 0 failed.
  [nodes/im-1-02-pipeline/acceptance.md](nodes/im-1-02-pipeline/acceptance.md) §9 records each one.
- Local deployment acceptance uses fake built-in LLM and MCP calls only. It confirms both chains reach
  one measurement and one idempotent core settlement per gateway call. **Not yet run**; it needs a
  deployment with the flag on.

The detailed node graph is in [wps-1.md](wps-1.md), [ims-1.md](ims-1.md), and [cus-1.md](cus-1.md).

## Delivered beyond the checkpoint 1 kernel: wallet provisioning, proration, and grants

Two follow-on worktrees closed gaps the `IM-1-02` review surfaced, without a new
migration beyond `ee0000000005` (`core_ee` head remains `ee0000000005`):

- **`WP-1-04` (wallet provisioning + plan-change proration).** Organization creation
  (`provision_signup_subscription`/`provision_user_subscription` in
  `ee.src.core.organizations.service`) now provisions the general `wallet_balances` row
  itself, idempotently, via `WalletsService.provision_general_balance`. Migration
  `ee0000000005_backfill_wallet_general_balances.py` backfills that row for every
  organization that predates this change. `WalletsService.apply_plan_change` prorates a
  mid-period plan change: it debits the outgoing plan's unused allowance remainder out of
  the active `plan_allowance` credit and mints a new one for the incoming plan's prorated
  share, both idempotent on the subscription's own `plan_change:{subscription_id}:{period_start}`
  key. `WalletCheckPort.check` also lost its unused `amount_musd` parameter this wave.
- **`WP-1-05` (real plan allowances + the grant catalog).** `ee.src.core.wallets.plans`
  carries real, product-decided per-plan allowance and floor amounts (see
  `nodes/im-1-02-pipeline/acceptance.md` §"2b" for the table and the date) — proration
  now moves real value on every plan change, not just zero. `ee.src.core.wallets.grants`
  adds a catalog of named activities that award wallet credit outside the plan-change
  path; `WalletsService.award()` is the idempotent entry point, keyed
  `award:{activity}:organization:{organization_id}` (or `...:reference:{reference}` for a
  repeatable activity). One catalog entry exists today, `signup` ($1, once per
  organization, twelve-month expiry, awarded only on the signup path per `report.md`
  §9.2) — wired into `provision_signup_subscription` only, after the general balance row
  exists. Adding an activation-milestone, referral, or contribution-award entry later is a
  new catalog row, not a new code path.

Both worktrees are documented in `nodes/im-1-02-pipeline/acceptance.md`, including the
integration suites they added and the results of running them. Those results matter here:
`WP-1-05`'s signup grant did not work when it was first exercised against a real engine.
`WalletsDAO.award_credit` inserted a credit's balance row before the credit itself in one
flush and violated its own foreign key on every first delivery, and `apply_plan_change`
carried the same defect. Both are fixed. See §9 of the acceptance document.

## Feature flag

Everything above ships switched off. `AGENTA_WALLETS_ENABLED` (EE only, `env.wallets.enabled`,
default `false`) gates every write the wallet performs, because the wave is code-complete
but not yet proven end to end against a real deployment. The integration suites have since
run and vindicated the flag: `WalletsDAO.award_credit` failed its own foreign key on every
first delivery, and the load-bearing call site sits on the signup path, where
`_provision_wallet_general_balance` and `_award_signup_grant` both re-raise and the signup
flow deletes the new user when provisioning fails. With the flag on, every signup would
have failed. That defect is fixed, but the flag stays off until the acceptance procedure
has run against a deployment.

While the flag is off:

- `provision_signup_subscription` and `provision_user_subscription` skip wallet
  provisioning and the signup grant, so no `wallet_balances` row and no `signup_grant`
  credit are written.
- `SubscriptionsService._apply_wallet_plan_change` returns immediately, so a mid-period
  plan change is not prorated.
- `measurements` and `debits` are absent from `ALL_STREAMS` and from the worker builder
  table, so their consumers never start and naming either one in `AGENTA_WORKER_STREAMS`
  is rejected instead of silently ignored.

**The migrations are unconditional, and that makes the flag a one-way door.** The tables and
the `ee0000000005` backfill land with the branch whether the flag is on or not, so turning
the flag on needs no schema step. But the backfill runs once, at migration time, and covers
only the organizations that existed then. Every organization created while
`AGENTA_WALLETS_ENABLED` was `false` is skipped by `provision_signup_subscription` and
`provision_user_subscription` and therefore holds no `wallet_balances` general row at all.
Those organizations do not heal themselves when the flag is turned on: their first debit
raises `WalletGeneralBalanceNotFoundError`, which `DebitWorker` treats as retryable, so the
message redelivers indefinitely — the poison-message gap that `WP-1-04` closed for the
signup path but that reopens for any organization provisioned with the flag off. Enabling
the flag later therefore requires one of two things first: re-running the `ee0000000005`
backfill against the gap (it is `ON CONFLICT DO NOTHING`, so it is safe to re-run), or
adding lazy provisioning so the settlement path creates a missing general balance row on
demand. Decide which before the flag is turned on, not after. Recorded as an open item in
[open-designs.md](open-designs.md).

Apart from that gap, turning the flag on changes no behaviour described in this document.
The guards are early-returns around calls that already existed; nothing else reads the flag.
