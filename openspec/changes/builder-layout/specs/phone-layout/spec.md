## ADDED Requirements

### Requirement: Panels open full screen with a back arrow
On a phone (below 768 px), Files, Configuration and the Builder SHALL open as full screen views over the session, each with a back arrow at the top left that returns to the session. A view that opens from a content SHALL open full screen with a back arrow to the screen before it. The phone SHALL have no panel width, no drag edge and no widen button.

#### Scenario: Files
- **WHEN** the user taps Files in a session
- **THEN** Files covers the screen with the back arrow "Back to Session" and the title "Files", and the back arrow returns to the session

#### Scenario: Builder
- **WHEN** the user taps the Builder icon
- **THEN** the builder covers the screen with the back arrow, and the chat that opens follows the desktop rule (builder-panel capability)

#### Scenario: View at depth 1
- **WHEN** the user taps the row "Integrations" on the Agent tab and then the row "Zendesk"
- **THEN** each screen covers the one before it with a back arrow to it ("Back to Configuration", "Back to Integrations")

#### Scenario: View at depth 2
- **WHEN** the user taps "Add integration" and then "Connect" for GitHub
- **THEN** "Connect" covers the screen with a back arrow to "Add integration", and that screen has a back arrow to Integrations

#### Scenario: System back
- **WHEN** the user uses the browser or system back gesture in a full screen view
- **THEN** the app goes back one level, as the back arrow does

#### Scenario: Unsaved edits
- **WHEN** the user goes back from a view with unsaved edits
- **THEN** the dialog asks with "Keep editing", "Discard" and "Save changes"

#### Scenario: No desktop controls
- **WHEN** any full screen view is open on a phone
- **THEN** it shows no widen button and no drag edge

### Requirement: Phone shared contract
The phone container SHALL use the view stack with a phone chrome (back arrow and title), not a separate implementation. It SHALL pass a `readOnly` input to the views that are read only on a phone. It SHALL offer one bottom-sheet menu, one full-width primary action at the bottom of a list screen, and one sidebar sheet, and every phone screen SHALL use these.

#### Scenario: Same view on desktop and phone
- **WHEN** the integration view opens on a phone and in the desktop panel
- **THEN** both mount the same view; only the chrome differs

#### Scenario: Read-only input
- **WHEN** the phone container opens the Instructions view
- **THEN** it passes `readOnly`, and the view shows no edit control

#### Scenario: Width
- **WHEN** a window is 768 px wide or wider
- **THEN** the desktop layout shows (the panel, in overlay mode under 1100 px)

### Requirement: Session header has two rows on a phone
On a phone, the session header SHALL have two rows. Row 1 SHALL hold the menu button ("Open the sidebar"), the agent name with its agent menu, Configuration and Builder. Row 2 SHALL hold the session button with the session name, Files and Share. Long names SHALL be cut with an ellipsis; the icons SHALL stay visible.

#### Scenario: Header drawn
- **WHEN** a session "Charged twice for March" of "Support triage" is open at 390 x 844
- **THEN** row 1 shows the menu button, "Support triage", Configuration and Builder, and row 2 shows "Charged twice for March", Files and Share

#### Scenario: Long names
- **WHEN** the agent name and the session name are longer than their rows
- **THEN** each is cut with an ellipsis, and no icon leaves the screen

#### Scenario: Agent menu
- **WHEN** the user taps the agent name
- **THEN** the agent menu of the desktop opens as a bottom sheet with "Cancel"

#### Scenario: Running session
- **WHEN** a run is active in the session
- **THEN** the session button shows the production spinner

#### Scenario: Private agent of another user
- **WHEN** the session belongs to a private agent the user cannot see
- **THEN** the phone shows the production no-access state, and Configuration and Builder do not show

### Requirement: Session bottom sheet
The session button SHALL open the latest sessions of the agent in a bottom sheet with "New session". A tap on a session SHALL close the sheet and open that session. "New session" SHALL start a new session of the agent.

#### Scenario: Open the sheet
- **WHEN** the user taps the session button
- **THEN** a bottom sheet shows the latest sessions of "Support triage" newest first and "New session"

#### Scenario: Switch session
- **WHEN** the user taps "Login fails on Safari" in the sheet
- **THEN** the sheet closes and that session opens

#### Scenario: Loading and error
- **WHEN** the session list of the sheet loads or fails
- **THEN** the sheet shows the production loading rows or the production error state

#### Scenario: Only one session
- **WHEN** the agent has only the open session
- **THEN** the sheet shows that session and "New session"

### Requirement: Sidebar sheet
The menu button SHALL open the sidebar in a sheet from the left, 300 px wide, with rows at least 44 px high and a dimmed page behind it. Inside an agent the sheet SHALL show the agent sidebar; "Back" SHALL show the main sidebar in the same sheet. A tap on a row SHALL close the sheet and open the page. A tap on "Close the sidebar" or on the dimmed page SHALL close the sheet.

#### Scenario: Agent sidebar in the sheet
- **WHEN** the user taps the menu button inside "Support triage"
- **THEN** the sheet shows "Back", "Support triage", "Agent", "New session", "Configuration", "Channels", "Analytics", "Sessions", the groups "Today", "Yesterday" and "Earlier" with their sessions, and "Show older sessions"

#### Scenario: Back to the main sidebar
- **WHEN** the user taps "Back" in the sheet
- **THEN** the main sidebar shows in the same sheet

#### Scenario: Open a page
- **WHEN** the user taps "Channels"
- **THEN** the sheet closes and the Channels page opens

#### Scenario: Close
- **WHEN** the user taps "Close the sidebar" or the dimmed page
- **THEN** the sheet closes and the page does not change

#### Scenario: Long session name
- **WHEN** a session name is longer than its row (for example "Health check after a configuration change")
- **THEN** the name is cut with an ellipsis

#### Scenario: All sessions
- **WHEN** the user taps "Sessions" (title "See all sessions")
- **THEN** the sheet closes and the Sessions list of the agent opens

### Requirement: Files are read only on a phone
On a phone, Files SHALL list the files of the session with their type, name and size, and a tap on a file SHALL open it to read or download. Files SHALL show no edit, upload, rename or delete control on a phone.

#### Scenario: Files drawn
- **WHEN** Files opens for "Charged twice for March"
- **THEN** it shows "All files", "Modified", "agent-files", "4 items" and rows such as "triage-notes.md" with "1.2 KB"

#### Scenario: Open a file
- **WHEN** the user taps "refund-policy.pdf"
- **THEN** the file opens full screen to read, with download and a back arrow to Files

#### Scenario: No files
- **WHEN** the session has no file
- **THEN** Files shows the production empty state

#### Scenario: Load error
- **WHEN** the file list fails to load
- **THEN** Files shows the production error state, and the back arrow works

### Requirement: Builder full screen on a phone
On a phone, the builder SHALL cover the screen with a back arrow to the session. It SHALL show the new chat with "What should we change?", the line "I can change, test and explain Support triage.", the context chip, the quick actions "Improve", "Test", "Skills", "Automate" and "Explain", and "Recent chats" with "View all". It SHALL have no "Open in the builder".

#### Scenario: New chat drawn
- **WHEN** the user opens the builder in a session of "Support triage" with no recent chat that opens by the 2-day rule
- **THEN** the screen shows "New chat", "What should we change?", the chip "Support triage · Charged twice for March", the five quick actions and three recent chats with their ages ("3d", "8d", "15d")

#### Scenario: Quick action
- **WHEN** the user taps "Test" and then a ready request
- **THEN** the request fills the composer and nothing is sent

#### Scenario: Remove the context
- **WHEN** the user taps "Remove the context" on the chip
- **THEN** the chip goes away and the next message sends only the agent part

#### Scenario: No "Open in the builder"
- **WHEN** the builder is open on a phone
- **THEN** the title menu has no "Open in the builder"

#### Scenario: Run error
- **WHEN** a builder run fails
- **THEN** the chat shows the production run error and "Try again"

### Requirement: Change card on a phone
On a phone, the change card SHALL be the desktop card at full width. "Deny" and "Approve" SHALL be 44 px high. "Approve" SHALL save a new version, and the card SHALL then show "Saved as v5" with View and Revert. "View full diff" SHALL open the diff full screen with a back arrow to the chat. The approval SHALL stay docked at the bottom outside the transcript.

#### Scenario: Card drawn
- **WHEN** the builder proposes "Edit the instructions" for Support triage
- **THEN** the card shows "Instructions › AGENTS.md", the old and new lines, "View full diff · 14 lines", "Saves as v5", "Deny" and "Approve"

#### Scenario: Approve
- **WHEN** the user taps "Approve"
- **THEN** a new version is saved, and the card shows "Saved as v5" with View and Revert

#### Scenario: Full diff
- **WHEN** the user taps "View full diff · 14 lines"
- **THEN** the diff covers the screen with a back arrow to the chat

#### Scenario: Grouped card
- **WHEN** several changes wait in one grouped card
- **THEN** "Deny all" and "Approve all" are 44 px high, and each row opens its detail full screen

#### Scenario: Not the owner
- **WHEN** a user who is not the owner opens the chat
- **THEN** the card shows "Only the owner can approve" and no Approve button

### Requirement: Chat history on a phone
"View all", or "Chat history" in the title menu, SHALL open the chat history in the same full screen builder, with "Search chats..." and the chats newest first with their ages. The back arrow SHALL return to the chat. A tap on a row SHALL open that chat.

#### Scenario: History drawn
- **WHEN** the user taps "View all"
- **THEN** the screen shows "Chat history", "Search chats..." and rows such as "Shorter replies for billing tickets" with "3d"

#### Scenario: Open a chat
- **WHEN** the user taps "Add the refund skill"
- **THEN** that chat opens in the full screen builder

#### Scenario: No match
- **WHEN** the search matches no chat
- **THEN** the list shows the desktop "no chat matches" line

#### Scenario: Long title
- **WHEN** a chat title is longer than its row (for example "Urgency of the Safari ticket" in the title bar)
- **THEN** the title is cut with an ellipsis

#### Scenario: Loading and error
- **WHEN** the list loads or fails
- **THEN** it shows the desktop loading rows or the desktop error state

### Requirement: Configuration page on a phone
On a phone, the Configuration icon in a session and "Configuration" in the agent sidebar SHALL open the Configuration page with the three tabs Agent, Automations and Access. "Saved as v4" (title "Version history") SHALL sit at the end of the tab row. The Agent tab SHALL show one row per section with its current value; a tap on a row SHALL open the section as the next screen.

#### Scenario: Agent tab drawn
- **WHEN** the user opens Configuration for "Support triage" at 390 x 844
- **THEN** the tabs "Agent", "Automations" and "Access" and "Saved as v4" show, and the rows show "Model" "Claude Sonnet 5.5 · via Claude Code", "Instructions" "AGENTS.md · 33 words", "Integrations" "Zendesk", "Subagents" "None", "MCP servers" "None", "Skills" "ticket-triage, plain-writing", "Secrets" "BILLING_API_KEY, GITHUB_TOKEN", "Permissions" "Allow reads" and "Advanced" "Sandbox: Daytona"

#### Scenario: A change is saved
- **WHEN** the user changes a value on the Agent tab
- **THEN** auto-save saves it as a new version, and the end of the tab row shows "Saved as v5"

#### Scenario: No Channels tab
- **WHEN** the Configuration page shows on a phone
- **THEN** it has no Channels tab

#### Scenario: Long value
- **WHEN** a row value is longer than the row
- **THEN** the value is cut with an ellipsis

#### Scenario: No edit right
- **WHEN** the user may read but not edit the agent
- **THEN** the rows open their sections with no edit control, as on the desktop

### Requirement: Version history on a phone
"Saved as v4" SHALL open the version history full screen with a back arrow to Configuration. The user SHALL read each version and revert to one, with the desktop revert dialog.

#### Scenario: Revert
- **WHEN** the user taps a version and reverts to it
- **THEN** the desktop revert dialog asks first, and a confirmed revert saves a new version

#### Scenario: Loading and error
- **WHEN** the version list loads or fails
- **THEN** it shows the desktop loading state or the desktop error state

### Requirement: Integrations list on a phone
On a phone, the Integrations section SHALL show its integrations as a list with the account source line, and "Add integration" SHALL be a full-width button at the bottom. "Add integration" SHALL open the integration catalog full screen, which shows its category list or its content one at a time, as production does below 640 px. A tap on a row SHALL open the integration.

#### Scenario: List drawn
- **WHEN** the user opens Integrations of "Support triage"
- **THEN** the screen shows "Zendesk" with "Each person's own account" and the full-width "Add integration" at the bottom

#### Scenario: Add
- **WHEN** the user taps "Add integration"
- **THEN** the catalog opens full screen with a back arrow to Integrations

#### Scenario: Empty
- **WHEN** the agent has no integration
- **THEN** the desktop empty sentence shows above "Add integration"

### Requirement: Integration account switch on a phone
On a phone, the integration view SHALL show the desktop parts in one column: the account switch with "Each person's own" and "One shared account", the "Your account" select, the default permission, and the tools. Each tool row SHALL put its permission select on its own line so the tool name is not cut. "Remove from agent" and "Done" SHALL stay at the end.

#### Scenario: View drawn
- **WHEN** the user opens Zendesk
- **THEN** the screen shows "Choose whose Zendesk account the agent uses", "Each person's own" with "Everyone uses their own Zendesk account.", "One shared account" with "Everyone uses the account you pick.", "Your account" with "Use my default" and "Lena at Acme", "Default permission" "Ask for write and delete", "Search 14 tools", "Read-only · 6" and the tools

#### Scenario: Tool row
- **WHEN** the tool "Get ticket" shows
- **THEN** its name and line show in full and "Follow agent policy" sits on its own line

#### Scenario: Personal accounts off
- **WHEN** personal accounts are off
- **THEN** the switch is hidden, as on the desktop

### Requirement: Automations tab on a phone
On a phone, the Automations tab SHALL show the groups "Scheduled triggers" and "App triggers" with each automation, its switch and "⋯". "⋯" SHALL hold the desktop row menu entries. "Add automation" SHALL be a full-width button at the bottom.

#### Scenario: Tab drawn
- **WHEN** the user opens Automations of "Support triage"
- **THEN** the screen shows "Daily summary" with "Weekdays at 09:00 UTC · next in 14h", "New Zendesk ticket" with "Zendesk · Ticket created · last run 2m ago", and "Add automation" at the bottom

#### Scenario: Switch
- **WHEN** the user turns off "Daily summary"
- **THEN** the automation pauses at once, as on the desktop

#### Scenario: Empty
- **WHEN** the agent has no automation
- **THEN** the desktop empty state shows above "Add automation"

#### Scenario: Long line
- **WHEN** an automation line is longer than one row
- **THEN** the line wraps and is not cut to one line

### Requirement: "Add automation" bottom sheet
On a phone, "Add automation" SHALL open a bottom sheet with "App trigger", "Scheduled trigger" and "Create with AI", each with its line, and "Cancel". "Create with AI" SHALL open the builder full screen with the request in the composer and SHALL send nothing. Every menu with two to five entries that starts a form SHALL open the same way; a select SHALL stay a menu under its field.

#### Scenario: Sheet drawn
- **WHEN** the user taps "Add automation"
- **THEN** the sheet shows "App trigger" "React to an event from a connected app", "Scheduled trigger" "Run on a recurring schedule", "Create with AI" "Describe it and let AI set it up", and "Cancel"

#### Scenario: Create with AI
- **WHEN** the user taps "Create with AI"
- **THEN** the builder opens full screen with the request in the composer, and nothing is sent

#### Scenario: Cancel
- **WHEN** the user taps "Cancel" or the dimmed page
- **THEN** the sheet closes and nothing changes

### Requirement: Run history on a phone
On a phone, the run history of an automation SHALL show the list or one run, never both, as production does below 700 px. A tap on a run SHALL open it full screen with a back arrow to the list.

#### Scenario: Open a run
- **WHEN** the user taps a run in the list
- **THEN** the run covers the screen with a back arrow to the list

#### Scenario: No runs
- **WHEN** the automation has no run
- **THEN** the desktop "No runs yet" state shows with "Run now"

### Requirement: Model providers on a phone
On a phone, "Model providers" SHALL show the desktop list at full width with the groups "Agenta", "API keys" and "Subscriptions", "Edit" on each row, and "Add a provider or subscription" as a full-width button fixed at the bottom. "Edit" SHALL open the provider form full screen with Name first and the key second.

#### Scenario: List drawn
- **WHEN** the user opens Model providers from the Model section
- **THEN** the screen shows "Agenta" "Built-in", "API keys" with "Anthropic" and "OpenAI", "Subscriptions" with "ChatGPT" and "Claude" "Sign in needed" with "Sign in again", and "Add a provider or subscription"

#### Scenario: Edit
- **WHEN** the user taps "Edit" on "OpenAI"
- **THEN** the provider form covers the screen with a back arrow, Name first and the key second

#### Scenario: Key check on a phone
- **WHEN** the user pastes a key in the form
- **THEN** the key is checked as on the desktop (model-providers capability)

#### Scenario: No right to edit
- **WHEN** the user may not edit project secrets
- **THEN** the list shows no "Edit" and no "Add a provider or subscription", as on the desktop

### Requirement: Channels page on a phone
On a phone, "Channels" in the agent sidebar SHALL open the Channels page in one column. Channels SHALL be reachable only from the agent sidebar on a phone. "Connect" SHALL open the connect steps full screen with a back arrow.

#### Scenario: Page drawn
- **WHEN** the user opens Channels of "Support triage"
- **THEN** the page shows "Channels", "A channel lets people talk to Support triage in the chat app they already use.", "Connected" with "Slack" and "Acme Agency · #support, direct messages · last message 2m ago", and "Add a channel" with "Telegram" "Answer messages sent to a Telegram bot." and "WhatsApp" "Answer messages sent to a WhatsApp number.", each with "Connect"

#### Scenario: Connect
- **WHEN** the user taps "Connect" on Telegram
- **THEN** the connect steps cover the screen with a back arrow to Channels

#### Scenario: No channel
- **WHEN** the agent has no connected channel
- **THEN** "Connected" does not show and "Add a channel" stays

### Requirement: Access, Sessions and Analytics on a phone
On a phone, the Access tab SHALL keep its one choice with its confirmation. The Sessions list of an agent SHALL show as a list, as production tables do below 992 px. Analytics SHALL be read only in one column, with the tiles and charts stacked.

#### Scenario: Access
- **WHEN** the user changes "Private" to "Shared with project"
- **THEN** the desktop confirmation asks first

#### Scenario: Sessions list
- **WHEN** the user opens Sessions of an agent with 42 sessions
- **THEN** the sessions show as a list, and a tap opens the session

#### Scenario: Analytics
- **WHEN** the user opens Analytics
- **THEN** the tiles and charts stack in one column, and no filter edits the shared filters

#### Scenario: Loading and error
- **WHEN** one of these pages loads or fails
- **THEN** it shows the desktop loading or error state in one column

### Requirement: Read-only views on a phone
On a phone, these SHALL be read only: Instructions (AGENTS.md), the skill files and the skill editor, "Publish to skill registry", Add MCP server, Add subagent, and Advanced (Execution, Agenta tools, Build kit). A read-only view SHALL show its content with no edit control and SHALL NOT show a sentence such as "Edit on a computer".

#### Scenario: Instructions
- **WHEN** the user opens Instructions on a phone
- **THEN** the AGENTS.md text shows in full with no editor toolbar and no Save

#### Scenario: Skill
- **WHEN** the user opens the skill "ticket-triage" and taps a file
- **THEN** the file shows to read, with no edit, rename, delete or upload control and no "Publish to skill registry"

#### Scenario: Add MCP server and Add subagent
- **WHEN** the user opens MCP servers or Subagents
- **THEN** the lists show, with no add control

#### Scenario: Advanced
- **WHEN** the user opens Advanced
- **THEN** Execution, Agenta tools and Build kit show their values with no control

#### Scenario: A large change from a phone
- **WHEN** the user wants to change the instructions on a phone
- **THEN** the builder is the way: it proposes a change card that the user approves

### Requirement: Desktop-only parts
On a phone, the builder page SHALL have no tab row beside the chat, and an item SHALL open as its own full screen view with a back arrow to the chat. The builder SHALL have no "Open in the builder". The phone SHALL have no widen button and no panel drag edge.

#### Scenario: Item from the builder page
- **WHEN** a builder page chat on a phone shows the chip "Email writer"
- **THEN** a tap opens the agent full screen with "Back to the chat"

#### Scenario: Several builder tabs
- **WHEN** the chat has opened three items
- **THEN** no tab row shows on the phone, and each item opens from its chip in the chat

### Requirement: Touch targets are at least 44 px
On a phone, every control on every screen SHALL have a hit area of at least 44 by 44 px. Footer buttons SHALL be 44 px high. A control drawn smaller (a row "Edit", the session button, the context chip x) SHALL keep its drawn size and SHALL get an invisible hit area of 44 px around it.

#### Scenario: Back arrow
- **WHEN** a full screen view is open on a phone
- **THEN** the back arrow has a hit area of at least 44 by 44 px

#### Scenario: Small control
- **WHEN** the user taps 4 px outside the drawn edge of the context chip x
- **THEN** the context is removed

#### Scenario: Automated check
- **WHEN** the phone QA check runs on every phone screen at 390 x 844
- **THEN** it finds no hit area under 44 px and no element wider than the screen

### Requirement: Phone loading, error and empty states
On a phone, every full screen view SHALL show the loading, error, empty and no-access states of its desktop view, in one column.

#### Scenario: Loading
- **WHEN** a full screen view loads
- **THEN** it shows skeleton rows in its layout, and the back arrow works

#### Scenario: Error
- **WHEN** a full screen view fails to load
- **THEN** it shows the desktop error state with its retry, and the back arrow works

#### Scenario: Empty
- **WHEN** a list has no items
- **THEN** it shows the desktop empty sentence

#### Scenario: No access
- **WHEN** a screen names an item the user cannot see
- **THEN** it shows the desktop no-access state, and the back arrow works
