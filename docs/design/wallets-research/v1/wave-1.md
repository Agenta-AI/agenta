# Wave 1: managed-gateway measurement and wallet debit kernel

**Status:** planned; not yet started. Wave 1 takes the application from checkpoint 0 to checkpoint 1.

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
- The streams are `streams:measurements` and `streams:debits`; both use the current compressed JSON
  `data` envelope and bounded approximate `MAXLEN` mechanism.
- `measurements` live in tracing. Authoritative `wallet_credits`, `wallet_debits`, and
  `wallet_balances` live together in core.
- Tables are EE-only. `WP-1-01` owns `core_ee` revision `ee0000000006`, based on the already
  reserved meter chain through `ee0000000005`; it must not fork until that dependency is present in
  its base. `WP-1-02` owns `tracing_ee` revision `ee0000000002`, based on `ee0000000001`.
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
