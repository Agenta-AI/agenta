# agent-sidebar-pages: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **Main sidebar**: the sidebar of the app with Builder, Home, Agents, Automations, Skills, Sessions and one section per agent.
- **Agent section**: one block in the main sidebar that names an agent and lists its latest sessions.
- **Agent sidebar**: the sidebar that shows one agent: Back, the agent switcher, the fold button, New session, Configuration, Channels, Analytics and the sessions of this agent.
- **Agent switcher**: the menu on the agent name in the agent sidebar. It lists Builder and all agents.
- **Agent page**: a page that belongs to one agent: a session, the Configuration page, the Channels page, the Sessions page of the agent or the Analytics page of the agent.
- **Locked filter**: a filter that a page sets to one agent and that the user cannot change on that page. It shows as a chip with a lock.
- **Builder spark**: the small mark after a session name that means "Started by the builder". It reads the session origin `builder` (session-screen capability).
- **Browser tab storage**: `sessionStorage`. It lasts for one browser tab and its reloads. A new tab starts empty.

## Today's behavior (origin/main 5d783fec, v0.129.0)

- The main sidebar has no agent sections at the top level. The "Sessions" group lists all sessions, grouped by agent by default (`web/mobile/src/features/nav/useMobileNavItems.tsx:81`, `setSidebarSessionFilterDefaults(..., {groupBy: "agent"})`). Each agent heading has a "+" that starts a blank session (`useMobileNavItems.tsx:138-147`). The group scrolls and loads more sessions at the end (`useMobileNavItems.tsx:309-310`). There is no limit of 4 sessions per agent and no open button.
- The sidebar has no "Builder" row and no agent sidebar (`useMobileNavItems.tsx:260-325`: Home, Agents, Automations, Skills, Sessions).
- A sidebar session row waits 220 ms before it navigates. The click handler calls `event.preventDefault()` and starts `window.setTimeout(..., 220)` before `router.push` (`web/packages/agenta-sessions-ui/src/SessionRowActions.tsx:196-219`). A double click cancels the timer and starts the rename (`SessionRowActions.tsx:242-248`). The long-press guard is at `SessionRowActions.tsx:95-101` and `:200-204`.
- A click on an agent in the Agents list starts a blank session when the overview flag is off (`web/mobile/src/features/agents/AgentListScreen.tsx:127-131`). The agent route does the same through `AgentPlaygroundRedirect` (`web/mobile/src/features/agents/AgentPlaygroundRedirect.tsx:22`). It never opens the last session.
- The Sessions page starts with Group by Agent (`web/mobile/src/features/sessions/sessionListView.ts:44`). The Agent filter is a row of the filter menu (`web/mobile/src/features/sessions/SessionFilterMenu.tsx:133-147`) and reads shared filter atoms (`SessionFilterMenu.tsx:6`, `useSessionFilters`). A lock must not write these shared atoms, or the lock leaks into the all-agents page.
- The session count can come from `include_total` on `POST /sessions/query` (`api/oss/src/apis/fastapi/sessions/models.py:98`, `:131-132`; frontend `web/packages/agenta-entities/src/session/api/api.ts:712`). No backend work is needed for "Sessions 42".
- Analytics is a Settings tab (`web/mobile/src/features/settings/settingsTabRegistry.tsx:19`, `web/mobile/src/features/settings/AnalyticsTab.tsx:17`). Its filters are one global atom (`web/packages/agenta-observability-ui/src/analytics/AnalyticsPage.tsx:74`), and a project change resets them (`AnalyticsPage.tsx:93`). The locked page needs its own filter state. "Failures by agent" is `FailureRateCard.tsx:61` in `web/packages/agenta-observability-ui/src/analytics/cards/`.
- Channels today: the agent overview card `AgentChannelsCard` (`web/mobile/src/features/agents/AgentOverviewScreen.tsx:138`), the publish panel (`web/mobile/src/features/agents/useAgentPublishPanel.tsx:22`, `:62`) and the Settings Channels tab (`web/mobile/src/features/settings/ChannelsTab.tsx:69`). All use `useChannelPanel` (`web/packages/agenta-settings-ui/src/channels/useChannelPanel.tsx:166`) and `ChannelsPanelSheet`.
- Access today: `AgentPrivacyControl` (`web/packages/agenta-entity-ui/src/sharing/AgentPrivacyControl.tsx`), mounted through `AgentPrivacyHost` (`web/mobile/src/features/chat/AgentPrivacyHost.tsx:18`) in the Share menu (`web/mobile/src/features/chat/ShareMenu.tsx:137`). It already has the private confirmation, the transfer step, "Take ownership", conflict, save failure and load failure (texts in `web/packages/agenta-i18n/locales/en/entityUi.sharing.json`).
- The prototype (not on main) keeps the selected sidebar in `sessionStorage` under `agenta-builder-sidebar` and opens the Configuration page as the agent route with `?configuration=<section>`.

## Other places that mount the changed components

- `SessionRowActions` is mounted by the `/m` sidebar (`useMobileNavItems.tsx:237`) and by the old desktop app (`web/oss/src/components/Sidebar/dynamic/sessionRowWrapper.tsx:26`). The removal of the 220 ms hold changes both. `web/oss` is the abandoned old app: it needs no code change for this, but its type check must still pass after the change. The unit test `web/packages/agenta-sessions-ui/tests/unit/SessionRowActionsOpen.render.test.tsx` covers the row and needs a case for "navigates without a timer" and "double click renames the open session".
- `SessionListScreen`, `SessionFilterMenu`: the all-sessions page (`web/mobile/src/pages/w/[workspace_id]/p/[project_id]/sessions/index.tsx`). The locked variant must leave it unchanged.
- `AnalyticsPage`: the Settings Analytics tab. The locked variant must leave it unchanged.
- `useChannelPanel` and `ChannelsPanelSheet`: Settings Channels tab, agent publish panel, agent overview card. The Channels page view is also the Channels tab of the right panel (configuration-draft capability, "Configuration tabs"), so a change to the page shows there too.
- `AgentPrivacyControl`: the Share menu of every session. The Access tab is a second container of the same control body.

## Backend work

- None in this work.
- The spark reads the session origin `builder`. The builder agent work provides it (builder architecture session): task 30 adds the value and the test-run builder tool (task 31) writes it. The spark waits for both. The rows already receive the decoded `origin` of each session (`api/oss/src/dbs/postgres/sessions/streams/mappings.py:110-120`).
- "Last opened session" per agent: frontend state per browser is enough (small). A per-user server value is not needed.

## Routes and the speed budget

The agent pages are views of the existing route `/agents/[agent_id]` (`web/mobile/src/pages/w/[workspace_id]/p/[project_id]/agents/[agent_id].tsx`) with a query value, as the Automations page uses `?view=runs`. The Configuration page is `?view=configuration&tab=<tab>`, with `tab` one of `agent`, `automations`, `access` (design.md D16). The prototype used `?configuration=<section>`; the program does not use it. The values for the Channels, Sessions and Analytics pages are not fixed in design.md (PROPOSED: `?view=channels`, `?view=sessions`, `?view=analytics`).

The agent pages share one page file, and every session shares the session page file. The requirement is that the builder panel's state survives (design.md D6, task 7.2). A route change to another page file unmounts everything below the route component (`web/mobile/src/pages/_app.tsx:66`). A move between a session and an agent page, or leaving the agent and coming back, does unmount the panel; the conversation then restores its composer text and scroll by session id.

A new route has no entry in `web/mobile/scripts/speed/budget.json`, and only Mahmoud can add one (`web/mobile/AGENTS.md:124-128`). The query value keeps the pages on a route that has a budget.

## Tasks

- Sidebars: section 12 of `tasks.md` (12.1 the 220 ms hold, 12.2 the main sidebar, 12.3 the agent sidebar).
- Agent pages: section 23 (23.1 Configuration page, 23.2 Sessions and Analytics locked to one agent, 23.3 Channels page and Slack manage view, 23.4 Access tab).
- One page file and the restore by session id: task 7.2.
- The builder spark: task 43 (after tasks 30 and 31 of the builder agent work).

## States described but not drawn

- Open menus: the agent switcher, the Filter button next to "Sessions" in the agent sidebar (drawn, behavior not described; PROPOSED: today's sidebar session filter menu scoped to this agent).
- The private confirmation and the transfer flow (production has both).
- Channel connect steps and the "Needs attention" channel state.
- Empty agent sidebar, empty Sessions page, empty Analytics range, loading and error states of every page.
- The no-access state of an agent page.
- The spark in the agent sidebar, the main sidebar sections and the locked Sessions page.

## Text

- New text from the canvas, not in production: "Show 36 older sessions", "This page shows only this agent", "See all sessions in a table", "Back to the main sidebar", "Open Support triage", "New session in Support triage", "A channel lets people talk to Support triage in the chat app they already use.", "Answer messages sent to a Telegram bot.", "Answer messages sent to a WhatsApp number.", "Who can message the agent", "Add another workspace, or your own Slack app", "v4 · Today 09:12". Each needs the i18n files of the 7 languages.
- Canvas text that differs from production: the Access line for "Shared with project" (canvas: "Everyone in Acme Agency can see and use it. Chats with it stay private."; production `lineProject`: "Everyone in {{project}} can see and use it. Chats with it stay private: share each chat from its own Share button."); "Who can message the agent" (production `channels.people.json` "Who can message it"); the Telegram and WhatsApp lines (production `channels.status.json` "Chat with the agent from your phone" and "Answer messages to your WhatsApp Business number"); the "+" label (production `navigation.json` "New session with {{agent}}"). Mahmoud picks one per pair.
- "Started by the builder" (the spark tooltip): new, from the canvas.
- No text of this capability is in HANDOFF section 5.

## Open questions

- Sessions keep their own page file (`web/mobile/src/pages/w/[workspace_id]/p/[project_id]/sessions/[session_id].tsx`), and the agent pages are on `agents/[agent_id].tsx` (design.md D6). A move between the two remounts the builder panel, which then restores by session id. The `?view=` values for Channels, Sessions and Analytics are PROPOSED above.
