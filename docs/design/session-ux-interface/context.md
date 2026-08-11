# Context

## User experience

The new Home and Sessions surfaces organize sessions as daily work. They separate sessions started
by a person from sessions started by an automation, show useful row context, and let users reopen a
session.

The initial implementation added the required backend capability in PR #5767 and consumed it in
the frontend package stack beginning with PR #5769. It exposed storage keys, enriched every list
with transcript data, and did not retain the exact delivery relationship needed for historical
inspection. The completed revision replaces those interfaces with typed queries, expansions,
attribution, and row actions.

## Goals

1. Keep every trigger firing as a distinct session.
2. Let the API return all origins unless the caller filters them.
3. Let each frontend surface choose whether to show automation sessions.
4. Expose typed session origin, automation, and delivery relationships.
5. Keep JSONB tags as the initial private storage mechanism.
6. Show the current automation name and its schedule/subscription kind.
7. Keep the primary row action opening the session.
8. Add secondary actions for the automation configuration and exact delivery.
9. Preserve automation configurations and deliveries after deletion.
10. Load message previews only on Home and dedicated Sessions pages.
11. Follow the repository's resource-nested query shape and cursor response conventions.
12. Avoid data migrations and unnecessary database schema changes before production.

## Confirmed product decisions

| Question | Decision |
| --- | --- |
| Which automation name appears? | The current automation name, resolved from the configuration. |
| What does a row click do? | It opens the session. |
| What additional actions exist? | Open automation configuration and view exact delivery. |
| Is automation kind visible? | Yes. The row distinguishes schedule from subscription. |
| Does each firing create a session? | Yes. Each claimed firing receives a fresh session ID. |
| Where are previews shown? | Home and project/agent Sessions pages only. |
| What does an unfiltered API query return? | All origins. Frontends opt into exclusions. |
| What happens after automation deletion? | Normal deletion soft-deletes the configuration and preserves delivery history. Authenticated exact-by-ID reads include the deleted configuration as read-only. |
| Is trigger name snapshotted? | No. Resolve the current name. |
| Does this work use session meta? | No. |

## Storage decision

The first implementation stores stable attribution values in the existing session tags JSONB
column. The storage adapter owns the reserved keys.

```json
{
  "ag.origin": "trigger",
  "ag.trigger.id": "019d952f-0000-0000-0000-000000000000",
  "ag.trigger.kind": "schedule",
  "ag.trigger.delivery_id": "019d952f-0000-0000-0000-000000000001"
}
```

The public response exposes typed fields instead of these keys.

The attribution write merges reserved keys into existing tags. It never replaces the complete
tags object.

## Why meta is not used

PR #5767 used a name snapshot to avoid resolving the automation. The confirmed product behavior
requires the current name instead, so a stored name snapshot would be stale after a rename.

No other field in this scope needs a rich non-queryable document:

- IDs and kind are compact filterable attribution values.
- Delivery details remain on the delivery resource.
- Usage, cost, and models are future typed summaries.
- Generic user tags are a future public tag capability.

Using meta would add a second storage convention without serving a current requirement.

## Public interface boundary

The public interface is hybrid:

- Stable domain concepts use typed fields, such as origin, trigger kind, and delivery ID.
- Generic user labels will use a public tags interface in future work.
- The backend may store typed fields in tags initially.
- Frontends never need to know reserved storage keys.

The API sanitizer removes reserved attribution keys from public `tags` maps. Typed origin, trigger,
and delivery fields remain available. Exact authenticated schedule and subscription reads include
soft-deleted configurations for historical display. Normal lists and mutations remain live-only.

## Deferred risk

Normal automation deletion preserves configuration and delivery history. Hard deletion of a
gateway connection can still cascade through subscriptions and deliveries. That path is outside
the direct automation-deletion scope and remains a deferred history-retention risk.

## Non-goals

- Generic tag editing, filtering, grouping, or facets.
- Work-status implementation.
- Token, cost, or model summaries.
- A provenance table or new attribution columns.
- A workflow-run table.
- Trigger-name snapshots.
- Provider event, run, or trace IDs on session rows.
- Message previews on sidebar, agent overview, mobile, reconciliation, or internal callers.
- Changing duplicate-delivery idempotency.
- Changing the primary row action.
