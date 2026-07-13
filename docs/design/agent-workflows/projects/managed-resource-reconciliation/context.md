# Context

The original PR #5242 combined two decisions: deliver opaque HTTP credentials through exact-host
Daytona Secrets, and persist crash-safe lifecycle state for external resources. The first decision
does not require an API migration and now lives in PR #5277. The second does require a reviewed
control-plane design and is the subject of this plan-only stacked PR.

## Goals

1. Preserve PR #5277 as the functional Daytona isolation layer with no API changes.
2. Keep the lower implementation reusable when durability is added.
3. Design a small managed-external-resource kernel using existing Agenta conventions.
4. Keep product domains such as connections and triggers as their own sources of truth.
5. Keep plaintext credentials and arbitrary provider responses out of the generic control plane.

## Non-goals

- Building a generic workflow engine.
- Replacing gateway connections, trigger subscriptions, webhooks, or session ownership.
- Migrating Composio triggers in the first durability PR.
- Enabling the lower PR in production before orphan recovery exists.
- Implementing the durable API, schema, worker, or controller in this planning PR.

## Success criteria

- PR #5277 contains no API router, migration, auth-middleware change, or durable janitor.
- PR #5277 proves plaintext opaque credentials do not enter Daytona sandbox configuration.
- The approved implementation adds durability without changing PR #5277's credential plan or
  Daytona provider adapter.
- The durable schema uses generic ownership and reconciliation concepts, not Daytona-only columns.
