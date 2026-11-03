# Tasks

Prerequisites: none. Priority: low, after the channel bug fix. Independent of the change that lets a private agent be in a channel. Parentheses name the spec requirement.

## 1. Backend

- [ ] 1.1 `audience` block in `ChannelAgentData`, defaulted when missing; one-time copy of `allowed_senders` to every binding. (Existing lists move to the agent binding)
- [ ] 1.2 `ChannelsService.resolve`: agent people check after the agent lookup; refusal reasons `sender_not_allowed` and `place_off`. (Only chosen people; Only chosen channels)
- [ ] 1.3 Refusal note from the inbox worker, keyed by person, place, reason and date; ephemeral send in the adapter interface and the Slack adapter; note texts in `render.py`. (A refused person gets one private note a day)
- [ ] 1.4 People routes `people/query` and `people/refresh`; cached Slack people list in Redis (24 hours); email lookup; Fern client. (People are picked by name or email)
- [ ] 1.5 Owner-only edits for a private agent's limits. (Who may change the limits)

## 2. Screen

- [ ] 2.1 Advanced row "Channels it answers in" / "Groups it answers in"; one rule writer for the switches and the row; `readBehavior` reads single-channel allow rules. (Only chosen channels)
- [ ] 2.2 "Who can message it" for Slack with the people picker; Telegram picker from people who messaged the bot. (Only chosen people; People are picked by name or email)
- [ ] 2.3 Add channel picker: search field and multi-add.
- [ ] 2.4 Fix the three screen bugs: "@name" refused; empty "Specific people" returns to Everyone; chosen channels read back as chosen.
- [ ] 2.5 Summary line on the agent's channel card in `web/mobile`.

## 3. Copy

- [ ] 3.1 Get owner approval for the note texts and the new screen strings before release.

## 4. QA matrix

OSS and EE, Slack and Telegram, mock harness in the channels suite. Every local QA also proves that self-managed agents still work (subscription sidecar, with and without a slug).

| Boundary | Test |
| --- | --- |
| Defaults | Every spec scenario of "Defaults keep today's behavior". |
| Places | Chosen channel answers; other channel refused with one note; nothing checked; group DM off under "Only these channels". |
| People | Not on the list refused with one note; two agents on one hosted installation; no-mention message not stored; removal mid-thread. |
| Note | Once a day per person and place; Telegram group silent; Slack ephemeral refusal logged and dropped. |
| Cost | Statement count of an allowed message equals today's. |
| Permissions | Admin refused on a private agent's limits; owner allowed. |
| Migration | Telegram lists copied to every binding; old pods keep working during the deploy. |
