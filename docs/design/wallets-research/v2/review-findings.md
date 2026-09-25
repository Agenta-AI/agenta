# Wallets: review findings register

Every finding raised against the wallet foundation during the 2026-09-25 takeover work, with
its disposition. The handoff requires that no finding is left without one.

A disposition is one of:

- **Fixed.** The commit and the test that pins it are named.
- **Accepted.** Not changed, with the reason.
- **Deferred.** Not changed here, and the named change or design item that owns it.

Commits are on `wallets/takeover`. Paths are relative to `api/` unless they start with
`docs/`. Test files are under `ee/tests/pytest/`. Where a finding also changed documented
behaviour, [spec-divergences.md](spec-divergences.md) has the row.

## Sources

| Prefix | Review | Scope |
| --- | --- | --- |
| SR | Cold spec review against the foundation spec, `v1/entities.md`, `v1/wave-1.md` and the node specs | Wallet diff at `884c966fe4`, read only |
| CG | Codex general review | Wallet diff at `bbbc072e9f` (after `main` was merged in) |
| ST | Codex rounds on the stream fixes | `wallets/fix-streams`, 2 rounds |
| BL | Codex rounds on the balance fixes | `wallets/fix-balance`, 2 rounds |
| PC | Codex rounds on the plan-change fixes | `wallets/fix-plan-change`, 2 rounds |
| LY | Codex rounds on the layering fixes, and a final round over the whole wallet diff | `wallets/fix-layering`, then `origin/main...6f4e567f9d -- api` |
| AC | Manual acceptance runs, IM-1-02 sections 0 to 8 | Disposable EE stack: Run 1 at `144c0dec91`, Runs 2 and 3 at `0693b307c1` |

The Codex reviews used `gpt-6-astra` at medium reasoning effort, in a read-only sandbox.

## Spec review

| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| SR-1 | P1 | After two plan changes in one period, the clawback can hit the older allowance credit. The lookup ordered by `end_time` only, with no tiebreak, and ran outside the organization lock. | **Fixed** in `d1cc58b029` and `fc37fe0718`. Same bug as CG-1 and CG-2. Tests: `integration/wallets/test_wallets_plan_change_postgres.py::test_successive_changes_in_one_period_claw_back_the_newest_allowance`, `::test_overlapping_changes_never_claw_the_same_allowance_twice`. Divergence row 9. |
| SR-2 | P2 | The reclaim pass read only the oldest 50 pending entries. Fifty permanent failures at the head hid every later pending debit. | **Fixed** in `9f8675313b`: a reclaim cursor walks the whole list, and entries past `max_deliveries` go to the dead letters. Test: `unit/wallets/test_wallets_stream_redelivery.py::test_failing_entries_at_the_head_do_not_hide_later_pending_entries`. Divergence row 2. The suggested upper bound on `DebitCommandV1.amount_musd` was **accepted as not needed**: an out-of-range amount now reaches the dead letters after 20 deliveries, and a bound would change the envelope contract, which is held steady for the coverage-contract design. |
| SR-3 | P2 | `XADD MAXLEN ~` trimming deleted pending debits during a long core-database outage, with no log line. | **Fixed** in `9f8675313b`: no trim; publishers refuse past a 100,000-entry backlog and log. Test: `test_wallets_stream_redelivery.py::test_debit_publish_refuses_past_the_backlog_limit_and_never_trims`. Divergence row 3. |
| SR-4 | P3 | The award replay guard is a JSONB lookup with no unique index. | **Fixed** in `0a891a45fe`: partial unique index `uq_wallet_credits_org_award_key` in the unreleased `ee0000000004`. Test: `integration/wallets/test_wallets_admission_postgres.py::test_a_second_credit_for_one_award_key_is_rejected`. |
| SR-5 | P3 | The plan-change incoming-credit guard is also a JSONB lookup with no unique index. | **Accepted.** The guard runs under the general-balance lock, and with the flag on the whole plan change also runs under the per-organization advisory lock (item 22). A second index would guard a path that two locks already serialize. |
| SR-6 | P3 | `apply_plan_change` locked the outgoing balance by credit id without an organization filter. | **Fixed** in `d1cc58b029`. Same as CG-7. |
| SR-7 | P3 | `measurement_values` keeps the first row per key, while pricing sums every component, so a repeated key makes evidence and charge disagree. | **Fixed** in `9f8675313b`. Same as CG-3. |
| SR-8 | P3 | Debit rows take `created_at` from the debit command, which on a retry is the republish time. | **Deferred** to [connect-model-gateway-wallet](openspec/changes/connect-model-gateway-wallet/), task 1.4. The Wave 2 plan persists the pricing decision, including the debit's `created_at`, with the measurement. |
| SR-9 | P3 | `SettlementUnavailableError` is never raised, so database exceptions cross the port as raw SQLAlchemy errors. | **Accepted.** The terminal/retryable taxonomy is the original author's, and the worker treats any non-terminal exception as retryable, which is the intended outcome. Revisit when a second settlement caller exists. |
| SR-10 | P3 | The `WalletsConfig` docstring in `oss/src/utils/env.py` still described the backfill as the way flag-off organizations get their row. | **Fixed** in `442d91a6c9`. |
| SR-11 | Gap | No test covered the flag-off early return of the plan-change hook. | **Fixed** in `d1cc58b029` (`test_flag_off_takes_no_lock_and_calls_no_hook`) and `6f3ca70ab8` (`unit/wallets/test_wallets_flag_gates.py::test_plan_change_is_not_prorated_when_the_wallet_is_off`). |
| SR-12 | Gap | No test covered the flag gate on `ALL_STREAMS` and the stream builders. | **Fixed** in `6f3ca70ab8` and `580e6d2432`: four cases in `test_wallets_flag_gates.py`, with EE pinned. |
| SR-13 | Gap | No real-Postgres test covered lazy provisioning by `check()`. | **Fixed** in `7b8ff59728`: `test_wallets_admission_postgres.py::test_check_provisions_a_missing_general_balance` (four concurrent checks leave one row). |
| SR-14 | Doc | Plan-change key text is stale in entities, Wave 1 and `grants.py`. | **Fixed** in `d1cc58b029` (docstring) and `7e39edb517` (docs). Divergence row 14. |
| SR-15 | Doc | Node specs WP-1-00 and WP-1-01 say `check` is synchronous and write-free, and that deficit stops at the floor. | **Deferred** as design suggestions for the owner. Divergence rows 15 to 17. |
| SR-16 | Doc | IM-1-02 says a poisoned message is terminally ACKed; a readable one was retried forever. | **Fixed** in code (`9f8675313b`, item 20) and in the acceptance procedure. The node spec text is a suggestion. Divergence rows 1 and 2. |
| SR-17 | Doc | Plan-allowance credits do not record the subscription. | **Fixed** in `d1cc58b029`. Divergence row 11. |
| SR-18 | Doc | Entities: the `check` query-path row and the debit example's workflow references contradict the delivered code. | **Deferred** as design suggestions. Divergence rows 18 and 19. |
| SR-19 | Doc | The recurring period-start allowance is not delivered, and the baseline does not say so plainly. | **Deferred** to open-designs item 3. The foundation proposal already excludes recurring issuance. Divergence row 20. |
| SR-20 | Known | Core built a concrete DAO through `runtime.py`. | **Fixed** in `f77b591a06`: `runtime.py` deleted, the service is injected at `ee/src/main.py`. See LY below. |

## Codex general review

| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| CG-1 | P0 | Successive plan changes can claw back the wrong credit: expiry is not an identity. | **Fixed** in `d1cc58b029`, refined in `fc37fe0718`. Same as SR-1. |
| CG-2 | P0 | The outgoing allowance was read in its own transaction, before the lock that protects the adjustment. | **Fixed** in `d1cc58b029`: selection moved inside `WalletsDAO.apply_plan_change`, after the general-balance lock. Test: `test_overlapping_changes_never_claw_the_same_allowance_twice` (10 attempts). The base commit clawed the same credit twice in 10 of 10 attempts. |
| CG-3 | P1 | Duplicate metric keys produce a charge the stored measurement cannot explain. | **Fixed** in `9f8675313b`: `MeasurementCommandV1` rejects repeated component keys. Tests: `unit/wallets/test_wallets_contracts.py::test_measurement_command_rejects_repeated_component_keys`, `unit/measurements/test_measurements_worker.py::test_duplicate_component_keys_are_dead_lettered_not_priced`. |
| CG-4 | P1 | Proration used delivery time and a midnight-aligned period rebuilt from the anchor day. | **Fixed** in `d1cc58b029`: the change's effective time and the subscription's real period. Tests: `test_creation_passes_the_stripe_period_and_effective_time`, `test_switch_reads_the_period_from_the_stripe_subscription`, `test_incoming_is_prorated_from_the_real_period_start_not_midnight`. Divergence row 10. |
| CG-5 | P2 | A conflicting measurement replay can add component rows to stored evidence and charge different content. | **Fixed** in `9f8675313b`: content fingerprint, children only with a new parent, conflict dead-lettered unpriced. Tests (real Postgres): `integration/measurements/test_measurements_integration.py::test_conflicting_replay_keeps_the_stored_measurement_and_is_dead_lettered`, `::test_identical_replay_is_confirmed_without_a_write`. Divergence row 5. |
| CG-6 | P2 | A retry after a pricing deployment re-prices the measurement. | **Deferred** to [connect-model-gateway-wallet](openspec/changes/connect-model-gateway-wallet/), task 1.4. Pricing is a fixture today. The Wave 2 plan persists the pricing decision with the measurement and replays it before pricing again. Dead letters make the path more reachable: replaying a measurement dead letter after a pricing change charges the new price until then. |
| CG-7 | P2 | The outgoing-credit update lacked tenant scope. | **Fixed** in `d1cc58b029`. Tests: `test_a_plan_change_never_selects_another_organizations_allowance`, `test_an_allowance_credit_without_its_balance_row_raises`. |
| CG-8 | P2 | The `ee0000000005` backfill migration is redundant now that provisioning is lazy. | **Accepted.** Unconditional migrations, including this backfill, were accepted by the owner on 2026-09-25 (v2 handoff, decision 3). |
| CG-9 | P2 | Concrete Redis publishers live in core. | **Fixed** in `f77b591a06`: publishers moved to `ee/src/dbs/redis/wallets/streams.py`, and each takes its client on the constructor. The wire contracts stay in `ee/src/core/wallets/contracts.py`; moving them to the measurements domain is left to the vocabulary work in `v1/cus-2.md`. |
| CG-10 | P2 | The debit envelope accepts kinds that settlement cannot honour, such as `expiry`. | **Deferred** as a suggestion. The envelope shapes are held steady for the coverage-contract design. Divergence row 21. |

## Codex rounds on the fixes

| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| ST-1 | P1 | Redis MULTI does not roll back, so a failed dead-letter `XADD` still acknowledged and deleted the entry. | **Fixed** in `aa6eb300b0`: the dead letter is written first, alone, then `XDEL`, then `XACK`. Test (real Redis): `test_measurements_integration.py::test_a_failed_dead_letter_write_leaves_the_entry_pending`. |
| ST-2 | P2 | An acknowledged entry that was never deleted counts against the backlog limit forever. | **Fixed** in `aa6eb300b0`: delete before acknowledge. Covered by the existing records, outbox and wallet consumer suites. |
| ST-3 | P2 | Measurements written before the fingerprint have none, so their replay is a false conflict. | **Accepted.** The flag has never been on outside test databases, so no such rows exist. No backward-compatibility path, by project policy. |
| ST-4 | P3 | Two concurrent replays can enqueue the same dead letter twice. | **Accepted.** Settlement is idempotent on the posting key. Round 2 advised against adding coordination. |
| ST-5 | none | Round 2: no findings. | Loop closed. |
| BL-1 | P2 | A NULL organization `created_at` could award several organizations of one owner in the grant backfill. | **Fixed** in `580e6d2432`: owners with any undated organization are skipped. Covered in `integration/wallets/test_wallets_signup_grant_backfill_postgres.py`. |
| BL-2 | P2 | Settlement judged expiry on two clocks (database, then API host). | **Fixed** in `a2a0a70f96`. Test: `test_settlement_judges_expiry_on_the_database_clock`. Divergence row 7. |
| BL-3 | P2 | The stream flag-gate tests passed vacuously under the OSS edition. | **Fixed** in `580e6d2432`: EE is pinned in the fixture. |
| BL-4 | P3 | The award lookup and the unique index use different JSON expressions, so the planner may not use the index. | **Accepted.** Uniqueness is enforced either way, and the lookup is already narrowed by organization. |
| BL-5 | P2 | Round 2: `now()` is the transaction start, before the lock wait, so a credit that expired during the wait still counted. | **Fixed** in `2139923d9a`: `clock_timestamp()` after the lock. Test: `test_settlement_does_not_spend_a_credit_that_expired_during_its_lock_wait`. |
| PC-1 | P1 | The advisory lock ran on the task-scoped session, so the nested subscription read committed and released it. | **Fixed** in `fc37fe0718`: the lock holds its own connection (`TransactionsEngine.transaction()`). Test: `test_the_subscription_lock_serializes_one_organization_only`, with reads inside the lock. |
| PC-2 | P1 | uuid7 order is not transaction order across processes. | **Fixed** in `fc37fe0718`: allowances are ordered by a `created_at` taken from `clock_timestamp()` after the lock. Test: `test_the_newest_allowance_is_found_even_when_uuid7_ids_run_backwards`. |
| PC-3 | P1 | Suggested alternative to PC-1: try-lock and reject with a retryable error. | **Accepted, not taken.** Blocking is fine for a rare, per-organization, user-initiated change. See LY-3. |
| PC-4 | Limit | A failed wallet adjustment after the subscription committed has no durable record. | **Deferred** to open-designs item 22, option 3, and to [harden-wallet-production-billing](openspec/changes/harden-wallet-production-billing/), task 1.3. **This blocks enabling the flag for paying customers.** |
| PC-5 | Limit | A delayed `customer.subscription.deleted` for an old subscription cancels its replacement. | **Accepted as a known limit**, recorded in item 22. The webhook does not compare the deleted subscription's id with the stored one. This is pre-existing billing behaviour, not wallet code. |
| PC-6 | Limit | The reverse trial writes the trial plan directly, so its creation webhook sees no change and the trial gets no allowance. | **Deferred** to open-designs item 3 (recurring allowance), recorded in item 22. |
| PC-7 | P2 | Round 2: separate whole-second truncation of the two durations could over-claw by up to 15 musd. | **Fixed** in `8720390427`: exact microsecond durations, one final floor. Regression test in `unit/wallets/test_wallets_proration.py`. |
| PC-8 | Doc | Item 22's "Current direction" still said no option was chosen. | **Fixed** in the item 22 rewrite (`914117d3fd`). |
| LY-1 | P3 | The admin-route pin test provisioned the row through `check()` before settling, so it did not prove settle-side provisioning. | **Fixed** in `6f4e567f9d`: separate organizations, and the test asserts no row before the debit. Test: `integration/wallets/test_wallets_debit_worker_integration.py::test_first_debit_for_an_organization_with_no_wallet_row_settles`. |
| LY-2 | P2 | Final round: the measurement worker trusts a producer-supplied `organization_id` without checking that it owns the project. | **Deferred** to [connect-model-gateway-wallet](openspec/changes/connect-model-gateway-wallet/), task 1.2 (trusted credential-origin stamp). No producer exists on this branch. The Wave 2 producer must set the organization from the authenticated scope, or the worker must validate it. |
| LY-3 | P2 | Final round: advisory-lock waiters each hold a pool connection and could starve the lock holder. | **Accepted.** It needs roughly 400 concurrent plan changes for one organization. The smallest fix, `pg_try_advisory_xact_lock` with a retryable busy error, changes the plan-change design. Revisit if plan changes are ever automated in bulk. |

## Acceptance run

| ID | Finding | Disposition |
| --- | --- | --- |
| AC-1 | Section 2: an organization created by `POST /admin/simple/accounts/` has no general balance row, and the finding claimed its first debit would wedge. | **Accepted, doc corrected.** The row is missing, but nothing wedges: every wallet write and `check()` provision it lazily. Pinned by LY-1's test. Eager provisioning in the admin route was not added. Decision in open-designs item 14. Divergence row 13. |
| AC-2 | Section 0 names `alembic_version_core_ee` and `alembic_version_tracing_ee`. The table is `alembic_version_ee` in both databases. | **Fixed** in the acceptance procedure. |
| AC-3 | Sections 6 to 8 use a `redis` service on port 6379. The streams live in `redis-durable`, on port 6381. | **Fixed** in the acceptance procedure. |
| AC-4 | Section 8 expects a log line and a dropped entry; the worker now dead-letters it. | **Fixed** in the acceptance procedure. |
| AC-5 | Sections 3, 4 and 6 import the publishers from core with no client. | **Fixed** in the acceptance procedure, after `f77b591a06` moved them. Run 2 hit the import error and confirmed the corrected wiring. |
| AC-6 | Section 2b queries `credit_kind = 'award'`. The code writes `signup_grant`. | **Fixed** in the acceptance procedure. Found in Run 2. |
| AC-7 | Run 2 could not exercise a plan change: an admin-created organization has no Stripe subscription, so the switch route refuses it before any wallet code runs. | **Fixed** by Run 3: a real Stripe test-mode checkout, then an upgrade, a downgrade and a cancel. All four transitions prorated exactly to the musd. |
| AC-8 | Billing, outside wallet scope. The "Cancel auto-renewal" dialog says the plan "stays active until the end of the current period", but confirming deletes the Stripe subscription and drops the organization to Hobby immediately. | **Deferred** to the owner: decide whether the copy or the cancel behaviour is wrong. Reproduce with any organization on a paid Stripe subscription: Settings, Usage & Billing, Cancel subscription, Confirm, then compare the dialog text with the plan shown right after. The wallet ledger follows the immediate cancel correctly. |

## Test evidence at the final code

At `6f4e567f9d`; `0693b307c1` changes docs only. From `api/`, against a throwaway Postgres 17
and Redis 8, with `AGENTA_LICENSE=ee` and `AGENTA_WALLETS_ENABLED=true`:

| Suite | Result |
| --- | --- |
| `ee/tests/pytest/integration/wallets/test_wallets_settlement_concurrency_postgres.py::test_competing_deliveries_cannot_overspend_one_credit` | 1 passed |
| `ee/tests/pytest/unit` | 573 passed, 0 skipped |
| `ee/tests/pytest/integration/wallets` and `ee/tests/pytest/integration/measurements`, after a database reset | 43 passed, 0 skipped |
| `oss/tests/pytest/unit`, with no infrastructure addresses set (at `c34646a4d5`; later commits touch EE tests and docs only) | 6804 passed, 119 skipped, the same as `main` |

The baseline after merging `main`, at `bbbc072e9f`, was 566 EE unit tests and 26
integration tests. Ruff format and check passed on every touched file.
