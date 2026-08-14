# WP4 — Audit events

**Owns:** `core/gateways/policy/service.py::record`, and a new `core/gateways/policy/audit.py`.
**Depends on:** Checkpoint A only. **Blocks:** nothing. Can start on day one.

One event per gateway call, into the existing events domain (D22). No new table, no new
worker, no new queryable surface.

---

## The seam already exists

R4 shipped `record()` as a no-op that never raises, and **every relay already calls it on
both the allow and the deny branch** — `core/gateways/policy/service.py:74`. This package
fills the body. It changes no call site, which is the whole reason the stub was written
that way.

```python
async def record(self, *, scope, target, decision, outcome) -> None: ...
```

All four arguments are already computed and already typed:

- `scope: AuthScope` — organization, workspace, project, user. The principal.
- `target: GatewayTarget` — plane, namespace, name, `endpoint_id`, and `model` on the LLM
  plane. What was addressed.
- `decision: PolicyDecision` — allowed or not, and the reason when not.
- `outcome: GatewayOutcome` — status code, and the secret's `owner` and `origin` when one
  was resolved. `origin` is what carries spend attribution.

## Follow the domain's own pattern

`core/events/utils.py` already has the shape, several times over: a `build_*_attributes`
function producing a flat attribute mapping, and an `async def publish_*` that emits it.
`build_trace_fetched_attributes` / `publish_trace_fetched` is the closest reader.

Copy that pair. Do not invent a gateway-specific publishing path, a second queue, or a new
event store — D22 is explicit that the audit record is an event, not a table.

## What the attributes must carry

- The principal, from `scope` — including `organization_id`, which is why the gateways read
  `AuthScope` rather than `request.state` (entities.md §9).
- The target: plane, namespace, name, and `model` when present.
- The decision, and the denial reason when denied.
- The outcome: status, and `secret_origin` when a secret was resolved. **`secret_origin` is
  the spend-attribution field** — a call the caller funded through pass-through resolves no
  secret of ours, and its absence is the record of that.
- No prompt, no completion, no secret value, no `X-AG-Credentials`. The observability rule
  is the platform's existing one and this package does not relax it.

## Contracts

- **`record()` never raises.** It is called on the failure path, where an exception would
  turn a clean 403 into a 500. Wrap the publish the way `_safe_publish` already does.
- **One event per call**, on the allow path and the deny path alike. A refused call is the
  one most worth having a record of.
- **Both planes.** The LLM and MCP services call the same method; the event distinguishes
  them by `target.plane`, not by having two shapes.
- **Streaming records after the drain.** The LLM service records usage after the response
  body is fully consumed, which is already where `record()` is called from — do not move it
  earlier to make the code simpler.

## Tests

- **Unit.** A mock event publisher; assert one event per relay, with the right principal,
  target, decision and outcome, on both planes.
- **Unit.** A denied call records exactly one event, with the reason, and the relay still
  raises `PolicyDeniedError` afterwards.
- **Unit.** A publisher that raises does not propagate — the relay's own result is
  unaffected.
- **Unit.** A pass-through call (no secret resolved) records with `secret_origin` unset.
- **Acceptance, at Checkpoint B.** A run's model and tool calls appear as events with the
  right principal.

## Out of scope

- Usage recording and charging (WP11, WP22) — those are meters, not audit, and they ship
  with billing.
- Any new query surface. The events domain's existing one answers this.
