# Audit Logs: Gap Analysis

## Core Gaps

### 1. Access Control

The main missing backend contract for this PR is not querying. It is correct authorization.

Missing:

- a dedicated EE entitlement flag named `events`
- a dedicated EE permission `Permission.VIEW_EVENTS`
- backend authorization on `/events/query` that checks `VIEW_EVENTS` instead of `VIEW_SPANS`
- role defaults that make this visible only to owners and admins

The intended rule is:

- entitlement gates feature availability by plan
- permission gates which users in the project can access it

### 2. Frontend Integration

The project settings surface exists, but audit logs are not integrated into it yet.

Missing:

- an `Audit Logs` tab in project settings
- an `Audit Logs` sidebar item
- route gating and tab gating using both entitlement and permission
- a page/component that fetches and renders raw events
- loading, empty, and access-denied states

### 3. Frontend Data Layer

The backend event query route already exists and already supports windowing.

Missing:

- a typed web client for `/events/query`
- query state for fetching the current event window
- cursor/window state management for pagination

For this PR, no extra filters should be added.

### 4. Security and Data Exposure

This feature intentionally renders raw events, so the main security question is whether the existing payload is safe to expose as-is.

Missing:

- confirmation that raw event fields and `attributes` are acceptable to show in web
- any backend-side redaction needed before exposing those fields directly

This matters because the current event model supports arbitrary `attributes`.

### 5. Product Scope

Some potential gaps are intentionally out of scope for this PR:

- expanding event coverage
- adding normalized audit-log DTOs
- adding actor/action/target filters
- adding org-level audit logs

Those may become later improvements, but they should not expand this implementation.

## Summary

The real gaps for this PR are:

- enterprise plan gating via a new `events` entitlement
- role-based access via `Permission.VIEW_EVENTS`
- switching backend auth away from `VIEW_SPANS`
- project settings integration
- a minimal raw-events presentation layer
- confirmation that the raw payload is safe to expose
