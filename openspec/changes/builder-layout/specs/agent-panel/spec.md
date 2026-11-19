## ADDED Requirements

### Requirement: One panel with one content at a time

Every agent screen SHALL have one right panel. The panel SHALL show at most one content: Files, Configuration or Builder. The header icons Files, Configuration and Builder SHALL open it, in this order, with Builder at the far right. A click on another icon SHALL swap the content and keep the panel open. A click on the icon of the open content SHALL close the panel.

#### Scenario: Open Configuration from a closed panel
- **WHEN** the panel is closed and the user clicks the icon "Configuration"
- **THEN** the panel opens on the right side of the conversation with the Configuration content
- **AND** the icon "Configuration" shows its pressed state and the other two icons do not

#### Scenario: Swap the content
- **WHEN** the panel shows Configuration and the user clicks the icon "Builder"
- **THEN** the panel stays open and shows the Builder content
- **AND** the panel does not play a close and open motion

#### Scenario: Close with the active icon
- **WHEN** the panel shows Builder and the user clicks the icon "Builder"
- **THEN** the panel closes and the conversation takes the full width

#### Scenario: Close with the close button
- **WHEN** the panel shows Configuration and the user clicks "Close" in the panel header
- **THEN** the panel closes
- **AND** the Files content has no close button, as in production, so the icon "Files" is the way to close it

#### Scenario: A content keeps its state while another content shows
- **WHEN** the user opens a view in Configuration with no unsaved edits, swaps to Builder, and swaps back to Configuration
- **THEN** Configuration shows the same view with the same scroll position

### Requirement: Panel width and drag

The Configuration and Builder contents SHALL open 440 px wide. The user SHALL be able to drag the panel edge between 360 px and 640 px. The Files content SHALL keep the production width rules: 620 px by default and a drag between 420 px and 1600 px. Each width SHALL be remembered per user and project.

#### Scenario: Drag the edge
- **WHEN** the user drags the left edge of the panel with Configuration open
- **THEN** the panel width follows the pointer between 360 px and 640 px and stops at these limits
- **AND** the new width is stored when the user releases the pointer, not on every move

#### Scenario: Width is shared by Configuration and Builder
- **WHEN** the user set Configuration to 520 px and then swaps to Builder
- **THEN** Builder opens 520 px wide

#### Scenario: Files keeps its own width
- **WHEN** the user opens Files after Configuration was 520 px wide
- **THEN** Files opens at its own stored width, 620 px when nothing is stored

#### Scenario: Width after a reload
- **WHEN** the user reloads the page with the panel open
- **THEN** the panel opens at the width the same user set last in this project

### Requirement: Widen a wide view to 760 px

A wide view (its view definition sets `wide`) SHALL show a button with the title "Widen the panel". The button SHALL grow the panel to 760 px for that view only. Going back from the view SHALL restore the width the panel had before. A widen SHALL NOT change the stored width. Only the panel reads `wide`; other containers ignore it.

#### Scenario: Widen the AGENTS.md editor
- **WHEN** the user opens AGENTS.md from the Agent tab and clicks "Widen the panel"
- **THEN** the panel grows to 760 px

#### Scenario: Back restores the width
- **WHEN** the panel is 760 px for a wide view and the user clicks the first part of the breadcrumb
- **THEN** the root shows and the panel goes back to its stored width

#### Scenario: Window too narrow for 760 px
- **WHEN** the window is narrower than the conversation minimum plus 760 px
- **THEN** the widened panel uses overlay mode instead of squeezing the conversation

#### Scenario: Same view on the Configuration page
- **WHEN** the AGENTS.md editor shows on the Configuration page
- **THEN** no widen button shows and the page decides the width

### Requirement: Overlay under 1100 px

When the window is narrower than 1100 px, the right panel SHALL open in overlay mode over the conversation. At 1100 px and wider, the panel SHALL push the conversation. Phone widths below 768 px are covered by the phone-layout capability, not by this requirement.

#### Scenario: Narrow window
- **WHEN** the window is 1000 px wide and the user opens Builder
- **THEN** the panel lies over the right part of the conversation with a shadow at its left edge
- **AND** the conversation keeps its width and its scroll position

#### Scenario: Window grows past 1100 px
- **WHEN** the panel is in overlay mode and the user makes the window 1200 px wide
- **THEN** the panel pushes the conversation and the overlay shadow goes away

### Requirement: Escape goes back, then closes

The Escape key SHALL act on the right panel only when the keyboard focus is inside the panel. It SHALL first close an open menu or dialog, then go back one level in the view stack (guarded), then call the container's action at the root (the panel closes). A running answer and an approval card in the focused conversation keep their own Escape behavior (session-screen capability).

#### Scenario: Escape in a view
- **WHEN** the focus is in the AGENTS.md editor with no unsaved edits and the user presses Escape
- **THEN** the panel goes back to the Agent tab

#### Scenario: Escape at the root
- **WHEN** the focus is on the Agent tab with no view open and the user presses Escape
- **THEN** the panel closes and the focus moves to the header icon "Configuration"

#### Scenario: Escape with unsaved edits
- **WHEN** the AGENTS.md editor has unsaved edits and the user presses Escape
- **THEN** the dialog "You have unsaved changes" opens and the view stays

#### Scenario: Escape with the focus in the conversation
- **WHEN** the focus is in the session composer and the user presses Escape
- **THEN** the panel does not change

#### Scenario: Escape at the root of a page container
- **WHEN** the focus is on the root of the Configuration page and the user presses Escape
- **THEN** nothing happens, because a page has no action at its root

### Requirement: Remembered panel state

The app SHALL store the panel content (or closed), the width and the Configuration tab in browser storage under the key `agenta:agent-panel:${userId}:${projectId}`. The state SHALL stay when the user moves to another session or another agent screen. Screens that are not agent screens (Agents list, Home, Settings) SHALL show no right panel. Open views and the 760 px widen SHALL NOT be stored.

#### Scenario: Move to another session
- **WHEN** the panel shows Configuration and the user opens another session from the sidebar
- **THEN** the new session opens with the panel open on Configuration

#### Scenario: Leave and come back
- **WHEN** the panel shows Builder, the user opens Settings, and then opens a session again
- **THEN** Settings shows no panel, and the session opens with Builder in the panel

#### Scenario: Another user on the same browser
- **WHEN** a second user signs in on the same browser
- **THEN** the panel state of the first user does not apply to the second user

#### Scenario: Storage is not available
- **WHEN** the browser refuses to store the state
- **THEN** the panel opens closed and still works, and no error shows

#### Scenario: Reload with a view open
- **WHEN** the user reloads the page while the skill view is open in Configuration
- **THEN** the panel opens on Configuration at the root of the stored tab, and no view is open

### Requirement: Root and view stack in a container

Each container SHALL have one root and one view stack. The root is the base screen and is not in the stack. The root SHALL call `open` to show a view at depth 1. A view at depth 1 SHALL be able to call `push` to show one view at depth 2. A view at depth 2 SHALL NOT push. `open` and `push` SHALL return `Promise<boolean>`, false when the user kept editing. A breadcrumb SHALL replace the tabs while a view is open.

#### Scenario: Open a view
- **WHEN** the user clicks the skill row "ticket-triage" on the Agent tab
- **THEN** the root calls `open`, the skill view shows at depth 1, and the tabs give way to the breadcrumb "Agent › ticket-triage"

#### Scenario: Push a second view
- **WHEN** the user opens "Add integration" and then "Connect" for GitHub
- **THEN** "Connect" shows at depth 2, the breadcrumb reads "Agent › Add integration › Connect", and a click on "Add integration" goes back one level

#### Scenario: No third level
- **WHEN** a view at depth 2 needs one more step
- **THEN** the step shows inside the same view (for example a part that opens in place), because the view has no `push`

#### Scenario: Open is refused
- **WHEN** a view has unsaved edits, the root calls `open` for another view, and the user picks "Keep editing" in the dialog
- **THEN** the promise resolves false and the first view stays

#### Scenario: Title from the view
- **WHEN** the skill view reports its title with `useViewTitle` and the user renames the skill in the view
- **THEN** the breadcrumb shows the new name at once, and the view params hold only the item address

### Requirement: One editable form at a time

The view stack SHALL hold at most one form with unsaved edits. A view that a form view pushes SHALL be either a picker that changes the parent's form and returns, or the parent SHALL ask the user to save or discard before the child opens. While a picker covers a parent with unsaved edits, the parent SHALL own the guard: the stack SHALL be dirty when any view in it is dirty.

#### Scenario: Picker inside a form
- **WHEN** the user edits a subagent and opens the model picker from it
- **THEN** the pick changes the subagent form and the picker returns to it, and the form keeps its other edits

#### Scenario: Child with its own form
- **WHEN** the integration view has unsaved edits and the user opens a view that has its own form
- **THEN** the unsaved-changes dialog opens first, and the child opens only after "Save changes" or "Discard"

#### Scenario: Leave while a picker covers a dirty parent
- **WHEN** the subagent form has unsaved edits, the model picker is open on top of it, and the user closes the panel
- **THEN** the unsaved-changes dialog opens with the description of the subagent view, and "Save changes" saves the subagent form

### Requirement: Apply and target of a view

A view definition SHALL set `apply: "on_save" | "immediate"`. An "on_save" view SHALL show "Cancel" and "Save" and write only on Save. An "immediate" view SHALL write at once and show "Done". `open` and `push` SHALL pass a `target`: `{kind: "agent_draft", revisionId}` writes the agent configuration (the automatic save saves it); `{kind: "project"}` writes a project resource on the server. A view SHALL have one target; a child MAY have another target than its parent.

#### Scenario: Save in an agent view
- **WHEN** the user edits AGENTS.md and clicks "Save" in the editor view
- **THEN** the configuration holds the new text, the view goes back one level, and the automatic save saves v5 for an agent on v4

#### Scenario: Done in a view
- **WHEN** the user picks a model in the model view
- **THEN** the configuration changes at once, the automatic save saves it, and "Done" or the breadcrumb goes back with no question

#### Scenario: Same view with a project target
- **WHEN** the MCP server view opens in Settings with the target `{kind: "project"}` and the user clicks "Save"
- **THEN** the server stores the MCP server, and the agent configuration does not change

#### Scenario: Production apply mode
- **WHEN** a flow becomes a view
- **THEN** it keeps the apply mode it has in production

#### Scenario: Child with its own target
- **WHEN** "Add integration" (target `agent_draft`) opens the connect view and the user clicks "Connect"
- **THEN** the connect view has the target `project` and creates only the project connection; adding it to the agent is a separate write of the agent configuration by "Add integration"

### Requirement: Cancel and guarded Back

"Cancel" SHALL drop the local form of the view with no question and go back one level. Back (the breadcrumb, Escape, the back arrow, and the container leaving) SHALL be guarded: when the form has unsaved edits, it SHALL ask with the unsaved-changes dialog first.

#### Scenario: Cancel with unsaved edits
- **WHEN** the user clicks "Cancel" in a view with unsaved edits
- **THEN** the edits are dropped with no question and the view goes back one level

#### Scenario: Breadcrumb with unsaved edits
- **WHEN** the user clicks "Agent" in the breadcrumb of a view with unsaved edits
- **THEN** the unsaved-changes dialog opens and the view stays until the user answers

#### Scenario: Back with no edits
- **WHEN** the view has no unsaved edits and the user clicks the breadcrumb
- **THEN** the view goes back with no question

### Requirement: Save is pending until it resolves

While the Save of a view runs, the chrome SHALL show the saving state, ignore a second Save, and hold every navigation (back, open, close, swap) until the save resolves. A save that succeeds SHALL go back one level. A save that fails SHALL keep the view open with the form as it was.

#### Scenario: Second click
- **WHEN** the user clicks "Save" twice quickly in the MCP server view
- **THEN** one save request runs

#### Scenario: Navigation during a save
- **WHEN** a save runs and the user clicks the icon "Builder"
- **THEN** the swap waits until the save resolves

#### Scenario: Save fails
- **WHEN** the save request fails
- **THEN** the view stays open with the user's edits and says in plain words that the save failed, and "Save" works again

### Requirement: Unsaved-changes dialog

Leaving a view with unsaved edits SHALL open one generic dialog with the title "You have unsaved changes" and the buttons "Keep editing", "Discard" and "Save changes". The dialog SHALL live in `@agenta/ui` with text keys in the namespace `ui.viewStack`. Its description SHALL come from the view, because Save writes different places. "Save changes" SHALL leave only when the save resolves true. Domain dialogs SHALL NOT live in the view stack.

#### Scenario: Keep editing
- **WHEN** the dialog is open and the user clicks "Keep editing"
- **THEN** the dialog closes, the view stays with its edits, and the action that opened the dialog resolves false

#### Scenario: Discard
- **WHEN** the user clicks "Discard"
- **THEN** the edits are dropped and the action the user started (back, close, swap or navigate) completes

#### Scenario: Save changes
- **WHEN** the user clicks "Save changes" in an agent view
- **THEN** the view applies its edits to the agent configuration, the started action completes, and the automatic save saves a new version

#### Scenario: Save changes fails
- **WHEN** the save of "Save changes" fails
- **THEN** the view stays open with its edits, and the started action does not complete

#### Scenario: Save changes is not possible
- **WHEN** the edits are not valid (for example a required field is empty)
- **THEN** "Save changes" is disabled and the user can still pick "Keep editing" or "Discard"

#### Scenario: Description of an agent view
- **WHEN** the dialog opens for a view with the target `agent_draft`
- **THEN** the description reads "Save your changes to this agent draft, or discard them?"

#### Scenario: Description of a project view
- **WHEN** the dialog opens for a view with the target `project`
- **THEN** the description is the text that view gives (text not written; listed for Mahmoud)

#### Scenario: Domain dialogs
- **WHEN** the user removes an integration, a subagent, an MCP server or a skill, removes a secret, deletes an automation or reverts a version
- **THEN** the dialog comes from the domain package of that flow, not from the view stack

### Requirement: One leave guard at the agent layout host

The agent layout host (the component that holds the panel; the agent pages use the same host) SHALL own one function `confirmLeave(reason)`. Every source of unsaved work SHALL register with it: the view stack (an open form with edits), the Files draft guard, the automation guard and `beforeunload`. A content swap, a panel close and a route change out of the agent SHALL call `confirmLeave`. A source that is not dirty SHALL NOT ask.

#### Scenario: Swap content with unsaved edits in a view
- **WHEN** the AGENTS.md editor has unsaved edits and the user clicks the icon "Builder"
- **THEN** the unsaved-changes dialog of the view opens before the swap

#### Scenario: Route change out of the agent
- **WHEN** the Instructions view holds typed text and the user opens a session of another agent
- **THEN** `confirmLeave` asks before the route changes (configuration-draft capability, "Leaving with an open form with edits"); "Save changes" applies the text and then the route changes; "Discard" drops the text

#### Scenario: Route change after an edit that is saving
- **WHEN** the user picked a new model, no view form has edits, and the user opens a session of another agent before the automatic save ran
- **THEN** no dialog opens, and the automatic save saves the change as production does

#### Scenario: Nothing is dirty
- **WHEN** no source is dirty and the user closes the panel
- **THEN** the panel closes with no question

#### Scenario: Reload or tab close
- **WHEN** a registered source is dirty and the user reloads or closes the browser tab
- **THEN** the browser asks before it leaves

### Requirement: Items are addressed by key

A view of one item SHALL receive its item as `ConfigItemRef = {list, key}` with `list` in `tools | mcps | skills | files`, never as a position in a list. The agent config writer and the page context SHALL use the same type. When the key no longer exists in the configuration, the view SHALL show the "removed" state and offer Back.

#### Scenario: The list changes under an open view
- **WHEN** the skill view of "release-qa" is open and the builder saves a version that adds a skill before it
- **THEN** the view still shows "release-qa"

#### Scenario: The item is removed under an open view
- **WHEN** the skill view of "release-qa" is open and a saved version removes that skill
- **THEN** the view shows the "removed" state with Back (text not written; listed for Mahmoud)

### Requirement: Views do not know their container

A view SHALL import no panel, route, drawer or page code. A view MAY take values and callbacks as props. The same view SHALL render in the panel, on the Configuration page, in Settings and on the phone; only the container chrome SHALL decide the width, the breadcrumb place and the close control. A drawer chrome SHALL wrap a view only where the host really keeps a drawer.

#### Scenario: Same view in another container
- **WHEN** the same skill view is mounted on the Configuration page instead of the panel
- **THEN** it renders the same content, and only the container decides the width, the breadcrumb place and the close control

#### Scenario: A host that keeps a drawer
- **WHEN** Settings › Integrations opens the connect view
- **THEN** the view shows inside `DrawerViewChrome` with today's drawer width

### Requirement: Files content as in production

The Files content SHALL be the production Files pane, with its toolbar rows, its grid and list views, its file tree rail, its file editor and its right-click menu. Only the host changes: it SHALL open in the right panel as one of the three contents. Its scope SHALL stay the agent, as in production, so a session switch of the same agent does not close it.

#### Scenario: Open Files
- **WHEN** the user clicks the icon "Files"
- **THEN** the panel shows the production Files pane with the breadcrumb "All files" and the grid view

#### Scenario: Expand Files
- **WHEN** the user clicks "Expand files pane"
- **THEN** Files takes the full width of the agent screen, as in production

#### Scenario: Files empty, loading or failed
- **WHEN** the drive has no files, is loading or fails to load
- **THEN** Files shows the production empty, loading or error state

#### Scenario: Unsaved file edits
- **WHEN** a file has unsaved edits and the user swaps to Configuration
- **THEN** the Files draft guard asks through `confirmLeave`, and the edits are not lost without a question

#### Scenario: Upload in progress
- **WHEN** an upload runs and the user swaps to Configuration
- **THEN** Files stays mounted until the upload ends, so the upload is not aborted

### Requirement: Content states

Each content SHALL show a skeleton in its own layout while it loads, the production error state with a retry when it fails, and no Configuration content for an agent the user cannot see. A user who cannot edit the agent SHALL see the Configuration content read only.

#### Scenario: Loading
- **WHEN** the Configuration content loads for the first time
- **THEN** the panel shows skeleton rows in the section layout, not a spinner in the middle

#### Scenario: Load error
- **WHEN** the agent configuration fails to load
- **THEN** the panel says what failed in plain words and offers "Try again", and the details go to the logs

#### Scenario: Private agent the user cannot see
- **WHEN** the session belongs to a private agent the user cannot see
- **THEN** the icons Configuration and Builder do not show and no configuration is mounted, as in production

#### Scenario: Read-only user
- **WHEN** the user has no right to edit agents
- **THEN** Configuration shows every section without "+", bin or Save, and nothing is saved

#### Scenario: Long names
- **WHEN** a breadcrumb part or a row name is longer than the space
- **THEN** the text is cut with an ellipsis and the full text shows on hover

### Requirement: Stable test selectors

The right panel host root SHALL carry `data-testid="agent-panel"`. The root of the current view in any container SHALL carry `data-testid="panel-view"`. The session header SHALL carry `data-testid="session-header"`. QA captures and recipes SHALL use these selectors, not CSS classes. A story that renders a view alone SHALL wrap it in the same `panel-view` selector.

#### Scenario: Panel open
- **WHEN** the panel shows Configuration with a skill view open
- **THEN** the page has one element with `data-testid="agent-panel"` and, inside it, one element with `data-testid="panel-view"` around the skill view

#### Scenario: Panel closed
- **WHEN** the panel is closed
- **THEN** no element with `data-testid="agent-panel"` is in the page, and the header with `data-testid="session-header"` is

#### Scenario: View in a story
- **WHEN** a story renders the skill view with fixture data
- **THEN** the view is inside an element with `data-testid="panel-view"`, so the same crop recipe works for the story and the app
