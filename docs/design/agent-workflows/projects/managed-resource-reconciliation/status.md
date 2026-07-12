# Status

Date: 2026-07-12

## Current state

- Existing API, worker, connections, triggers, webhooks, sessions, mounts, and evaluation patterns
  researched.
- No existing generic durable external-resource reconciler found.
- Composio trigger subscriptions confirmed as a real second consumer.
- Two-PR recut proposed.
- No production code or existing migration changed in this planning pass.

## Recommended decisions

- Recut #5242 rather than merge it unchanged.
- Keep PR A free of API and database changes.
- Keep PR A disabled for production until durable orphan recovery exists.
- Name the general domain `managed_resources` pending CTO review.
- Keep gateway connections and trigger subscriptions as product sources of truth.
- Replace unshipped migration 011 before merge.
- Use a typed workload identity boundary, not telemetry fields or path-specific auth bypasses.

## Decisions still needed

1. Does the team approve managed external resources as the reusable domain?
2. Should the aggregate be named `resource_set`, `realization`, or another term?
3. What standard workload identity should runner and workers use?
4. Does a Daytona sandbox become a child resource or a typed safe attribute of the Secret bundle?
5. Which deployment gate keeps PR A off in production?
6. Who operates blocked/quarantined resources and what alert opens that workflow?

## Next action

Review this plan on PR #5242. After approval, recut PR A with GitButler. Do not begin the generic API
implementation until the CTO approves the domain and workload-auth decisions.
