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
| `open-designs.md` | The register of design questions, fifteen of them, each self-contained. |
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
against a throwaway Postgres 17 and Redis 8. The counts below include the lazy-provisioning
work that closed item 14.

| Suite | Result |
| --- | --- |
| `ee/tests/pytest/unit/wallets/` plus `ee/tests/pytest/unit/measurements/` | 133 passed |
| The whole of `ee/tests/pytest/unit` | 504 passed |
| `integration/wallets/` and `integration/measurements/` together | 26 passed |

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

1. **The value the dark-window organizations missed.** Item 14 is closed: every wallet
   write path, and the admission read, now provisions a missing general balance row
   idempotently, and a missing, unprovisionable row is terminal in the debit worker rather
   than redelivered forever. What lazy provisioning does not restore is value. An
   organization created while the flag was off also missed its signup grant, so it comes
   back at a zero balance and is refused at admission until something funds it. That is
   item 15 in `open-designs.md`; the recommendation there is a one-off backfill calling the
   already-idempotent `WalletsService.award`, run before the flag is turned on.
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

**Wave 2 is written.** [wave-2.md](wave-2.md) has the checkpoint boundary, the fixed inputs,
the invariants and the completion evidence; the graph is in [wps-2.md](wps-2.md),
[ims-2.md](ims-2.md) and [cus-2.md](cus-2.md), with a specification and a task list per node
under [nodes/](nodes/). Nothing in it is implemented.

What has not happened is the preflight review `waves.md` requires before any worktree forks.
Wave 1's is in [preflight.md](preflight.md) and is the shape this one must take: read the graph
and every specification cold, and write down every blocker and every gap with its disposition.
Four questions are the ones most likely to come back as blockers, and all four are already in
`open-designs.md` as items 16 to 19: who owns the rate card, what the admission ceiling
enforces, what unit a provider-declared cost is stored in, and what keeps the card in step with
the model catalogue.

One fact about scope, before anyone estimates this wave's value. Charging follows the
namespace, per the gateway's D30: only `builtin` is a target whose account we own, and
`builtin_llm_endpoint` today serves `agenta` and `mock` behind `env.mock_gateways.enabled` and
nothing else. Every real model reaches the gateway through `standard`, on the customer's own
credential, which is deliberately not charged. **Wave 2 therefore delivers a complete,
tested charging path and no revenue.** The first platform-funded `builtin` provider is a
gateway-wave deliverable, not a wallet one, and until it exists there is nothing real to bill.

Two more facts about the gateway side should be settled before `WP-2-01` forks, because the
wave leans on both. The non-streaming relay path may never drain its body generator, in which case
usage is never recorded at all — `WP-2-01`'s first task is a test that settles it. And
`SecretOrigin.LOCAL` is never produced in production code today. A `builtin` target resolves no
secret at all, so its origin is `None`, and the resolver's two call sites both stamp `VAULT`
on the customer's own credential, correctly. Every charge decision reads that stamp, so
`WP-2-01` has to produce `LOCAL` where the payer is us — in `_outcome_from`, from the
namespace, not in the resolver.

Wave 2 spans two branches. Roughly half its files are on `feat/add-gateways` and half on this
one, and every node specification says which. Merge order within a node is always gateway
first: the wallet side imports gateway-declared ports.

## What Wave 2 does not cover

- **The manual acceptance run for Wave 1.** Sections 0 through 8 of
  `nodes/im-1-02-pipeline/acceptance.md`, against a local deployment with the flag on. That is
  what declares checkpoint 1, and it is independent of everything in Wave 2.
- **Item 15**, the value the dark-window organizations missed. It is a one-off backfill over an
  already-idempotent entry point, not a work package.
- **What nobody owns yet.** `seams.md` names two things no design claims: reconciliation
  against the provider invoice, and the success criterion for a funded tier. Wave 2 claims
  neither. Item 18 makes reconciliation possible later by not rounding a provider's figure away
  at capture; the funded tier is untouched.

The sandbox class, live providers, layer-one exposure estimates, rollups, and store separation
are all still design only. `out-of-scope.md` records the condition that reopens each deferral.
