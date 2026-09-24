# Tasks

These tasks describe future implementation. All remain unchecked. Mahmoud approved writing the specification and the plan, not the implementation. Each numbered group ships as its own pull request. [plan.md](plan.md) gives the files, tests, and commands for every task.

## 1. Destinations, bot settings, and the list tool

- [ ] 1.1 Add the `tools` settings block to `ChannelAgentData` with the three defaults; verify that a stored bot without the block reads as the defaults and that a partial edit keeps its other fields.
- [ ] 1.2 Add the `channel_people` table, DTOs, and DAO; verify idempotent upsert, name search, and project isolation against PostgreSQL.
- [ ] 1.3 Add Slack adapter methods that list the bot's member channels and the workspace's people; verify paging, the exclusion of group DMs, bots, deactivated users, and Slackbot, and that Telegram reports both as unsupported.
- [ ] 1.4 Add opaque destination IDs; verify that they round-trip and that malformed, foreign-project, and foreign-bot IDs resolve to not found.
- [ ] 1.5 Match the bound run artifact to its bots; verify application, workflow, variant, and revision references, archived connections, and the refusal for two bots on one connection.
- [ ] 1.6 Implement `list_channel_destinations` for Slack and Telegram; verify the setting effects, the Telegram limits, hosted-bot scoping, and the directory cache.
- [ ] 1.7 Add the authenticated tool router and the SDK catalog entry; verify `run_channels`, closed input schemas, hidden bindings, and that no raw provider ID is returned.

## 2. The send tool and the delivery record

- [ ] 2.1 Add `$ctx.tool.call_id` to the runner's direct-call context; verify that it is bound, stable across a retry, and not part of the approval key.
- [ ] 2.2 Make the outbox thread optional and add `space_id` and `origin`; verify turn rows are unchanged and a duplicate tool key returns the existing row.
- [ ] 2.3 Move the claim, post, and receipt steps into `ChannelsService.deliver`; verify the existing outbox worker suite passes unchanged.
- [ ] 2.4 Implement channel sends; verify the setting refusals, the thread check, the retry, the unknown outcome, and a revoked credential.
- [ ] 2.5 Implement person sends with a private session; verify Slack opens the conversation, Telegram reuses the private chat, the source session is untouched, and the next private turn sees the sent text.
- [ ] 2.6 Enable the Slack messages tab in the app manifest; verify the generated manifest.
- [ ] 2.7 Add the send route and the SDK catalog entry; verify the session and tool call bindings are hidden from the model.

## 3. Settings UI

- [ ] 3.1 Regenerate the TypeScript client and add the settings actions; verify that a write sends only the `tools` block.
- [ ] 3.2 Add the Advanced section with the two switches and the readable-channels choice; verify defaults, the disabled direct-message switch, saving a narrowed list, error recovery, and the Telegram help text.
- [ ] 3.3 Update the manage-panel test that forbade an Advanced section and add Storybook states.

## 4. Message history, Slack backfill, and the read tool

- [ ] 4.1 Add the `channel_messages` table, DTOs, and DAO; verify idempotent upsert, edits, deletions, and newest-first paging against PostgreSQL.
- [ ] 4.2 Add history settings to `env.channels.history`; verify the defaults.
- [ ] 4.3 Parse Slack `message_changed` and `message_deleted` into history updates; verify that `parse_event` still drops both.
- [ ] 4.4 Write history from the dispatcher and from sends; verify readable channels only, no direct messages, and the bot's own messages.
- [ ] 4.5 Add paged Slack history with `Retry-After` handling; verify cursors, the `oldest` bound, and the rate-limit error.
- [ ] 4.6 Add the history backfill worker on `queues:channels-history`; verify the bounds, the wait on 429, resuming after restart, and coverage states.
- [ ] 4.7 Queue backfills and cleanups when readability changes; verify both.
- [ ] 4.8 Implement `read_channel_messages` with inline thread fetch, its route, and the SDK catalog entry; verify limits, ordering, refusals, deleted messages, and Telegram coverage.

## 5. Search

- [ ] 5.1 Add the full-text column and index; verify matching, filters, stable cursors, and project isolation against PostgreSQL.
- [ ] 5.2 Implement `search_channel_messages`, its route, and the SDK catalog entry; verify query-time readability, coverage for each channel, and hidden raw sender IDs.

## 6. Release validation

- [ ] 6.1 Run the live Slack and Telegram QA in [plan.md](plan.md) on fresh connections and save sanitized evidence.
- [ ] 6.2 Confirm whether the hosted Slack app is subject to Slack's history limits for non-Marketplace apps, and set the backfill bounds to match.
- [ ] 6.3 Run `openspec validate --all --strict --no-interactive`; archive the change only after the implementation, live validation, and product acceptance are complete.
