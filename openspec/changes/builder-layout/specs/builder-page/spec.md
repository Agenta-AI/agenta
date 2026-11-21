## ADDED Requirements

### Requirement: Builder sidebar
"Builder" in the main sidebar SHALL open the builder page with a new chat and the builder sidebar. The builder sidebar SHALL show "Back", "Builder", "New chat" and "Chats", with the user's builder chats newest first and the day of the last message.

#### Scenario: Sidebar drawn
- **WHEN** the user has the chats "Lead outreach system", "Support triage setup" and "Weekly report"
- **THEN** the sidebar shows "Back", "Builder", "New chat", "Chats" and the three chats with "Today", "Yesterday" and "Mon"

#### Scenario: Back
- **WHEN** the user clicks "Back"
- **THEN** the main sidebar shows and the page in the middle does not change

#### Scenario: Running chat
- **WHEN** the builder still runs in a chat that is not on screen
- **THEN** that chat's row shows a spinner

#### Scenario: No chat yet
- **WHEN** the user has no builder chat
- **THEN** "Chats" shows no rows and "New chat" stays

#### Scenario: Long title
- **WHEN** a chat title is longer than the row
- **THEN** the title is cut with an ellipsis and shows in full on hover

#### Scenario: Loading and error
- **WHEN** the chat list loads or fails
- **THEN** the sidebar shows today's sidebar loading rows or its error state (as production)

### Requirement: New chat on the builder page
A new builder chat SHALL show the hero animation, the title "Builder", the line "Tell me what you want to automate. I build the agent, test it and improve it with you.", the quick actions "Build an agent", "Improve an agent", "Test an agent", "Automate an agent" and "Browse ideas", and the composer with the placeholder "What do you want to build?".

#### Scenario: New chat drawn
- **WHEN** the user clicks "New chat"
- **THEN** the page shows the hero, "Builder", the line, the five quick actions and the composer, and no pane

#### Scenario: Hero
- **WHEN** the new chat shows
- **THEN** the hero shows the hero animation in the state `idle` (see "Hero animation"), with no new dependency

#### Scenario: Quick action fills the composer
- **WHEN** the user clicks "Build an agent", "Test an agent" or "Automate an agent"
- **THEN** a ready request goes into the composer and nothing is sent

### Requirement: "Improve an agent" picks an agent
"Improve an agent" SHALL ask which agent and SHALL add the picked agent as a context chip in the composer. The chip SHALL be the page context of the next messages (see the page-context capability).

#### Scenario: Pick an agent
- **WHEN** the user clicks "Improve an agent" and picks "Support triage"
- **THEN** the composer shows a chip for "Support triage", and the message sends the agent id and name as page context

#### Scenario: Send with the chip
- **WHEN** the user sends the first message with the chip for "Support triage"
- **THEN** the chat is about "Support triage", and a builder tab "Support triage" opens

#### Scenario: Remove the chip
- **WHEN** the user removes the chip
- **THEN** the next message sends no agent

#### Scenario: No agent in the project
- **WHEN** the project has no agent the user can see
- **THEN** the picker shows an empty state, and the other quick actions still work

### Requirement: Browse ideas
"Browse ideas" SHALL open a dialog with a search field, categories and ready prompts. A click on a prompt SHALL put it in the composer, close the dialog and SHALL NOT send.

#### Scenario: Dialog drawn
- **WHEN** the user clicks "Browse ideas"
- **THEN** the dialog shows "Browse ideas", the search field "Search ideas…", the categories "All", "Getting started", "Support", "Sales", "Operations", "Engineering", "Improve an agent", "Test and evaluate" and "Automations", and prompts such as "Triage support tickets"

#### Scenario: Pick a prompt
- **WHEN** the user clicks "Triage support tickets"
- **THEN** the composer holds "Build an agent that reads new support tickets, labels urgency and category, and drafts a first reply." and the dialog closes

#### Scenario: Search with no result
- **WHEN** the search matches no prompt
- **THEN** the dialog shows one line that no idea matches, and the categories stay

#### Scenario: Close
- **WHEN** the user presses Escape or clicks the close button
- **THEN** the dialog closes and the composer does not change

### Requirement: A chat appears in the list after its first message
A new builder chat SHALL NOT show in "Chats" before its first message is sent. After the first message, the chat SHALL show at the top of "Chats" and the page SHALL show the conversation in place of the new chat view.

#### Scenario: Empty new chat
- **WHEN** the user opens "New chat" and types nothing
- **THEN** "Chats" does not change

#### Scenario: First message
- **WHEN** the user sends the first message
- **THEN** the chat shows at the top of "Chats", and the page shows the conversation

#### Scenario: Title
- **WHEN** the builder names the chat after the first exchange
- **THEN** the row and the page header show that name

### Requirement: Builder tabs open what the chat touched
The builder page SHALL show a pane beside the chat with one builder tab per agent, automation, tool or app that the chat created, changed or opened. The pane SHALL appear with the first such thing. A chip for a thing in the chat SHALL open its tab. "+" ("Open an item") SHALL open another tab. The pane SHALL mount only the active tab.

#### Scenario: First thing in a chat
- **WHEN** the builder creates the agent "Lead finder" in a chat with no builder tab
- **THEN** the pane appears with one builder tab "Lead finder", and that tab is active

#### Scenario: Chips open tabs
- **WHEN** the chat shows the chips "Lead finder" (Agent), "Email writer" (Agent), "Every day 09:00" (Automation), "enrich_company" (Tool) and "Lead form" (App), and the user clicks "Email writer"
- **THEN** the builder tab "Email writer" opens and is active

#### Scenario: Open an item
- **WHEN** the user clicks "+" ("Open an item") and picks the agent "Support triage"
- **THEN** a builder tab "Support triage" opens and is active

#### Scenario: Change to another agent
- **WHEN** the builder saves a new version of an agent that has no open builder tab, and the user did not close its tab before in this chat
- **THEN** a builder tab for that agent opens with a dot, and the active tab does not change

#### Scenario: Only the active tab is mounted
- **WHEN** three builder tabs are open
- **THEN** only the active tab renders its view, and a switch to another tab mounts that tab's view

#### Scenario: Chat that started with an agent
- **WHEN** a builder chat has no stored builder tabs and no `?tab=`, and its latest `create_agent` or `edit_agent_config` result names an agent
- **THEN** the pane opens with one builder tab for that agent

#### Scenario: Chat with nothing to show
- **WHEN** a builder chat has no tool result for an agent or an automation, no stored builder tab and no `?tab=` in the address
- **THEN** the page shows no pane

### Requirement: Builder tabs fit in one row
Each builder tab SHALL show at least about 12 letters of its name. When the builder tabs do not fit in one row, the active tab SHALL stay in full and the other tabs SHALL go into a list "N more" at the end of the row, whose tooltip names the tabs in it. A pick in the list SHALL make that tab active and visible.

#### Scenario: Two tabs do not fit
- **WHEN** the open builder tabs are "Lead finder", "Email writer", "Every day 09:00", "enrich_company" and "Dentist software leads", and the last two do not fit
- **THEN** the row shows "Lead finder", "Email writer", "Every day 09:00" and "2 more" with the tooltip "enrich_company, Dentist software leads"

#### Scenario: Pick from the list
- **WHEN** the user picks "enrich_company" from "2 more"
- **THEN** "enrich_company" is active and visible in the row, and another tab goes into the list

#### Scenario: Long name
- **WHEN** a builder tab name is longer than the tab
- **THEN** the name is cut with an ellipsis and shows in full on hover

### Requirement: Builder tabs are kept per chat and in the address
The page SHALL store the open builder tabs and the active tab per builder chat in this browser. The active tab SHALL be in the address as `?tab=<kind>:<id>`, written with replace. A chat SHALL keep at most 50 builder tabs; when a 51st opens, the oldest tab that is not active SHALL close.

#### Scenario: Reload
- **WHEN** the user reloads a builder chat with three builder tabs and "Email writer" active
- **THEN** the same three tabs show and "Email writer" is active, and the address did not get a new history entry

#### Scenario: Another chat
- **WHEN** the user opens another builder chat
- **THEN** the pane shows the builder tabs of that chat, or no pane

#### Scenario: Shared link
- **WHEN** a user opens a builder chat link with `?tab=agent:<id>` in a browser with no stored tabs for the chat
- **THEN** the pane opens with that one builder tab

#### Scenario: Cap
- **WHEN** a chat has 50 builder tabs and the builder opens one more
- **THEN** the oldest tab that is not active closes, and the new tab opens

#### Scenario: No browser storage
- **WHEN** the browser refuses storage
- **THEN** the page works with the tabs of this visit and the active tab from the address, and shows no error

### Requirement: Close a builder tab
Each builder tab SHALL have a close control ("Close {{name}}"). Closing the active tab SHALL make the nearest tab active. A closed tab SHALL NOT reopen by itself in that chat; only the user can open it again, with its chip or with "+".

#### Scenario: Close the active tab
- **WHEN** the user closes the active tab "Lead finder" (label "Close Lead finder") and "Email writer" is next to it
- **THEN** "Email writer" becomes active

#### Scenario: Closed tab stays closed
- **WHEN** the user closed "Email writer" and the builder then saves a new version of "Email writer" in the same chat
- **THEN** no tab opens for "Email writer"; the result row in the chat still shows the change

#### Scenario: Open again by hand
- **WHEN** the user clicks the chip "Email writer" after closing its tab
- **THEN** the tab opens again and is active

#### Scenario: Last tab closed
- **WHEN** the user closes the only builder tab
- **THEN** the pane hides, and it shows again when the user opens a tab

### Requirement: Content of a builder tab
An agent tab SHALL show the pane tabs of that agent. An automation tab SHALL show the automation view of the automations capability. A tool tab and an app tab SHALL show the view of that item. Each tab SHALL show the same view as the right panel or the agent pages, with the same data.

#### Scenario: Automation tab
- **WHEN** the user opens the builder tab "Every day 09:00"
- **THEN** the pane shows the automation view of "Every day 09:00"

#### Scenario: Thing deleted or hidden
- **WHEN** a builder tab names a thing that was deleted or that the user can no longer see
- **THEN** the tab shows the no-access state, and the user can close it

### Requirement: Pane layout
The pane SHALL have "Hide open items" and "Full screen". The pane width and the hidden state SHALL be kept in `agenta:builder:layout` for every chat.

#### Scenario: Hide and full screen
- **WHEN** the user clicks "Hide open items" or "Full screen"
- **THEN** the pane hides, or the pane takes the whole page, and a reload keeps that state

#### Scenario: Private agent
- **WHEN** the agent of the active builder tab is private
- **THEN** the tab has the tooltip "Only you can see and use it in Agenta."

### Requirement: Agent pane tabs
An agent tab SHALL show one row of pane tabs: Agent, Automations, Channels, Access, Drives and Sessions, with a count after Automations and Sessions when there are any. It SHALL open on Agent. Each pane tab SHALL show the same view as the right panel or the agent page.

#### Scenario: Agent tab drawn
- **WHEN** the active builder tab is "Email writer"
- **THEN** the pane tabs show "Agent", "Automations 1", "Channels", "Access", "Drives" and "Sessions 12", and the Agent section list shows "Model", "Instructions", "Integrations", "Subagents", "MCP servers", "Skills", "Secrets", "Permissions" and "Advanced" with their values (for example "Claude Code · Claude Haiku 5.5", "AGENTS.md 35 words", "1 integration", "None", "Policy · Allow reads")

#### Scenario: Same data as the agent page
- **WHEN** the user edits the Agent tab of "Email writer" in the pane and then opens its Configuration page
- **THEN** both show the same saved configuration

#### Scenario: Sessions tab
- **WHEN** the user opens Sessions and picks a session
- **THEN** the session shows inside the pane and the address does not change

#### Scenario: Tabs not drawn
- **WHEN** the user opens Automations, Channels, Access or Drives in an agent tab
- **THEN** the pane shows the same view as the Configuration page tab, the Channels page or the Files pane of that agent

### Requirement: Changes on the builder page use a change card
On the builder page, a change that the builder proposes SHALL show as the same change card as in the builder panel. "Approve" SHALL save a new version, or apply a change that is not part of a version. This follows DECIDED by Mahmoud (always a card).

#### Scenario: Builder proposes a change
- **WHEN** the builder proposes an edit to "Email writer" on the builder page
- **THEN** the chat shows the change card with "Saves as vN", "Deny" and "Approve" (see the change-cards capability)

### Requirement: Tabs follow the saved version
When a builder tool result says that the builder saved a new version of an agent with an open builder tab, that tab SHALL show the new saved version. A result with no change, a denied call or a refusal SHALL change nothing.

#### Scenario: Instructions changed
- **WHEN** an `edit_agent_config` result for "Email writer" has `status` "committed" and `revision.version` "5"
- **THEN** the "Email writer" tab shows v5 and its new instructions

#### Scenario: Nothing changed
- **WHEN** the result has `status` "no_change", or the call was denied or refused
- **THEN** no builder tab changes

### Requirement: Changed rows are marked
When the builder saved a new version of an agent with an open builder tab, each changed section row of its Agent pane tab SHALL show "Changed by the builder". The rows SHALL come from the first segment of each operation target (for example `instructions`, `skills`, `mcps`, `tools`). PROPOSED: the mark SHALL stay until the user opens that row or closes the tab.

#### Scenario: Instructions changed by the builder
- **WHEN** the builder saved a version of "Email writer" with an operation on `instructions`
- **THEN** the Instructions row shows "Changed by the builder", and the other rows show no mark

#### Scenario: User opens the row
- **WHEN** the user opens the Instructions row
- **THEN** the mark goes away

#### Scenario: Target with no row
- **WHEN** an operation target names a part that has no row on the Agent tab
- **THEN** no row is marked, and the result row in the chat still shows the change

### Requirement: Follow the builder with the 10 second rule
When the builder changes the configuration of the agent in the active builder tab, the tab SHALL move to its Agent pane tab. When the builder starts a test run of that agent, it SHALL move to Sessions. If the user clicked in the pane in the last 10 seconds, the view SHALL stay and the other pane tab SHALL get a dot (a change) or a spinner (a test).

#### Scenario: Follow a change
- **WHEN** the active builder tab "Email writer" shows Sessions, the user did not click in the pane for 10 seconds, and the builder saves a change to "Email writer"
- **THEN** the tab moves to Agent and the changed row shows "Changed by the builder"

#### Scenario: User is working in the pane
- **WHEN** the user clicked in the pane 4 seconds ago and the builder saves a change to the agent of the active tab
- **THEN** the view stays, and the Agent pane tab shows a dot

#### Scenario: Follow a test
- **WHEN** the builder starts a test run of the agent in the active tab and the user did not click in the pane for 10 seconds
- **THEN** the tab moves to Sessions and shows the test session

#### Scenario: Test while the user works
- **WHEN** the builder starts a test run while the user clicked in the pane in the last 10 seconds
- **THEN** the view stays, and the Sessions pane tab shows a spinner

#### Scenario: Change to a tab that is not active
- **WHEN** the builder changes an agent whose builder tab is open and not active
- **THEN** that builder tab shows a dot, and the active tab does not change

#### Scenario: Dot goes away
- **WHEN** the user opens a pane tab or a builder tab that shows a dot
- **THEN** the dot goes away

### Requirement: Test tab with a read-only session
While the builder tests an agent (the test run tool is provided by the builder agent work), the Sessions pane tab of that agent SHALL show the test session read only: the line "The builder is testing {{agent}}.", "Reply", the state "Writing" and no composer. "Reply" SHALL open the message box of that session. When the test ends, the line and the state SHALL go away, and the session SHALL stay in the Sessions list with the builder spark.

#### Scenario: Test runs
- **WHEN** the builder runs a test of "Email writer" on the lead "Zahnwerk GmbH"
- **THEN** the Sessions pane tab shows the test session with the turn as it streams, "Writing", "The builder is testing Email writer." and "Reply", and no composer

#### Scenario: Reply
- **WHEN** the user clicks "Reply" during the test
- **THEN** the message box of that session opens, and a sent message goes to that session

#### Scenario: Test ends
- **WHEN** the test run ends
- **THEN** the line and "Writing" go away, and the session stays in the Sessions list with the spark "Started by the builder"

#### Scenario: Test fails
- **WHEN** the test run fails
- **THEN** the session shows the production run error, and the builder chat shows the tool result

#### Scenario: No right to read the session
- **WHEN** the user cannot read the test session
- **THEN** the Sessions pane tab shows the production no-access state for that session

### Requirement: Hero animation
The new chat hero SHALL take one state input with four values: `idle`, `typing`, `thinking` and `done`. It SHALL draw one still frame when `prefers-reduced-motion` is on, pause when the browser tab is hidden or the hero is off screen, and show a still fallback when the browser cannot draw the variant. It SHALL load with `next/dynamic` and SHALL NOT change the `speed:check` budget. Until Mahmoud picks the variant (OPEN-QUESTIONS choice 1.1), it SHALL show the current ring.

#### Scenario: States
- **WHEN** the composer is empty, then the user types, then sends, then the first answer ends
- **THEN** the hero state is `idle`, then `typing`, then `thinking`, then `done`, and each change moves smoothly with no jump

#### Scenario: Reduced motion
- **WHEN** the operating system asks for reduced motion
- **THEN** the hero shows one still frame and does not animate

#### Scenario: Hidden or off screen
- **WHEN** the browser tab is hidden or the hero scrolls off screen
- **THEN** the hero stops drawing until it shows again

#### Scenario: No graphics support
- **WHEN** the browser cannot draw the chosen variant (for example no WebGL, or a lost WebGL context)
- **THEN** the hero shows the still fallback, and the page works

#### Scenario: Theme
- **WHEN** the theme changes between light and dark
- **THEN** the hero uses the app's ink tokens of that theme

### Requirement: Builder page states
The builder page SHALL show a loading state, an error state and a no-access state in the layout of the page.

#### Scenario: Chat loads
- **WHEN** a builder chat opens and its history loads
- **THEN** the conversation shows skeleton rows (as production sessions)

#### Scenario: Builder run fails
- **WHEN** a builder run fails
- **THEN** the chat shows the production run error and "Try again"

#### Scenario: Chat of another person
- **WHEN** a user opens the address of a builder chat of another person
- **THEN** the page shows the production state for a session the user cannot open

#### Scenario: Long chat
- **WHEN** a builder chat has many turns
- **THEN** the conversation scrolls as a production session does, and the pane stays
