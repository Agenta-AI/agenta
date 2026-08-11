# Implementation handoff

Date: 2026-08-11

## Outcome

The session UX now separates human-started and automation-started sessions without exposing
private storage keys to frontend callers. Automation rows can show the current schedule or
subscription name, identify the automation kind, and open the exact delivery that created the
session.

The implementation uses the existing session tags and trigger lifecycle columns. It adds no data
migration, backfill, or database index.

## Runtime flow

For each trigger firing, the dispatcher generates one delivery ID and one session ID. A single
Postgres transaction claims the delivery and creates or updates the attributed session. A failed
claim or attribution rolls back both writes and invokes no workflow.

The session stores private attribution values in reserved tags:

```json
{
  "ag.origin": "trigger",
  "ag.trigger.id": "019d952f-0000-0000-0000-000000000000",
  "ag.trigger.kind": "schedule",
  "ag.trigger.delivery_id": "019d952f-0000-0000-0000-000000000001"
}
```

The write merges these keys into the existing tags object. It does not replace user tags and does
not store a trigger-name snapshot or session meta.

## Public contract

`POST /sessions/query` accepts resource-nested predicates, exclusions, optional expansions, and
cursor windowing. It returns typed `origin`, `trigger`, `delivery`, `last_message`, and `windowing`
fields.

The API adapter removes reserved `ag.*` attribution keys from every public session `tags` map.
Frontend code reads typed relationships only.

Message previews and current trigger names are optional expansions:

- Home and Sessions request message previews.
- Automation modes also request current trigger details.
- Sidebar, agent overview, mobile, and internal callers do not request previews.

## History behavior

Normal schedule and subscription deletion now uses lifecycle soft deletion. Normal lists,
mutations, dispatch, and provider lookup remain live-only. Authenticated exact-by-ID reads can
retrieve a deleted configuration for historical display, and delivery history remains available.

Hard deletion of a gateway connection can still cascade through subscription and delivery
history. That broader operation is deferred.

## Frontend behavior

The API returns all origins when no origin predicate is present. Each frontend surface sets its own
policy:

| Surface | Policy | Expansions |
| --- | --- | --- |
| Home human sessions | Exclude trigger | `last_message` |
| Home automation sessions | Trigger only | `last_message`, `trigger` |
| Sessions default mode | Exclude trigger | `last_message` |
| Sessions automation mode | Trigger only | `last_message`, `trigger` |
| Sidebar | Exclude trigger | None |
| Mobile | Preserve its explicit existing policy | None |
| Internal callers | All origins unless specified | None |

Clicking a row still opens the session. Automation rows add `Open automation` and `View delivery`
secondary actions. Exact delivery mode fetches one delivery by ID and does not start the owner-wide
delivery list query.

## Review stack

The implementation is split from `origin/release/v0.112.0` in dependency order:

1. API attribution, lifecycle, query, expansion, and sanitization.
2. Generated Python and TypeScript clients plus their consuming UV lockfiles.
3. Session entity contracts, frontend list policies, row models, actions, and historical drawers.
4. Design record and QA handoff.

See [`qa-handoff.md`](qa-handoff.md) for verification evidence and remaining checks. See
[`plan.md`](plan.md) for the detailed file and behavior map.
