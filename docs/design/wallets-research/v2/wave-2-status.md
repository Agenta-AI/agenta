# Wave 2 status: the gateway to wallet seam

Branch `wallets/wave-2`, stacked on `wallets/takeover`. The plan is
[v1/wave-2.md](../v1/wave-2.md), as reviewed in the Wave 2 preflight and amended after a Codex
review of that plan. Decisions are recorded in [v1/open-designs.md](../v1/open-designs.md)
items 16 to 19.

**Wave 2 bills nothing real.** The only models the `builtin` namespace serves are the mock
provider's, and only when `AGENTA_GATEWAYS_MOCKS_ENABLED` is on. Every real model reaches the
gateway through `standard` or `custom`, on the customer's own credential, which is never
charged. The charging path is complete and proven against the mock. Revenue needs a real
platform-funded `builtin` provider, and the launch blockers below.

## What a `builtin` call does now

With `AGENTA_WALLETS_ENABLED` on, in EE:

1. The gateway checks the caller's permission.
2. It asks the wallet whether the organization may spend (`WalletsService.check`, one read).
   A refusal, or a wallet that cannot answer, returns 403 `policy_denied` and records one
   audit event. The provider is never contacted and no secret is read.
3. The mock answers. The gateway reads its usage, with fresh input, cache reads and cache
   writes kept apart, and stamps the payer as `local`.
4. After the body is drained, the gateway hands the usage to the sink, which publishes one
   measurement to `streams:measurements`. The hand-off is bounded to 0.5 seconds and can
   never fail or stall the response.
5. The measurement worker prices it from the rate card, stores the measurement with its
   charge decision, and publishes one debit.
6. The debit worker settles it against the organization's credits.

`standard` and `custom` calls skip steps 2, 4, 5 and 6. With the flag off, or in OSS, the
gateway holds null ports: every call is admitted and nothing is handed off.

## Implemented

| Piece | Where |
| --- | --- |
| Ports and null defaults: `SpendAdmissionInterface`, `UsageSinkInterface`, `SpendAdmission` (with `ceiling_musd` kept, unenforced) | `api/oss/src/core/gateways/policy/{interfaces,dtos,null}.py` |
| Fail-closed admission and the bounded, contained usage hand-off, both owned by the policy service; the hand-off only for dispatched `builtin` LLM calls with usage | `api/oss/src/core/gateways/policy/service.py` |
| Admission call site (after permission, before the secret), `LOCAL` payer stamp, provider on the policy target, run id from the proxy | `api/oss/src/core/gateways/llms/service.py`, `api/oss/src/apis/fastapi/gateways/llms/proxy.py` |
| Cache split for Chat Completions, Responses and Messages, kept through the multi-frame merge and in the audit event | `api/oss/src/core/gateways/llms/providers/passthrough/adapter.py`, `policy/audit.py` |
| `WalletSpendAdmission` over `WalletsService.check` | `api/ee/src/core/wallets/admission.py` |
| `MeasurementUsageSink`: one call to one `MeasurementCommandV1` | `api/ee/src/core/measurements/sink.py` |
| Rate card (synthetic mock rates, MCP 50 musd per request, derived version) and `calculate_charge` | `api/ee/src/core/measurements/{rate_card,charges,components}.py` |
| Charge decision stored in `measurements.data.charge`, replayed on redelivery without re-resolving or re-pricing, debit `created_at` reused | `api/ee/src/tasks/asyncio/measurements/worker.py`, `api/ee/src/dbs/postgres/measurements/` |
| Unknown rate is retried, then dead-lettered, never stored as free (`UnpricedMeasurementError`) | `api/ee/src/core/wallets/errors.py` |
| Wiring behind `is_ee()` and `AGENTA_WALLETS_ENABLED` | `api/entrypoints/routers.py` |
| Retired: `pricing.py` (`calculate_fake_charge`) and the fake LLM producer. The fake MCP producer moved to `api/ee/tests/pytest/utils/measurements/mcp_producer.py`, as the only MCP producer | |

No envelope field, port signature or migration changed. No new environment variable.

## Tested

- **Gateway unit** (`oss/tests/pytest/unit/gateways`): the cache split per protocol, with and
  without a cached slice; a full Messages stream keeping its cache fields; admission refusal
  (never dispatched, no secret read, one 403 audit event, no hand-off); a failing wallet
  refuses; `standard` and `custom` never consult the wallet; permission denial wins; the
  hand-off on streaming and non-streaming calls, with the run id and `LOCAL`; nothing handed
  off on denial, MCP or missing usage; a raising sink changes nothing; a stalled sink holds
  the response no longer than its bound; the null defaults; the flag guard in `routers.py`;
  no gateway module imports `ee`; the proxy passes the run id.
- **EE unit**: the charge arithmetic by hand, rounding, zero, unpriced model and server,
  non-`builtin`, MCP flat rate, derived version; every `builtin` model has a rate; the sink
  mapping by value; admission; replay from the stored decision with the resolver and the
  pricer raising, byte-identical debit envelope; a price change does not reach a replay; an
  unpriced measurement is retried, dead-lettered, and charged once on replay.
- **Integration, real Postgres and Redis**: two concurrent first inserts answer with one
  committed decision; a worker that loses the insert race publishes the winner's debit; the
  decision survives the round trip; a cached Messages stream is stored and priced with its
  split; and the whole chain through the real proxy, service, mock, sink and both workers
  (`ee/tests/pytest/integration/wallets/test_wallets_gateway_chain_postgres.py`): one call
  is one measurement and one posting (streaming and non-streaming), a redelivery settles
  once, two calls charge twice, an organization at its floor gets 403 with the provider never
  called, `standard` on the same spent wallet succeeds uncharged, a direct call carries no
  run reference, an abandoned stream is not charged, and the wallet-off composition checks
  and measures nothing.

Suite counts at the final commit are in the Wave 2 completion evidence in
[v1/wave-2.md](../v1/wave-2.md).

## Deferred

- **Deployed smoke run** (preflight step 8) against a local EE stack with the flag on. The
  in-process chain test covers the same path with real stores; the deployed run is the
  acceptance record, not yet made.
- **MCP admission and measurement** for `builtin` MCP (`agenta`, `composio`), which is
  platform-paid (D30). Not admitted and not measured in Wave 2.
- **Measurements for `standard` and `custom`.** Their usage stays in the `GATEWAYS_CALLED`
  audit event. Reopens when something other than billing reads measurements.
- **`Counter.CREDITS_CONSUMED`** stays. It still counts requests against platform keys
  (`apis/fastapi/access/router.py`), and Wave 2 did not make the gateway the only mechanism
  (D24). The word *credit* keeps two meanings until it does.

## Launch blockers for a real `builtin` provider

These are gateway-wave deliverables, not code in this wave.

1. **Usage lost on a cut stream.** An adapter learns a call's usage when its body ends. A
   client that disconnects first leaves no usage, so the call is not charged. The chain test
   records this. A Chat Completions stream without `stream_options.include_usage` reports no
   usage either. Before launch: force `include_usage` on `builtin` streams, and bill or refuse
   a stream that ends without usage.
2. **Real rates with provenance.** Replace the synthetic rows with the provider's price plus
   our margin, with source and date, approved by product.
3. **Activation order.** Deploy the measurement worker with the new card before the API that
   routes a new model. The retry and dead-letter path covers an overlap; it is not a plan.
4. **The signup-grant backfill** (item 15) before the flag goes on. Otherwise a dark-window
   organization is refused on its first `builtin` call.
5. **Non-reserving admission.** Admission is one read and reserves nothing, so calls already
   in flight can take an organization below its floor (items 2 and 17). Measure the overshoot
   in the ledger before a provider with material spend launches.
6. **Best-effort first hop.** A failed or timed-out measurement publish is a lost charge,
   logged, not recovered.
