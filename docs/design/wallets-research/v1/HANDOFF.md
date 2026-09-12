# Wallets v1: handoff

## What this branch is

`feat/add-wallets` adds the enterprise-edition credit wallet to Agenta: a credit ledger, a
raw usage fact called a measurement, and the settlement path that turns a gateway-decided
charge into debit rows and updated balances. It builds on `feat/add-gateways`, which owns
the request path and decides what a call costs; this branch owns the accounting. Everything
it adds is switched off behind the `AGENTA_WALLETS_ENABLED` environment variable, which
defaults to false, so merging it changes no running behaviour. Its pull request is
Agenta-AI/agenta#6050, a draft based on `feat/add-gateways`, and it must merge after that
branch rather than before it.

## The tracking files

All of these live in `docs/design/wallets-research/v1/`. Read them in the order the README
gives, not the order below.

| File | What it is for |
| --- | --- |
| `README.md` | The map. It states the reading order and which document wins when two disagree. |
| `waves.md` | The delivery model. It defines checkpoints, waves, and the three node types (work package, intermediate merge, cleanup). |
| `wave-1.md` | What Wave 1 delivered. It carries the checkpoint boundary, the fixed inputs, the replay invariant, the completion evidence, and the feature-flag section. Start here for the state of the code. |
| `preflight.md` | The review that Wave 1's graph and specifications had to pass before any node work began. It records four blockers and four gaps, and the disposition of each. |
| `open-designs.md` | The register of unresolved design questions, fourteen of them, each self-contained. |
| `entities.md` | The canonical data model. It is authoritative for every table, column, and name. Where any other document disagrees with it, it wins. |
| `nodes/*/specs.md` and `nodes/*/tasks.md` | One pair per node in the Wave 1 graph. The specification states the boundary and the owned code; the task list is the ordered work. This is the format Wave 2 must also use. |
| `nodes/im-1-02-pipeline/acceptance.md` | The verification procedure. Section 9 holds the test commands, the infrastructure recipe, and the results. Sections 0 through 8 are the manual acceptance run against a deployed stack. |
| `seams.md` | Where the gateway design and the wallet design meet, and what each already settled. Wave 2 planning depends on it. |
| `wps-1.md`, `ims-1.md`, `cus-1.md` | The Wave 1 node graph: the work packages, the merge points, and the cleanup node. |

## Current state

Wave 1 is code-complete. The measurement and debit pipeline, wallet provisioning at
organization creation, mid-period plan-change proration, and the grant catalog all ship on
this branch. Two Redis streams carry the work. `streams:measurements` feeds the measurement
worker, which persists the usage fact and publishes a debit command. `streams:debits` feeds
the wallet worker, which settles that command inside one core transaction. The caller waits
for none of it.

The migrations land unconditionally, whether the flag is on or off. The `core_ee` head is
`ee0000000005` and the `tracing_ee` head is `ee0000000002`.

The unit and integration suites pass as of 12 September 2026, at those two migration heads,
against a throwaway Postgres 17 and Redis 8.

| Suite | Result |
| --- | --- |
| `ee/tests/pytest/unit/wallets/` plus `ee/tests/pytest/unit/measurements/` | 126 passed |
| The whole of `ee/tests/pytest/unit` | 497 passed |
| `integration/wallets/` and `integration/measurements/` together | 20 passed |

The first integration run found four defects, two of them in production code. One of the two
would have failed every signup the day the flag was turned on. All four are fixed. Section 9
of the acceptance document records each defect, its cause, and the regression test that now
pins it.

What has not been done is the manual acceptance run in sections 0 through 8 of the acceptance
document. That needs a local deployment with the flag on, and it is what closes checkpoint 1.

One further note on test results. The sessions record-replay integration test
(`api/oss/tests/pytest/integration/sessions/test_records_replay_postgres.py`) fails
independently of this work. It exists on `main` and no wallet commit touches it, so a failure
there is not a wallet regression.

## How to run the tests

The unit suites need nothing beyond the repository. From `api/`:

```bash
AGENTA_LICENSE=ee uv run --no-sync pytest ee/tests/pytest/unit -q -o addopts="-n auto"
```

The integration suites need a Postgres and a Redis, and nothing else. They drive the data
access objects and the worker bodies in process, so the API and the workers do not have to be
running. Two throwaway containers are enough, which is how the 12 September 2026 run was
done. Three environment variables have to point at them: `POSTGRES_URI_CORE`,
`POSTGRES_URI_TRACING`, and `REDIS_URI`. The test fixtures probe those addresses and skip when
they are unreachable, so a skipped test means a misconfigured environment, never a pass.

Four things in that setup are easy to get wrong.

1. **The databases must exist before the migrations run.** Mount
   `api/ee/databases/postgres/init-db-ee.sql` as the Postgres image's init script rather than
   creating `agenta_ee_core`, `agenta_ee_tracing`, and `agenta_ee_supertokens` by hand.
2. **The migration runner does not work outside its container as shipped.** The two Alembic
   configuration files hardcode a `script_location` under `/app`. Copy both somewhere
   writable, rewrite the paths, and point `ALEMBIC_CFG_PATH_CORE` and
   `ALEMBIC_CFG_PATH_TRACING` at the copies. Then run
   `uv run --no-sync python -m ee.databases.postgres.migrations.runner` from `api/` with
   `AGENTA_LICENSE=ee`. Expect `core_ee` at `ee0000000005` and `tracing_ee` at
   `ee0000000002`.
3. **Downgrade `core_ee` to `ee0000000003` before running the wallet tests.** Every wallet
   fixture upgrades and downgrades itself. Left at head, its upgrade is a no-op and the
   round-trip migration test fails its opening assertion.
4. **Do not disable xdist.** These suites share schema state. `api/pytest.ini` runs
   `--dist=loadgroup` and every wallet and measurement integration module carries the
   `wallets-integration` xdist group marker, which lands them all on one worker. Any new
   module here that holds database state must follow the same precedent.

Run each command with `AGENTA_LICENSE=ee AGENTA_WALLETS_ENABLED=true` and the three addresses
set. The exact commands, in the order that matters, are in section 9 of
`nodes/im-1-02-pipeline/acceptance.md`, together with what a failure of each one would mean.
Run the concurrency test first. It proves that competing deliveries cannot overspend one
credit, and it alone is enough to catch a broken locking strategy.

## Open items, in priority order

1. **Organizations provisioned while the flag was off.** This is item 14 in
   `open-designs.md` and it blocks turning the flag on. The migrations are unconditional but
   the provisioning code is not, so every organization created while the flag is false has no
   general balance row, and the backfill migration has already run and will not run again.
   The first debit for such an organization raises a not-found error that the debit worker
   treats as retryable, so the message redelivers forever. The register proposes lazy
   provisioning on the settlement path, plus reclassifying that error as terminal and alerted.
   Decide it before the flag is ever turned on, not after.
2. **The seam to the gateway.** Three pieces of Wave 1 are placeholders that the gateway has
   to replace. The `record()` call has to become a real producer into `streams:measurements`,
   driven by actual gateway usage rather than the wallet-owned fakes under
   `api/ee/tests/pytest/acceptance/wallets/fakes/`. The rate card has to become real, so the
   charge amount comes from a price list rather than a fixture. And `check()` has to be called
   at admission, before dispatch, rather than existing as an uncalled port. The ownership
   split these three follow is in `seams.md`, under "The line between the gateway and the
   wallet": the gateway enforces and the wallet accounts.
3. **The manual acceptance run.** Sections 0 through 8 of the acceptance document, against a
   local deployment with the flag on. This is what declares checkpoint 1 reached.

## Next step

Write the Wave 2 specifications in the same format the Wave 1 nodes use: one
`nodes/<node>/specs.md` stating the boundary, the prerequisites, and the owned code and
schema, paired with one `nodes/<node>/tasks.md` giving the ordered work and what to read
first. Follow the process in `waves.md`: name both checkpoints and the target before naming
the wave, close the design gate, then break the work into a dependency graph of independently
executable nodes. Run the graph and the specifications through a preflight review, as
`preflight.md` did for Wave 1, before forking any worktree.

## Next work package

Wave 2 has no specifications yet. When they are written, they must cover the following.

- **The flag and backfill gap**, from item 14 of `open-designs.md`. It is the only open item
  that prevents the existing code from being turned on, so it comes first and may deserve its
  own cleanup node rather than waiting for a work package.
- **The real measurement producer.** Replace the wallet-owned fake gateways with the gateway's
  own emission into `streams:measurements`. `seams.md`, under "The line between the gateway and
  the wallet", lists the four facts the gateway has to carry from its first day, because none
  can be added retroactively: the principal on every emission including the run, the credential
  origin and owner so a call paid on a customer's own key is not billed as ours, the raw
  measurement with cache reads separate from fresh input, and a decision point before dispatch
  even while it always answers yes.
- **The rate card and the conversion.** The same section of `seams.md` places pricing with the
  wallet rather than the gateway. It decides the number and the gateway enforces it. The unit,
  the price list, and who converts credits to money are all wallet-owned.
- **Admission.** Call `check()` before dispatch. Note that the current predicate is non-strict:
  it rejects on committed balance against a floor and reserves nothing. Item 2 of
  `open-designs.md` holds that question, and a strict check with reservation semantics would
  reintroduce an amount parameter deliberately.
- **The vocabulary collisions.** `seams.md`, under "Three live meanings of one word" and
  "Mechanical collisions to fix before anyone writes code", lists the naming and mechanical
  conflicts between the four efforts that have to be resolved before code is written rather
  than during review.
- **What nobody owns yet.** The section of `seams.md` with that heading names two items that
  no design currently claims: reconciliation against the provider invoice, and the success
  criterion for a funded tier. Wave 2 should either claim them or record why it does not.

The sandbox class, live providers, layer-one exposure estimates, rollups, and store separation
are all still design only. `out-of-scope.md` records the condition that reopens each deferral.
