# WP-2-01 specification: the real measurement producer

## Boundary and ownership

Fork from `IM-2-00`. This package makes a real gateway call produce a real measurement. It
owns the gateway's usage capture and the EE sink that turns one usage hand-off into one
`MeasurementCommandV1` on `streams:measurements`. It owns no price, no admission, and no
composition-root edit.

It replaces the wallet-owned fakes under `api/ee/tests/pytest/acceptance/wallets/fakes/` as the
production producer. It does not delete them — `CU-2-01` does, once the replacement is proven.

Three facts `seams.md` says the gateway must carry from its first day are this package's real
subject, because none of them can be added retroactively: the principal including the run, the
credential origin, and the raw measurement with cache reads separate from fresh input.

## Do and do not

| Do | Do not |
| --- | --- |
| Call the usage sink from `GatewayPolicyService.record`, the one place that already receives everything a measurement needs. | Call it from the adapter, the proxy, or `_drain_and_record` directly. One sink, one call site. |
| Prove the non-streaming path records at all before building on it. | Assume it does. See "The drain" below; the unit test that covers it drains the body in a way the proxy does not. |
| Normalise each protocol's token accounting into the one vocabulary. | Store the provider's spelling and normalise later. The rate card cannot re-derive a split that was never carried. |
| Emit a measurement for every dispatched relay, charged or not. | Suppress the emission for a customer-funded call. Measure before you bill; the charge decision is `WP-2-02`'s. |
| Leave a refusal to the audit event. | Emit a measurement for a call that never reached a provider. `WP-2-00`'s gating condition in `record` is what keeps a permission denial, an admission refusal and `list_models` out of the measurement stream. |
| Swallow every sink failure, log it, and return. | Let a measurement failure change a relay's result. Invariant 2. |
| Stamp `SecretOrigin.LOCAL` on a `builtin` outcome. | Touch `_resolve_provider_key`. See "Who paid" below: `builtin` resolves no secret at all, and the resolver only ever sees the customer's. |

## The drain

`LLMGatewayService._drain_and_record` records in a `finally` after the body generator
terminates, which is correct for the streaming path because Starlette iterates a
`StreamingResponse` to exhaustion. The non-streaming path in `LLMGatewayProxy._relay` calls
`anext(result.body)` once and never closes or exhausts the generator, and
`RelayLLMAdapter._single_chunk_body` sets `result.usage` on the statement *after* its `yield`.
The unit test that covers this drains with a comprehension, which the proxy does not do.

**The first task in this package is a test at the proxy level, not the service level, that
asserts `policy.record` is called with a populated `usage` on a non-streaming relay.** If it
passes, say so and move on. If it fails, that is the defect this whole wave rests on, and
fixing it comes before anything else here.

## Who paid

`secret_origin` is the stamp every charge decision reads, and it is not currently producible
where it is needed.

`_ResolvedLlmTarget.secret_ref()` returns a reference only for the `standard` namespace. A
`builtin` target sets no `secret_id`, so the resolver is never called, `secret` is `None`, and
`_outcome_from` leaves `origin` as `None`. The resolver's two production call sites both stamp
`VAULT`, and both of them are on the customer's own credential — which is correct, and is
exactly why `SecretOrigin.LOCAL` has no producer today.

So the stamp does not belong in the resolver. **It belongs in `_outcome_from`, which knows the
target.** The payer is a property of the namespace, not of whether a secret happened to be
looked up: a `builtin` target is one whose account we own, per D30, and that is true whether it
resolved a platform key, an ambient credential, or nothing at all. `_outcome_from` sets
`origin=SecretOrigin.LOCAL` for a `builtin` target, and otherwise carries the resolved secret's
origin as it does today.

Without this, `WP-2-02`'s charge predicate is unsatisfiable and Wave 2 bills nothing. It is the
single highest-risk line in the wave, which is why `IM-2-01` checks it by name.

## Files

On `feat/add-gateways`:

| File | New or edited |
| --- | --- |
| `api/oss/src/core/gateways/llms/providers/passthrough/adapter.py` | edited — `_usage_from_payload` gains the cache split for all three protocols |
| `api/oss/src/core/gateways/llms/service.py` | edited — populate `target.provider` and `outcome.duration_ms`; stamp `SecretOrigin.LOCAL` on a `builtin` outcome in `_outcome_from`; thread `GatewayCallContext` and pass it to `policy.record` |
| `api/oss/src/apis/fastapi/gateways/llms/proxy.py` | edited — mint `request_id`, read `request.state.gateway_run_id`, build `GatewayCallContext`; drain fix if the test above fails |
| `api/oss/src/core/gateways/policy/service.py` | edited — `__init__` takes a `UsageSinkInterface`, defaulting to `NullUsageSink`; `record` calls it |
| `api/oss/src/core/gateways/policy/audit.py` | edited — the audit event carries usage, which it currently drops |
| `api/oss/tests/pytest/unit/gateways/test_gateways_llm_relay_adapter.py` | edited |
| `api/oss/tests/pytest/unit/gateways/test_gateways_policy_audit.py` | edited |
| `api/oss/tests/pytest/unit/gateways/test_gateways_usage_capture.py` | new — the proxy-level drain test and the per-protocol normalisation table |

On `feat/add-wallets`:

| File | New or edited |
| --- | --- |
| `api/ee/src/core/measurements/ingress.py` | edited — `MeasurementUsageSink.record` gets its body |
| `api/ee/tests/pytest/unit/measurements/test_measurements_ingress.py` | new |
| `api/ee/tests/pytest/integration/measurements/test_measurements_integration.py` | edited — a sink-produced command travels the existing chain |

## Interfaces

Verbatim; do not rename. The normalisation rule, which is the part that is easy to get subtly
wrong and impossible to fix later:

```python
# Chat Completions (OpenAI): `usage.prompt_tokens` INCLUDES the cached slice, reported under
# `usage.prompt_tokens_details.cached_tokens`. Fresh input is the difference.
#   cache_read_tokens = prompt_tokens_details.cached_tokens
#   input_tokens      = prompt_tokens - cache_read_tokens
#
# Messages (Anthropic): `usage.input_tokens` EXCLUDES both cached slices, which arrive as
# `cache_read_input_tokens` and `cache_creation_input_tokens`. Fresh input is already fresh.
#   cache_read_tokens  = cache_read_input_tokens
#   cache_write_tokens = cache_creation_input_tokens
#   input_tokens       = input_tokens
#
# Responses (OpenAI): as Chat Completions, under `usage.input_tokens_details.cached_tokens`.
#
# In every case `input_tokens + cache_read_tokens + cache_write_tokens` is the prompt, and a
# field the upstream did not report stays None rather than becoming 0. None means unknowable,
# which `LLMRelayResult` already says in as many words; 0 means measured as nothing.
```

The mapping the EE sink applies, which is the seam's whole payload:

| `MeasurementCommandV1` field | Source |
| --- | --- |
| `measurement_id` | `f"msr_{context.request_id}"` |
| `request_id` | `context.request_id` |
| `organization_id`, `project_id`, `user_id` | `scope` |
| `agent_id` | `None` — the LLM plane has no agent identity, and inventing one here would be a guess |
| `gateway_kind` | `target.plane.value` |
| `resource_key` | `f"{target.plane.value}:{target.provider}:{target.model}"` |
| `resource_locator` | `{"provider": target.provider, "model": target.model, "endpoint_id": str(target.endpoint_id)}` |
| `endpoint_id` | `str(target.endpoint_id)` |
| `endpoint_kind` | `target.namespace` — `builtin`, `standard` or `custom` |
| `secret_origin` | `outcome.origin` |
| `start_time`, `end_time` | derived from `outcome.duration_ms` and the emission instant |
| `components` | one per non-`None` `GatewayUsage` field, keyed from `components.py` |
| `references` | `{"workflow": {"gateway_run_id": context.run_id}}` when there is a run, and `{"admission": {"ceiling_musd": admission.ceiling_musd}}` when there is an admission |

Three conversions are load-bearing and easy to get wrong.

`target.plane` is a `str`-mixin enum, and since Python 3.11 an f-string renders it as
`GatewayPlane.LLM`, not `llm`. `resource_key` must use `.value`. This is not cosmetic:
`is_resource_eligible` in `ee/src/core/wallets/types.py` prefix-matches `resource_key` to
decide whether a restricted credit may fund a posting, so the wrong string silently breaks
restricted-credit selection rather than looking wrong.

`GatewayTarget.endpoint_id` is a `UUID` and `MeasurementCommandV1.endpoint_id` is a `str`.
Pydantic rejects the one for the other; `entities.md`'s worked example carries an opaque
string.

`references` is a map of grouped objects in `entities.md` and in the Wave 1 builders, not a
flat bag of keys. The run goes under `workflow`, the ceiling under `admission`, and neither is
invented at the top level.

`endpoint_kind` carries the gateway's own namespace rather than the Wave 1 fixture's invented
`"managed"`. D30 put the billing boundary on the namespace on purpose — "metering attaches to
`builtin` alone" — so the field that decides chargeability should hold the value that decision
is written in.

## Required evidence

Gateway branch: the proxy-level drain test named above; a parametrised normalisation test with
one real usage payload per protocol, including one with a cached slice and one with none; a
test that `record` still returns normally when the sink raises; a test that
`SecretOrigin.LOCAL` is produced for a platform-owned key and `VAULT` for a customer's.

Wallet branch: unit tests that one `record` call produces exactly one command with the mapping
above, asserting the three conversions by value rather than by construction — `resource_key`
is `"llm:openai:gpt-4o"` and not `"GatewayPlane.LLM:openai:gpt-4o"`, `endpoint_id` is a
string, and `references` is grouped. That a `None` usage field produces no component rather
than a zero one. That the sink returns rather than raises when the publish fails. And an
integration test that a sink-produced command travels the existing measurement chain to a
persisted row.

## Explicit exclusions

No rate, no charge, no admission call, no `routers.py` edit, no `worker_streams.py` edit, no
migration, no MCP plane work beyond leaving it possible, and no deletion of the Wave 1 fakes.
