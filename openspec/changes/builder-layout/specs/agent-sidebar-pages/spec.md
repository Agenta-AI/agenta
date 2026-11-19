## ADDED Requirements

### Requirement: Agent sections in the main sidebar
The main sidebar SHALL show one agent section per agent with the 4 latest sessions of that agent, newest first. A click on a session SHALL open it and keep the main sidebar. The "Sessions" row SHALL keep opening today's page with the sessions of all agents.

#### Scenario: Sections with sessions
- **WHEN** the project has the agents "Support triage" and "Email writer", each with 5 or more sessions
- **THEN** each agent section shows the agent name and its 4 latest sessions, and no fifth session

#### Scenario: Agent with fewer than 4 sessions
- **WHEN** an agent has 2 sessions
- **THEN** its section shows these 2 sessions and no empty rows

#### Scenario: Agent with no session
- **WHEN** an agent has no session
- **THEN** its section shows the agent name only, and "+" starts its first session

#### Scenario: Click on a session
- **WHEN** the user clicks "Charged twice for March" in the "Support triage" section
- **THEN** that session opens in the middle of the screen, it is highlighted in the sidebar, and the main sidebar stays

#### Scenario: Running and waiting sessions
- **WHEN** a session in an agent section runs or waits for the user
- **THEN** its row shows the spinner or the amber state that today's sidebar shows

#### Scenario: Long session name
- **WHEN** a session name is longer than the row
- **THEN** the name is cut with an ellipsis and the full name shows on hover

#### Scenario: Loading and error
- **WHEN** the session list loads or fails to load
- **THEN** the sections show today's sidebar loading rows or error state (as production)

### Requirement: Hover actions on an agent section
On hover over an agent section header, the main sidebar SHALL show "+" and an open button. "+" SHALL start a new session of that agent. The open button SHALL replace the main sidebar with the agent sidebar of that agent and SHALL NOT change the page in the middle of the screen.

#### Scenario: Start a session from the section
- **WHEN** the user clicks "+" on the "Support triage" section (title "New session")
- **THEN** an empty session of "Support triage" opens with the cursor in the composer

#### Scenario: Open the agent sidebar
- **WHEN** the user clicks the open button on the "Support triage" section (title "Open Support triage")
- **THEN** the agent sidebar of "Support triage" slides in and the page in the middle does not change

#### Scenario: Touch screen
- **WHEN** the device has no hover
- **THEN** "+" and the open button are always visible on the section header

### Requirement: Agent sidebar content
The agent sidebar SHALL show, from top to bottom: Back, the agent name with the agent switcher and the fold button, New session, Configuration, Channels, Analytics, the link "Sessions" with the count of the agent's sessions, the latest sessions grouped by day, and a last row "Show N older sessions" when older sessions exist.

#### Scenario: Agent sidebar on a session
- **WHEN** the user is on a session of "Support triage" and the agent sidebar shows
- **THEN** it shows "Back", "Support triage", "New session", "Configuration", "Channels", "Analytics", "Sessions" with "42", the day groups "Today", "Yesterday" and "Earlier", and "Show 36 older sessions"

#### Scenario: Current page is marked
- **WHEN** the user is on the Configuration page of the agent
- **THEN** "Configuration" is marked as the current row, and no session row is highlighted

#### Scenario: No session yet
- **WHEN** the agent has no session
- **THEN** the sessions part shows no day group and no "Show N older sessions" row, and "New session" stays

#### Scenario: All sessions fit
- **WHEN** every session of the agent is in the list
- **THEN** the row "Show N older sessions" does not show

#### Scenario: Count is not known yet
- **WHEN** the session count has not loaded
- **THEN** "Sessions" shows without a number, and the number appears when it loads

#### Scenario: Agent was removed or the user lost access
- **WHEN** the agent of the agent sidebar is archived, deleted or no longer visible to the user
- **THEN** the app shows the main sidebar

### Requirement: Session links from the agent sidebar
In the agent sidebar, a click on a session SHALL open it and keep the agent sidebar. The link "Sessions" and the row "Show N older sessions" SHALL open the Sessions page of this agent.

#### Scenario: Click on a session in the agent sidebar
- **WHEN** the user clicks a session in the agent sidebar
- **THEN** the session opens and the agent sidebar stays

#### Scenario: Open the table
- **WHEN** the user clicks "Sessions" (title "See all sessions in a table") or "Show 36 older sessions"
- **THEN** the Sessions page of this agent opens

### Requirement: Back and fold in the agent sidebar
Back SHALL return to the place the user came from: the main sidebar or the Agents list. The fold button SHALL return to the main sidebar and SHALL keep the page in the middle.

#### Scenario: Came from the main sidebar
- **WHEN** the user opened the agent sidebar with the open button of an agent section and then clicks "Back"
- **THEN** the main sidebar shows and the page in the middle does not change

#### Scenario: Came from the Agents list
- **WHEN** the user opened the agent from the Agents list and then clicks "Back"
- **THEN** the Agents list opens with the main sidebar

#### Scenario: Fold
- **WHEN** the user clicks the fold button (title "Back to the main sidebar")
- **THEN** the main sidebar shows and the page in the middle does not change

#### Scenario: No earlier place
- **WHEN** the agent sidebar shows after a reload and the place before it is not known
- **THEN** "Back" shows the main sidebar

### Requirement: Agent switcher
The agent switcher SHALL list Builder and all agents the user can see. A pick SHALL keep the same kind of page when the other agent has it: Analytics goes to the other agent's Analytics, a session goes to the other agent's last opened session.

#### Scenario: From Analytics
- **WHEN** the user is on the Analytics page of "Support triage" and picks "Email writer"
- **THEN** the Analytics page of "Email writer" opens and the agent sidebar shows "Email writer"

#### Scenario: From a session
- **WHEN** the user is on a session of "Support triage" and picks "Email writer"
- **THEN** the last opened session of "Email writer" opens

#### Scenario: Target has no session
- **WHEN** the user is on a session and picks an agent with no session
- **THEN** an empty new session of that agent opens

#### Scenario: Pick Builder
- **WHEN** the user picks "Builder"
- **THEN** the builder page opens with a new chat and the builder sidebar (see the builder-page capability)

#### Scenario: Many agents
- **WHEN** the project has more agents than fit in the menu
- **THEN** the menu scrolls and has a search field

### Requirement: Which sidebar shows is kept per browser tab
The app SHALL store which sidebar shows (the main sidebar or the agent sidebar of one agent) in browser tab storage. A page that opens in a new browser tab or from a shared link SHALL show the main sidebar.

#### Scenario: Reload
- **WHEN** the agent sidebar of "Support triage" shows and the user reloads the page
- **THEN** the agent sidebar of "Support triage" shows again

#### Scenario: Shared link
- **WHEN** a user opens a link to a session in a new browser tab
- **THEN** the main sidebar shows

#### Scenario: Pages of other agents
- **WHEN** the agent sidebar of "Support triage" shows and the user opens a session of "Email writer" from the command palette
- **THEN** the agent sidebar switches to "Email writer"

#### Scenario: Pages that are not agent pages
- **WHEN** the agent sidebar shows and the user opens Settings, Home or the Agents list
- **THEN** the main sidebar shows

### Requirement: Opening an agent from the Agents list
A click on an agent in the Agents list SHALL open the last session of that agent that the user opened. When there is none, it SHALL open an empty new session of that agent. In both cases the agent sidebar SHALL show.

#### Scenario: Agent with an opened session
- **WHEN** the user clicks "Support triage" in the Agents list and last opened "Login fails on Safari"
- **THEN** "Login fails on Safari" opens and the agent sidebar of "Support triage" shows

#### Scenario: Agent with no opened session
- **WHEN** the user clicks an agent whose sessions the user never opened
- **THEN** an empty new session opens and the agent sidebar shows

#### Scenario: Last session was deleted
- **WHEN** the last opened session was deleted or archived
- **THEN** an empty new session opens

### Requirement: New session from the agent sidebar
"New session" SHALL open an empty session of the agent on its current saved version and SHALL put the cursor in the composer.

#### Scenario: New session
- **WHEN** the user clicks "New session" in the agent sidebar
- **THEN** an empty session opens on the latest saved version and the composer has the focus

### Requirement: A session row opens on the first click
A session row in the sidebar SHALL navigate on the first click with no wait. A double click on a row SHALL rename the session that the first click opened. The 220 ms hold before navigation SHALL be removed.

#### Scenario: Single click
- **WHEN** the user clicks a session row once
- **THEN** navigation starts in the same task as the click, with no timer

#### Scenario: Double click
- **WHEN** the user double clicks a session row
- **THEN** the session opens once (not twice), and the row of the open session shows the inline rename field

#### Scenario: Row that cannot be renamed
- **WHEN** the user double clicks an archived session or a session of another person
- **THEN** the session opens and no rename field shows (as production)

#### Scenario: Modifier click and middle click
- **WHEN** the user clicks with Ctrl, Cmd, Shift, Alt or the middle button
- **THEN** the browser opens the link as it does today (new tab or new window)

#### Scenario: Long press on touch
- **WHEN** a long press opens the row menu and the browser sends a click on release
- **THEN** the session does not open (as production)

### Requirement: Builder spark in the agent sidebar and the agent pages
A session row in the agent sidebar, in the main sidebar agent sections and on the Sessions page of the agent SHALL show the builder spark when the session has the origin `builder`, with the tooltip "Started by the builder" (session-screen capability). The Sessions page SHALL NOT add a "Started by" column or a "Builder" filter.

#### Scenario: Test session in the agent sidebar
- **WHEN** the builder ran a test of "Email writer" and the agent sidebar of "Email writer" lists the test session
- **THEN** the row shows the spark with the tooltip "Started by the builder"

#### Scenario: Locked Sessions page
- **WHEN** the user opens the Sessions page of "Email writer" with one builder-started session
- **THEN** that row shows the spark, and the table has no "Started by" column and no "Builder" filter

#### Scenario: No builder sessions
- **WHEN** no session of the agent has the origin `builder`
- **THEN** no row shows a spark

### Requirement: Configuration page
"Configuration" in the agent sidebar SHALL open the Configuration page with three tabs: Agent, Automations and Access. Only the Agent tab SHALL show the version and the save status, as production. A change on the Agent tab SHALL be saved by auto-save, as production does.

#### Scenario: Agent tab at a saved version
- **WHEN** the user opens the Configuration page of "Support triage" at version 4
- **THEN** the header shows "Configuration", "v4 · Today 09:12" and the save status "Saved as v4", and the Agent tab is open

#### Scenario: A change on the Agent tab
- **WHEN** the user changes the model on the Agent tab
- **THEN** auto-save saves the change as version 5 shortly after, and the header shows "Saved as v5" (see the configuration-draft capability)

#### Scenario: Other tabs have no version
- **WHEN** the user opens the Automations tab or the Access tab
- **THEN** the header shows no version and no save status

#### Scenario: Tab change keeps an open form
- **WHEN** the user has an open Instructions form with edits on the Agent tab and opens Access
- **THEN** the unsaved-changes dialog asks first, with "Keep editing", "Discard" and "Save changes"

#### Scenario: Leaving the page with an open form
- **WHEN** the user leaves the Configuration page while a view form has edits
- **THEN** the dialog asks with "Keep editing", "Discard" and "Save changes"; a change outside an open form is already saved by auto-save

### Requirement: Agent tab layout on the Configuration page
The Agent tab SHALL show a list of the sections at the left and one card per section at the right. A click in the list SHALL scroll to that section. Each section SHALL show its title, its action ("Change", "Edit" or "Add") and its items. An item or an action SHALL open the same view as in the right panel.

#### Scenario: Section list
- **WHEN** the Agent tab opens
- **THEN** the list shows "Model", "Instructions", "Integrations", "Subagents", "MCP servers", "Skills", "Secrets", "Permissions" and "Advanced", in this order

#### Scenario: Jump to a section
- **WHEN** the user clicks "Secrets" in the section list
- **THEN** the page scrolls to the Secrets card and "Secrets" is marked in the list

#### Scenario: Empty sections
- **WHEN** the agent has no subagent and no MCP server
- **THEN** the cards show "No subagents yet" and "No MCP servers yet" with "Add"

#### Scenario: Open an item
- **WHEN** the user clicks the skill "ticket-triage"
- **THEN** the skill view opens, the same view that the right panel shows (see the agent-panel capability)

#### Scenario: Long instructions
- **WHEN** the instructions are long
- **THEN** the Instructions card shows the start of AGENTS.md and the word count ("AGENTS.md 33 words"), and "Edit" opens the full editor

#### Scenario: Loading, error and no access
- **WHEN** the configuration loads, fails to load, or the user cannot edit the agent
- **THEN** the page shows skeleton cards in the same layout, an error with "Try again", or the read-only state of the section views

### Requirement: Automations tab on the Configuration page
The Automations tab SHALL show the automations of this agent with the same view as the Automations tab of the right panel. Changes on this tab SHALL apply at once and SHALL NOT create a version.

#### Scenario: Automations drawn
- **WHEN** the agent has the paused schedule "Morning check" and the app trigger "New Zendesk ticket"
- **THEN** the tab shows "Add automation", the group "Scheduled triggers" with "Daily at 08:00 UTC · paused", and the group "App triggers" with "Zendesk · Ticket created · last run 2m ago, completed"

#### Scenario: No automation
- **WHEN** the agent has no automation
- **THEN** the tab shows "No automations yet" and "Add automation" (see the automations-run-history capability)

### Requirement: Access tab
The Access tab SHALL show who can see the agent ("Private" or "Shared with project"), the owner and "Transfer ownership". Making the agent private SHALL ask for confirmation first. Changes SHALL apply at once.

#### Scenario: Private agent
- **WHEN** the agent is private and the user is the owner
- **THEN** the tab shows "Who can see this agent", "Private" selected with "Only you can see and use it in Agenta.", "Shared with project", "Owner" with the user's name and "(you)", and "Transfer ownership"

#### Scenario: Make private
- **WHEN** the owner selects "Private" on a shared agent
- **THEN** the production dialog "Make {agent} private?" asks first, with "Make private" and "Cancel", and nothing changes before "Make private"

#### Scenario: Share with the project
- **WHEN** the owner selects "Shared with project"
- **THEN** the change applies at once and a toast says "{agent} is now shared with the project."

#### Scenario: Transfer ownership
- **WHEN** the owner clicks "Transfer ownership"
- **THEN** today's transfer step opens with "New owner" and "Transfer to {name}", and the private-agent warning when the agent is private

#### Scenario: Not the owner
- **WHEN** the user is not the owner
- **THEN** the choices are read only and the tab says "Only {owner} can make this agent private or change its owner."

#### Scenario: Owner left the project
- **WHEN** the owner left the project
- **THEN** the tab shows the production text for an agent with no owner and, for a project admin, "Take ownership"

#### Scenario: Conflict, error and loading
- **WHEN** the sharing settings changed in another place, the save fails, or the settings load or fail to load
- **THEN** the tab shows the production texts for conflict, save failure and load failure with "Try again", and skeleton rows while it loads

### Requirement: Sessions page locked to the agent
The link "Sessions" in the agent sidebar SHALL open today's Sessions page with the Agent filter locked to this agent. The page SHALL start with "Group by" set to Date, SHALL hide the Agent column and SHALL NOT show a second "New session" button. The locked page SHALL keep its own filter state and SHALL NOT write the shared filter atoms of the all-agents page.

#### Scenario: Table drawn
- **WHEN** the Sessions page of "Support triage" opens
- **THEN** the toolbar shows "Search sessions" and the locked chip "Agent: Support triage" (tooltip "This page shows only this agent"), the columns are "Session", "Status" and "Updated", and the groups are "Pinned", "Today", "Yesterday" and "This week"

#### Scenario: Filter menu
- **WHEN** the user opens the filter menu
- **THEN** it shows "Group by" with "Date", "Type", "Status", "Agent" with "Support triage" and a lock, "Last activity", "Only archived" and "Reset to defaults", and the Agent row cannot change

#### Scenario: Reset keeps the lock
- **WHEN** the user clicks "Reset to defaults"
- **THEN** the other filters reset, Group by returns to Date, and the Agent filter stays on this agent

#### Scenario: The lock does not leak
- **WHEN** the user leaves the locked page and opens "Sessions" in the main sidebar
- **THEN** that page shows the sessions of all agents with the filters the user set there

#### Scenario: Row and paging
- **WHEN** the user clicks a row or "Load more"
- **THEN** the session opens, or 30 more sessions load (as production)

#### Scenario: Empty, loading, error
- **WHEN** the agent has no session, or the list loads or fails
- **THEN** the page shows the production empty, skeleton and error states

### Requirement: Analytics page locked to the agent
"Analytics" in the agent sidebar SHALL open today's Analytics page with the Agent filter locked to this agent. The card "Failures by agent" SHALL be hidden. The locked page SHALL keep its own filter state and SHALL NOT write the shared filter atom, so the filters of the Analytics tab in Settings do not change.

#### Scenario: Charts drawn
- **WHEN** the Analytics page of "Support triage" opens
- **THEN** it shows the range button "Last 7 days", "Filter", "Group", the locked Agent chip "Support triage" (tooltip "This page shows only this agent"), and the cards "Cost", "Runs", "Success rate" and "Tokens by type", each with "Explore"

#### Scenario: Explore a chart
- **WHEN** the user clicks "Explore" or a bar
- **THEN** today's Analytics drawer opens, with the agent filter applied

#### Scenario: Empty period
- **WHEN** the agent has no run in the range
- **THEN** the page shows the production empty state for a range with no runs

#### Scenario: No access to traces
- **WHEN** the user's role cannot read analytics
- **THEN** the page shows the production state for that role (as production)

### Requirement: Channels page
"Channels" in the agent sidebar SHALL open the Channels page of the agent. It SHALL list the connected channels first, then the channels the user can add. "Manage" SHALL open the manage view of a channel in the same page. "Connect" SHALL open the connect steps in the same page. Changes SHALL apply at once.

#### Scenario: One channel connected
- **WHEN** Slack is connected and Telegram and WhatsApp are not
- **THEN** the page shows "A channel lets people talk to Support triage in the chat app they already use.", the group "Connected" with Slack, its place and "last message 2m ago", and the group "Add a channel" with Telegram and WhatsApp and "Connect"

#### Scenario: Healthy channel has no tag
- **WHEN** a connected channel works
- **THEN** its row shows no "Connected" tag

#### Scenario: Broken channel
- **WHEN** a connected channel has a problem (for example a revoked token)
- **THEN** its row shows "Needs attention" and "Reconnect"

#### Scenario: No channel connected
- **WHEN** no channel is connected
- **THEN** the page shows only the group "Add a channel"

#### Scenario: Connect
- **WHEN** the user clicks "Connect" on Telegram
- **THEN** today's Telegram connect steps open in the page, with the breadcrumb "Channels › Telegram"

#### Scenario: Loading and error
- **WHEN** the channels load or fail to load
- **THEN** the page shows skeleton rows or the production reload error with "Try again"

### Requirement: Slack manage view
The manage view of a Slack channel SHALL open with the breadcrumb "Channels › Slack". It SHALL show where the agent answers, the Slack channels with their modes, who can message the agent, the Slack app, Advanced and "Disconnect". "Disconnect" SHALL ask first.

#### Scenario: Manage view drawn
- **WHEN** the user clicks "Manage" on Slack
- **THEN** the view shows the workspace "Acme Agency", "Where it answers" with "Direct messages" and "Slack channels", the channels "#support" with "Mentions only" and "#billing" with "Off", "Add channel", "Who can message the agent" with "Everyone", "Slack app" with "App credentials" and "Update", "Add another workspace, or your own Slack app" with "Add", "Advanced" and "Disconnect"

#### Scenario: Change a mode
- **WHEN** the user changes "#billing" from "Off" to "Mentions only"
- **THEN** the change applies at once, with no save button

#### Scenario: Disconnect
- **WHEN** the user clicks "Disconnect"
- **THEN** a confirmation asks first, and after the confirmation the page returns to the Channels list

#### Scenario: Back
- **WHEN** the user clicks "Channels" in the breadcrumb
- **THEN** the Channels list shows

### Requirement: Agent pages and the right panel
Every agent page SHALL show the Builder icon at the far right of its header. Pages that are not agent pages (Agents list, Home, Settings) SHALL have no right panel.

#### Scenario: Builder icon on the Configuration page
- **WHEN** the user is on the Configuration, Channels, Sessions or Analytics page of an agent
- **THEN** the header shows the Builder icon (title "Builder") at the far right

#### Scenario: No panel on the Agents list
- **WHEN** the user opens the Agents list with the builder panel open before
- **THEN** no right panel shows, and the panel comes back when the user returns to an agent page

### Requirement: Agent pages have their own address
Each agent page SHALL have an address that opens it directly: the Configuration page with its tab, the Channels page, a channel's manage view, the Sessions page and the Analytics page of the agent. The Configuration page SHALL be the agent route with `?view=configuration&tab=<tab>`. The agent pages SHALL be views of one agent route, and the builder panel's state SHALL survive a move between them. A reload SHALL show the same page and tab.

#### Scenario: Configuration address
- **WHEN** the user opens the Automations tab of the Configuration page of an agent
- **THEN** the address is the agent route with `?view=configuration&tab=automations`

#### Scenario: Builder panel state survives
- **WHEN** the builder panel is open with text in its composer, and the user moves from a session of the agent to its Configuration page and back
- **THEN** the composer text and the scroll position are as before (a remount that restores them is allowed)

#### Scenario: Reload on a tab
- **WHEN** the user is on the Access tab of the Configuration page and reloads
- **THEN** the Access tab of the same agent shows

#### Scenario: Link to an agent the user cannot see
- **WHEN** a user opens the address of an agent page for an agent that is private to someone else
- **THEN** the page says who the owner is and that they can share the agent, and shows no configuration
