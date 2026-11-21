# builder-panel: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **Builder**: the platform agent with the slug `__ag__builder`. It reads, creates and edits agents with the rights of the person who chats with it.
- **Chat and session**: the interface says "chat" for a conversation with the builder. The code and the API say "session" for every conversation, also a builder chat (design.md, Terms). A conversation with the agent of the screen stays a "session" in this file.
- **Builder chat**: one session with the builder. In the panel, a builder chat is always about one agent.
- **Builder panel**: the Builder content of the right panel (see the agent-panel capability).
- **Agent of the screen**: the agent whose screen is open (a session, the Configuration page, Analytics or the Sessions page of that agent).
- **Chat about an agent**: a builder chat whose id the browser keeps in the list of that agent, under the key `agenta:builder:chats:${userId}:${projectId}` (PROPOSED; design.md D12, D16). The browser adds it at the first message sent from that agent's panel, or at the first `create_agent` or `edit_agent_config` result of a builder page chat with no agent. A chat that edits several agents is about the first one (documented limit). Another browser does not know the link (documented limit).
- **Last activity**: the `updated_at` of the builder chat's session stream. A heartbeat, a rename or an archive also moves it (`api/oss/src/dbs/postgres/sessions/streams/dao.py:603-610`), so a renamed old chat counts as recent (documented limit).
- **Quick action**: one of the category buttons under the composer of a new chat.
- **Ready request**: one prepared request inside a quick action.
- **Builder page**: the full page of the builder. It is the builder-page capability.

## Which rule won
- Which chat opens (contradiction 4). BEHAVIOR 1.3 and note `n_s0b` 1 have the 2-day rule. The 18 November OpenSpec opened the last chat with no time limit. BEHAVIOR won.
- New chat layout in the panel (contradiction 11). The panel uses the question, the five quick actions and recent chats (S07, BEHAVIOR 1.3a). The B01 layout with the hero belongs to the builder page (builder-page capability, program shape small decision).
- Builder card buttons (contradiction 6): "Deny" and "Approve" (BEHAVIOR 10.3). See the change-cards capability.
- "A chat appears in the lists after the first message" is from note `n_b0` 1 for the builder page. This file applies it to the panel lists too. PROPOSED. It matches the link: the browser stores it at the first message.
- The context chip (contradiction 5). The panel sends and shows the agent and the page part of the page it is on (a session, Configuration, the Sessions page or Analytics). The chip shows on the unsent composer and on every sent message, also after a reload, because the browser rebuilds it from the context line in the stored message text (page-context capability; design.md D13).
- The same-agent switch test (design review round 1). A Profiler count on a parent counts child updates such as streaming text, so it is not the test. The test checks that state survives (composer text, scroll position, an open quick action, a running answer) and the renders that the switch itself causes (task 24.2). Component identity is not a requirement (design.md D6).
- A ready request replaces the composer text. Not specified on the canvas. PROPOSED.

## Today's behavior
- Nothing of the builder panel exists on `origin/main` (5d783fec). The builder agent is in the open PR stack 8341, 7409, 8345 (none merged). PR 8345 adds the static catalog entry `__ag__builder`.
- The prototype in the private development copy keeps the link from a builder chat to its agent in browser storage (`agenta-builder-chat-agent`). The program keeps this approach, with a key per user and project, because it needs no backend change.
- The sessions query takes an explicit set `session_ids` (up to 500, `api/oss/src/apis/fastapi/sessions/models.py:88`), can search titles (`search`, `models.py:105`; and in the predicates, `:71`), and pages with `windowing` (`models.py:100`). It sorts by last activity, newest first (`api/oss/src/dbs/postgres/sessions/streams/dao.py:600-624`). The panel queries its stored chat ids with it.
- Run state of a session: the sidebar shows a spinner for a running session (`web/mobile/src/features/nav/useMobileNavItems.tsx:115`).
- "Create with AI" today writes the starter text into the agent's own composer through `composerPrefillRequestAtom` (the atom is read in `web/mobile/src/features/chat/SessionWorkspace.tsx:247-250`). The text "I want to connect" is `entityUi.agentTemplate.json:39`.
- The chat UI (composer, messages, activity line, run errors) is `@agenta/chat` and `web/mobile/src/features/chat/LiveConversation.tsx`. The builder panel reuses them. The page role of a conversation must change without a remount (design.md D6).

## Backend work
None in this program. The panel uses existing routes and what the builder agent work provides:
- **Chat about an agent.** The link lives in browser storage (above). The panel sends `session_ids` from that list to `POST /sessions/query`, newest first, limit 3, for the 2-day rule and "Recent chats"; the title menu and "Chat history" use the same set with `search` and `windowing`.
- **Builder PR stack.** The panel needs the builder catalog entry (PR 8345 on top of 8341 and 7409), rebased onto the program base (tasks 9.1 and 9.6, builder agent work).
- **Page context.** Every message sends the page context as one context line in the text the model reads, with the person's words in `metadata.display_content`, read at send time and snapshotted when the message is queued (page-context capability; tasks 8.1 and 24.3).
- Check: that a builder run continues on the server after the browser closes its stream. Production runs are server side, but the panel unmount path is not verified.

## Other places that mount the changed parts
The builder chat reuses the production chat components. Changes to them (for example the focus rule for Escape) reach every session screen.

## States described but not drawn
Running answer, run error, loading skeleton, empty history, search with no result, list load error, read-only chat, builder not available, the title menu open. The canvas draws the new chat (S07), a quick action open (S08), a chat with a change card (S03) and the history list (S09).

## Text
- Not confirmed (HANDOFF section 5): "What should we change?", "Improve", "Test", "Skills", "Automate", "Explain", every ready request and its line, "Recent chats", "View all", "Chat history".
- From the canvas, new: "New chat", "Open in the builder", "Close the builder", "I can change, test and explain {{agent}}.", "Ask the builder about this agent", "Search chats…", the age format "3d".
- Only the "Test" ready requests are drawn. The ready requests of "Improve", "Skills", "Automate" and "Explain" are not drawn and must be written and confirmed.
- Not drawn and not written: the empty history line, the "no chat matches" line, the list load error line. Write them and add them to the list for Mahmoud.
- From production: "I want to connect" (`entityUi.agentTemplate.json:39`), "Worked for {{time}}" (`chat.activity.json:29`), "Try again".
- From the canvas board C01: "Only the owner can approve" and "You can read this chat.". The production card has a read-only note that the host words and that names the owner (`web/packages/agenta-chat/src/components/ApprovalCard.tsx:52-58`).
