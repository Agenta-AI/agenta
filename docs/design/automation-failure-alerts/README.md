# Automation Failure Alerts

**Status:** Planning. Nothing is built yet. See [status.md](./status.md).

## Problem in one paragraph

When a scheduled or event automation fails on the server, nobody finds out. The server
records every started run as "dispatched" and never writes the real result back, so the app
shows the run as "Running" forever. No email, webhook or message goes out. A person must open
each run's conversation to see that it failed.

## Goal

The platform (not the agent) emails the automation owner when an automation fails on the
server. The email is correct, is sent once, contains no private data, and does not flood the
inbox.

## Reading order

| File | Answers |
|------|---------|
| [plan.md](./plan.md) | What we build, how it works, the contracts, the delivery phases, the tests. Start here. |
| [research.md](./research.md) | How automations work today, verified in code, with file references. Read when you need the evidence for a design choice. |
| [status.md](./status.md) | Decisions made, open questions, blockers, next steps. The source of truth for progress. |
| [sizing.sql](./sizing.sql) | Read-only queries that measure production volume and failure rate. |

Visual companions (private claude.ai pages, ask the owner for access):

- Automation Alert Journey (interactive diagram of an earlier draft; plan.md is current): https://claude.ai/artifact/13Qag3h2uyGAfcmZU1FKpv
- Automation Runtime Map (today's architecture and failure points): https://claude.ai/artifact/3FkN6HZGpLoBZsaPFQNYhi
- Automation Failure Alerts (proposal and challenges): https://claude.ai/artifact/TmRQvv38jjVZzPpGEiP16g

## Glossary

- **Automation**: the product word for a trigger. In the backend it is either a **schedule**
  (`trigger_schedules`, a UTC cron) or a **subscription** (`trigger_subscriptions`, a Composio
  event such as a new Gmail message).
- **Composio**: the third-party service that watches connected accounts (Gmail, Slack, GitHub)
  and sends Agenta a signed webhook per event. It is used only for event automations.
- **cron container**: a container that runs `supercronic`, which calls the API every minute to
  start due schedules.
- **Delivery**: one row in `trigger_deliveries` for each time an automation fires. It holds the
  run's status and a link to its session.
- **Dispatcher**: `TriggersDispatcher` in the `worker-queues` process. It claims a delivery,
  creates the session and starts the run.
- **Runner**: the service (`services/runner`) that runs the agent in a sandbox and writes the
  run's records.
- **Session / turn**: a session is one conversation. A turn is one run of the agent inside it.
  An automation run starts as one turn; after an approval it continues on a new turn in the
  same session. People can also add their own turns to that session later.
- **Records**: the events a turn produces (`message`, `error`, `done` and others), stored in
  the tracing database.
- **Watchdog**: a loop in the API that closes runs whose runner stopped sending heartbeats.
- **Outcome**: the new `outcome` column on a delivery. It holds the run's real result
  (`succeeded`, `failed`, and so on). The existing `status` column keeps the dispatch stage.
- **Automation monitor**: the new loop in the API that reads run records every 60 seconds,
  writes outcomes, updates alert state and sends emails.
- **Alert state**: one row per automation in the new `trigger_alerts` table: `ok` or
  `failing`, and what the owner was last told.
- **Shadow mode**: a setting that sends every alert email to one internal address instead of
  the real owner, for a beta period.
- **Fingerprint**: a short key for the cause of a failure, used to avoid repeat emails.
