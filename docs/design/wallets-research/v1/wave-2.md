# Wave 2: the gateway–wallet seam

**Status:** planned. No node has been implemented. The graph is in [wps-2.md](wps-2.md),
[ims-2.md](ims-2.md) and [cus-2.md](cus-2.md), with per-node specifications under
[nodes/](nodes/). Nothing here has been through a preflight review yet; [preflight.md](preflight.md)
is the shape that review must take, and `waves.md` requires it before any worktree forks.

**Wave 2 spans two branches.** The gateway owns the request path, so roughly half of this
wave's files live on `feat/add-gateways` and the other half on `feat/add-wallets`. Every node
specification states which. That is the whole subject of this wave: Wave 1 built a settlement
authority with nothing real feeding it, and the gateway built a request path that measures
usage and then drops it on the floor.

## Checkpoint boundary

Checkpoint 1 is the state Wave 1 reaches: the measurement and debit chain works end to end,
driven by wallet-owned fakes under `api/ee/tests/pytest/acceptance/wallets/fakes/`. No real
gateway call creates a measurement, no price list exists, and `WalletCheckPort.check` is an
uncalled port.

**Checkpoint 1 has not been declared.** Its acceptance procedure, sections 0 through 8 of
`nodes/im-1-02-pipeline/acceptance.md`, has not been run against a deployment. Wave 2 is
specified against the code Wave 1 delivered rather than against a declared checkpoint, and the
two can be closed in either order — but a Wave 2 node that finds a Wave 1 defect is finding it
for the first time.

Checkpoint 2 is reached when a real LLM request through the gateway's own north port can:

```text
POST /gateways/llms/{namespace}/{name}/v1/chat/completions
  → gateway permission check → wallet admission (allow + ceiling) → provider dispatch
  → response to the caller
  → gateway usage hand-off → streams:measurements → measurement worker
  → tracing measurement → rate card → streams:debits → wallet worker
  → core debit, credit selection, balances
```

and when a caller whose organization is at its floor is refused before dispatch, visibly, with
the provider never contacted.

The caller waits for exactly one of those steps: admission. Everything from the usage hand-off
rightwards is off the response path, best-effort at its first hop and retried after that,
exactly as Wave 1 established.

**Checkpoint 2 is provable today only against the `builtin` namespace, which is currently the
mock provider behind `env.mock_gateways.enabled`.** `builtin_llm_endpoint` serves `agenta` and
`mock` and nothing else; every real model reaches the gateway through `standard`, on the
customer's own credential, which is deliberately not charged. So Wave 2 delivers a complete,
tested charging path and no revenue: the first platform-funded `builtin` provider is a gateway-
wave deliverable, and until it exists the wallet has nothing real to bill. Say this plainly at
`IM-2-02` rather than declaring a checkpoint that reads stronger than it is.

## Fixed inputs

These are settled before any node starts. A node that wants to change one raises it as a
graph-review question rather than deciding it in a worktree.

- **The gateway holds the interface; the wallet holds both implementations.** `seams.md`,
  under "The line between the gateway and the wallet". Two ports, both declared in gateway
  code on `feat/add-gateways`, both implemented in EE code on `feat/add-wallets`, and both
  with a null implementation on the gateway side so that OSS and a flag-off EE deployment
  behave exactly as they do today.
- **The seam is a port, not a shared table.** Neither side reads the other's rows. The
  gateway never touches `wallet_balances`; the wallet never sees a provider response body.
- **One call, one measurement, one posting.** `measurement_id` is the idempotency spine from
  the gateway's emission through to `wallet_debits.idempotency_key`, which is already
  `measurement:{measurement_id}`. Nothing in this wave invents a second identity.
- **The two envelopes are not redesigned.** `MeasurementCommandV1` and `DebitCommandV1` in
  `ee/src/core/wallets/contracts.py` are already the right vocabulary; Wave 2 fills them from
  real data instead of fakes. `components` is an open key space, so the cache-read split needs
  no envelope change — it needs a fixed key vocabulary, which `WP-2-00` sets. Exactly one
  field is added, `secret_origin`, because a charge decision turns on it and a free-form
  `references` dictionary is the wrong home for that.
- **Admission is the only synchronous addition to the request path.** No pricing, no
  measurement persistence, and no wallet write beyond the lazy provisioning that item 14
  already put behind `check`.
- **`AGENTA_WALLETS_ENABLED` still gates every wallet write**, and now also gates whether the
  gateway's ports are bound to anything. With the flag off both ports resolve to their null
  implementations, and the request path's observable behaviour is exactly today's: two awaited
  calls are added that return immediately and change nothing a caller or a database can see.
  The property to test is that, not byte-identity, which the added calls make false.
- **The rate card is versioned and stamped.** Every debit carries the `pricing_version` of the
  table that produced it. A price change is a new version, never an edit to the old one.
- **Only the LLM plane gains admission and usage capture.** MCP reuses the same two ports and
  the same worker, and `WP-2-01` must not foreclose it, but no MCP admission and no new MCP
  measurement producer ships here. MCP's existing flat charge does carry forward: `WP-2-02`
  keeps it, because deleting a charging path Wave 1 delivered would be a regression dressed as
  a cleanup. SBX, live sandbox providers, rollups, L1 exposure estimates and reservations are
  all out, as `out-of-scope.md` records.
- **Charging follows the namespace.** D30 put the billing boundary there: a `builtin` target is
  one whose account we own, and `standard` and `custom` are the customer's own credential and
  need no charging path. Admission follows the same boundary — an organization at its floor is
  refused a call we would pay for, and is not refused a call it pays for itself.

## Invariants

1. **The gateway never writes a wallet row, and the wallet never parses a provider payload.**
   Everything that crosses is a DTO owned by the port.
2. **A failed usage hand-off costs a charge, never a response.** The first `XADD` is
   best-effort and its failure is logged, as in Wave 1. Once a message is in a stream, normal
   consumer-group retry applies and idempotency makes it safe.
3. **Admission fails closed on the vendor pass-through class and open on nothing.** A wallet
   that cannot answer refuses the call. This is `mechanics.md` §2's fixed-per-resource-class
   posture, not a per-call-site choice: the alternative is spending cash we do not have.
4. **Nothing is silently clamped.** Adopted verbatim from
   `gateways-research/v1/open-designs.md`: when a ceiling rejects, it rejects visibly. Wave 2
   enforces the admission boolean and carries the ceiling without enforcing it — what the
   ceiling would enforce, and on what evidence, is open-design item 17. No node in this wave
   shrinks a caller's parameters to fit a balance.
5. **A call paid on the customer's own credential is never charged.** In Wave 2 the namespace
   decides and `secret_origin` vetoes: a `vault`-funded call is never charged whatever
   namespace it arrived through. The single connection-derived stamp `seams.md` envisages,
   covering models, tools and sandbox time alike, arrives with the sandbox sink; on the LLM
   plane today the stamp is derived from the namespace instead.
6. **Cache reads are priced separately from fresh input, from the first emission.** Not
   because Wave 2 prices them differently today, but because the gateway cannot reconstruct
   the split retroactively and two of the three protocols already report it.
7. **Pricing never runs on the request path.** The rate card is read by the measurement
   worker, after the response, off the caller's latency budget.

## Completion evidence

- Unit tests, on both branches: the usage extraction for all three protocols including the
  cache split; the null ports; the admission decision and its reason vocabulary; the rate
  card's arithmetic, rounding and version stamping; zero-rating by `secret_origin`.
- Integration tests: a gateway call against the mock adapter produces exactly one measurement
  row and one debit posting, and a replay of either message produces no second financial
  effect.
- Acceptance, against a local deployment with the flag on: a request through the `builtin`
  namespace moves a real balance, an organization at its floor is refused before the provider
  is contacted, and a `standard` request succeeds against that same spent wallet because the
  customer's own credential is not ours to ration.
- The wallet-owned fakes under `api/ee/tests/pytest/acceptance/wallets/fakes/` are retired as
  the production producer and survive only where a test needs a deterministic measurement
  without a gateway.

## What this wave does not decide

Item 15 (restoring the value dark-window organizations missed), items 2 and 11 (strict
admission with reservations, and restricted-credit applicability), item 8 (reconciliation
against the provider invoice) and item 13 (expiry and spend order) all stay open. Wave 2 adds
no machinery that presumes an answer to any of them, and the `ceiling_musd` field it
introduces is the place a strict, reserving admission would later put a number without
changing a signature.
