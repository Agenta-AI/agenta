# Context

This workspace coordinates the production hardening of write-only and platform-managed Vault secrets. The implementation spans five open pull requests: #6164 defines value visibility and runtime resolution, #6165 defines platform management, #6138 creates the starter-credit connection, #6174 consumes the public contract in the web app, and #6195 probes stored provider credentials.

## Goal

Ship the approved review decisions without a database migration or feature flag. Preserve existing readable SSO and webhook secrets, batch-resolution performance, standalone provider environment fallback, and the current cache-key packing.

## System boundaries

- The Vault service stores the trusted plaintext representation in encrypted JSON and exposes caller-specific projections.
- Trusted platform services may resolve write-only values through a short-lived signed grant and a dedicated internal-service key.
- Ordinary API and frontend consumers receive public status and management policy, never an internal component identity or a write-only value.
- The starter-credit bridge creates one platform-managed, write-only provider connection.
- The provider probe may spend a stored user-managed credential, but it must not spend a platform-managed credential on a caller-selected endpoint.

## Constraints

- No database migration.
- No new feature flag.
- Redis remains inside the trusted backend boundary and may cache canonical plaintext DTOs.
- `write_only` is immutable after creation.
- Management ownership and value visibility are independent policies.
- The existing 12-character cache-key UUID packing stays unchanged.
- Railway-dependent validation is recorded as deferred while Railway is unavailable.
- The active pi-traces work owns `services/runner/**`; this project does not touch those files.

## Pull request order

The dependency chain is `release/v0.114.0` to #6164 to #6165 to #6138 to #6195 to #6174. Each PR uses the preceding branch as its immediate GitHub base so every diff remains reviewable. The backend and frontend deploy together in one release.
