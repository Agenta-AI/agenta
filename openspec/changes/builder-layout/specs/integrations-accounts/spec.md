## ADDED Requirements

### Requirement: Views of the integrations flow

The integrations flow SHALL use the view contract of the `agent-panel` spec. "Add integration" and the integration view SHALL have `apply: "immediate"` and change their target at once. The connect view SHALL have `apply: "on_save"` and always the target `project`. Adding a new connection to the agent SHALL be a separate change by "Add integration". Views SHALL address an integration by `ConfigItemRef` `{list: "tools", key}` and set their title with `useViewTitle`.

#### Scenario: Targets in the agent panel
- **WHEN** the Integrations section opens "Add integration" or an integration view
- **THEN** the view gets the target `agent_draft`, and each add, remove, permission or account source change writes the agent configuration, and auto-save saves it as a new version shortly after
- **AND** the connect view opened from "Add integration" gets the target `project`

#### Scenario: Connect, then attach
- **WHEN** the user connects GitHub from "Add integration" in the panel
- **THEN** "Connect" creates the GitHub connection in the project at once, and when the connect view returns, "Add integration" adds GitHub to the agent with "Allow all" as a separate write, as production does once the connection is valid
- **AND** auto-save saves the agent with GitHub as a new version, and a later removal of GitHub from the agent keeps the connection

#### Scenario: Targets in Settings
- **WHEN** Settings › Integrations opens the catalog or the connect view
- **THEN** the view gets the target `project`, and nothing is added to an agent

#### Scenario: Title from the view
- **WHEN** the integration view of Zendesk with the connection "acme-support" is open
- **THEN** the breadcrumb shows "Zendesk" from `useViewTitle`, and the view params hold only the address

#### Scenario: The integration leaves the list under the open view
- **WHEN** a builder save removes Zendesk from the agent while its view is open
- **THEN** the view finds no item with its key and shows the removed state with Back, and no other integration shows in its place (text not written; listed for Mahmoud)

#### Scenario: A host that keeps a drawer
- **WHEN** the playground, a prompt, a revision or an automation run opens the catalog
- **THEN** the host wraps the same "Add integration" view in `DrawerViewChrome`

#### Scenario: Connect in Settings
- **WHEN** Settings › Integrations opens Connect for GitHub
- **THEN** the connect view shows inside `DrawerViewChrome` with the target `project`, and "Connect" adds GitHub to no agent

### Requirement: Integrations section rows and tags

The Integrations section of the Agent tab SHALL show one row per app with the app logo and name. A row SHALL show "Needs setup" with its reason under the name, "New" or "Edited" for an unsaved change, or "old format". A healthy row SHALL show no tag. Hover SHALL show a bin. A dot on the section header SHALL mark unsaved integration changes. A click on a row SHALL open the integration view.

#### Scenario: Rows with every tag
- **WHEN** the agent has Zendesk, Stripe with an expired sign-in, Gmail just added, GitHub, Linear with an unsaved change and HubSpot in the old format
- **THEN** the rows read "Zendesk", "Stripe" with "Needs setup" and "Sign-in expired", "Gmail" with "New", "GitHub", "Linear" with "Edited" and "HubSpot" with "old format"
- **AND** the header reads "Integrations" with "6 integrations" and a dot

#### Scenario: Needs setup reasons
- **WHEN** an integration cannot run
- **THEN** its reason is one of the production texts "No account chosen", "Sign-in expired", "Turned off", "Not found in this project", "Not shared with this project" or "No longer available"

#### Scenario: Remove from the row
- **WHEN** the user hovers a row and clicks the bin
- **THEN** the remove dialog (canvas F06 frame 2) asks first; it lives in `@agenta/entity-ui` next to the agent sections

#### Scenario: No integration yet
- **WHEN** the agent has no integration
- **THEN** the section shows the production line "No integrations yet" and the "+" on the header is the way to add

#### Scenario: Loading
- **WHEN** the integration catalog or the connections are still loading
- **THEN** the rows show their names from the agent configuration, and logos and tags fill in when they arrive

### Requirement: The "+" menu and "Create with AI"

The "+" on the Integrations header SHALL open a menu with two rows: "Create with AI" ("Describe it; the agent sets it up") and "Browse integrations" ("Pick an app and its actions"). "Create with AI" SHALL open the Builder content of the right panel with "I want to connect" in the builder composer, not sent.

#### Scenario: Create with AI
- **WHEN** the user clicks "+" and then "Create with AI"
- **THEN** the right panel swaps to Builder, and the builder composer holds "I want to connect" with the caret at the end
- **AND** nothing is sent

#### Scenario: Browse integrations
- **WHEN** the user clicks "Browse integrations"
- **THEN** the view "Add integration" opens with the breadcrumb "Agent › Add integration"

### Requirement: Add integration view

"Add integration" SHALL show a search field "Search apps...", a category select "All categories", the group "Connected" (the project's apps) and the group "All apps". A click on a connected app SHALL add it to the agent with "Allow all" at once and mark it "Added". An app with several connections SHALL show "Change" once added. A pending connection SHALL show "Pending" and open its finish step. "Done" SHALL go back with no question.

#### Scenario: Add a connected app
- **WHEN** the user clicks "Zendesk" under "Connected"
- **THEN** Zendesk is added to the agent with the preset "Allow all", auto-save saves it and the row shows "Added"

#### Scenario: An app with several connections
- **WHEN** Stripe has "2 connections" and is added
- **THEN** the row shows "Added" and "Change", and "Change" lets the user pick the other connection

#### Scenario: A pending connection
- **WHEN** the user clicks "Gmail" with "Pending"
- **THEN** the finish step opens with the production text "Finish connecting Gmail" and "Its sign-in was never completed, so agents can't use its tools yet."

#### Scenario: Connection actions
- **WHEN** the user hovers a connection under "Connected"
- **THEN** "Refresh", "Revoke" and "Delete" show, as in production, and "Revoke" and "Delete" ask first with the production dialogs

#### Scenario: Connect a new app
- **WHEN** the user clicks the connect icon on "GitHub" under "All apps"
- **THEN** the connect view opens at depth 2 with the breadcrumb "Agent › Add integration › GitHub"

#### Scenario: Search with no match
- **WHEN** no app matches the search
- **THEN** the view shows the production texts "No apps match “{query}”" and "Try another name, or look in all categories."

#### Scenario: Catalog error
- **WHEN** the app catalog fails to load
- **THEN** the view says in plain words that the apps could not load and shows "Try again"

#### Scenario: Loading
- **WHEN** the catalog is loading
- **THEN** the view shows skeleton rows in the same layout

### Requirement: Connect form as a view

The connect form SHALL be a view, not a modal. It SHALL show the app mark, "Connect {name}", the app description, "Name" (placeholder "e.g. My {name} Account"), "Who can use it" only when the personal accounts switch is on, and "Auth Method" only for apps that offer both OAuth and API Key. "Connect" SHALL start the sign-in and store the connection in the project, outside the agent's versions.

#### Scenario: Who can use it
- **WHEN** the personal accounts switch is on and the user opens Connect GitHub
- **THEN** "Who can use it" is a two-choice switch: "Only me" ("Only your own runs use it.") and "Everyone in {project}" ("Agents in this project can use it.")
- **AND** under the switch, the full production sentence of the selected choice shows: for "Only me", "Used when you run an agent that uses each person's own GitHub. Your first GitHub account becomes your default."; for everyone, "An agent in this project can use it as the agent's account, for every person who runs it."

#### Scenario: Personal accounts switch off
- **WHEN** the switch is off
- **THEN** "Who can use it" does not show and the connection belongs to the project

#### Scenario: Auth Method
- **WHEN** the app offers OAuth and API Key
- **THEN** "Auth Method" shows as a select with "OAuth" and "API Key"
- **WHEN** the app offers one way
- **THEN** "Auth Method" does not show

#### Scenario: OAuth sign-in
- **WHEN** the user clicks "Connect" with OAuth
- **THEN** the app's sign-in opens in a new window, and the view waits until the connection arrives, then returns to the view that opened it

#### Scenario: Popup blocked
- **WHEN** the browser blocks the sign-in window
- **THEN** the production text "Popup blocked. Redirecting in this tab." shows and the sign-in continues in the tab

#### Scenario: Connect in flight
- **WHEN** the user clicks "Connect" again, or the breadcrumb, while the connection starts
- **THEN** nothing happens until the start ends

#### Scenario: Cancel and leave
- **WHEN** the user typed a name and clicks "Cancel"
- **THEN** the form is dropped with no question
- **WHEN** the user typed a name and clicks the breadcrumb instead
- **THEN** the unsaved-changes dialog asks first, with a description from the connect view that says Save stores the connection in the project (text not written; listed for Mahmoud)

#### Scenario: Connect failed
- **WHEN** the server refuses to start the connection
- **THEN** the view keeps the form and says in plain words that the connection could not start, with the error detail in the logs

#### Scenario: First account becomes the default
- **WHEN** a person connects their first GitHub account with "Only me"
- **THEN** it becomes their default GitHub account

### Requirement: Integration view

A click on an integration row SHALL open its view with the app name and connection in the title, the Account part, "Default permission", a tool search and the tools by group. A state tag SHALL show only when something needs attention ("Not connected", "Sign-in expired", "Needs setup"). The view SHALL change the agent configuration at once and have "Done"; auto-save SHALL save the change. "Remove from agent" SHALL sit in the footer and ask first with the remove dialog in `@agenta/entity-ui`.

#### Scenario: A healthy integration
- **WHEN** the user opens Zendesk with the connection "acme-support"
- **THEN** the title reads "Zendesk" and "acme-support" with no "Connected" tag

#### Scenario: Remove from agent
- **WHEN** the user clicks "Remove from agent"
- **THEN** the dialog "Remove Zendesk from this agent?" asks with "The connection stays in the project." and the count of skills that mention the app
- **AND** "Remove" removes the item with this view's key from the agent and returns to the Agent tab

#### Scenario: Remove after the list changed
- **WHEN** a builder save added another integration above Zendesk while its view was open, and the user removes Zendesk
- **THEN** the agent loses Zendesk and keeps the other integration, because the remove uses the key, not the position

#### Scenario: Old format
- **WHEN** the integration is in the old format
- **THEN** the view shows the production texts "This integration uses the old format", its detail and "They keep running as they are. To set permissions here, remove the integration and add it again under one connection."

### Requirement: Per-tool permissions

"Default permission" SHALL offer the production presets. Setting one tool SHALL turn the default into "Custom" with the count of overrides. Picking a preset SHALL reset every tool. Tools SHALL be in folding groups ("Read-only", "Write and delete") with a count and a summary. A group SHALL list 25 tools, then "Show N more". A click on a description SHALL open the full text in place. A tool set to Deny SHALL have a red control.

#### Scenario: Custom after one change
- **WHEN** the default is "Ask for write and delete" and the user sets "Update ticket" to "Allow"
- **THEN** the default reads "Custom · 1 override"
- **AND** the note reads "Setting a tool's permission switches the default to Custom. Picking a preset resets them."

#### Scenario: Preset resets
- **WHEN** the default is "Custom · 3 overrides" and the user picks a preset
- **THEN** every tool follows the preset and the overrides are gone

#### Scenario: Long group
- **WHEN** a group has 40 tools
- **THEN** it shows 25 rows and "Show 15 more"; a click shows the next 25 or the rest

#### Scenario: Description opens in place
- **WHEN** the user clicks the description of "Close ticket"
- **THEN** the full text shows under the name without leaving the view

#### Scenario: Fold a group
- **WHEN** the user clicks the header of "Read-only · 6"
- **THEN** the group folds and its summary stays visible

#### Scenario: Search tools
- **WHEN** the user types in "Search 14 tools" and no tool matches
- **THEN** the view shows the production text "No tool here matches that."

#### Scenario: Tools could not load
- **WHEN** the tool list fails to load
- **THEN** the view shows the production text "Couldn't load Zendesk's tools, so per-tool permissions aren't listed. The default permission above still applies."

#### Scenario: Agent policy
- **WHEN** the agent's permission policy makes the tools follow it
- **THEN** the group summary reads "follows agent policy" and each tool shows "Follow agent policy"

### Requirement: Account switch

The Account part SHALL show the label "Account" with "Choose whose {app} account the agent uses" and a two-choice switch: "Each person's own" ("Everyone uses their own {app} account.") and "One shared account" ("Everyone uses the account you pick."). The switch SHALL write the account source to the agent configuration at once, and auto-save SHALL save it. The switch SHALL be hidden when the personal accounts switch is off; then only the shared account select shows.

#### Scenario: Pick each person's own
- **WHEN** the user picks "Each person's own"
- **THEN** the agent configuration sets the integration's account source to `user`
- **AND** the "Your account" select shows under the switch

#### Scenario: Pick one shared account
- **WHEN** the user picks "One shared account"
- **THEN** the agent configuration sets the account source to `agent` with the slug of the selected project connection
- **AND** the "Shared account" select shows under the switch

#### Scenario: Personal accounts off
- **WHEN** the personal accounts switch is off, or the person's own accounts could not be read
- **THEN** the switch does not show, and the view shows only "Shared account"

#### Scenario: Saved as each person's own while the switch is off
- **WHEN** the agent was saved with `user` and the personal accounts switch is now off
- **THEN** the view still shows that the integration uses each person's own account, so the saved value stays visible, and the warning of "Runs without a person" applies

### Requirement: Your account select

With "Each person's own", the select "Your account" ("The {app} account your own runs use") SHALL show only the viewer's own accounts. "Use my default" SHALL follow the viewer's default account, also when the default changes later. A pick SHALL apply to this agent only and SHALL save at once, outside the agent configuration. The list SHALL end with "Connect another {app} account".

#### Scenario: Default in use
- **WHEN** the viewer has no choice for this agent and their default Zendesk account is "Lena at Acme"
- **THEN** the select reads "Use my default" with "Lena at Acme"

#### Scenario: The select open
- **WHEN** the viewer opens the select
- **THEN** it lists "Use my default" with "Lena at Acme", "Lena sandbox", and "Connect another Zendesk account"

#### Scenario: Pick another account
- **WHEN** the viewer picks "Lena sandbox"
- **THEN** Agenta stores the account choice for this viewer and this agent at once, and the select reads "Lena sandbox"
- **AND** the agent configuration does not change and no new agent version is saved

#### Scenario: Back to the default
- **WHEN** the viewer picks "Use my default"
- **THEN** Agenta removes the viewer's account choice for this agent, so runs follow the default again

#### Scenario: Pick failed
- **WHEN** the choice cannot be stored
- **THEN** the select keeps the previous value and shows the production text "Could not save your choice. Try again."

#### Scenario: Other people
- **WHEN** another person opens the same integration
- **THEN** their "Your account" select shows their own accounts and their own choice

### Requirement: No account yet

When the viewer has no own account of the app, the select SHALL give way to "No account yet" and a "Connect {app}" button. The button SHALL open the connect view with only "Name", because an account connected here is always only the viewer's. The title SHALL show "Not connected".

#### Scenario: No Zendesk account
- **WHEN** the viewer has no Zendesk account of their own
- **THEN** the view shows "Not connected" under the title, "Your account" with "No account yet" and "Connect Zendesk"

#### Scenario: Connect from here
- **WHEN** the viewer clicks "Connect Zendesk"
- **THEN** the connect view opens with "Name" only and no "Who can use it"
- **AND** after the sign-in the select shows the new account, which is now the viewer's default

### Requirement: Shared account select

With "One shared account", the select "Shared account" ("Every run uses this account, whoever starts it") SHALL list the project's connections of the app. Every run SHALL use the selected one, also runs from an automation or a channel. The list SHALL end with "Connect another shared account", which opens the connect view with "Who can use it" set to everyone in the project.

#### Scenario: The select open
- **WHEN** the user opens "Shared account"
- **THEN** it lists "acme-support", "acme-eu-support" and "Connect another shared account"

#### Scenario: Pick a connection
- **WHEN** the user picks "acme-eu-support"
- **THEN** the agent configuration sets the slug to that connection

#### Scenario: No project connection
- **WHEN** the project has no connection of the app
- **THEN** the select is empty and offers "Connect another shared account" (text for this case is not drawn; see notes.md)

#### Scenario: A saved slug that is gone
- **WHEN** the saved slug names a connection that no longer exists
- **THEN** the select still shows the saved slug, and the row shows "Needs setup" with "Not found in this project"

### Requirement: Runs without a person

DECIDED: when an integration uses each person's own account, the view SHALL warn only when the agent has a channel or an automation created with an API key, because those runs have no person. An automation saved in the app runs as the person who saved it and SHALL NOT trigger the warning. The text is PROPOSED: "Runs from a channel or from an automation created with an API key have no person. They cannot use each person's own account, so this integration is not available to them."

#### Scenario: The agent has a channel
- **WHEN** the integration uses each person's own account and the agent is connected to a channel
- **THEN** the warning shows under the switch with the PROPOSED text

#### Scenario: The agent has an automation saved in the app
- **WHEN** the only automation of the agent was saved by a person in the app
- **THEN** no warning shows, because that automation runs as the person who saved it and uses their account

#### Scenario: The agent has an automation created with an API key
- **WHEN** an automation of the agent was created with an API key
- **THEN** the warning shows

#### Scenario: Shared account chosen
- **WHEN** the integration uses one shared account
- **THEN** no warning shows

#### Scenario: No channel and no API key automation
- **WHEN** the integration uses each person's own account and the agent has no channel and no automation created with an API key
- **THEN** no warning shows

### Requirement: One implementation in every place

The integration catalog, the connect view, the integration view with its permissions and the account part SHALL be one implementation each. Every other place that shows them today SHALL use the new views, and the three integration catalogs SHALL merge into one.

#### Scenario: Settings
- **WHEN** the user opens Settings › Integrations
- **THEN** it uses the same catalog and the same connect view

#### Scenario: Composer integration picker
- **WHEN** the user adds an app from the playground, a prompt, a revision or an automation run
- **THEN** the same catalog and the same connect view show inside that place's container (`DrawerViewChrome` where the place keeps a drawer)

#### Scenario: MCP permissions
- **WHEN** the user opens an MCP server's permissions
- **THEN** the same permission list shows, because the MCP permission view mounts it (see the `mcp-subagents` spec)
