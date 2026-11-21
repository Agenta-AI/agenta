## ADDED Requirements

### Requirement: Views of the subagents and MCP flows

The subagent and MCP flows SHALL use the `agent-panel` view contract. "Add subagents", "Add MCP server" and the MCP server view SHALL have `apply: "immediate"`. The subagent view SHALL have `apply: "on_save"` with the target `agent_draft`. "Connect server" SHALL have `apply: "on_save"` and store the server in the project. A view SHALL address a subagent by `ConfigItemRef` `{list: "tools", key}` and an MCP server by `{list: "mcps", key}`, and SHALL report its title with `useViewTitle`.

#### Scenario: Targets in the agent panel
- **WHEN** the Subagents or MCP servers section opens a view
- **THEN** the view gets the target `agent_draft`, and each add, remove, description, permission or account source change writes the agent configuration, and auto-save saves it as a new version shortly after

#### Scenario: Targets in Settings
- **WHEN** Settings › MCP opens "Connect server" or a server view
- **THEN** the view gets the target `project`, and nothing is added to an agent

#### Scenario: Title from the view
- **WHEN** the server view of "linear" is open
- **THEN** the breadcrumb shows "linear" from `useViewTitle`, and the view params hold only the address

#### Scenario: The item leaves the list under the open view
- **WHEN** a builder save removes the open subagent or MCP server from the agent
- **THEN** the view finds no item with its key and shows the removed state with Back, and no other item shows in its place (text not written; listed for Mahmoud)

#### Scenario: Remove dialogs
- **WHEN** the user removes a subagent or an MCP server from the agent
- **THEN** the remove dialog (canvas F06 frame 2) asks first; it lives in `@agenta/entity-ui` next to the agent sections

### Requirement: Add subagents view

"+" on the Subagents section SHALL open "Add subagents": a search field "Search agents by name…" and the project's agents, each with name and description. A click on an agent SHALL add it to the agent configuration; a second click SHALL remove it. Added agents SHALL show "Added". A load error SHALL show as one line with "Retry". "Done" SHALL go back with no question.

#### Scenario: Add and remove
- **WHEN** the user clicks "Lead finder"
- **THEN** the agent gains the subagent "Lead finder" and the row shows "Added"
- **WHEN** the user clicks "Lead finder" again
- **THEN** the agent loses it and the row shows the add icon

#### Scenario: An agent with no description
- **WHEN** an agent has no description
- **THEN** its row shows the production text "No description"

#### Scenario: Some agents could not load
- **WHEN** one agent of the project could not be loaded
- **THEN** the list ends with "1 agent could not be loaded, so it is not listed." and "Retry"
- **AND** "Retry" loads the list again

#### Scenario: Empty and no match
- **WHEN** the project has no other agent
- **THEN** the view shows the production texts "No agents yet" and "Create an agent, then come back to add it here."
- **WHEN** no agent matches the search
- **THEN** the view shows "No agents match your search" and "Try a different name."

#### Scenario: Loading
- **WHEN** the agents are loading
- **THEN** the view shows skeleton rows in the same layout

### Requirement: Subagent view

A click on a subagent row SHALL open its view. Only "Description" SHALL be editable; the field starts 5 lines high and grows. Under it SHALL show the production hint. "Configuration" with "Read-only" SHALL show the subagent's model, instructions (4 lines behind a fade), integrations with their permission, and skills by name, with "Open agent" in its title. The footer SHALL have "Remove from agent", "Cancel" and "Save".

#### Scenario: Open a subagent
- **WHEN** the user clicks "Email writer"
- **THEN** the view shows "Description" with its text and "The agent reads this description to decide when to call this subagent. Edit it to change when it is used."
- **AND** "Configuration" with "Read-only" and "Open agent", "Model" "GPT-5.5 mini" (`gpt-5.5-mini`), "Instructions" "AGENTS.md" "96 words", "Integrations" "Gmail" "Allow all" and "HubSpot" "Ask for write and delete", and "Skills" "cold-email" and "plain-writing"

#### Scenario: Edit the description
- **WHEN** the user changes the description and clicks "Save"
- **THEN** the agent configuration holds the new description, auto-save saves it, and the view returns to the Agent tab
- **WHEN** the user clicks "Cancel"
- **THEN** the change is dropped

#### Scenario: Open agent
- **WHEN** the user clicks "Open agent"
- **THEN** the subagent opens in its own agent screen
- **AND** when the Description form has edits, the leave guard `confirmLeave` asks first, as the `agent-panel` spec says

#### Scenario: Skill names are plain text
- **WHEN** the user clicks a skill name in the read-only configuration
- **THEN** nothing happens; the way to read or change it is "Open agent"

#### Scenario: Remove from agent
- **WHEN** the user clicks "Remove from agent"
- **THEN** the remove dialog asks first, and "Remove" removes the subagent with this view's key from the agent

#### Scenario: Save, Cancel and leave
- **WHEN** the user changed the description and clicks the breadcrumb "Agent"
- **THEN** the unsaved-changes dialog asks first, with the production description "Save your changes to this agent draft, or discard them?"
- **WHEN** the user clicks "Cancel" instead
- **THEN** the change is dropped with no question

#### Scenario: Empty parts of the configuration
- **WHEN** the subagent has no model, no instructions, no integration or no skill
- **THEN** the row shows the production text "No model", "No instructions", "No connected apps" or "No skills"

#### Scenario: Configuration could not load
- **WHEN** the subagent's configuration cannot be read
- **THEN** the Description stays editable and the Configuration card says in plain words that it could not load, with "Try again"

#### Scenario: The subagent is not an agent
- **WHEN** the reference points to a workflow that is not an agent
- **THEN** the row shows the production tag "not an agent"

#### Scenario: Empty section
- **WHEN** the agent has no subagent
- **THEN** the section shows the production line "No subagents yet"

### Requirement: Full instructions in place

"Show full instructions" SHALL open the whole instruction text in place, in a box that scrolls after 320 px, and the link SHALL turn into "Hide instructions".

#### Scenario: Show and hide
- **WHEN** the user clicks "Show full instructions"
- **THEN** the full text shows in a box of at most 320 px with its own scroll, and the link reads "Hide instructions"
- **WHEN** the user clicks "Hide instructions"
- **THEN** the box returns to 4 lines behind a fade

### Requirement: Add MCP server view

"+" on the MCP servers section SHALL open "Add MCP server": a search field "Search servers", the button "Connect server", and the project's servers with name, host and tool count. An added server SHALL show "Added". A click on a server that is not added SHALL add it to the agent and open its server view at once. A server with an expired sign-in SHALL show it and "Reconnect".

#### Scenario: The list
- **WHEN** the user opens "Add MCP server"
- **THEN** the view lists "linear" with "mcp.linear.app · 12 tools" and "Added", "docs-search" with "mcp.acme.io · 4 tools" and the icon "Add to this agent", and "billing" with "billing.acme.io · Sign-in expired" and "Reconnect"

#### Scenario: Add goes to permissions
- **WHEN** the user clicks "docs-search"
- **THEN** the agent gains docs-search, and its server view replaces "Add MCP server" at depth 1 with the breadcrumb "Agent › docs-search"

#### Scenario: Reconnect from the list
- **WHEN** the user clicks "Reconnect" on "billing"
- **THEN** the reconnect step opens (see "Connect server step")

#### Scenario: No server yet
- **WHEN** the project has no MCP server
- **THEN** the view shows the production texts "No MCP servers in this project yet" and "Connect an MCP server by URL. You'll sign in or add a key once, and every agent in the project can use it."

#### Scenario: No match
- **WHEN** no server matches the search
- **THEN** the view shows the production text "No servers match"

### Requirement: Connect server step

"Connect server" SHALL open a view with "Server URL". Agenta SHALL check the URL by itself and show one line with the result and "Change", detect the authentication and mark it "Detected" among "OAuth", "API key" and "None", then show "Name" and a folded "Advanced" (callback URL, client ID, scopes). "Connect" SHALL save the server for the whole project.

#### Scenario: OAuth server
- **WHEN** the user enters "https://mcp.linear.app/mcp"
- **THEN** the line reads "Reachable · signs in with OAuth" with "Change", "OAuth" is selected with "Detected", and "Name" reads "linear"

#### Scenario: Other detected modes
- **WHEN** the server needs a key or no sign-in
- **THEN** the line reads the production text "Reachable · needs an API key" or "Reachable · no sign-in needed"

#### Scenario: OAuth wait
- **WHEN** the user clicks "Connect" on an OAuth server
- **THEN** the server's sign-in opens in a new window, and the view shows the production texts "Waiting for {name}…" and "Finish in the window that opened. Sign in to the provider if it asks, then approve Agenta. This closes on its own when you're done." with "Open the window again"
- **AND** when the sign-in arrives, the server view opens

#### Scenario: Sign-in cancelled
- **WHEN** the person cancels or denies the sign-in
- **THEN** the view shows the production text "{name} didn't authorize Agenta. The sign-in was cancelled or denied. Nothing was saved." and "Try again"

#### Scenario: API key step
- **WHEN** the detected mode is "API key"
- **THEN** the view shows the production secret step: pick a project secret or create one, and "Send as" with its options (as production)

#### Scenario: URL errors
- **WHEN** the address cannot be reached, is not an MCP server, or uses the old SSE transport
- **THEN** the view shows the production text "Couldn't reach this server.", "Reached the address, but it isn't an MCP server." or "This address uses the older SSE transport, which Agenta does not support." with its advice

#### Scenario: Advanced
- **WHEN** the user opens "Advanced"
- **THEN** it shows "Callback URL" with "Copy", "Client ID", "Client secret" and "Scopes", as production

#### Scenario: Connect in flight
- **WHEN** the user clicks "Connect" again, or the breadcrumb, while the server is saved
- **THEN** nothing happens until the save ends

#### Scenario: Leave with typed values
- **WHEN** the user typed a URL and clicks the breadcrumb
- **THEN** the unsaved-changes dialog asks first, with a description from the view that says Save stores the server in the project (text not written; listed for Mahmoud)
- **WHEN** the user clicks "Cancel" instead
- **THEN** the typed values are dropped with no question

### Requirement: MCP server view

The server view SHALL show the server name and host in the title, the Account part, "Default permission", a tool search and the tools by group, with the same permission rules as an integration. A state SHALL show only when something needs attention. An expired project sign-in SHALL show the tag "Sign-in expired" and "Reconnect" in the title line, with no banner. "Remove from agent" SHALL ask first. The view has "Done".

#### Scenario: A healthy server
- **WHEN** the user opens "linear" with a working sign-in
- **THEN** the title reads "linear" and "mcp.linear.app" with no tag

#### Scenario: Expired sign-in
- **WHEN** the project's sign-in to linear expired
- **THEN** the title line shows "Sign-in expired" and "Reconnect"
- **AND** no banner shows

#### Scenario: Reconnect
- **WHEN** the user clicks "Reconnect"
- **THEN** the reconnect step opens and says "Permissions below are kept", and after the sign-in the server view returns with the same permissions

#### Scenario: Permissions
- **WHEN** the default is "Follow agent policy"
- **THEN** it reads "Follow agent policy" with "Follows agent policy for every tool", the groups read "Read-only · 7" with "follows agent policy" and "Write · 5" with "asks first"
- **AND** setting a tool switches the default to "Custom", 25 tools show per group then "Show N more", as in the `integrations-accounts` spec

#### Scenario: Tools could not load
- **WHEN** the tool list cannot be read
- **THEN** the view shows the production texts "Couldn't read this server's tools", "The tool list could not be read." and "Retry tools"

#### Scenario: Not connected
- **WHEN** the server has no project sign-in yet
- **THEN** the view shows the production text "{name} is not connected yet, so its tools cannot be listed." and "Connect"

#### Scenario: No access
- **WHEN** the viewer may not use the project's servers
- **THEN** the view shows the production text "You do not have access to this server's tools."

#### Scenario: Remove from agent
- **WHEN** the user clicks "Remove from agent"
- **THEN** the remove dialog asks first, "Remove" removes the server with this view's key from the agent, and the server stays in the project

### Requirement: MCP account switch

The Account part of a server view SHALL show "Choose whose {server} sign-in the agent uses" and a two-choice switch: "Each person's own" ("Everyone uses their own {server} sign-in.") and "One shared sign-in" ("Everyone uses the sign-in of the project."). The switch SHALL write the account source to the agent configuration at once, and auto-save SHALL save it. It SHALL be hidden when the personal accounts switch is off, when the server takes no sign-in, or when the server is not a project server.

#### Scenario: One shared sign-in
- **WHEN** the user picks "One shared sign-in"
- **THEN** the agent configuration sets the server's account source to `agent`
- **AND** "Shared sign-in" ("Every run uses this sign-in, whoever starts it") shows "The project's sign-in"

#### Scenario: Each person's own
- **WHEN** the user picks "Each person's own"
- **THEN** the agent configuration sets the account source to `user`, and "Your sign-in" shows

#### Scenario: Switch hidden
- **WHEN** the personal accounts switch is off, or the server's authentication is "None", or the server is one of Agenta's own servers
- **THEN** the switch does not show and the view shows only "Shared sign-in"

#### Scenario: Saved as each person's own while the switch is off
- **WHEN** the agent was saved with `user` and the personal accounts switch is now off
- **THEN** the view still shows that the server uses each person's own sign-in, so the saved value stays visible

### Requirement: Each person's own sign-in

With "Each person's own", "Your sign-in" ("The {server} sign-in your own runs use") SHALL show the viewer's state: "Not signed in yet" with "Sign in to {server}", signed in with "Sign out", or expired with the sign-in button. Each person SHALL sign in once per server; the sign-in serves every agent of the project. Other people SHALL see their own state.

#### Scenario: Not signed in yet
- **WHEN** the viewer has no own sign-in to linear
- **THEN** "Your sign-in" shows "Not signed in yet" and "Sign in to linear"

#### Scenario: Sign in with OAuth
- **WHEN** the viewer clicks "Sign in to linear" on an OAuth server
- **THEN** the server's sign-in opens in a new window, and when it arrives "Your sign-in" shows the signed-in state with "Sign out"

#### Scenario: Sign in with a token
- **WHEN** the server uses an API key
- **THEN** "Sign in to linear" opens a token field (production "Your token" and "Save"), and the token is stored as the viewer's own

#### Scenario: Own sign-in expired
- **WHEN** the viewer's own grant expired and cannot renew
- **THEN** "Your sign-in" shows the expired state (production "When you run it: your sign-in expired") with the sign-in button

#### Scenario: Sign out
- **WHEN** the viewer clicks "Sign out"
- **THEN** their own sign-in is deleted, and their runs of agents that use each person's own sign-in can no longer call this server

#### Scenario: Signed in
- **WHEN** the viewer is signed in
- **THEN** "Your sign-in" shows "Your sign-in: {{name}}" with "Sign out", or "Signed in" when the server gave no name (see "Account name of an own sign-in")

#### Scenario: Viewer may not edit the agent
- **WHEN** the viewer may not edit the agent
- **THEN** "Your sign-in" does not show, as in production, because those roles may not use the project's servers

### Requirement: Account name of an own sign-in

DECIDED: for a project server connected by address (`custom`), the server SHALL read the account name at a person's sign-in, store it with that person's grant and return it with the person's sign-in state. "Your sign-in" SHALL show "Your sign-in: {{name}}" with "Sign out". When the server gives no name, it SHALL show "Signed in" with "Sign out". A failed name read SHALL NOT fail the sign-in.

#### Scenario: OAuth sign-in with a name
- **WHEN** the viewer signs in to linear with OAuth and the token response or the server's user info names the account "Lena at Acme"
- **THEN** "Your sign-in" shows "Your sign-in: Lena at Acme" with "Sign out"

#### Scenario: Server gives no name
- **WHEN** the viewer signs in and neither the token response nor a user info read gives a name
- **THEN** "Your sign-in" shows "Signed in" with "Sign out", and the sign-in works

#### Scenario: Pasted token
- **WHEN** the viewer stores a token for an API key server
- **THEN** "Your sign-in" shows "Signed in" with "Sign out", because a token carries no account name

#### Scenario: Name read fails
- **WHEN** the user info read fails or times out after the grant is stored
- **THEN** the sign-in succeeds, no name is stored, and "Your sign-in" shows "Signed in"

#### Scenario: Two people signed in
- **WHEN** two people of the project signed in to linear with their own accounts
- **THEN** each person sees only their own name

#### Scenario: Sign-in state cannot load
- **WHEN** the server list fails to load
- **THEN** "Your sign-in" shows the production error state of the list with "Retry"

### Requirement: MCP runs without a person

When a server uses each person's own sign-in, the server view SHALL show the same warning as an integration (see the `integrations-accounts` spec), only when the agent has a channel or an automation created with an API key. A run without a person, or a person without a sign-in, SHALL get no fallback to the project's sign-in.

#### Scenario: The agent has a channel
- **WHEN** the server uses each person's own sign-in and the agent is connected to a channel
- **THEN** the warning shows under the switch (not drawn on the canvas; PROPOSED text in the `integrations-accounts` spec)

#### Scenario: A person without a sign-in runs the agent
- **WHEN** a person who has not signed in runs the agent and the agent calls the server
- **THEN** the call is refused, and the session shows the production MCP notice card with the way to sign in

### Requirement: One implementation in every place

The MCP server list, the connect step, the server view and the account part SHALL be one implementation each. Settings › MCP, the chat MCP notice card and the chat tool widget SHALL use the same connect step and server view. The subagent views SHALL be the only subagent views.

#### Scenario: Settings
- **WHEN** the user opens Settings › MCP and connects a server
- **THEN** the same connect step shows inside the Settings container

#### Scenario: Chat notice
- **WHEN** a session shows the MCP notice card and the user clicks its connect action
- **THEN** the same connect step shows, inside `DrawerViewChrome` or a dialog container, because the card has no view stack of its own
