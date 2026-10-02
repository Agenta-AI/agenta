## 1. Work and evidence

Implemented on `wallets/wave-2` (PR #7162). The status and the launch blockers for a real `builtin` provider are in [../../../wave-2-status.md](../../../wave-2-status.md).

- [x] 1.1 Resolve original preflight questions on price ownership, admission ceiling meaning, cost units/rounding and catalog updates.
  - Decided in `v1/open-designs.md` items 16 to 19 (commit `22c06677f3`). The ceiling stays carried and unenforced (item 17), so no port shape changed.
- [x] 1.2 Implement shared ports, null implementations, usage component vocabulary and trusted credential-origin stamp.
  - Commit `1db045034f`: spend-admission and usage-sink ports with null defaults, and `SecretOrigin.LOCAL` stamped in `_outcome_from` from the namespace. Commit `7211155556`: the component vocabulary (`components.py`).
- [x] 1.3 Implement real usage extraction and enterprise sink; test non-stream body consumption and interrupted streams.
  - Commits `1db045034f` and `c0cccbb923`: usage extraction with the cache split for all three protocols, and `MeasurementUsageSink`, bounded to 0.5 seconds. Commit `40b9152f4c`: a timed-out hand-off is logged as an unknown outcome.
  - Tests: `test_a_messages_stream_keeps_the_cache_split_its_first_frame_reported`, `test_a_cached_messages_stream_is_stored_and_priced_with_its_cache_split` (real Postgres), `test_a_stalled_sink_holds_a_response_no_longer_than_its_bound`, and, in `test_wallets_gateway_chain_postgres.py`, the non-streaming call and the client disconnect (recorded as an accepted loss).
- [x] 1.4 Replace fixture model pricing with a versioned rate card and preserve existing fixture MCP behavior.
  - Commit `7211155556`: `rate_card.py` with a version derived from the table's hash, and `calculate_charge`. The fixture `pricing.py` and the fake LLM producer are deleted. The fake MCP producer moved under the test utilities.
  - Tests: `test_every_model_the_builtin_namespace_serves_has_a_rate`, and `test_an_unpriced_measurement_is_retried_dead_lettered_and_charged_on_replay`.
- [x] 1.5 Wire admission and flag-controlled composition; include run attribution and customer-funded bypass.
  - Commit `c0cccbb923`: `WalletSpendAdmission` and the sink are wired only when the edition is EE and the wallet flag is on. Admission runs once, after authorization and before the secret is read, for `builtin` only, and fails closed. Commit `40b9152f4c`: admission has a 2-second timeout that refuses. The run id is carried on each measurement's references.
  - Tests: the admission tests in `test_gateways_wallet_seam.py`, and `test_with_the_wallet_off_nothing_is_checked_or_measured`.
- [x] 1.6 Prove one mock managed call charges once, an empty-wallet managed call never dispatches, and a customer-funded call still succeeds.
  - `test_wallets_gateway_chain_postgres.py` (9 tests on real Postgres and Redis): streaming and non-streaming calls charge once, a redelivery charges once, the floor refusal returns 403 with the provider never called, and a `standard` call on a spent wallet succeeds without a charge. Disabling admission makes 3 of them fail.
  - Live QA on a deployed stack: each call was charged once at the rate card price, the spent wallet was refused before dispatch, a worker killed mid-traffic lost and duplicated nothing, and flag off checked and published nothing. The `standard` call was not run live because no real provider key was available; the test above covers it.
- [x] 1.7 Remove test fakes from the production producer path; document that live funded providers remain separate.
  - Commit `7211155556` removed the fakes from the production path. `wave-2-status.md` states that Wave 2 bills nothing real, because `builtin` serves only the mock provider, and lists the launch blockers for a real one.
