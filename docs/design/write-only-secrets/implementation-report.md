# Write-only and managed secrets implementation report

Date: 2026-08-22

## Outcome

The five-PR feature stack now implements the decisions in `review.md` without a database
migration or feature flag. The backend stack is rooted in `release/v0.114.0` and uses immediate
dependency bases. The frontend PR is stacked on the provider-probe PR, so its diff contains only
the generated clients, frontend consumers, and the implementation/QA reports.

The implementation deliberately did not touch the parallel pi-traces branches, runner code, or
generated session/trace contracts.

Each PR was also rebuilt and validated as an independent layer. A late standalone #6164 CI run
caught managed-secret imports that had accidentally landed below #6165. The six shared Vault files
were split at the real ownership boundary: #6164 now has no managed-secret import, field, storage,
or guard, and #6165 introduces that complete contract. The final combined behavior is unchanged.

## Changes by PR

### #6164: write-only secret contract

- Restored the Vault list cache with its existing namespace, TTL, invalidation, and shortened UUID
  packing.
- Cached canonical trusted DTOs and applied grant-aware redaction after every cache read.
- Made `write_only` a creation-time policy. Updates cannot change it; omitted legacy storage
  values remain readable.
- Replaced `has_key` and `key_preview` with the general `value_status.configured` and
  `value_status.preview` response.
- Separated create, update, trusted internal response, and public response DTO roles.
- Kept update carry-over and policy resolution in a pure service resolver invoked against the
  DAO's locked current row.
- Centralized and allowlisted the `secret-resolve` grant.
- Preserved the provider-specific standalone environment fallback.
- Kept SSO and webhook secrets explicitly readable with `write_only=False`.
- Removed the admin-key fallback. `AGENTA_SERVICES_INTERNAL_KEY` is the only accepted internal
  proof, and the API now fails startup when it is missing or still `replace-me`.
- Updated Docker Compose, Helm, Railway templates, examples, and design documentation. The key is
  provided only to the API and trusted services, never runners or sandboxes.

### #6165: managed-secret model

- Added typed internal `SecretManager`, public `SecretManagementPolicy`, and structured
  `SecretManagementDTO`.
- Stored `management` in the existing encrypted JSON payload. Existing rows remain unmanaged;
  no schema migration is needed.
- Exposed only `management.policy` publicly. The backend component identity does not cross the
  API boundary.
- Removed management fields from public create/update DTOs.
- Added `create_managed_secret` as the typed internal creation boundary.
- Removed the universal `allow_managed` bypass.
- Enforced managed update/delete rejection against the current row under the DAO transaction lock.
- Kept management and write-only visibility independent.

### #6138: starter-credit seeded secret

- Creates the seeded connection through `create_managed_secret`.
- Chooses `manager=starter-credits-bridge`, `policy=manager_only`, and `write_only=True`
  explicitly.
- Separates internal proxy-origin metadata from user-facing copy.
- Refuses to mint or seed when the dedicated internal key is unusable.
- Uses Vault service-level invalidation, so internal creation invalidates the same list cache as a
  public mutation.

### #6195: provider probe

- Rejects any stored secret carrying management metadata before credentials are inspected, merged
  with overrides, or sent outbound.
- Ordinary user-owned stored-secret probes continue to work.
- Added a regression test proving a managed credential cannot be redirected through a
  caller-supplied URL.

### #6174: generated frontend contract and UX

- Regenerated Fern from the final EE OpenAPI contract for Python and TypeScript.
- Replaced handwritten response intersections with `PublicSecretResponseDto`.
- Reads credential presence and preview from `value_status`.
- Reads management behavior from the exact generated `manager_only` policy, never an internal
  component-name string.
- Uses the Fern secrets client for `POST /providers/probe`, with independent Zod validation kept
  at the frontend boundary.
- Hides manager-only connections from Settings and edit drawers, while retaining them in the
  shared connection atom, agent defaults, key gating, and model picker.

## Data and compatibility

- No database migration is introduced.
- Existing rows without `write_only` resolve as readable.
- Existing rows without `management` resolve as unmanaged.
- SSO and webhook value behavior is unchanged.
- Cache key formatting, TTL, and invalidation namespace are unchanged.
- Redis may hold canonical decrypted DTOs inside the trusted backend boundary, as approved.

## Verification

Local automated verification passed:

- 2,635 OSS API unit tests from an isolated #6164 checkout (73 Postgres/live-key tests skipped).
- 3,005 combined OSS and EE API unit tests from an isolated final-stack checkout (73 Postgres/live-key tests skipped).
- 233 focused API tests covering secrets, grants, middleware, provider probe, SSO/webhook
  behavior, and starter-credit seeding/client behavior.
- Standalone boundary checks after the split: 55 write-only tests on #6164 alone, 65
  write-only plus managed tests on #6165, 77 starter-credit tests on #6138, and 93
  provider-probe tests on #6195.
- 4 services tests covering credential exchange and secret mapping.
- 89 SDK tests covering write-only resolution and provider-specific environment fallback.
- 292 focused frontend unit tests across entities, entity UI, chat projection, and the OSS exhaustion flow.
- TypeScript type checks for `@agenta/entities`, `@agenta/entity-ui`, and
  `@agenta/settings-ui`.
- Generated TypeScript client build.
- Generated Python client imports.
- Required frontend `pnpm lint-fix`.
- Scoped Ruff formatting and linting.
- Static Compose, Helm, and Railway template checks completed during implementation.
- The CI-only unknown-grant regression is covered: malformed grant claims now flow through the
  existing invalid-token handler and remain HTTP 401 instead of being wrapped as HTTP 500.

Railway live checks were not run because Railway is unavailable. They remain a release-QA item.

## Accepted boundary and follow-up

A short-lived granted Secret token reaches the runner because the runner must resolve secrets for
the authorized workload. The dedicated internal key does not reach the runner or sandbox. The
current grant is project-wide; future per-secret permissions can add resource scope to the same
grant model without changing the first release.
