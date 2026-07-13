# Status

Date: 2026-07-13

## Current state

- Existing API, worker, connections, triggers, webhooks, sessions, mounts, and evaluation patterns
  researched.
- No existing generic durable external-resource reconciler found.
- Composio trigger subscriptions confirmed as a real second consumer.
- PR A opened as #5277 from `feat/daytona-secret-materialization`.
- This plan-only PR B is stacked directly on PR A.
- No production code or existing migration changed in this planning pass.

## Recommended decisions

- Keep #5242 as historical review context rather than merge it unchanged.
- Keep PR #5277 free of API and database changes.
- Keep `AGENTA_DAYTONA_OPAQUE_SECRETS=process_local` disabled in production until durable orphan
  recovery exists.
- Name the general domain `managed_resources` pending CTO review.
- Keep gateway connections and trigger subscriptions as product sources of truth.
- Replace unshipped migration 011 before merge.
- Use a typed workload identity boundary, not telemetry fields or path-specific auth bypasses.

## Decisions still needed

1. Does the team approve managed external resources as the reusable domain?
2. Should the aggregate be named `resource_set`, `realization`, or another term?
3. What standard workload identity should runner and workers use?
4. Does a Daytona sandbox become a child resource or a typed safe attribute of the Secret bundle?
5. Who operates blocked/quarantined resources and what alert opens that workflow?

## Next action

Review this stacked plan before adding implementation. Do not begin the generic API, migration, or
worker work until the CTO approves the domain, workload-auth, ownership, and fencing decisions.
