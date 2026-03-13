# Status

## Current state

Checkpoints 1, 2, and 3 implemented in code. Checkpoint 3 still needs final review/PR creation.

## Checkpoint 1: Remove gate, auto-ping, restore test button

| Task | Status | Notes |
|------|--------|-------|
| 1.1 Remove `is_valid` gate from dispatcher | Completed | Real events now match by event type only. |
| 1.2 Stop forcing `is_valid=False` on create/edit | Completed | Create/edit no longer downgrade active subscriptions. |
| 1.3 Trigger test after create/edit | Completed | Implemented in the drawer via the existing `test` endpoint. |
| 1.4 Restore test button in drawer | Completed | Button is enabled only for persisted subscriptions. |
| 1.5 Remove pending status from table | Completed | Status now shows `Active` instead of `Test pending`. |
| 1.6 Show test feedback after create/edit | Completed | Save flow now follows with a non-fatal test result toast. |

## Checkpoint 2: Test-draft endpoint

| Task | Status | Notes |
|------|--------|-------|
| 2.1 Extract HTTP delivery logic | Completed | Shared request preparation/execution now lives in `core/webhooks/delivery.py`. |
| 2.2 Add `test_draft` service method | Completed | Supports create drafts and edit drafts with existing secrets. |
| 2.3 Add `POST /subscriptions/test-draft` route | Completed | Route registered before param routes to avoid UUID path conflicts. |
| 2.4 Add `testWebhookDraft` API function | Completed | Frontend API client calls the new draft test endpoint. |
| 2.5 Add `testDraftAutomationAtom` | Completed | Drawer uses a dedicated draft test atom. |
| 2.6 Enable test button for drafts in drawer | Completed | Test now uses current form values in both create and edit mode. |

## Checkpoint 3: Delivery logs in the drawer

| Task | Status | Notes |
|------|--------|-------|
| 3.1 Add frontend delivery query client | Completed | `queryWebhookDeliveries` added to the automations API client. |
| 3.2 Add delivery query atom family | Completed | Delivery logs are fetched per subscription via `automationDeliveriesAtomFamily`. |
| 3.3 Build logs tab UI | Completed | Drawer now renders a `Logs` tab for persisted automations. |
| 3.4 Add overview/json log detail views | Completed | Selected deliveries show summary fields plus a raw JSON view. |
| 3.5 Widen drawer layout | Completed | Drawer width increased to accommodate config and log inspection. |

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-13 | Remove `is_valid` as a delivery gate | Industry standard: create = active. Testing is diagnostic. |
| 2026-03-13 | Keep `is_valid` flag in data model | Preserve compatibility while removing it as a delivery gate. |
| 2026-03-13 | Save flow triggers test from the drawer | Reuses the existing polling test endpoint and gives immediate user feedback. |
| 2026-03-13 | Table status stays `Active` in checkpoint 1 | Avoids implying that saved automations are blocked before the log UI exists. |
| 2026-03-13 | Test-draft bypasses event bus entirely | Direct HTTP call via extracted `execute_webhook_request`. No persisted subscription needed. |
| 2026-03-13 | Test button always tests form values | In edit mode, draft testing uses the current form state rather than the persisted subscription. |
| 2026-03-13 | Logs live only on persisted automations | Draft tests are ephemeral, so the drawer exposes logs only after a subscription has been created. |
