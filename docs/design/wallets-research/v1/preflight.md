# Wave 1 preflight

The graph/specification review that `waves.md` requires before any node work starts.

Verified against `origin/main` on 14 August 2026. Four blockers, four gaps, and the facts a
node will otherwise have to rediscover.

---

## Blockers

### B1. Two live vocabularies, and the reading order points at the superseded one

`mechanics.md` §3 proposes `wallet_movement`, `wallet_lot`, `wallet_allocation`,
`wallet_hold`, `price_book` / `price_line`, `usage_event`, `credit_line`.

`entities.md` selects `wallet_credits`, `wallet_debits`, `wallet_balances`, `measurements`,
pricing as versioned code rather than tables, no allocation table (folded into
`wallet_debits.wallet_credit_id`), and no hold.

Both are in `v1/`. `entities.md` reconciles the older `credit_*` vocabulary from `report.md`
in a table, but says nothing about `mechanics.md`. `open-designs.md` calls `mechanics.md` the
"current canonical direction", which is true of its three-class model and false of its naming
and schema. Meanwhile open item 9 reads *"Reopened: decide the raw collector record's name and
the financial domain prefix before any migration"*, while `entities.md` states those names are
selected.

A node worktree told "your context is `v1/`" reads `README.md`, follows it to `mechanics.md`,
and builds `wallet_movement` and `price_book`.

**Fix:** one reconciliation table in `entities.md` covering `mechanics.md` the way it already
covers `report.md`, and a reading order that names the canonical documents. Close item 9 or
state that `entities.md` is provisional until it closes — not both.

### B2. No migration chain or head is named, and two numbers are already claimed

`WP-1-01` task 1 says "add core migrations"; `WP-1-02` writes `measurements` into tracing.
Neither names a chain, a head, or an edition. There are four live chains and two parked traps:

| Chain | Path | Head | Live? |
| --- | --- | --- | --- |
| `core_oss` | `api/oss/databases/postgres/migrations/core_oss/versions/` | `oss000000020` | yes |
| `tracing_oss` | `api/oss/databases/postgres/migrations/tracing_oss/versions/` | `oss000000004` | yes |
| `core_ee` | `api/ee/databases/postgres/migrations/core_ee/versions/` | `ee0000000003` | yes |
| `tracing_ee` | `api/ee/databases/postgres/migrations/tracing_ee/versions/` | `ee0000000001` | yes |
| `core`, `tracing` | under both `api/oss/` and `api/ee/` | parked | **no — reading a head here is wrong** |

`ee0000000004` is already claimed by sandbox-metering Track B and `ee0000000005` by Track C
(both open drafts), and `report.md` §7.5 claims the same two. The gateways wave targets
`core_oss` at `oss000000021`.

**Fix:** state the chain and the reserved revision id in each WP spec, and say which edition
the wallet tables live in. Two worktrees writing migrations against an unnamed chain collide.

### B3. Checkpoint 1 includes a wallet check that no node builds

`wave-1.md` defines the boundary as:

```text
API request → wallet check → fake managed gateway result → ...
```

`WP-1-01` is settlement only and explicitly excludes reservation and hold. `WP-1-02` is the
fake gateway and measurement chain. `WP-1-03` is the debit worker. None of them implements
`check(delta)`, which `entities.md` treats at length as an operation.

As written, the graph cannot reach the checkpoint.

**Fix:** either drop the check from the checkpoint boundary — defensible, since Wave 1 has no
admission control by design and open item 2 already decided there is no hold on this path — or
add it to `WP-1-01` with its own tests. Not both.

### B4. The fake gateways are owned by another wave

`gateways-research/v1/workstreams/README.md` assigns `core/gateways/llms/providers/fake/` and
`core/gateways/mcps/providers/fake/` to that wave's **WP5**, under a one-owner-per-file rule.
`WP-1-02` says it "provides fake built-in LLM and MCP gateway paths."

Two waves, two sets of worktrees, the same paths.

**Fix:** make `WP-1-02` depend on the gateways fake provider, or give the wallet its own fake
at a wallet-owned path and say so. Decide before either worktree forks.

---

## Gaps

### G1. No seed commit, and the parallel packages share an interface

`WP-1-01` and `WP-1-02` are declared independent, but `WP-1-02` produces the debit command
that `WP-1-01`'s settlement service consumes and `WP-1-03` deserializes. That is an interface
dependency across three worktrees.

The gateways wave solved this with a seed commit: every DTO, exception and port declared with
not-implemented bodies, landed on the base branch, and every worktree forks from it. Wave 1
has no equivalent. The two stream envelopes in `entities.md` are the natural seed content.

### G2. The node specs are thin against the precedent they follow

The gateways workstreams ship 350–480 line specifications and 130–215 line task lists per
package, explicitly so a package can be handed to an agent "with no context beyond `v1/`".
Wave 1's are 4–18 lines of specification and 4–7 tasks. `WP-1-01` is the strongest and still
names no file path, DTO, or service boundary.

They lean on `entities.md`, which is genuinely detailed — but its own §5 opens four questions
that `WP-1-01` and `WP-1-02` need answered: the identity and idempotency constraint for a
measurement, which header dimensions are real columns, whether metrics are child rows or typed
data, and which names are canonical.

### G3. Two worktrees must edit one shared registration file

Confirmed: `streams:spans`, `streams:records` and `streams:events` are registered in
`api/entrypoints/worker_streams.py` through `_build_*_worker`, `ALL_STREAMS`, and the
`AGENTA_WORKER_STREAMS` selector. Two new streams mean `WP-1-02` and `WP-1-03` both edit that
one file. Same one-owner problem as B4, smaller blast radius.

The rest of the transport claim in `entities.md` checks out: one compressed JSON `data` field,
a dedicated consumer group, bounded approximate `MAXLEN`, ACK-and-delete after success.

### G4. Wave 1 assumes an answer to an open item

`measurements` in tracing and `wallet_*` in core is two databases in one wave. Open item 12
(store classes and co-location units) is still `Open`, and `entities.md` calls physical
placement "an open multi-store boundary". The wave is not wrong to pick one — it should say it
is picking one, so item 12 records it.

---

## What holds up

Worth stating, so review does not relitigate it:

- **The replay invariant is right**, and it is the hard part. A composed `debit_key` from the
  posting key plus the actual funding source, a unique `(organization_id, debit_key)`, and the
  organization-balance lock serialising simultaneous first deliveries of one posting key. It
  uses source identity rather than an invented sequence, and it survives a split debit.
- **The two-stream choice is justified from how the existing consumer behaves** — it deletes
  entries after success, so one entry cannot fan out to two workers. That is a verified reason,
  not a preference.
- **Completion evidence is stated as tests**, including the one that matters: concurrent
  deliveries cannot overspend one credit.
- **`out-of-scope.md` states the condition that reopens each deferral**, which is the part
  that usually goes missing.
- **No hold on the non-strict variable-cost path** is explicit, and consistent with a wave
  that has no admission control.
