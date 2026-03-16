# Audit Logs: Research on Current State

## Scope Framing

This work is strictly project-level for now.

The goal of this PR is presentation, not to redesign the backend event system. The intended UI is a thin browser over existing events:

- render raw events returned by the backend
- use existing windowing
- add no extra filters in v1

## Backend: Existing Event Log Infrastructure

The backend already has a project-scoped events stack:

- Router: `api/oss/src/apis/fastapi/events/router.py`
- Models: `api/oss/src/apis/fastapi/events/models.py`
- Service: `api/oss/src/core/events/service.py`
- DTOs: `api/oss/src/core/events/dtos.py`
- DAO: `api/oss/src/dbs/postgres/events/dao.py`
- DBE: `api/oss/src/dbs/postgres/events/dbes.py`
- Mounted route: `POST /events/query` via `api/entrypoints/routers.py`

Current API shape:

- Endpoint: `POST /events/query`
- Request body:
  - `event`
    - `request_id`
    - `request_type`
    - `event_type`
  - `windowing`
- Response body:
  - `count`
  - `events`

Important current behavior:

- Queries are project-scoped through `request.state.project_id`.
- Cursor-style windowing already exists on `timestamp` plus `event_id`.
- The route already returns raw event DTOs, which fits the current presentation-only goal.
- In EE, the route is currently protected by `Permission.VIEW_SPANS`, not by an events-specific permission.

## Backend: Event Coverage

The current event taxonomy is still sparse:

- `environments.revisions.committed`
- `webhooks.subscriptions.tested`

That is a product limitation, but expanding event coverage is out of scope for this PR. For this work, the page should present whatever events already exist.

## Backend: Scoping and Retention

The current events table is project-scoped, which aligns with the intended scope for this feature.

This work should keep existing retention behavior. Audit log retention should remain the same as generic event retention.

## EE Permissions and Entitlements

Two separate mechanisms exist and should remain separate in the design:

- Entitlements:
  - plan-level feature flags in `api/ee/src/core/entitlements/types.py`
- Permissions:
  - role-based permissions in `api/ee/src/models/shared_models.py`

Current state:

- There is no `Permission.VIEW_EVENTS` yet.
- There is no dedicated `events` entitlement flag yet.
- The frontend entitlement helper is coarse and currently exposes fixed plan flags such as `hasRBAC` and `hasHooks`.

Intended gating for this feature:

- require an entitlement flag named `events`
- require a permission `Permission.VIEW_EVENTS`
- production packaging starts at Enterprise
- for dev/test only, the entitlement may temporarily be enabled on Pro and Business
- audience is owners and admins only

## Frontend: Existing Settings Surface

The project settings surface already exists:

- Page routing: `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx`
- Sidebar: `web/oss/src/components/Sidebar/SettingsSidebar.tsx`

There is no Audit Logs tab, no audit-log page component, and no event-fetching state in web yet.

## Frontend: Webhook Delivery Work as Reference Material

Webhook delivery support exists in the backend, including delivery query routes.

PR 3986 also adds useful related reference material:

- draft webhook testing endpoint
- shared delivery request preparation logic
- UI feedback patterns for rendering delivery/test results

This is useful prior art for presentation details, but it is not a webhook delivery history page. The current `Automations` settings UI is still a subscription management surface.

## Summary

What already exists:

- a project-scoped raw events API at `POST /events/query`
- cursor/windowing support
- a project settings page and sidebar where `Audit Logs` can be added
- webhook delivery presentation patterns from PR 3986

What still needs to be added for this feature:

- a new entitlement flag named `events`
- a new permission `Permission.VIEW_EVENTS`
- backend authorization on `/events/query` that uses that permission instead of `VIEW_SPANS`
- project settings tab and page for audit logs
- a minimal web data layer for fetching and paginating raw events
