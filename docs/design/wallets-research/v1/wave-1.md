# Wave 1: managed-gateway measurement and wallet debit kernel

**Status:** planned; not yet started. Wave 1 takes the application from checkpoint 0 to checkpoint 1.

**Fork point:** `IM-1-00` reviewed and merged `WP-1-00` (contract seed) at commit `659e7ac5db1e0d0987acdc1beb654ea2becfc14b`
(merging `WP-1-00` commit `676a96e054940b166461a43217de81214aaf8cff`) on `wallets/im-1-00-seed`. `WP-1-01`
and `WP-1-02` fork from this commit; neither may fork before it exists.

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
  included in `ALL_STREAMS` only when `is_ee()` is true.
- `measurements` live in tracing. Authoritative `wallet_credits`, `wallet_debits`, and
  `wallet_balances` live together in core.
- Tables are EE-only. **Delivered migration ids** (superseding the reserved numbers below): `core_ee`
  `ee0000000004` (`down_revision = "ee0000000003"`), `tracing_ee` `ee0000000002`
  (`down_revision = "ee0000000001"`, unchanged from the original plan).

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
  duplicate delivery, restricted-credit selection, split debit, and allowed deficit.
- Real-Postgres integration tests prove all debit and balance changes commit or roll back together and
  concurrent deliveries cannot overspend one credit.
- Local deployment acceptance uses fake built-in LLM and MCP calls only. It confirms both chains reach
  one measurement and one idempotent core settlement per gateway call.

The detailed node graph is in [wps-1.md](wps-1.md), [ims-1.md](ims-1.md), and [cus-1.md](cus-1.md).
