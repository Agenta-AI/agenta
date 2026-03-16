# Audit Logs: Implementation Plan

## Goal

Add a project-level `Audit Logs` page under settings as a thin presentation layer over the existing events API.

V1 intentionally means:

- raw events
- existing windowing only
- no extra filters
- same retention as generic events

## Phase 1: Add Correct EE Gating

- [ ] Add a new entitlement flag named `events`
- [ ] Enable `events` for production starting at Enterprise
- [ ] Allow temporary Pro/Business enablement only for dev/test if needed
- [ ] Add a new permission `Permission.VIEW_EVENTS`
- [ ] Update role defaults so only owners and admins can view events
- [ ] Change `/events/query` authorization from `Permission.VIEW_SPANS` to `Permission.VIEW_EVENTS`

Required rule:

- entitlement answers whether the plan includes the feature
- permission answers whether the current user may view it

## Phase 2: Keep the Backend Shape Minimal

- [ ] Continue using `POST /events/query`
- [ ] Return raw events as-is
- [ ] Preserve existing cursor/windowing behavior
- [ ] Keep project scope only
- [ ] Keep retention identical to generic event retention
- [ ] Verify whether any event fields need redaction before raw exposure in web

## Phase 3: Add the Web Settings Surface

- [ ] Add an `auditLogs` tab to project settings routing
- [ ] Add an `Audit Logs` item to `SettingsSidebar`
- [ ] Hide the tab unless both entitlement and permission checks pass
- [ ] Add a page/component that renders raw events in timestamp-first order
- [ ] Support pagination using existing windowing only
- [ ] Add loading, empty, and access-denied states

## Phase 4: Frontend Data Layer

- [ ] Add a typed web client for `/events/query`
- [ ] Add query state for fetching the current window of events
- [ ] Keep transformations minimal so the page stays a thin presentation layer

## Phase 5: Testing and Docs

- [ ] API tests for entitlement and permission enforcement
- [ ] API tests for event windowing behavior
- [ ] Web tests for sidebar visibility, route gating, and empty states
- [ ] Document:
  - project-only scope
  - raw-event presentation
  - no-filter v1 behavior
  - Enterprise production packaging
  - dev/test temporary plan overrides if used

## Notes

- Do not broaden this to org-level audit logs in this PR.
- Do not expand this PR into event taxonomy work.
- Do not introduce a normalized audit-log model unless the raw event payload proves unusable.
- Do not rely only on frontend gating; backend authorization must change as well.
- PR 3986 is useful reference material for presentation patterns, but it is not a delivery-history page.
