# Proposal

## Why

Many companies talk in Microsoft Teams, not in Slack. Today an Agenta agent can answer in Slack, Telegram and WhatsApp, but a company cannot put the same agent in a Teams chat or a Teams channel.

Teams delivers every event to a bot as an HTTP POST to one URL, which Microsoft calls the messaging endpoint. This is the same transport that Slack, Telegram and WhatsApp use: the ingress route checks the request, stores the event in the inbox, enqueues a turn and answers at once (`api/oss/src/apis/fastapi/channels/ingress.py:660-746`). So Teams needs a new adapter and a new route, and no new long-running process.

Status: Proposal, not built. The design passed design review (simplify and naming lenses both rated Low). Two product questions stay open: where users register the bot (D2) and whether the bot reads all messages in shared places (D8). design.md lists the recommended answer for each.

## What Changes

- Add Microsoft Teams as a Channels platform, next to Slack, Telegram and WhatsApp. A connection is one Teams bot that the user registers in their own Microsoft tenant (one organization's Microsoft 365 account) and connects to one project.
- Setup on the agent page in /m. The user enters three values: the application (client) id, the client secret value and the directory (tenant) id. Agenta asks Microsoft for a token with these values before it stores anything. The screen then shows the messaging endpoint to paste into the bot registration, and a download button for the Teams app package (a zip file that the user uploads to Teams to install the bot).
- A new route `POST /channels/teams/events/` for every Teams bot. It checks the signed token that Teams sends on each request, and it drops events from any tenant other than the connected one.
- In a personal chat the agent answers every message. In a group chat and in a team channel the agent answers when someone mentions the bot. In a team channel the reply goes into the thread of the message that mentioned it.
- While the agent works, Teams shows its typing signal, and after 30 seconds the agent posts the existing working message. There are no streaming edits in v1.
- Tool approvals use an Adaptive Card (Microsoft's JSON format for rich messages) with Approve and Deny buttons. After the answer, the card is replaced with a copy that has no buttons.

## Capabilities

### New Capabilities

- `teams-connection`: The three setup fields, the token check and its error messages, the messaging endpoint, the Teams app package, and disconnect.
- `teams-conversation`: The inbound token check, the tenant check, how activities become inbound events, how Teams places map to Agenta spaces and threads, mentions and commands, ignored events, and duplicates.
- `teams-delivery`: The access token cache, the reply host allowlist, replies and thread replies, typing and the working message, long answers, approval cards, and error mapping.

### Modified Capabilities

None. The shared ingress, inbox, outbox and approval code keep their behavior. The changes in shared files are additions to lists: the adapter registry, the secret kinds, the vault secret fields, the public endpoint list and the platform list in the setup screen.

## Impact

Backend: a new `teams` adapter under `api/oss/src/core/channels/adapters/teams/` (`adapter.py`, `capabilities.py`, `mapping.py`, `signature.py`, `package.py`, and two PNG icons), its registry entry, the route `POST /teams/events/` in the channels ingress, four public endpoint entries in `api/oss/src/middlewares/auth.py`, the secret kind `ChannelSecretKind.TEAMS`, the vault field `client_secret` on `ChannelSecretSettingsDTO`, and `pyjwt[crypto]` as a direct dependency in `api/pyproject.toml` (it is already in `api/uv.lock`).

Frontend: Teams as a fourth platform in `@agenta/settings-ui`, a Teams setup flow on the /m agent page, the messaging endpoint copy field, and the app package download. Docs: a "Connect Microsoft Teams" guide under `docs/docs/guides/`.

No database migration, no new environment variable, and no change to Helm, docker-compose or Railway. No hosted Agenta Teams bot, no files, no history reads through Microsoft Graph, no message edits, deletes or reactions, no native slash commands and no streaming answers in this change.
