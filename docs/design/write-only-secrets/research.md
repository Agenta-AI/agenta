# Research

## Current implementation

- #6164 currently removes the Vault list cache, supports changing `write_only` during update, returns `has_key` and `key_preview`, and uses one DTO inheritance tree for create, update, trusted reads, and public responses.
- The current update resolver mutates the caller's DTO. The Postgres DAO owns part of the `write_only` policy while it also owns the row lock.
- The runtime proof uses `X-Agenta-Runtime-Key`. The dedicated configuration exists, but documentation and failure behavior still need a complete source walk.
- SSO and webhook paths have dedicated readable-secret behavior. Every creation path still needs an explicit-policy audit.
- #6165 stores a free-form `managed_by` string in encrypted JSON. Public request DTOs structurally accept it, routes reject it, and `allow_managed=True` bypasses ownership checks.
- #6165 derives `write_only=True` from management, although the two policies have different owners and lifecycles.
- #6138 uses one string marker for bridge identity and creates the starter-credit row with both management and write-only behavior.
- #6174 hand-maintains backend response fields around the generated Fern type.
- #6195 can load a stored plaintext credential and merge it with caller-supplied provider configuration. It needs a managed-secret guard before outbound probing.

## Storage compatibility

`write_only` already lives inside encrypted JSON. Structured management can also live there under `management`. Rows without either field map to readable and unmanaged defaults. This keeps the production change compatible without a schema migration.

## Interface classification

- Secret value fields are credential data.
- `write_only` is value-visibility policy selected at resource creation.
- `management.manager` is internal lifecycle ownership metadata.
- `management.policy` is user-mutation policy.
- `value_status` is public response metadata derived from the trusted value.
- Runtime grants are authorization policy carried in signed protocol context.

These roles remain separate in the final models. The frontend receives public policy and status, not the internal manager identifier.

## Workspace state

The secrets lanes were rebased locally by another agent after the last push. Their local tips differ from the remote PR heads and require force-with-lease updates after implementation. The shared workspace also contains unrelated pi-traces work, website work, hooks, and other lanes. Only secrets-owned changes may enter these PRs.
