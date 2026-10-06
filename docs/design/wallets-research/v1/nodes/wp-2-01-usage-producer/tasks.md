# WP-2-01 tasks

Fork point: the reviewed `IM-2-00` seed, on both branches. Each item is one reviewable commit.

## Read first

1. `api/oss/src/core/gateways/llms/service.py` — `relay_chat_completion`, `_drain_and_record`,
   `_outcome_from`, and the comment explaining why recording happens after the drain.
2. `api/oss/src/core/gateways/llms/providers/passthrough/adapter.py` — `_usage_from_payload`,
   `_single_chunk_body`, `_stream_body`, and `_usage_from_stream_tail`.
3. `api/oss/src/core/tracing/utils/trees.py` around `CACHE_READ_TOKEN_KEYS` and
   `calculate_costs` — the only place in this repository that already gets the cache-read
   convention right, including what litellm expects.
4. `api/oss/src/core/workflows/service.py` `_prepare_invoke`, where `gateway_run_id` is
   minted, and `api/oss/src/middlewares/auth.py` `sign_secret_token` / `verify_secret_token`,
   where it is signed in and read back onto `request.state`. The comment there explains why it
   is kept off `AuthScope`.
5. `api/ee/tests/pytest/acceptance/wallets/fakes/llm.py` — the fake this package replaces, as
   the worked example of a complete measurement.

## Gateway branch: prove the drain first

1. Write the proxy-level test asserting `policy.record` is called with a populated `usage` on
   a non-streaming relay. Commit it whether it passes or fails.
2. If it fails: make the proxy exhaust and close the body on the non-streaming path, or make
   the adapter set `result.usage` before yielding. Prefer whichever keeps the streaming path
   untouched, and say in the commit message which and why.

## Gateway branch: capture

1. Extend `_usage_from_payload` with the cache split for all three protocols, following the
   normalisation rule in the specification exactly. A field the upstream did not report stays
   `None`.
2. Populate `outcome.duration_ms`, declared since the seed and never filled.
3. Populate `target.provider` from `_ResolvedLlmTarget.provider_key` when building the policy
   target, so the measurement and the audit event both know which provider answered.
4. Add a `target` parameter to `_outcome_from` — it does not take one today — and stamp
   `SecretOrigin.LOCAL` there when the target's namespace is `builtin`, leaving the resolved
   secret's origin alone otherwise. Read "Who paid" in the specification first: the resolver
   cannot do this, because a `builtin` target resolves no secret at all.
5. Add usage to `build_gateway_call_attributes`. It reaches `record` today and is dropped.

## Gateway branch: the hand-off

1. Mint `request_id` in `LLMGatewayProxy._relay`, read `request.state.gateway_run_id`, and
   build one `GatewayCallContext` per relay. Thread it through
   `LLMGatewayService.relay_chat_completion` to `_drain_and_record`.
2. Give `GatewayPolicyService.__init__` a `usage_sink: UsageSinkInterface = NullUsageSink()`
   parameter, and call `await self.usage_sink.record(...)` from `record`, after
   `publish_gateway_call`, under the gating condition `WP-2-00` wrote into the signature, and
   inside its own `try/except Exception` with a log. The unused `resolver` parameter stays
   where it is; removing it is not this package's business.
3. Add the tests that a permission denial and a `list_models` call publish an audit event and
   no measurement. These are the ones that keep the refusal path out of the charging path.
4. Repeat the steps above for the MCP plane only as far as passing the context through. No
   MCP sink behaviour ships here, and MCP's existing charge is `WP-2-02`'s to preserve.

## Wallet branch: the sink

1. Implement `MeasurementUsageSink.record` against the mapping table in the specification.
   It takes the publisher in `__init__`; it constructs no Redis client of its own.
2. One `GatewayUsage` field with a value becomes one component; a `None` field becomes no
   component. Leave `cost_musd` unset on every component: `GatewayUsage.cost` is a float of
   undeclared unit that nothing in production sets, and rounding it into an integer
   micro-dollar field would destroy the precision reconciliation needs. Open-design item 18
   holds the question, and its answer needs an envelope field this wave does not add.
3. Swallow every failure: log with `measurement_id` and return. The sink is called from a
   relay that has already succeeded.
4. Assert the three conversions from the specification's mapping table by value in a test:
   the `.value` on the plane, the `str()` on the endpoint id, and the grouped `references`.
   Each is a silent corruption rather than an error if it is wrong, and the first of them
   breaks restricted-credit selection downstream.
5. Unit tests per the evidence list.
6. Add `test_measurements_ingress_integration.py` so a sink-produced command reaches a
   persisted row through the real worker. A new file, not an edit to the existing module:
   `WP-2-02` is changing that module's vocabulary in a parallel worktree off the same seed.

## Close

1. `ruff format` then `ruff check --fix` under `api/` on both branches.
2. Run `oss/tests/pytest/unit/gateways`, `oss/tests/pytest/integration/gateways`,
   `ee/tests/pytest/unit`, and the measurement integration suite. Record the counts.
3. Confirm the diff contains no price, no admission call, and no composition-root edit.
4. Hand `IM-2-01` the drain finding, the per-protocol normalisation table as implemented, and
   the namespace-to-origin mapping as implemented.
