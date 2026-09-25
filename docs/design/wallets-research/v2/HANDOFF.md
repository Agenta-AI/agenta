# Wallets: takeover handoff

Read this first. It is written for an engineer or agent who has only this repository.
Everything you need is in `docs/design/wallets-research/`: `v1/` is the original design
and delivery record, and `v2/` (this folder) is the takeover package.

## Who owns this now

PR [#6050](https://github.com/Agenta-AI/agenta/pull/6050) (`feat/add-wallets`) was written
by an engineer who is no longer available. Ownership has moved to Mahmoud Mabrouk
(`mmabrouk`). Do not wait for answers from the original author. The `v1/` documents are the
complete record of his reasoning, and they are unusually thorough: read them before you
second-guess a decision.

## Decisions already made (2026-09-25)

1. **We are taking the work over.** Fix it, test it, and bring it to production-ready.
2. **Merging is not enabling.** Nothing in this PR runs unless `AGENTA_WALLETS_ENABLED` is
   true. After merge the flag stays off. It will later be turned on for a small group of known
   users to try, and only after that for everyone. Still, do not treat the PR as mergeable
   until it is actually fixed and tested: merge is a separate, explicit decision by Mahmoud.
3. **Unconditional migrations are accepted.** `core_ee` `ee0000000004`/`ee0000000005` and
   `tracing_ee` `ee0000000002` run on every EE deployment even with the flag off, including the
   backfill that creates a general balance row for every organization. That is fine.

**Not yet decided:** whether paid actions reserve funds before dispatch. See
[Reservation](#reservation-open-not-your-task) below. Do not implement reservation in this work.

## Your task

Make the wallet foundation production-ready. That is the ledger, the measurement and debit
pipeline, provisioning, plan-change proration, and the grant catalog, all already on the
branch. It is **not** connecting real gateway traffic, pricing, checkout, sandbox allowances,
managed tools, or reservation. Those are separate OpenSpec changes in this folder, and a
separate owner is designing the shared coverage contract in parallel. If a fix you need would
change the shape of `WalletCheckPort`, `WalletSettlementPort`, or the stream envelopes in
`api/ee/src/core/wallets/contracts.py`, stop and write it up in the PR instead of changing it.

The acceptance criteria are the requirements and unchecked tasks in
[document-wallet-foundation](openspec/changes/document-wallet-foundation/). Check a task only
with evidence.

## State at handoff

Updated 2026-09-25, after the overnight takeover run. The first handoff state (PR head
`b0b7fe08ee`, 17 commits ahead of `main`, never accepted) is superseded.

| Fact | Value |
| --- | --- |
| `feat/add-wallets` (PR #6050) | `c7254535df`: `main` merged in (a merge commit, no force push). Open, no review |
| `wallets/takeover` (PR #7153) | `0693b307c1`, base `feat/add-wallets`. Holds every fix below. Not yet merged into `feat/add-wallets` |
| CI on #6050 at `c7254535df` | All code checks pass. `license/cla` is pending ("not signed yet") and needs a person with CLA access |
| Migrations | Single-headed: `core_ee` ends at `ee0000000005`, `tracing_ee` at `ee0000000002`. `main` added no EE migrations |
| Tests at the final code | `ee/tests/pytest/unit` 573 passed; wallet and measurement integration 43 passed, 0 skipped; OSS unit the same as `main`. Commands and counts: [review-findings.md](review-findings.md#test-evidence-at-the-final-code) |
| Review findings | Every finding from the spec review, the Codex reviews and the acceptance run has a disposition in [review-findings.md](review-findings.md) |
| Design changes | Every place the code now differs from the original design, and which side should move: [spec-divergences.md](spec-divergences.md) |
| Manual acceptance | Run 1 at `144c0dec91`: sections 0, 1 and 3 to 8 pass; section 2 failed only against a wrong claim in the procedure, now corrected. Run 2 at `0693b307c1`: sections 0 to 3 and 5, lazy provisioning and the signup-grant backfill pass. Plan-change proration was not exercised on a deployment (it needs a Stripe checkout) |
| Wave 2 | Being built on the stacked branch `wallets/wave-2`, whose PR base is `wallets/takeover`. Nothing from it is on this branch |
| Known unrelated failure | `api/oss/tests/pytest/integration/sessions/test_records_replay_postgres.py` fails on `main` too |

## Branches

- `wallets/takeover` carries the foundation fixes. Its PR targets `feat/add-wallets`.
- `feat/add-wallets` is up to date with `main` as of `c7254535df`. Sync it again with a
  merge commit, not a rebase: the PR is shared history.
- When the work is accepted, `wallets/takeover` merges into `feat/add-wallets`, and #6050
  goes to `main` only when Mahmoud approves.
- `wallets/wave-2` is stacked on `wallets/takeover`. Rebase or merge it forward when this
  branch moves.

## Work, in order

### Done

1. **Update from `main` and re-verify.** Done. `main` merged into `feat/add-wallets` and then
   into this branch. Two conflicts, both resolved by keeping both sides:
   `api/entrypoints/worker_streams.py` (the `sessions` stream plus the wallet streams) and
   `hosting/docker-compose/ee/env.ee.dev.example`. Baseline after the merge: 566 EE unit
   tests and 26 integration tests passed, 0 skipped.
2. **Review the exact head cold.** Done. The spec review matched all 13 baseline scenarios
   and found one P1 and two P2 bugs. The Codex general review found two P0, two P1 and six
   P2. Each group of fixes then had its own Codex rounds, and a final Codex round over the
   whole wallet diff found no P0 or P1.
3. **Fix the open foundation items.** Done, each decision recorded in its item of
   [v1/open-designs.md](../v1/open-designs.md):
   - **Item 21.** Admission reads a spendable balance: the general balance minus the
     remaining value of expired credits, in one statement. Settlement judges expiry on one
     database clock read after its lock.
   - **Item 22, option 2.** A per-organization advisory lock serializes each plan change
     from reading the plan through the wallet adjustment. Direct routes key on a fresh id.
     The clawback targets the newest allowance not already clawed back. Proration starts at
     the Stripe event time and uses the subscription's real billing period.
   - **Item 20.** Unacceptable stream entries, and any entry past 20 deliveries, go to a
     dead-letter stream with list and replay commands. The streams are no longer trimmed;
     publishers refuse past a 100,000-entry backlog. This changes the original rule that a
     readable debit is retried forever.
   - **Item 15.** The one-off signup-grant backfill job exists, with the procedure below. It
     has not run anywhere shared.
   - **The runtime factory.** `runtime.py` is deleted. `ee/src/main.py` builds the wallets
     service and injects it. The Redis publishers moved out of core.
   - **Item 14 addendum.** Organizations created by the admin route have no balance row.
     Lazy provisioning covers them, and a test pins it.
4. **Run the manual acceptance procedure.** Done at `144c0dec91` and again at `0693b307c1`.
   Details are under task 1.2 of
   [document-wallet-foundation](openspec/changes/document-wallet-foundation/tasks.md). The procedure in
   [v1/nodes/im-1-02-pipeline/acceptance.md](../v1/nodes/im-1-02-pipeline/acceptance.md) is
   corrected for what that run found: the Alembic version table name, the `redis-durable`
   service on port 6381, the moved publisher imports, the admin-route row, the
   `signup_grant` credit kind, and section 8's dead letters.

### Left

1. **Exercise a plan change on a deployment.** Run 2 could not: its organizations have no
   Stripe subscription, so the switch route refuses them. Use a stack wired to Stripe test
   mode, complete a checkout, switch plans, and check the clawback and the prorated
   allowance against the real-Postgres plan-change tests.
2. **Get the CLA check on #6050 signed off.** It went pending when `main` was merged in. It
   needs a person with CLA access; it does not block the code.
3. **Update the PR descriptions of #6050 and #7153** so they state what is verified, what is
   deferred, and that merge leaves the flag off.
4. **Decide the design suggestions** in [spec-divergences.md](spec-divergences.md), rows 15
   to 22. They change design text only.
5. **Before the flag is turned on for paying customers**, build open-designs item 22,
   option 3: a durable record and re-drive for a wallet adjustment that fails after the
   subscription change committed. Today it is logged and not retried. **This blocks
   enabling for paying customers.** It belongs with the recurring allowance (item 3) if that
   comes first.
6. **Known limits from the plan-change work, recorded in item 22:**
   - A delayed `customer.subscription.deleted` for an old subscription can cancel its
     replacement, because the webhook does not compare subscription ids. This is
     pre-existing billing behaviour.
   - The reverse trial gets no allowance, because it writes the trial plan directly and its
     creation webhook sees no change.
   - No recurring period-start allowance exists. Only a plan change mints one.
7. **Accepted P2 findings to revisit** ([review-findings.md](review-findings.md)):
   - The measurement worker trusts a producer-supplied `organization_id` (LY-2). The Wave 2
     producer must set it from the authenticated scope.
   - Plan-change lock waiters each hold a database connection (LY-3). Revisit if plan changes
     are ever automated in bulk.
   - A retry after a pricing change re-prices a measurement (CG-6). Wave 2 persists the
     pricing decision.

## Done means

- `feat/add-wallets` is up to date with `main`, and CI is green on the new head.
- Unit and integration suites pass with zero skipped infrastructure tests, at a recorded commit.
- Every review finding has a disposition in the PR and in [review-findings.md](review-findings.md).
- Items 20, 21, 22 and 15 are fixed or deferred with a written reason.
- Acceptance sections 0 to 8 have been run with recorded evidence.
- The foundation spec's tasks are checked only where evidence exists.

## Rules

- Never merge #6050 or this PR. Never enable the flag in a shared environment.
- This repository is public. Do not commit secrets, internal hostnames, or customer data.
- Keep `v1/` as the historical record. Correct it only where it is wrong, and say so in the
  commit message. Put new decisions in `v1/open-designs.md` under the item they close.
- Run `openspec validate --all --strict --no-interactive` from this folder (OpenSpec 1.13.1)
  after editing any spec.

## Before turning the flag on: the signup-grant backfill

Organizations that signed up while `AGENTA_WALLETS_ENABLED` was off never received the signup
grant ([v1/open-designs.md](../v1/open-designs.md), item 15). An operator runs
`api/entrypoints/backfill_wallet_signup_grants.py` once per deployment, against that
deployment's own database, before the flag is turned on there. Never run it against a
database you do not own.

From `api/`, with the deployment's EE environment loaded (`AGENTA_LICENSE=ee` and
`POSTGRES_URI_CORE` at minimum):

```bash
# 1. Dry run (the default): counts eligible organizations, writes nothing.
uv run --no-sync python -m entrypoints.backfill_wallet_signup_grants

# 2. Award the grants. Safe to rerun: each organization gets at most one grant.
uv run --no-sync python -m entrypoints.backfill_wallet_signup_grants --apply

# Optional: limit to a creation window, [from, to), in ISO 8601.
uv run --no-sync python -m entrypoints.backfill_wallet_signup_grants \
  --created-from 2026-08-14 --created-to 2026-10-01 --apply
```

The last line prints `eligible`, `awarded` and `failed`. A non-zero `failed` count gives a
non-zero exit status, and each failure is logged with its organization. Run the job again to
retry the failures. After a successful `--apply`, a second dry run should report
`eligible=0`. The job awards whatever `GRANT_CATALOG["signup"]` holds at that moment. Whether
these organizations get the grant, and how much, is a product decision to make before
running `--apply`.

## Reservation (open, not your task)

The original design admits a call by checking only that the organization's general balance is
above its floor. It reserves nothing, so several in-flight calls can together overspend the
last credit; settlement then records the shortfall as a deficit. That was deliberate, and the
reasoning is sound for its case ([v1/open-designs.md](../v1/open-designs.md), items 2, 10 and
17):

- A model call's cost is unknown until the provider reports usage. Reserving an estimate
  either over-refuses calls or invents a second, pending-money state that expiry and plan
  changes would then have to reason about.
- Choosing the funding credit at settlement keeps credit selection a single atomic operation
  with the actual debit.
- The admission ceiling is carried but not enforced on purpose: first measure how far real
  balances go below their floor, then decide between deleting the ceiling and a reservation.
- Reservation was held open, not rejected. Item 2's decision covers only the "non-strict",
  variable-cost path, and item 17 names reservation as a possible later wave.

The open question is whether fixed-price actions (a managed tool call, a bounded sandbox
interval) should reserve before dispatch. That belongs to the coverage-contract design, not to
this foundation work.

## Files in this folder

- [README.md](README.md): the seven OpenSpec changes and how they relate.
- [source-map.md](source-map.md): what is implemented versus planned, with pinned sources.
- [decision-register.md](decision-register.md): all 22 original design items and their status.
- [next-steps.md](next-steps.md): the recommended order across all seven changes.
- [validation.md](validation.md): what the OpenSpec check does and does not prove.
- [spec-divergences.md](spec-divergences.md): where the code and the original design disagree, and which side should move.
- [review-findings.md](review-findings.md): every review finding and its disposition, with test evidence.
