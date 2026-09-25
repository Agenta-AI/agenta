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

| Fact | Value |
| --- | --- |
| PR #6050 head | `b0b7fe08ee2a7dbda8558504bd29b0bef994f7d3`, open, not draft, no review |
| CI on that head | 77 of 77 checks passing |
| Against `main` | 17 commits ahead, 1072 behind |
| Merge conflicts with `main` | `api/entrypoints/worker_streams.py` and `hosting/docker-compose/ee/env.ee.dev.example` only |
| Migration collisions with `main` | None. `main` still ends at `core_ee` `ee0000000003` and `tracing_ee` `ee0000000001` |
| Manual acceptance run | Never done. It is what declares checkpoint 1 |
| Known unrelated failure | `api/oss/tests/pytest/integration/sessions/test_records_replay_postgres.py` fails on `main` too |

## Branches

- Do the work on `wallets/takeover` (this branch). Its draft PR targets `feat/add-wallets`.
- First, merge `main` into `feat/add-wallets` (a merge commit, not a rebase: the PR is
  shared history), resolve the two conflicts, push, then merge `feat/add-wallets` into
  `wallets/takeover`. This keeps both PR diffs readable.
- When the work is done, `wallets/takeover` merges into `feat/add-wallets`, and #6050 goes
  to `main` only when Mahmoud approves.

## Work, in order

1. **Update from `main` and re-verify.** After the merge, run every suite the way
   [v1/HANDOFF.md, "How to run the tests"](../v1/HANDOFF.md#how-to-run-the-tests) describes.
   Its four setup traps are real; read them. Run the concurrency test first. A skipped
   integration test means a broken environment, never a pass.
2. **Review the exact head cold.** Compare the code against the
   [foundation spec](openspec/changes/document-wallet-foundation/specs/wallet-foundation-baseline/spec.md).
   Write each finding into the PR with a disposition: fixed, accepted with reason, or deferred
   to a named change. The previous Codex and CodeRabbit findings are recorded in
   [v1/HANDOFF.md](../v1/HANDOFF.md) as already fixed; confirm, do not assume.
3. **Fix the open foundation items.** Each is described in full in
   [v1/open-designs.md](../v1/open-designs.md). The recommendations are ours; record the choice
   you make and why.
   - **Item 21, expired value in the general balance.** Admission reads the general balance,
     which still counts credit that has expired. Admission and any spendable-balance display
     must exclude expired value, not only settlement.
   - **Item 22, direct plan changes.** The webhook path is fixed. The two direct routes still
     cannot tell a repeated transition from a double submission. Recommended: option 2, close
     the race at the subscription row (lock or compare-and-set), because option 1 changes a
     customer-facing endpoint contract. Also record that a failed wallet adjustment after a
     committed plan change has no durable record; a pending-record-and-drain job (option 3) is
     the fix, and it may be deferred with a stated reason.
   - **Item 20, stream entries the pipeline cannot accept.** Before any real user runs with the
     flag on, an entry that can never be processed must be inspectable and recoverable, not
     silently dropped or retried forever.
   - **Item 15, missed grants.** Organizations created while the flag was off have no signup
     grant. Write the one-off backfill over the already-idempotent `WalletsService.award`, to
     run before the flag is turned on. Do not run it anywhere shared.
   - **Cleanup row in [v1/cus-2.md](../v1/cus-2.md):** core services call
     `get_wallets_service()`, which builds a concrete data access object inside core. Move the
     wiring to the entrypoint, as `api/AGENTS.md` requires.
4. **Run the manual acceptance procedure.** Sections 0 through 8 of
   [v1/nodes/im-1-02-pipeline/acceptance.md](../v1/nodes/im-1-02-pipeline/acceptance.md),
   against a disposable deployment you control with the flag on. Never a shared or production
   database. Record the commands, results, and exact commit.
5. **Update the PR description of #6050** so it states what is verified, what is deferred, and
   that merge leaves the flag off.

## Done means

- `feat/add-wallets` is up to date with `main`, and CI is green on the new head.
- Unit and integration suites pass with zero skipped infrastructure tests, at a recorded commit.
- Every review finding has a disposition in the PR.
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
