# PR: Data Retention

## Summary
- Add plan-based trace retention windows.
- Add tracing retention DAO/service and admin endpoint to flush old spans.
- Add cron entry to trigger retention runs.

## Scope
- EE tracing retention (plans and billing endpoint).
- Core/OSS migrations for retention-related indexes.
- UI exposure of retention settings.
