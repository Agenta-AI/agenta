<!-- review-loop: design=7c845979d7da lenses=simplify,naming -->

**Review loop result** for the Discord channel design (repo commit `aa9a7354ca`), 6 rounds. Rounds 1 to 4 reviewed the design draft. Rounds 5 and 6 reviewed this OpenSpec change.

| Lens | R1 | R2 | R3 | R4 | R5 | R6 (final) |
| --- | --- | --- | --- | --- | --- | --- |
| Simplify (Codex) | Medium | Medium | High | Low | High | Low |
| Naming (Codex, Opus) | Low, Medium | Medium | Medium | Low | High | Medium |

**Fixed:**
- The socket loop is a task in worker-queues next to channels-inbox, with one lock through the shared locking helpers. No new service.
- Store-and-enqueue moves into core as ChannelsService.record_and_enqueue_inbox_event; the existing unique constraint drops duplicates; enqueue failure raises ChannelInboxEnqueueFailed.
- Parsing and the button acknowledgement live in the adapter. Approval buttons reuse the existing choice token.
- The locator follows the Slack precedent: channel_id is the text channel (the space), thread_id is the thread, source_channel_id is where Discord delivered the message.
- Recovery after a failed resume reads inbox rows, groups by source_channel_id, takes its snapshot before new live events, and retries enqueue failures.
- Thread follow-ups follow the shared mention-only rule (PR #7128).
- Names: query_active_connections (returns project id with each connection), inbox_dispatch_task, discord_socket.py, bot_username, application_name.

**Left on purpose:**
- The round 6 naming finding was one stale recovery scenario that still used the old channel_id meaning. It is fixed as a text correction. The round limit stopped a seventh review of that line.
- The in-memory enqueue retry does not survive a process crash during a queue outage. The webhook path has the same limit.
- Discord typing lasts 10 s and the shared refresh is 20 s, so typing shows for about half of each period. The reaction stays on the whole time.
