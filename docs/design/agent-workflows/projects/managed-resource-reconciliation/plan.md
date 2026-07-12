# Plan

## Stack overview

The implementation is two stacked PRs. PR B uses PR A's materializer and provider adapter without
rewriting them.

## PR A: isolate Daytona credentials without API persistence

Suggested title: `[feat] Deliver opaque credentials through Daytona Secrets`

Base: `big-agents`.

### Include

1. Typed consumer-owned credential contracts in the Python SDK and runner wire.
2. Effective model endpoints and HTTP MCP URLs next to their credentials.
3. Environment/header binding and `opaque_http` usage classification.
4. Exact HTTPS host validation and fail-closed unsupported modes.
5. Daytona Secret planning, deterministic non-sensitive names, create/find/verify/delete adapter.
6. Secret-name attachment to sandbox creation and placeholder materialization for HTTP MCP headers.
7. Process-local allocation records for normal teardown, failed provisioning compensation, and
   warm sessions in the current sidecar process.
8. Credential generation fingerprints so a changed credential replaces the warm sandbox.
9. A feature flag or deployment gate that remains off in production until PR B merges.

### Exclude

- `api/oss/src/**/agent_secret_leases/`;
- migration 011;
- API router composition;
- global auth middleware changes;
- runner control token and HMAC deployment wiring;
- HTTP lease client;
- durable janitor, cursor, claim, and retry code;
- telemetry-based authorization hotfix;
- unrelated approval-event behavior changes.

### Acceptance tests

- Supported model and HTTP MCP credentials become Secret attachments/placeholders.
- Plaintext does not appear in sandbox env, files, command arguments, logs, traces, or persisted
  session state.
- Exact allowed host succeeds; a different host receives no plaintext.
- Invalid host, wildcard, IP, local address, empty value, and unsupported usage fail before sandbox
  creation.
- Secret creation followed by sandbox failure triggers compensation.
- Normal cold and warm teardown delete sandbox and Secrets.
- Local Pi, local Claude, and self-managed auth behavior remain unchanged.
- The production gate defaults off and the PR states the hard-crash orphan limitation.

## PR B: durable managed external-resource reconciliation

Suggested title: `[feat] Reconcile managed external resources durably`

Base: PR A branch.

### Design gate before implementation

The CTO reviews and approves:

1. domain name and scope;
2. generic versus controller-specific fields;
3. workload identity and tenant attestation;
4. database ownership and migration;
5. desired/observed state model;
6. claim and fencing semantics;
7. worker topology and operational ownership.

### Include

1. New `managed_resources` API/core/Postgres domain.
2. Resource-set and child-resource tables.
3. Internal workload-only routes.
4. Optimistic versions, idempotency, immutable pagination, due-work queries, retries, claims, and
   generation fencing.
5. A controller port and in-memory test implementation.
6. A dedicated reconciliation worker path using existing TaskIQ infrastructure for wakeups.
7. Daytona controller integration using PR A's unchanged plan and provider adapter.
8. Crash injection at every provider/database boundary.
9. Production enablement after live Daytona verification and zero leaked resources.

### Exclude

- Migrating gateway connections or trigger subscriptions.
- Public managed-resource CRUD.
- A generic workflow language.
- Arbitrary provider JSON persistence.

### Acceptance tests

- Repeated reservation returns one resource set.
- Stale versions and stale claim generations cannot mutate state.
- Two workers cannot apply the same generation concurrently.
- A crash after each Secret/sandbox/provider step converges on retry.
- Credential generation changes converge old resources to absent before new resources become
  present.
- Queue message loss does not lose due work because Postgres is authoritative.
- Migration upgrade/downgrade works on PostgreSQL.
- Workload auth cannot access unrelated routes or tenant scopes.
- No persisted row, error, or log contains credential plaintext.
- Live QA finishes with the Daytona resource count at baseline.

## Follow-up controller: Composio triggers

After PR B proves the kernel, plan a separate adoption PR:

1. Trigger subscription remains the product source of truth.
2. Desired local subscription state produces a managed-resource intent.
3. The Composio controller creates, observes, enables, disables, or deletes the `ti_*` resource.
4. Local persistence failure can no longer orphan the provider trigger.
5. Provider deletion failure retains a retryable realization record.

This follow-up is the proof of reuse. It is not part of the initial Daytona rollout.

## Recut procedure

1. Freeze new implementation work on #5242.
2. Preserve #5242 as the review record until the new stack exists.
3. Create the lower GitButler lane from `big-agents` using only PR A files and behavior.
4. Verify its diff contains no `api/`, migration, or durable control-plane files.
5. Open PR A and run focused SDK, runner, and live Daytona QA with the production gate off.
6. Create PR B stacked on PR A only after design approval.
7. Replace the unshipped migration instead of adding a rename migration.
8. Close or retarget #5242 after both replacement PRs are visible and cross-linked.

Every branch, commit, and push operation must use GitButler. Do not use a worktree or raw git.

## Review order

For PR A: credential contract -> endpoint and host policy -> Daytona provider adapter -> sandbox
attachment -> cleanup and warm-session behavior -> tests.

For PR B: domain boundary -> data model -> workload identity -> claim/fence rules -> controller
port -> worker loop -> Daytona integration -> failure injection and migration tests.
