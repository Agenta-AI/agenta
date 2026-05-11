# PR 3372 - Advanced Auth (Multi-Org, Verified Domains, SSO Providers)

Source: https://github.com/Agenta-AI/agenta/pull/3372

## Executive summary

This PR introduces a comprehensive authentication and authorization system centered on
multi-organization support, domain verification, and enterprise SSO (OIDC). It adds new
database schema and migrations, new OSS/EE services and API routes, updated SuperTokens
integration, and a significant frontend rework for auth flows and organization settings.
The PR also ships extensive design documentation and manual test plans.

## Change inventory (organized by area)

### Data model and migrations

- Add organization slug and cleanup migrations to normalize org data and flags.
- Add SSO/OIDC tables and organization-scoped secrets.
- Scope secrets and entities to organizations/projects in both OSS and EE migrations.
- Expand organization metadata and flags used for policy enforcement.

Key files:
- `api/ee/databases/postgres/migrations/core/versions/12d23a8f7dde_add_slug_to_organizations.py`
- `api/ee/databases/postgres/migrations/core/versions/59b85eb7516c_add_sso_oidc_tables.py`
- `api/ee/databases/postgres/migrations/core/versions/a9f3e8b7c5d1_clean_up_organizations.py`
- `api/ee/databases/postgres/migrations/core/versions/c3b2a1d4e5f6_add_secret_org_scope.py`
- `api/oss/databases/postgres/migrations/core/versions/12d23a8f7dde_add_slug_to_organizations.py`
- `api/oss/databases/postgres/migrations/core/versions/59b85eb7516c_add_sso_oidc_tables.py`
- `api/oss/databases/postgres/migrations/core/versions/a9f3e8b7c5d1_clean_up_organizations.py`
- `api/oss/databases/postgres/migrations/core/versions/c3b2a1d4e5f6_add_secret_org_scope.py`

### OSS backend

- New centralized `AuthService` for discovery, policy enforcement, and session identity
  tracking.
- New FastAPI auth endpoints for discovery, access checks, session identity updates,
  and SSO authorization (EE-only).
- New SuperTokens configuration and recipe overrides for dynamic providers and payload
  management.
- New users/identities DAOs and organization/user typed models.
- Updates across services (auth, users, organizations, secrets, caching, env).

Key files:
- `api/oss/src/core/auth/service.py`
- `api/oss/src/apis/fastapi/auth/router.py`
- `api/oss/src/core/auth/supertokens/config.py`
- `api/oss/src/core/auth/supertokens/overrides.py`
- `api/oss/src/dbs/postgres/users/dao.py`
- `api/oss/src/services/auth_service.py`
- `api/oss/src/services/user_service.py`
- `api/oss/src/utils/env.py`

### EE backend

- New organization APIs, models, and DAO layers for domains and providers.
- Expanded organization service logic, admin manager, and workspace manager behavior.
- Organization access control, invitations cleanup, and policy enforcement updates.
- Billing and subscription adjustments to account for org ownership and membership.

Key files:
- `api/ee/src/apis/fastapi/organizations/router.py`
- `api/ee/src/dbs/postgres/organizations/dao.py`
- `api/ee/src/services/organization_service.py`
- `api/ee/src/routers/organization_router.py`
- `api/ee/src/services/commoners.py`

### Frontend (OSS)

- New or updated auth pages: email-first, OTP, social, email/password flows, and callback
  handling changes.
- New organization settings UI, org lists in sidebar, org/project switching UX updates.
- Updated auth/session hooks and API layers to support discovery and access checks.
- New auth upgrade modal and settings page for organization-level policies.

Key files:
- `web/oss/src/pages/auth/[[...path]].tsx`
- `web/oss/src/pages/auth/callback/[[...callback]].tsx`
- `web/oss/src/components/pages/settings/Organization/index.tsx`
- `web/oss/src/components/Sidebar/components/ListOfOrgs.tsx`
- `web/oss/src/components/Sidebar/components/AuthUpgradeModal.tsx`
- `web/oss/src/services/organization/api/index.ts`

### Docs and test assets

- New design documents in `docs/designs/advanced-auth`.
- Manual auth test suites and quick-start guides.
- Updates to self-host docs and env examples.

Key files:
- `docs/designs/advanced-auth/*`
- `api/ee/tests/manual/auth/*`
- `docs/docs/self-host/01-quick-start.mdx`
- `docs/docs/self-host/02-configuration.mdx`
- `hosting/docker-compose/*/env.*.example`

## Behavior and policy changes

- Auth discovery determines available methods per user email and org policy.
- SSO enforcement requires both a verified domain and an active provider.
- Session payloads now accumulate identity proofs for policy checks.
- Organizations can restrict access by method and verified domains, with explicit error
  codes returned to the client when policy checks fail.

## Risks and migration considerations

- Multiple large schema/data migrations touch organizations, secrets, identities, and
  scoping. Migration order and data integrity are critical.
- Auth behavior changes are broad (middleware, session payloads, and routing). Expect
  potential regressions for existing auth flows if configuration is incomplete.
- New environment variables and docker examples need to be reflected in deployment
  tooling and runtime configs.
- EE/OSS boundaries are more explicit; policy differences may surface in shared codepaths.

## Suggested validation

- Follow the manual auth test plans in `api/ee/tests/manual/auth/README.md`.
- Validate discovery + access enforcement for mixed org memberships.
- Verify domain verification and SSO login in EE with at least one provider.
- Check org switching and settings UI for upgrade prompts and policy enforcement.
