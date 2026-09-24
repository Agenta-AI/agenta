# Proposal

## Why

Agenta keeps every Slack and Telegram message a connected bot sees, and every reply it posts, for as long as the project exists. Nothing ever deletes them. Disconnecting a bot only archives its connection, and the messages stay. Even deleting a channel space from settings leaves its messages in the database, where nothing reads them again. Only deleting the whole project removes them.

That is more than the product needs. Channels uses stored messages for one job: to give the agent the messages posted in a conversation since its last turn. A copy kept forever, of every message in every channel the bot is in, is a privacy liability for us and for customers. It also grows without bound.

Status: Draft for Mahmoud's review. Nothing here is implemented. The implementation plan is in [plan.md](plan.md).

## What Changes

- **Periodic cleanup.** A job runs every hour and deletes stored channel messages older than a retention period. The default period is 30 days. A self-hosting operator can change it, or turn the cleanup off, with one environment variable.
- **Imported history follows the same rules.** Messages copied from a channel's history (the one-time backfill today, and the planned copy of older Slack history when the bot joins) are cleaned up like any other stored message. A copy never imports a message posted before the retention cutoff.
- **Cleanup on disconnect.** When a bot has been disconnected for 7 days, the same job deletes everything it stored for that bot: received messages, the bot's own replies, and its conversation records. Reconnecting within the 7 days restores the bot exactly as it was. Reconnecting later restores the bot's settings (its agent, its channels and its rules) but not the old messages, and every conversation starts fresh.
- **Cleanup when a channel space is deleted.** Deleting a space from settings deletes that space's messages right away. Today they become unreachable but stay.
- **Safety rules for the cleanup.** It never deletes a reply that is still being sent or whose delivery is still pending. It never deletes the marker that tells the next turn where the previous turn stopped, so an old quiet conversation does not suddenly receive a flood of messages. It deletes in small batches so it never locks the tables for long.
- **What people see.** The disconnect confirmation and the Channels settings page say how long messages are kept. The exact wording is left to Mahmoud (see decision 6 in [design.md](design.md)).

## Out of scope

The conversation also lives outside Channels. This change does not touch those copies:

- **Agent sessions and their history** (the `records` table in the tracing database). On Agenta Cloud, the existing per-plan retention job already deletes them after 7, 31 or 92 days. Self-hosted deployments keep them.
- **Traces.** Same as sessions: per-plan retention on Agenta Cloud, kept on self-hosted.
- **Queued follow-ups** (`session_inputs`), which hold the composed input of a message sent while a turn was running. No cleanup exists today.
- **The harness's own transcript** inside the sandbox. It goes when the runner deletes the sandbox (30 minutes after it stops, by default).

The disconnect confirmation already promises that "past conversations stay in Agenta". That promise refers to these sessions, and this change keeps it true. A unified retention policy for sessions on self-hosted deployments is a separate change.

## Capabilities

### New Capabilities

- `channel-message-retention`: how long Channels keeps stored messages, what it deletes on a schedule, on disconnect and on space deletion, what it must never delete, and what settings say about it.

### Modified Capabilities

None. The baseline specifications cover Slack installation, routing, reply identity and deployment. None of them promises how long messages are kept.

## Impact

- **API**: a new retention service in `api/oss/src/core/channels/retention.py`, a retention DAO in `api/oss/src/dbs/postgres/channels/retention_dao.py`, an admin route `POST /admin/channels/messages/sweep`, a purge call in the space delete path, and an `oldest` bound on the adapter's `fetch_history` so a history copy stops at the retention cutoff.
- **Database**: one new index on `channel_outbox_events (project_id, connection_id, id)`. No new table, and no column change.
- **Configuration**: two new variables, `AGENTA_CHANNELS_MESSAGE_RETENTION_DAYS` (default 30, `0` keeps messages forever) and `AGENTA_CHANNELS_DISCONNECT_PURGE_DAYS` (default 7).
- **Cron**: a new `api/oss/src/crons/channels.sh` and `channels.txt`, registered in the four API Dockerfiles and the two dev compose files. Railway and Helm use the same image, so they pick it up.
- **Web**: one sentence in the disconnect confirmation and one line in the Channels settings page (`web/packages/agenta-settings-ui/src/channels/`).
- **Docs**: the Channels section of `docs/docs/self-host/reference/01-configuration.mdx`.
- **Interaction with other changes**: PR #7128 (`fix/channels-mention-only-threads`) changes how the next turn finds its starting point. This design protects that starting point in both the old and the new rule. If the `channel-agent-tools` change lands, its `channel_messages` history table must follow the same retention period.
