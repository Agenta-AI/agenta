# API design

This document is the proposed lower-level shape for PR B. Names remain reviewable until the CTO
approves the domain boundary.

## Domain placement

```text
api/oss/src/apis/fastapi/managed_resources/
api/oss/src/core/managed_resources/
api/oss/src/dbs/postgres/managed_resources/
```

Follow the standard Router -> Service -> DAO interface -> Postgres DAO dependency direction.

## Data model

### `managed_resource_sets`

One set represents a controller-owned realization of one product/runtime owner generation.

| Field | Role |
| --- | --- |
| `id` | Internal resource-set identity |
| `project_id` | Tenant scope |
| `owner_kind`, `owner_id` | Product or runtime owner reference |
| `controller_key` | Routes reconciliation to a typed controller |
| `idempotency_key` | Deduplicates reservation attempts |
| `specification_digest` | Detects owner-generation changes without storing secrets |
| `generation` | Monotonic desired generation |
| `desired_state` | `present` or `absent` |
| `observed_state` | `pending`, `present`, `absent`, `unknown`, or `blocked` |
| `version` | Optimistic compare-and-set version |
| `attempt_count`, `next_attempt_at` | Retry scheduling |
| `error_code` | Bounded non-secret error |
| `claim_id`, `claim_owner`, `claim_generation`, `claim_expires_at` | Fenced worker claim |
| timestamps | Creation, update, and terminal history |

Unique constraints:

- `(project_id, controller_key, idempotency_key)`;
- stable cursor index `(created_at, id)`;
- due-work index `(controller_key, desired_state, observed_state, next_attempt_at, created_at, id)`.

### `managed_resources`

One row represents one external child resource in a set.

| Field | Role |
| --- | --- |
| `id`, `resource_set_id` | Internal identity and parent |
| `logical_key` | Stable controller-owned key within the set |
| `provider_key`, `resource_kind` | External system and typed resource kind |
| `external_id`, `external_name` | Provider identity needed for observe/delete |
| `observed_state` | Child observation |
| `version` | Child compare-and-set version |
| `safe_attributes` | Optional versioned, controller-validated, non-secret recovery facts |
| timestamps | Lifecycle history |

`safe_attributes` must be a discriminated typed payload for registered resource kinds. It is not an
unrestricted metadata bucket. Daytona Secret rows should not store credential values, headers,
provider responses, or control tokens.

## Internal operations

The initial API surface should be workload-only:

```text
POST  /internal/managed-resources/reserve
GET   /internal/managed-resources/{id}
PATCH /internal/managed-resources/{id}/intent
POST  /internal/managed-resources/query-due
POST  /internal/managed-resources/{id}/claim
PATCH /internal/managed-resources/{id}/observation
```

Exact path naming is less important than keeping the surface internal and avoiding special cases in
global authentication middleware.

Every mutation includes `expected_version`. Observation writes from a worker also include the claim
ID and claim generation. A stale claim or version returns a conflict without changing state.

## Workload identity

PR B must choose one standard internal workload-auth mechanism. The current #5242 approach adds
exact path matching to shared auth middleware and relies on invocation authorization that was
temporarily carried through telemetry context. Do not preserve that coupling.

The preferred contract is:

```text
service-stamped run context {
  tenant scope
  run/session owner
  workload authorization or signed assertion
}
```

The runner uses its workload identity for control-plane access and the signed context for tenant
scope. Provider credentials remain separate from both.

## Reconciler execution

1. Query due sets by `controller_key` and immutable cursor.
2. Atomically claim one set with a new claim generation.
3. Load the current owner generation or typed controller plan.
4. Observe the provider outside a database transaction.
5. Apply the smallest idempotent provider operation.
6. Record child and set observations using version and claim fences.
7. On a retryable failure, record a safe error and bounded backoff.
8. On an invariant violation or ambiguous ownership, mark `blocked` for operator review.

TaskIQ can wake or schedule controllers. Postgres remains the due-work authority so a lost queue
message cannot permanently lose reconciliation.

## Daytona mapping

| Current Daytona field | Proposed location |
| --- | --- |
| session/run owner | resource-set owner reference |
| credential epoch digest | resource-set specification digest |
| Secret provider ID/name | child external ID/name |
| sandbox ID | separate child resource or typed safe attribute |
| allowed host and binding | Daytona controller plan, not universal columns |
| cleanup retry | resource-set retry state |
| janitor claim | generic resource-set claim |

The Daytona controller may store a versioned safe attribute required to verify exact-host metadata.
That payload remains a typed Daytona shape rather than a column required by other controllers.

## Migration policy

Migration `oss000000011_add_agent_secret_leases.py` has not shipped. Replace it before merge. Do
not ship a Daytona schema followed immediately by a production rename migration.

Preview databases that already ran migration 011 should downgrade to 010 and apply the replacement
011. If a shared preview cannot be reset, use a one-off development repair rather than permanent
production compatibility code for unshipped data.
