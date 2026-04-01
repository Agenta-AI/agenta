# Context

## Background

Agenta supports webhook automations that fire when events occur (e.g., a configuration is deployed). Users configure a destination URL, authentication, and event types. The backend delivers events via a Redis Streams -> dispatcher -> TaskIQ pipeline.

## The Problem

The current flow is:

1. User creates an automation in the drawer
2. Backend saves it with `is_valid=false` -- the dispatcher **hard-gates** on this flag and will not deliver real events
3. Automation appears in the table with a "Test pending" tag
4. User must discover they need to click "Test" in the table
5. If test succeeds, `is_valid` flips to `true` and events start flowing
6. If the user later edits **anything** (even renaming), `is_valid` resets to `false` and the automation stops working until re-tested

Users don't discover step 4. They create an automation, deploy something, nothing happens, and they don't know why.

## Goals

- **Create = active.** A newly created automation should immediately receive events.
- **Edit doesn't break things.** Renaming or changing event types shouldn't invalidate a working automation.
- **Testing is diagnostic, not a gate.** Users can test anytime to verify their setup, but it doesn't block event delivery.
- **Immediate feedback.** After creating or saving, the user gets a ping result so they know if their config works.
- **Test before save (Checkpoint 2).** Users can test a draft configuration before committing it.

## Non-Goals (for now)

- Delivery log UI (Checkpoint 3, separate effort)
- Retry configuration UI
- Webhook signature verification documentation
- Multi-event-type testing
