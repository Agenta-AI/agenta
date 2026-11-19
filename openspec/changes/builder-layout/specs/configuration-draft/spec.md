## ADDED Requirements

### Requirement: Configuration tabs

The Configuration content of the right panel SHALL have the tabs "Agent", "Automations", "Channels" and "Access", as the approved canvas draws them. "Agent" SHALL open when no tab is stored; after that the panel SHALL open on the stored tab (agent-panel capability). The "Channels" tab SHALL mount the same view as the Channels page. The Configuration page has three tabs (agent-sidebar-pages capability).

#### Scenario: Open Configuration the first time
- **WHEN** the user opens the Configuration content and no tab is stored
- **THEN** the tabs "Agent", "Automations", "Channels" and "Access" show, with "Agent" selected

#### Scenario: Channels tab
- **WHEN** the user opens the "Channels" tab of the panel
- **THEN** it shows the same channel list and actions as the Channels page, and changes apply at once

#### Scenario: Change tabs while a save runs
- **WHEN** an edit on the Agent tab is saving and the user opens "Automations" and then "Agent" again
- **THEN** the save goes on, and the Agent tab shows the saved version when it lands

#### Scenario: Version only on the Agent tab
- **WHEN** the user opens "Automations", "Channels" or "Access"
- **THEN** the footer with the save status and "Version history" does not show

### Requirement: Agent tab sections

The Agent tab SHALL list these sections in this order: Model, Instructions, Integrations, Subagents, MCP servers, Skills, Secrets, Permissions, Advanced. Each section SHALL show its title and a short summary. Integrations, Subagents, MCP servers, Skills and Secrets SHALL have an "Add" button ("+"). Every row and every "+" SHALL open a view in the same container. No section SHALL open a drawer.

#### Scenario: Sections with items
- **WHEN** the agent has a model, AGENTS.md, one integration, two skills and two secrets
- **THEN** the tab shows rows such as "Model" with "Claude Code · Claude Sonnet 5.5", "Instructions" with "AGENTS.md" and "33 words", "Integrations" with "1 integration" and the row "Zendesk", "Skills" with "2 skills", "Secrets" with "2 attached", "Permissions" with "Policy · Allow reads", and "Advanced"

#### Scenario: Empty sections
- **WHEN** the agent has no subagent and no MCP server
- **THEN** those sections show "None" and their "+" button

#### Scenario: Empty integrations
- **WHEN** the agent has no integration
- **THEN** the Integrations section shows the production line "No integrations yet", and "+" is the way to add

#### Scenario: Open a row
- **WHEN** the user clicks the row "AGENTS.md"
- **THEN** the AGENTS.md editor opens as a view in the same container with the breadcrumb "Agent › AGENTS.md"

#### Scenario: Secrets is its own section
- **WHEN** the agent has secrets attached
- **THEN** they show in the Secrets section after Skills, not inside Advanced

#### Scenario: Read only
- **WHEN** the user has no right to edit agents
- **THEN** the sections show their items with no "+" and no bin, and nothing is saved

### Requirement: Changes save automatically

Every change to the agent configuration SHALL be saved as a new version about 1500 ms after the last edit, as production does, in every host of the agent configuration. A view with "Cancel" and "Save" SHALL apply its form to the agent configuration on "Save"; the automatic save then saves the version. A view that applies at once (for example a model pick) SHALL change the configuration at once, and the automatic save saves it.

#### Scenario: Edit in a view with Save
- **WHEN** the user changes AGENTS.md in the Instructions view and clicks "Save"
- **THEN** the view goes back, and about 1500 ms later a new version is saved with the new text

#### Scenario: Pick a model
- **WHEN** the user picks "Claude Opus 5.5" in the Model view
- **THEN** the Model row shows the new model at once, and a new version is saved about 1500 ms later

#### Scenario: Several edits in a short time
- **WHEN** the user adds Gmail and changes a Linear permission within one second
- **THEN** one version holds both changes, with the production commit message built from the changes

#### Scenario: Ephemeral onboarding agent
- **WHEN** onboarding shows an agent that is not created yet
- **THEN** no version is saved, as production

#### Scenario: Non-agent playground
- **WHEN** the user edits a prompt or an evaluator in the playground
- **THEN** that surface keeps its own production save behavior

### Requirement: Save status and version in the footer

The footer of the Agent tab SHALL show the production save status and the version: a dot with "Saving…" while a save is armed or runs, "Draft" when edits are not saved and no save is coming, "Not saved" with a retry when a save failed, and "Saved" for a moment after a save lands, next to the version ("Saved as v4" when settled). A click SHALL open the version history.

#### Scenario: No changes
- **WHEN** the agent is on v4 and nothing changed
- **THEN** the footer shows the version v4 with the saved dot, and a click opens "Version history"

#### Scenario: Save runs
- **WHEN** the user picks a new model on v4
- **THEN** the footer shows "Saving…", then "Saved" with v5 for a moment, then the dot only

#### Scenario: Save fails
- **WHEN** the save request fails twice (the production retry after 3000 ms also fails)
- **THEN** the footer shows "Not saved" with the production tooltip and a click retries the save

#### Scenario: Newer version from elsewhere
- **WHEN** the builder saves v5 while the user has no open form with edits
- **THEN** the browser runs the latest-version check when the builder result arrives, the session follows the saved version (session-screen capability), and the footer shows v5

### Requirement: Dirty means an open form with edits

A view form with edits that the user did not apply with "Save" SHALL count as dirty. Session adoption and the leave guard (agent-panel capability) SHALL check it. The agent configuration itself has no long-lived unsaved state, because the automatic save saves it.

#### Scenario: Open form with typed text
- **WHEN** the Instructions view holds typed text that the user did not save
- **THEN** the view counts as dirty, and an open session does not adopt a newer version; it offers the update

#### Scenario: No open form
- **WHEN** no view has edits and a save is running
- **THEN** nothing counts as dirty for the leave guard, and the save goes on

### Requirement: Leaving with an open form with edits

An open view form with edits SHALL register with the leave guard `confirmLeave` of the agent layout host. Leaving the view, closing the panel or leaving the agent SHALL ask with "You have unsaved changes", "Keep editing", "Discard" and "Save changes". "Save changes" SHALL apply the form; the automatic save then saves the version. "Discard" SHALL drop the form.

#### Scenario: Open another agent with typed text
- **WHEN** the Instructions view holds typed text and the user opens a session of another agent
- **THEN** the dialog opens; "Save changes" applies the text, the other agent opens, and the version is saved

#### Scenario: Discard
- **WHEN** the user picks "Discard" in the dialog
- **THEN** the typed text is dropped and nothing is saved

#### Scenario: Another session of the same agent
- **WHEN** no view has edits and the user opens another session of the same agent
- **THEN** no dialog opens

#### Scenario: Close the browser tab
- **WHEN** a view form has edits and the user closes or reloads the browser tab
- **THEN** the browser asks before it leaves

### Requirement: What is versioned and what applies at once

Only the Agent tab SHALL be part of a version. Changes on the Automations tab, the Access tab and the Channels page SHALL apply at once and SHALL NOT save a version. A project resource that a flow of the Agent tab creates (an app connection, a model provider, an MCP server connection, a secret in the vault) SHALL be stored for the project at once. Adding it to the agent SHALL change the agent configuration, and the automatic save saves a version.

#### Scenario: Pause an automation
- **WHEN** the user pauses an automation on the Automations tab
- **THEN** the change is stored at once, and the Agent tab footer does not change

#### Scenario: Connect an app during Add integration
- **WHEN** the user connects GitHub in "Add integration" and adds it to the agent
- **THEN** two writes happen: the connect view creates the GitHub connection in the project at once, and "Add integration" then adds GitHub to the agent, which the automatic save saves as a new version

#### Scenario: Remove the integration again
- **WHEN** the user then removes GitHub from the agent
- **THEN** a new version without GitHub is saved, and the GitHub connection stays in the project

#### Scenario: Attach a secret in the Secrets section
- **WHEN** the user attaches a secret to the agent in the Secrets section
- **THEN** the attachment changes the agent configuration and the automatic save saves a new version

### Requirement: Secret request dock as production

The secret request dock in a running chat SHALL keep its production save path and its production rules, including the text "Save or discard your agent changes first." while the configuration has unsaved changes.

#### Scenario: Dock answer
- **WHEN** a run asks for a secret and the agent has no unsaved changes
- **THEN** the dock attaches the secret and saves a new version, as production does

#### Scenario: Dock answer while a change is saving
- **WHEN** a run asks for a secret while a change of the agent is not saved yet
- **THEN** the dock shows the production text and attaches after the save, as production does

### Requirement: Instructions editor

The AGENTS.md editor SHALL be a wide view with `apply: "on_save"` and the target `agent_draft`. It SHALL fill the container from edge to edge, with the breadcrumb "Agent › AGENTS.md", the formatting toolbar under the breadcrumb, no frame around the text, and "Cancel" and "Save" at the bottom. The writing tips rail and the "Suggested" sections SHALL be removed.

#### Scenario: Edit and save
- **WHEN** the user changes the "Urgency" part and clicks "Save"
- **THEN** the view goes back, the Instructions row shows the new word count, and the automatic save saves a new version

#### Scenario: Cancel
- **WHEN** the user changes the text and clicks "Cancel"
- **THEN** the change is dropped with no question and nothing is saved

#### Scenario: Toolbar
- **WHEN** the editor opens
- **THEN** the toolbar shows "Normal text", bold, italic, strike, code and "Source"

#### Scenario: Empty instructions
- **WHEN** AGENTS.md is empty
- **THEN** the editor shows an empty page with the cursor at the top, and "Save" is enabled only after a change

#### Scenario: Long instructions
- **WHEN** AGENTS.md is longer than the view
- **THEN** the text scrolls inside the view, and the toolbar and the footer stay in place

#### Scenario: Leave with edits
- **WHEN** the editor has edits that are not saved and the user clicks "Agent" in the breadcrumb
- **THEN** the dialog "You have unsaved changes" opens

#### Scenario: Shared editor
- **WHEN** the editor component changes
- **THEN** the SKILL.md editor and every other place that uses the shared Markdown editor get the same toolbar and the same layout

### Requirement: Revert a version

A revert SHALL ask first with the dialog "Revert to v3?", the production description text, "Cancel" and "Revert". "Revert" SHALL save a new version with the configuration and schemas of the picked version, through the production revert path. A revert SHALL NOT start while a save runs. A failed revert SHALL put back the state before it, as production does.

#### Scenario: Revert
- **WHEN** the agent is on v4 and the user confirms "Revert" for v3
- **THEN** v5 is saved with v3's configuration, and the footer shows v5

#### Scenario: Revert during a save
- **WHEN** a save runs and the user confirms a revert
- **THEN** the revert does not start, and the production text "Revert failed. Wait for any save to finish, then try again." shows

#### Scenario: Revert fails
- **WHEN** the revert request fails
- **THEN** the production failure text shows with "Try again", and the configuration is as it was before the revert

### Requirement: State tags only when something needs attention

A row SHALL show a state tag only when something needs attention. A healthy integration, MCP server, model provider or channel SHALL show no "Connected" tag. A section summary SHALL show a count only where it helps the user decide.

#### Scenario: Healthy integration
- **WHEN** the Zendesk connection works
- **THEN** the Zendesk row shows the logo and the name only

#### Scenario: Integration with a problem
- **WHEN** the Stripe sign-in expired
- **THEN** the Stripe row shows "Needs setup" with the reason "Sign-in expired" under the name

#### Scenario: Old format
- **WHEN** an integration is stored in the old format
- **THEN** its row shows the production tag "old format"

### Requirement: Bin means delete, x means close

A bin icon SHALL mean delete or remove. An x icon SHALL mean close only, and SHALL NOT delete or remove anything. Removing an item from the agent with a bin or with "Remove from agent" SHALL ask first with the domain dialog of that flow; "Remove" SHALL change the agent configuration, and the automatic save saves a version.

#### Scenario: Remove with the row bin
- **WHEN** the user hovers the GitHub row and clicks its bin
- **THEN** the dialog "Remove GitHub from this agent?" opens with the production removal texts, and "Remove" takes GitHub out of the agent

#### Scenario: Close a view
- **WHEN** the user clicks the x in a view header
- **THEN** the view closes (with the unsaved-changes dialog if its form has edits) and nothing is removed
