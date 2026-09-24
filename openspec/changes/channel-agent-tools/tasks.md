# Tasks

These tasks describe future implementation. All remain unchecked. Mahmoud approved writing the specification and the plan, not the implementation. Each numbered group ships as its own pull request. [plan.md](plan.md) gives the files, tests, and commands for every task. Tasks marked "pending decision" exist only if direct messages to people stay in v1.

## 1. Destinations, bot settings, and the list tool

- [ ] 1.1 Add the `tools` settings block to `ChannelAgentData` with its defaults; verify that a stored bot without the block reads as the defaults and that a partial edit keeps its other fields.
- [ ] 1.2 Pending decision: add the `channel_people` table, DTOs, and DAO; verify idempotent upsert, name search, and project isolation against PostgreSQL.
- [ ] 1.3 Add a Slack adapter method that lists the bot's member channels (and, pending decision, the workspace's people); verify paging, the exclusion of group DMs, and that Telegram reports it as unsupported.
- [ ] 1.4 Add opaque destination IDs; verify that they round-trip and that malformed, foreign-project, and foreign-bot IDs resolve to not found.
- [ ] 1.5 Match the bound run artifact to its bots; verify application, workflow, variant, and revision references, archived connections, and the refusal for two bots on one connection.
- [ ] 1.6 Implement `list_channel_destinations` for Slack and Telegram; verify the setting effects, the Telegram limits, hosted-bot scoping, and the directory cache.
- [ ] 1.7 Add the authenticated tool router and the SDK catalog entry; verify `run_channels`, closed input schemas, hidden bindings, and that no raw provider ID is returned.
- [ ] 1.8 Give the Agenta tools kit its condition (is this agent connected to an active, verified bot); verify it turns false on disconnect and archive.

## 2. The send tool and the delivery record

- [ ] 2.1 Add `$ctx.tool.call_id` to the runner's direct-call context; verify that it is bound, stable across a retry, and not part of the approval key.
- [ ] 2.2 Make the outbox thread optional and add `space_id` and `origin`; verify turn rows are unchanged and a duplicate tool key returns the existing row.
- [ ] 2.3 Move the claim, post, and receipt steps into `ChannelsService.deliver`; verify the existing outbox worker suite passes unchanged.
- [ ] 2.4 Implement channel sends; verify the setting refusals, the thread check, the retry, the unknown outcome, and a revoked credential.
- [ ] 2.5 Pending decision: implement person sends with a private session; verify Slack opens the conversation, Telegram reuses the private chat, the source session is untouched, and the next private turn sees the sent text.
- [ ] 2.6 Pending decision: enable the Slack messages tab in the app manifest; verify the generated manifest.
- [ ] 2.7 Make the send tool default to `allow`, the way the Agenta tools kit expresses per-tool defaults; verify that an author `ask` or `deny` and an agent-wide `ask` win.
- [ ] 2.8 Add the send route and the SDK catalog entry; verify the session and tool call bindings are hidden from the model.

## 3. Settings UI

- [ ] 3.1 Regenerate the TypeScript client and add the settings actions; verify that a write sends only the `tools` block.
- [ ] 3.2 Add the Advanced section with the posting switch, the readable-channels choice, and (pending decision) the direct-message switch; verify defaults, saving a narrowed list, error recovery, and the Telegram help text.
- [ ] 3.3 Update the manage-panel test that forbade an Advanced section and add Storybook states.

## 4. The read tool

- [ ] 4.1 Record the provider time and message reference on stored inbox messages, with a `sent_at` column and a thread expression index; verify Slack and Telegram parsing and the round trip.
- [ ] 4.2 Read a channel's stored messages from inbox and outbox rows in provider order; verify the merge, the single copy of a bot post, thread reads, paging, and the fallback to `created_at`.
- [ ] 4.3 Fetch one page of older Slack history before a timestamp; verify the `latest` bound, thread replies, the rate-limit error, and deleted messages.
- [ ] 4.4 Implement `read_messages`: stored messages first, then one live Slack call; verify limits, the notes on edits, rate limits, and Telegram, the refusals, and that live messages are not stored.
- [ ] 4.5 Add the read route and the SDK catalog entry.

## 5. Search

- [ ] 5.1 Add the full-text expression index on stored inbox text; verify matching, filters, stable cursors, project isolation, and that queries use the index.
- [ ] 5.2 Implement `search_channel_messages`, its route, and the SDK catalog entry; verify query-time readability, the "since the bot joined" statement, no provider calls, and hidden raw sender IDs.

## 6. Release validation

- [ ] 6.1 Run the live Slack and Telegram QA in [plan.md](plan.md) on fresh connections and save sanitized evidence.
- [ ] 6.2 Check the assumptions about the Agenta tools kit and the retention specification once both are published.
- [ ] 6.3 Run `openspec validate --all --strict --no-interactive`; archive the change only after the implementation, live validation, and product acceptance are complete.
