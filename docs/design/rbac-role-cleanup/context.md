# Context: RBAC Role Cleanup and API Key Access Tightening

## Problem Statement

We want to clean up access control across the product by:

- redefining the role model with minimal churn
- redefining the permission matrix for those roles
- limiting API key management to higher-level roles
- making the change visible in all user-facing and code-facing surfaces

The requested rename set is:

- `editor` -> `admin`
- `deployment_manager` -> `manager`
- `analyst` -> `developer`
- `viewer` stays `viewer` (previously misnamed `auditor` in early drafts)

## Explicit Objectives

- Limit API key access to higher-level roles: `owner`, `admin`, `manager`
- Expose frontend authorization helpers that mirror the target model:
  - organization-scoped entitlement checks such as `useOrganizationEntitlements()`, `hasEntitlement()`, and `hasPlan()`
  - project-scoped permission checks such as `hasPermission()` against the current member role/permissions
- Apply the change consistently in:
  - interfaces: web, API
  - code: enums, literals, checks, conditions, helpers
  - database: schema usage and persisted role data

## Important Clarification

The user clarified that API key use does not need its own permission. For this design:

- `owner`, `admin`, and `manager` should have both `view_api_keys` and `edit_api_keys`
- `developer`, `annotator`, and `viewer` should have neither `view_api_keys` nor `edit_api_keys`
- API keys that belong to users whose post-migration role is `developer`, `annotator`, or `viewer` should be deleted during migration
- `view_api_keys` and `edit_api_keys` remain the relevant API key permissions
- "use" is treated as derived behavior from who can create/manage keys, not as a new permission such as `use_api_keys`

## Current Scope

This work touches at least:

- EE RBAC source of truth in `api/ee/src/models/shared_models.py`
- EE RBAC evaluation in `api/ee/src/utils/permissions.py`
- role persistence in `workspace_members`, `project_members`, and `project_invitations`
- workspace/project membership sync code in `api/ee/src/services/db_manager_ee.py`
- API key CRUD routes in `api/oss/src/routers/api_key_router.py`
- frontend settings and member-management UI in `web/oss/src/components/pages/settings/*`
- test tooling and markers in `api/run-tests.py`, `api/pytest.ini`, and `web/tests/*`

## Confirmed Decisions

- The steady-state role set is:
  - `owner`
  - `admin`
  - `manager`
  - `developer`
  - `annotator`
  - `viewer`
- `workspace_admin` is retired and mapped to `admin`.

## Non-Goals

- redesigning billing or entitlements
- redesigning organization-level `owner/member` semantics in `organization_members`
- creating a brand-new permission model from scratch
- introducing a new `use_api_keys` permission

## Scope Note

- Apply the role, migration, and frontend changes in all environments: OSS, EE, RBAC on, and RBAC off.
- Under the current runtime model, the access-control effect will only materially change behavior in EE when RBAC is enabled.
