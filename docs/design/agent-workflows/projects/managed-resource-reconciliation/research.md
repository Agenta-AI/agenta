# Research

## Existing foundations

Agenta's standard new-domain layering is Router -> Service -> DAO interface -> Postgres DAO. The
composition root wires concrete implementations. Provider-specific behavior in
`api/oss/src/core/gateway/connections/` already uses adapters and a registry. The proposed design
should reuse both patterns.

Session ownership and evaluation job locks provide useful TTL and fencing examples, but they solve
ephemeral coordination rather than durable external-resource cleanup. TaskIQ and Redis streams can
wake reconcilers, while Postgres remains the authority for due work and observed state.

References:

- `api/AGENTS.md`
- `api/oss/src/core/gateway/connections/`
- `api/oss/src/core/sessions/streams/service.py`
- `api/oss/src/dbs/redis/sessions/locks.py`
- `api/oss/src/core/evaluations/runtime/locks.py`
- `api/entrypoints/worker_queues.py`

## Confirmed second use case

Trigger subscription creation mints a Composio trigger instance before the local database write.
If persistence fails, the provider resource can remain orphaned. Deletion logs some provider
failures and proceeds with local deletion, which can erase the durable knowledge needed to retry
cleanup.

References:

- `api/oss/src/core/triggers/service.py`
- `api/oss/src/core/triggers/providers/composio/adapter.py`

Gateway connections have the same failure class. Provider initiation happens before persistence,
and provider revocation is best effort before local deletion. The product-level connection should
remain in `gateway_connections`; managed resources can later realize its provider lifecycle.

## Concepts that remain separate

- Future MCP authorization relationships belong in `gateway_connections`.
- Outbound webhooks are local subscriptions plus delivery jobs, not external allocations.
- Evaluation reconciliation derives internal graph state.
- Session affinity and job locks should not move into this domain.
- Events are analytics records, not a transactional outbox or saga system.

## Assessment of #5242

The current lease code has reusable mechanics: idempotency, optimistic versions, retry times,
generation-fenced claims, immutable cursors, and safe errors. Its schema is still Daytona-specific:
provider `daytona`; owners run/session; consumers model/HTTP MCP; environment/header bindings; and
columns for sandbox identity, credential epochs, allowed hosts, and provider Secret names.

Migration 011 is unmerged and has no production data. Replace it before merge rather than shipping
a specialized schema and adding a rename migration immediately afterward.

## Conclusion

No generic durable external-resource reconciler exists in Agenta today. Build a small
`managed_resources` domain. Product records remain authoritative, and provider controllers realize
their desired external state through the kernel. Daytona is the first controller. Composio trigger
subscriptions are the strongest later adopter.
