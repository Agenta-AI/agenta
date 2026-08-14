# WP4 — tasks

Read [`specs-wp4.md`](specs-wp4.md) first. Branch from C1; no seed dependency.

## audit.py — the attribute builder

- [ ] Read `core/events/utils.py`'s `build_trace_fetched_attributes` /
      `publish_trace_fetched` pair before writing anything. This package copies that shape;
      it does not invent one.
- [ ] `core/gateways/policy/audit.py`: `build_gateway_call_attributes(*, scope, target,
      decision, outcome) -> Dict[str, Any]`. Flat mapping, no nesting.
- [ ] Carry: principal (including `organization_id`), `target.plane`, `namespace`, `name`,
      `endpoint_id`, `model` when present, allowed/denied plus the reason, status code, and
      `secret_origin` when a secret resolved.
- [ ] Carry nothing else. No prompt, no completion, no secret value, no header values.

## service.py — filling the stub

- [ ] Replace `record()`'s body with build + publish. **Do not touch its signature** — every
      relay in wave 1 already calls it, and R4 exists so that this is a body change.
- [ ] Wrap the publish so it cannot raise, the way `_safe_publish` already does. `record()`
      is called on the deny path, where an exception turns a 403 into a 500.

## Tests

- [ ] Unit: one event per relay on both planes, with the right principal, target, decision
      and outcome. Mock publisher; nothing running.
- [ ] Unit: a denied call records one event carrying the reason, and `PolicyDeniedError` is
      still raised afterwards.
- [ ] Unit: a publisher that raises does not propagate — assert the relay's result is
      unchanged, not merely that no exception escaped.
- [ ] Unit: a pass-through call records with `secret_origin` unset, which is what
      distinguishes a call we funded from one the caller did.
- [ ] Unit: the attributes contain no value from the request or response body.
- [ ] `ruff format` && `ruff check --fix` in `api/`; run the API unit tests.
- [ ] Commit: "gateways(policy): emit one audit event per call".

## Definition of done

- Every relay, allowed or denied, on either plane, leaves exactly one event.
- The events are queryable through the existing surface with no new code.
- `record()`'s signature is byte-identical to wave 1's.
