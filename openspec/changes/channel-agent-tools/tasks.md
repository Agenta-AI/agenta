# Tasks

All phases ship in one pull request, on branch `feat/channel-agent-tools`. [plan.md](plan.md) gives the files, tests, and commands for every task. Task numbers are kept from the approved plan, so dropped tasks leave gaps.

## 1. Destinations, bot settings, and the list tool

- [x] 1.1 Add the `tools` settings block to `ChannelAgentData` with its defaults; verify that a stored bot without the block reads as the defaults and that a partial edit keeps its other fields.
- [x] 1.3 Add a Slack adapter method that lists the bot's member channels; verify paging, the exclusion of group DMs, and that Telegram reports it as unsupported.
- [x] 1.4 Add opaque destination IDs; verify that they round-trip and that malformed, foreign-project, and foreign-bot IDs resolve to not found.
- [x] 1.5 Match the bound run artifact to its bots; verify application, workflow, variant, and revision references, archived connections, and the refusal for two bots on one connection.
- [x] 1.6 Implement `list_channel_destinations` for Slack and Telegram; verify the setting effects, the Telegram limits, hosted-bot scoping, and the member-channel cache.
- [x] 1.7 Add the authenticated tool router and the SDK catalog entry; verify `run_channels`, closed input schemas, hidden bindings, and that no raw provider ID is returned.
- [x] 1.8 Give the Agenta tools kit its condition (is this agent connected to an active, verified bot); verify it turns false on disconnect and archive.

## 2. The send tool and the delivery record

- [x] 2.1 Add `$ctx.tool.call_id` to the runner's direct-call context; verify that it is bound, stable across a retry, and not part of the approval key.
- [x] 2.2 Make the outbox thread optional and add `space_id`; verify turn rows are unchanged and a duplicate tool key returns the existing row.
- [x] 2.4 Implement channel sends; verify the setting refusals, the thread check, the retry, the unknown outcome, and a revoked credential.
- [x] 2.7 Make the send tool default to `allow` through `PlatformOp.default_permission`; verify that an author `ask` or `deny` and an agent-wide `ask` win.
- [x] 2.8 Add the send route and the SDK catalog entry; verify the session and tool call bindings are hidden from the model.

## 3. Settings UI

- [x] 3.1 Regenerate the TypeScript client and add the settings actions; verify that a write sends only the `tools` block.
- [x] 3.2 Add the Advanced section with the posting switch and the readable-channels choice; verify defaults, saving a narrowed list, error recovery, and the Telegram help text.
- [x] 3.3 Update the manage-panel test that forbade an Advanced section and add Storybook states.

## 4. The read tool

- [x] 4.1 Record the provider time and message reference on stored inbox messages, with a `sent_at` column; verify Slack and Telegram parsing and the round trip.
- [x] 4.2 Read a channel's stored messages from inbox and outbox rows in provider order; verify the merge, the single copy of a bot post, thread reads, paging, and the fallback to `created_at`.
- [x] 4.3 Fetch one page of older Slack history before a timestamp; verify the `latest` bound, thread replies, the rate-limit error, and deleted messages.
- [x] 4.4 Implement `read_messages`: stored messages first, then one live Slack call; verify limits, the notes on edits, rate limits, and Telegram, the refusals, and that live messages are not stored.
- [x] 4.5 Add the read route and the SDK catalog entry.

## 5. Search

- [x] 5.1 Add the full-text expression index on stored inbox text; verify matching, filters, stable paging, project isolation, and that queries use the index.
- [x] 5.2 Implement `search_channel_messages`, its route, and the SDK catalog entry; verify query-time readability, the coverage statements, no provider history or search calls, and hidden raw sender IDs.

## 6. Release validation

- [ ] 6.1 Run the live Slack and Telegram QA in [plan.md](plan.md) on fresh connections and save sanitized evidence.
- [ ] 6.2 Check the assumptions about the Agenta tools kit and the retention specification once both are approved.
- [ ] 6.3 Run `openspec validate --all --strict --no-interactive`; archive the change only after the implementation, live validation, and product acceptance are complete.

## 7. Follow-ups

- [ ] 7.1 Once pull request #7128 merges, skip consumed rows (`flags.is_consumed`) in `query_space_inbox_messages` and `search_inbox_statement` in `api/oss/src/dbs/postgres/channels/dao.py`.
- [ ] 7.2 Direct messages to people.
- [ ] 7.3 Add the channel tools to a connected agent's runs automatically, with the Agenta tools kit.
- [ ] 7.4 Apply Slack edits and deletions to stored inbox rows.
