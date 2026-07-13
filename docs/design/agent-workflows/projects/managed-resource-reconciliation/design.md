# Design

## Boundary

The shared abstraction is a managed external resource: something Agenta creates in another system,
which may survive the process that created it and must eventually converge to a requested state.

The kernel owns durable intent and coordination. Controllers own provider behavior.

```text
Product or runtime owner
  -> managed-resource intent
  -> durable store
  -> controller claim
  -> provider operation
  -> observed-state compare-and-set
```

Product records remain the user-facing source of truth. A trigger subscription remains a trigger
subscription. A connection remains a gateway connection. Managed-resource records are internal
realization records linked to those owners.

## Common kernel

The common kernel owns:

- tenant scope;
- owner reference;
- controller key;
- idempotency key;
- specification digest and generation;
- desired state;
- observed state;
- external resource identity;
- optimistic version;
- attempt count and next attempt time;
- bounded safe error;
- claim identity, generation, and expiry;
- lifecycle timestamps.

It never stores plaintext credentials, arbitrary provider responses, user-facing connection
configuration, or provider control-plane credentials.

## Controller boundary

Each controller understands one resource kind and exposes a small port:

```text
plan(owner, generation) -> typed provider plan
observe(record) -> provider observation
apply(plan, observation) -> provider result
destroy(record) -> provider result
```

The first controller is `daytona.secret_bundle.v1`. It remains in the runner because the runner
already owns resolved model credentials, Daytona credentials, sandbox creation, and warm-session
lifecycle.

A later Composio trigger controller can live beside the triggers service and run in an API worker.
The kernel does not require every controller to run in the same process.

## Generic state

Prefer desired and observed state over a universal transition enum.

```text
desired: present | absent
observed: pending | present | absent | unknown | blocked
```

Provider-specific controllers validate their own transition rules. The shared store only enforces
claim fencing, optimistic versions, valid common states, and safe retry scheduling.

This avoids pretending that Daytona Secret provisioning, OAuth connection activation, and trigger
subscription enablement share one detailed state machine.

## PR A process-local seam

PR A defines the Daytona credential plan and provider adapter independently from durable storage.
It uses a process-local allocation record attached to the existing session environment:

```text
DaytonaSecretAllocation {
  sandboxId
  credentialEpochDigest
  resources: [{logicalKey, externalId, externalName}]
}
```

Normal teardown and failed sandbox creation call the same provider cleanup functions PR B will use.
A hard process crash may still orphan resources. The feature stays disabled for production until
PR B removes that limitation.

## PR B durable seam

PR B adds a `ManagedResourcesControl` port. The runner uses an HTTP implementation backed by the
API domain. Tests use an in-memory implementation. The Daytona plan and provider adapter do not
change.

```text
ManagedResourcesControl {
  reserve(intent)
  retrieve(id)
  setDesiredState(id, state, expectedVersion)
  recordObserved(id, result, expectedVersion, claim)
  queryDue(controllerKey, cursor, limit)
  claim(id, owner, ttl)
}
```

The internal API should use one workload-auth dependency or internal router. It should not add
feature-specific path recognition to global authentication middleware. Tenant scope must come from
a typed service-stamped run context or other approved workload identity, not from telemetry fields.

## Reuse cases

1. Daytona Secret and sandbox cleanup.
2. Composio trigger instances and project webhook registrations.
3. Provider-side gateway connection initiation and revocation.
4. Future MCP OAuth registrations or managed gateway allocations.
5. Remote relay endpoints, tunnels, or preview sandboxes if they become persistent provider
   resources.

Only Daytona ships in PR B. The trigger controller is the next recommended adoption and the proof
that the kernel is reusable.

## Guardrails

- Do not create an arbitrary JSON workflow engine.
- Do not put credentials in `attributes` or `metadata`.
- Do not merge product DTOs with realization DTOs.
- Do not use age alone to decide that a resource is orphaned.
- Do not hold a database transaction while calling a provider.
- Claim work, call the provider outside the transaction, then compare-and-set observed state.
- Every provider create/delete operation must be idempotent or reconciled through observe-before-act.
