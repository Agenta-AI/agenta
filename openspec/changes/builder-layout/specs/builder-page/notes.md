# builder-page: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **Builder**: the platform agent `__ag__builder`. It creates and changes the agents of the project with the rights of the person who chats with it.
- **Builder chat**: one session with the builder. The interface says "chat"; the code and the API say "session".
- **Builder page**: the full page for a builder chat, opened from "Builder" in the main sidebar. It is not the builder panel (the right panel on an agent page, see the builder-panel capability).
- **Builder sidebar**: the sidebar of the builder page: Back, "Builder", "New chat" and the list "Chats".
- **Pane**: the area at the right of the builder page. It shows the builder tabs and the view of the active one.
- **Builder tab**: one tab in the strip at the top of the pane. It stands for one thing the chat touched: an agent, an automation, a tool or an app. Its key is `<kind>:<id>`, for example `agent:<workflow id>`.
- **Active tab**: the builder tab whose view the pane shows. Only the active tab is mounted.
- **Pane tabs**: the row of tabs inside an agent tab: Agent, Automations, Channels, Access (the Configuration tabs), Drives and Sessions. "Tab" in the other capabilities means Agent, Automations, Channels, Access; here "builder tab" and "pane tab" keep the two rows apart.
- **Chip**: a small labeled button in a builder message that names a thing (name and kind "Agent", "Automation", "Tool" or "App") and opens its builder tab.
- **Test session**: a session of another agent that the builder started with the test-run tool. It has the session origin `builder` (session-screen capability).
- **The 10 second rule**: the pane moves to show what the builder does only when the user did not click in the pane in the last 10 seconds.
- **Hero**: the picture above the title of a new chat. It is an animation with one state input.

## Milestones

- Builder page (tasks.md section 27): the sidebar, the new chat, Browse ideas, the agent tab with its pane tabs, the card rule.
- Builder tabs (section 40): the strip, chips, "+", "N more", the per-chat store, the address, the cap, closing.
- Follow the builder (section 41): the 10 second rule, dots and spinners, "Changed by the builder".
- Test tab (section 42): the read-only test session and "Reply". Needs the test-run tool (section 31) and the session origin (section 30).
- Hero animation (section 48): the state input and the rules of the spec. The hero shows the current ring until Mahmoud picks the variant (OPEN-QUESTIONS 1.1).

## Where the pane reads the builder's actions

- Which tabs open: `?tab=<kind>:<id>` in the address; the latest typed results of `create_agent` and `edit_agent_config` in the chat stream (`revision: {id, version}` and `agent`, builder-backend capability, task 9.3); the results of the tools that create automations (task 34); the chips in builder messages; and the stored tabs of the chat. No server field links a chat to an agent; this work adds no backend. The prototype's shell-command parser is not ported.
- Which rows are marked: the first segment of each operation `target` of a committed `edit_agent_config` call (`instructions`, `skills`, `mcps`, `tools`, and the others that the change-set engine keys, `api/oss/src/core/workflows/change_set.py:230-235`). A segment maps to the section row of the same list.
- A test: the result of the test-run tool (task 31, provided by the builder agent work) carries the session id of the test session and its agent. The Sessions pane tab of that agent shows that session.
- After a "committed" result for an agent with an open tab, the browser clears that agent's latest-revision caches, so the tab reads the new version.
- No stream frame exists today for a write to another agent; the pane reads tool results only.

## What is stored

- Per builder chat, in this browser (`localStorage`): the open builder tabs in their order, the active tab, and the closed tabs of the chat (so a closed tab does not reopen by itself). PROPOSED key: `agenta:builder:tabs:${sessionId}`. At most 50 tabs per chat; the oldest tab that is not active goes first. The closed-tab list has the same cap.
- `agenta:builder:layout`: the pane width and whether the pane is hidden, for every chat (design.md D16).
- `?tab=<kind>:<id>`: the active tab, written with replace, so no history entry.
- Every read and write of browser storage is in a `try`; with no storage the page uses the tabs of this visit.

## Today's behavior (origin/main 5d783fec, v0.129.0)

- There is no builder page and no "Builder" row in the sidebar (`web/mobile/src/features/nav/useMobileNavItems.tsx:260-325`).
- The builder agent is not on main. It is in the open PR stack 8341, 7409, 8345 and 8346 (builder-backend capability). Static agents have stable UUIDv5 ids derived from the slug (`api/oss/src/core/workflows/static_catalog.py:437-443`).
- No builder tool on main or in the PR stack starts a session of another agent. `SessionOrigin` has only `manual` and `trigger` (`api/oss/src/core/sessions/types.py:49-51`).
- The approval card is shared (`web/packages/agenta-chat/src/components/ApprovalCard.tsx`) and the session screen docks it (`web/mobile/src/features/chat/ApprovalDock.tsx:18`).
- Today's activity mark is three dots with a reduced-motion check (`web/packages/agenta-ui/src/components/presentational/activity-dots/AgentActivityDots.tsx:54`). `/m` has a reduced-motion hook in its motion presets (`web/mobile/src/lib/motion/presets.ts:230`).
- The prototype (not on main) has the tabs pane, `?tab=agent:<id>`, the cap of 50 tabs and the per-chat storage in `localStorage`. It opens only agent tabs. It uses a hard-coded proof-of-concept builder id, not `__ag__builder`.

## The hero (animation design notes, 19 November 2026)

- One state input: `idle`, `typing`, `thinking`, `done`. A keystroke may add a small bump. Each state is a set of numbers that move with a damped spring of about 0.45 s, so a change never jumps.
- Map in the page: an empty composer is `idle`; text in the composer is `typing`; a sent first message with no answer yet is `thinking`; the end of the first answer is `done`. Not drawn; PROPOSED.
- Colors only from the app's ink tokens; the theme follows `data-theme`, else `prefers-color-scheme`.
- Six variants exist in the gallery. The recommendation is "Soft shape" with "Three dots" as the still fallback when WebGL is missing; the variant is Mahmoud's choice (OPEN-QUESTIONS 1.5). Measured on a box with no GPU: the WebGL variants are 4.2 to 4.6 KB gzip and cost 6 to 8 ms per frame at 200 x 200 px; "Three dots" (SVG) is 3.5 KB and 0.1 ms. Not tested on a real GPU, a phone, Safari or Firefox, or inside `/m`.
- The hero loads with `next/dynamic`, so it does not count in the first load of `speed:check`.

## Other places that mount the changed components

- The pane tabs reuse the views of the right panel (agent-panel capability), the Configuration page (agent-sidebar-pages capability), the automation view (automations-run-history capability) and the Files pane. A change to those views shows here too.
- The change card is the one of the change-cards capability. It is also the approval card of the agent's own chat.
- The test session view is the session conversation (session-screen capability) in read-only mode.
- The spark on the test session is the one of the session-screen capability.
- Phone: the builder page tab row is desktop only; on a phone an item opens as its own full screen view with a back arrow to the chat (phone-layout capability).

## Backend work

None in this work. The builder page reads what the builder agent work provides (builder architecture session; tasks.md "Depends on the builder agent work"):
- The builder stack on the program base (tasks 9.1 to 9.6), with the tool results `revision: {id, version}` (task 9.3).
- The test-run tool (task 31): runs another agent as the person, returns the session id at start, and writes the session origin `builder` and the tag `ag.builder.session_id` (task 30). The test tab and the spark wait for it.
- The tools that create automations (task 34) give the automation tabs their results.
- The builder chat list for the builder sidebar reads the existing session query for sessions of `__ag__builder` of the current user. Not verified: whether `POST /sessions/query` with the static workflow id in `turn_references` returns them (small to check, before task 27.1).

## States described but not drawn

- The agent picker of "Improve an agent".
- The pane tabs Automations, Channels, Access and Drives.
- The tool tab and the app tab (see open questions).
- The page with a chat that has no pane after its first message.
- The closed-tab state, the last tab closed, the cap reached.
- The dot and the spinner on a pane tab or a builder tab.
- A failed test and a test session the user cannot read.
- Each hero state; the still frame; the fallback.
- Loading, error, empty and no-access states.

## Open questions

- 3.24: which view a tool tab and an app tab mount. The canvas draws "enrich_company" (Tool) and "Lead form" (App) as chips and tabs, and production has no app object. The builder page session checks this before task 40.1.
- How the builder writes chips into a message (a tool result, or a part type of the stream). Builder architecture session, before task 40.1.
- What a quick action does when the composer already has text (replace or add). The canvas does not say.
- The map from page events to the hero states is not drawn (PROPOSED above).
- BEHAVIOR 1.10 says the builder applies changes itself on its own page. This spec follows DECIDED by Mahmoud (always a card). If Mahmoud picks the other option, the backend needs a per-surface approval mode (approval mode is fixed per agent).
- The lifetime of "Changed by the builder" is PROPOSED (until the row is opened or the tab closes).

## Text

- Not final (FIRST-DRAFT, inventory section 5): every quick action and idea text: "Build an agent", "Improve an agent", "Test an agent", "Automate an agent", "Browse ideas", the categories and the prompts of the ideas dialog, "Tell me what you want to automate. I build the agent, test it and improve it with you.", "What do you want to build?".
- New text from the canvas: "Chats", "Hide open items", "Full screen", "Message the builder", "Search ideas…", "Only you can see and use it in Agenta.", "Open an item", "Open items", "Close {{name}}" (drawn as "Close Lead finder"), "Changed by the builder", the chip kinds "Agent", "Automation", "Tool", "App", "Writing".
- Not confirmed (HANDOFF section 5): "2 more", "The builder is testing Email writer.", "Reply".
- Not written: the line when no idea matches in "Browse ideas"; the no-access text of a builder tab. Listed for Mahmoud.
