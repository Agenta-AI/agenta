## ADDED Requirements

### Requirement: Views of the skills flow

The skills flow SHALL use the view contract of the `agent-panel` spec. "Add skills" SHALL have `apply: "immediate"`. The skill view and the "New skill" view SHALL have `apply: "on_save"`. In an agent the target SHALL be `agent_draft`; on the Skills page it SHALL be `project`. A view SHALL address a skill of the agent by `ConfigItemRef` `{list: "skills", key}` with the skill name as the key, and SHALL report its title with `useViewTitle`. New text SHALL go to the namespace `entityUi.skillView`.

#### Scenario: Where Save writes
- **WHEN** the skill view of an agent-only skill saves
- **THEN** it writes the agent configuration, and auto-save saves it as a new version
- **WHEN** the skill view of a registry skill saves, in an agent or on the Skills page
- **THEN** it saves a new revision in the skill registry on the server, and the agent configuration does not change

#### Scenario: Title from the view
- **WHEN** the user renames an agent-only skill from "ticket-triage" to "ticket-routing" and saves
- **THEN** the breadcrumb shows "ticket-routing" at once, because the view reports its title with `useViewTitle`

#### Scenario: The skill leaves the list under the open view
- **WHEN** a builder save removes the open skill from the agent
- **THEN** the view finds no skill with its key and shows the removed state with Back, and no other skill shows in its place (text not written; listed for Mahmoud)

#### Scenario: New skill steps stay in one view
- **WHEN** the user opens "New skill" at depth 2 and picks "Write from scratch", "Upload" or "Import from a repo"
- **THEN** the chosen step shows inside the same view, because the stack holds two levels, and the crumb title follows the step

### Requirement: Skills section "+" menu

The Skills section of the Agent tab SHALL show a "+" that opens a menu with two entries: "Create with AI" with the line "Describe it; the agent sets it up", and "Add manually" with the line "From your registry, or write one". "Create with AI" SHALL open the Builder panel with the production starter text in its composer. "Add manually" SHALL open the "Add skills" view.

#### Scenario: Open the menu
- **WHEN** the user clicks "+" on the Skills section header
- **THEN** a menu opens with "Create with AI" and "Add manually", each with its line

#### Scenario: Create with AI
- **WHEN** the user picks "Create with AI"
- **THEN** the right panel swaps to the Builder content and the builder composer holds the starter text "I want a skill that", with the caret after it, and nothing is sent

#### Scenario: Add manually
- **WHEN** the user picks "Add manually"
- **THEN** the "Add skills" view opens in the panel with the breadcrumb "Agent › Add skills"

#### Scenario: Read-only agent
- **WHEN** the user cannot edit the agent (a viewer, or a revision that is not editable)
- **THEN** the "+" does not show, as production

### Requirement: Add skills view

The "Add skills" view SHALL list the skills of the skill registry with search, a "New skill" entry and a "Done" button. Each row SHALL show the name, the description (or "No description") and the source when the skill was imported. A click on a row SHALL add the skill to the agent at once and follow its latest version. A second click on an added row SHALL remove it. Added rows SHALL show "Added".

#### Scenario: Add a skill
- **WHEN** the user clicks the row "refund-check"
- **THEN** the agent gains a reference to "refund-check" that follows the latest version, the row shows "Added", and auto-save saves the agent as a new version

#### Scenario: Remove from the list
- **WHEN** the user clicks the row "ticket-triage" that shows "Added"
- **THEN** the reference leaves the agent and the row no longer shows "Added"

#### Scenario: Search
- **WHEN** the user types in "Search skills..."
- **THEN** the list narrows to skills whose name or description matches

#### Scenario: Search with no result
- **WHEN** no skill matches the search
- **THEN** the view shows the production text "No skills match your search" and "Try a different name.", and keeps "New skill"

#### Scenario: Empty registry
- **WHEN** the skill registry has no skill
- **THEN** the view shows the production title "No skills yet" with its production line (key `skills.gallery.createBelow`) and "New skill" as its only action

#### Scenario: Loading
- **WHEN** the registry list is loading
- **THEN** the view shows skeleton rows in the layout of the list, as production

#### Scenario: Done
- **WHEN** the user clicks "Done" or the breadcrumb "Agent"
- **THEN** the view goes back to the Agent tab with no question, because each click already changed the agent

#### Scenario: New skill
- **WHEN** the user clicks "New skill"
- **THEN** the view "New skill" opens at depth 2, with the breadcrumb "Add skills › New skill"

### Requirement: One skill view in every place

The app SHALL have one skill view for registry skills, agent-only skills and built-in skills. The Agent tab (in the right panel and on the Configuration page) and the Skills page SHALL mount this view. The drawers `SkillDetailDrawer` and `ConfigItemDrawer` (skill kind) SHALL stop rendering a skill. A change to the skill view SHALL show in every container that mounts it.

#### Scenario: Registry skill from the agent
- **WHEN** the user clicks the row of a registry skill in the Skills section
- **THEN** the skill view opens in the panel with the breadcrumb "Agent › ticket-triage", and no drawer opens

#### Scenario: Agent-only skill from the agent
- **WHEN** the user clicks the row of an agent-only skill
- **THEN** the same skill view opens, with the status line "Only available to this agent"

#### Scenario: Skill on the Skills page
- **WHEN** the user opens a skill on the Skills page
- **THEN** the Skills page container mounts the same skill view, with the same file menu, search, Advanced part and expanded editor

#### Scenario: Widen
- **WHEN** the user clicks "Widen the panel" in the skill view
- **THEN** the panel grows to 760 px for this view only (a wide view), as the `agent-panel` capability defines

### Requirement: Skill view header

The skill view header SHALL show the skill name, one status line and a "..." menu with the label "Skill actions". A registry skill SHALL show "Shared in your skill registry" (not confirmed). An agent-only skill SHALL show "Only available to this agent" (not confirmed). The words "skill registry" SHALL be a link that opens this skill on the Skills page in a new browser tab.

#### Scenario: Registry skill header
- **WHEN** a registry skill is open
- **THEN** the header shows "ticket-triage", the line "Shared in your skill registry", and no "Used by N agents" text

#### Scenario: Link to the Skills page
- **WHEN** the user clicks "skill registry" in the status line
- **THEN** a new browser tab opens the Skills page with this skill open, and the skill view in the first tab keeps its unsaved edits

#### Scenario: Long name
- **WHEN** the skill name is longer than the header
- **THEN** the name is cut at the end and the full name shows on hover

### Requirement: SKILL.md opens first with Name and Description

The skill view SHALL open on SKILL.md. Name and Description SHALL show only while SKILL.md is the open file. Description SHALL be a text area that starts at four lines, grows with the text and can be dragged larger. The SKILL.md editor SHALL be the production Markdown editor with its toolbar and "Source" switch.

#### Scenario: Open a skill
- **WHEN** a skill view opens
- **THEN** the file button reads "SKILL.md" with "14 files", and the form shows Name, Description, the SKILL.md editor and the closed "Advanced" part

#### Scenario: Another file hides Name and Description
- **WHEN** the user opens "scripts/classify_ticket.py"
- **THEN** Name and Description do not show

#### Scenario: Name rule
- **WHEN** the user types a name with a capital letter or a space
- **THEN** the field shows the production error and the hint "Lowercase letters, numbers and hyphens only." stays under the field

#### Scenario: Long description
- **WHEN** the description is longer than four lines
- **THEN** the text area grows with the text

### Requirement: File menu

The file button SHALL open the file menu. The menu SHALL list SKILL.md first, then the files grouped in folders taken from their paths. Folders SHALL fold and SHALL show their file count. The menu SHALL scroll when the list is long. The menu foot SHALL hold "Add a file", "Upload a folder or a .zip" and "Download as .zip". A click on a file SHALL open it and close the menu.

#### Scenario: Open the menu
- **WHEN** the user clicks the file button
- **THEN** the menu shows the search field "Find a file", SKILL.md, the root files, and the folders "references 4", "scripts 2", "templates 3" and the others

#### Scenario: Fold a folder
- **WHEN** the user folds "templates" and then opens another file
- **THEN** "templates" stays folded the next time the menu opens, while this skill stays open

#### Scenario: Long file name
- **WHEN** a file name is longer than the row, for example "refund-policy-europe-and-united-kingdom-2026.md"
- **THEN** the row cuts the name at the end, the file button cuts it in the middle, and hover shows the full path

#### Scenario: Long list
- **WHEN** the skill has more files than the menu height holds
- **THEN** the menu scrolls and the foot actions stay reachable

#### Scenario: Skill with only SKILL.md
- **WHEN** the skill has no bundled file
- **THEN** the menu lists SKILL.md and the foot shows "Download SKILL.md" in place of "Download as .zip", as production

### Requirement: Search in the file menu

Typing in "Find a file" SHALL filter files by name and by folder. A result SHALL show its folder under its name. A count line SHALL say how many files match. Enter SHALL open the first result. With no match the menu SHALL say "No file matches" and keep "Add a file".

#### Scenario: Matches
- **WHEN** the user types "re"
- **THEN** the menu shows the matching files with their folders and the line "2 of 14 files · Enter opens the first one"

#### Scenario: Enter
- **WHEN** the user presses Enter in the search field
- **THEN** the first result opens and the menu closes

#### Scenario: No match
- **WHEN** no file name or folder matches
- **THEN** the menu shows "No file matches" and "Add a file"

### Requirement: A file other than SKILL.md

A file other than SKILL.md SHALL show its path field, the switch "Mark executable" with the line "Your sandbox settings must allow it too.", and a code editor. Changing the path SHALL rename or move the file. "Mark executable" SHALL be on only while the skill has "Allow executable files" on.

#### Scenario: Open a code file
- **WHEN** the user opens "scripts/classify_ticket.py"
- **THEN** the view shows "File path" with the hint "Change the path to rename or move the file.", "Mark executable", and the code editor with Python highlight

#### Scenario: Move by path
- **WHEN** the user changes the path to "lib/classify_ticket.py"
- **THEN** the file moves to the folder "lib" in the menu, and the folder is created when it did not exist

#### Scenario: Executable files not allowed
- **WHEN** "Allow executable files" is off in Advanced
- **THEN** "Mark executable" is disabled

### Requirement: Rename and delete a file

Hover on a file row in the file menu SHALL show Rename and Delete. A bin next to the file button SHALL delete the open file. Every delete SHALL ask first with "Delete classify_ticket.py?" (the name of the file). SKILL.md SHALL have no bin and no Delete, because a skill must keep it.

#### Scenario: Delete asks first
- **WHEN** the user clicks the bin ("Delete this file") with "scripts/classify_ticket.py" open
- **THEN** the dialog "Delete classify_ticket.py?" opens, and the file leaves the skill only after the user confirms

#### Scenario: Cancel the delete
- **WHEN** the user cancels the dialog
- **THEN** the file stays and stays open

#### Scenario: Rename from the menu
- **WHEN** the user picks Rename on a row
- **THEN** the file opens with the cursor in its path field

#### Scenario: SKILL.md
- **WHEN** SKILL.md is open or its row is hovered
- **THEN** no bin and no Delete show

#### Scenario: After a delete
- **WHEN** the user deletes the open file
- **THEN** SKILL.md opens

### Requirement: Unsaved files are marked

A file with unsaved edits SHALL show a dot in the file menu. The bar under the file button SHALL count the edited files, for example "14 files · 2 edited".

#### Scenario: Edit two files
- **WHEN** the user edits SKILL.md and "scripts/classify_ticket.py" and has not saved
- **THEN** both rows show a dot and the bar reads "14 files · 2 edited"

#### Scenario: After Save or Cancel
- **WHEN** the user saves or cancels
- **THEN** the dots and the count go away

### Requirement: Add a file with a unique path

"Add a file" SHALL open an empty file named "untitled" with the cursor in the path field and the hint "Type a folder and a name, for example references/pricing.md." A folder in the path SHALL create the folder. Two files of one skill SHALL NOT have the same path; the view SHALL refuse a path that another file already has.

#### Scenario: Add a file in a new folder
- **WHEN** the user picks "Add a file" and types "references/pricing.md"
- **THEN** the file shows under "references" and the file count grows by one

#### Scenario: Duplicate path when adding
- **WHEN** the user types a path that another file of this skill already has
- **THEN** the path field shows an error, "Save" is disabled, and no file is replaced

#### Scenario: Duplicate path when renaming
- **WHEN** the user renames a file to the path of another file
- **THEN** the same error shows and "Save" is disabled

#### Scenario: Path SKILL.md
- **WHEN** the user types "SKILL.md" as the path of a bundled file
- **THEN** the path is refused, as the SDK refuses it today

#### Scenario: Add before the skill exists
- **WHEN** the user is writing a new skill that is not created yet
- **THEN** "Add a file" works the same way

### Requirement: Upload a folder or a .zip

"Upload a folder or a .zip" SHALL open an upload step with a drop zone ("Drag a skill folder, .zip, or .skill here", "or", "Browse files") and two choices. "Add to this skill" SHALL be the default: new files are added and a file with the same path is replaced. "Replace the whole skill" SHALL replace all files, the name and the description. Files that are not text SHALL be skipped and listed after the upload.

#### Scenario: Add is the default
- **WHEN** the upload step opens
- **THEN** "Add to this skill" is selected, with the line "New files are added. Files with the same path are replaced."

#### Scenario: Add an upload
- **WHEN** the user uploads a folder with "templates/reply-refund.md" and "references/categories.md" and clicks "Upload"
- **THEN** "templates/reply-refund.md" is added, "references/categories.md" is replaced, and all other files stay

#### Scenario: Replace the whole skill
- **WHEN** the user picks "Replace the whole skill" and uploads
- **THEN** every file, the name and the description come from the upload, as production does today for every upload

#### Scenario: A file that is not text
- **WHEN** the upload holds a binary file or a file that is too large
- **THEN** the file is skipped and the view lists it after the upload, with the line "Text files only. A file that is not text is skipped and listed after the upload."

#### Scenario: Upload with no SKILL.md in Replace mode
- **WHEN** a "Replace the whole skill" upload has no SKILL.md
- **THEN** the view shows "No SKILL.md found in the upload." and changes nothing

#### Scenario: Upload that cannot be read
- **WHEN** the browser cannot read the upload
- **THEN** the view shows "Couldn't read the upload." and changes nothing

#### Scenario: Nothing is saved yet
- **WHEN** the upload finishes
- **THEN** the changed files show the unsaved dot and nothing is saved until the user clicks "Save"

### Requirement: Advanced part of the skill

The Advanced part SHALL be the last part of the form under the SKILL.md editor and SHALL be closed by default. It SHALL hold the production switches "Hide from prompt" and "Allow executable files" with their production lines. It SHALL show only while SKILL.md is the open file.

#### Scenario: Open Advanced
- **WHEN** the user clicks "Advanced"
- **THEN** it shows "Hide from prompt" with "The agent won't pick this skill on its own. You run it yourself with /skill:ticket-triage." and "Allow executable files" with "Let the files in this skill run as programs. Your sandbox settings must allow it too."

#### Scenario: Upload with hide-from-prompt
- **WHEN** an uploaded SKILL.md sets hide-from-prompt
- **THEN** Advanced opens and the switch is on, as production

### Requirement: Expanded editor

The SKILL.md editor and the code editor SHALL be at least 300 px high, and the form SHALL scroll under them. A button at the right of the editor toolbar ("Expand the editor") SHALL make the editor fill the view and hide Name, Description and Advanced. The same button ("Make the editor smaller") SHALL bring them back. The panel widen button SHALL still work.

#### Scenario: Short screen
- **WHEN** the window is short
- **THEN** the editor keeps 300 px and the form scrolls, so about 14 lines of text show without a click

#### Scenario: Expand
- **WHEN** the user clicks "Expand the editor"
- **THEN** the editor fills the view and Name, Description and Advanced are hidden

#### Scenario: Expand and widen
- **WHEN** the editor is expanded and the user clicks "Widen the panel"
- **THEN** the panel is 760 px wide and the editor stays expanded

### Requirement: "..." menu of a registry skill

The "..." menu of a registry skill SHALL hold "Download as .zip" and "Archive". It SHALL NOT hold "Add to agent". "Archive" SHALL ask first and SHALL say how many agents still use the skill.

#### Scenario: Download
- **WHEN** the user picks "Download as .zip"
- **THEN** the browser downloads the skill as a .zip, as production

#### Scenario: Archive asks first
- **WHEN** the user picks "Archive" on a skill that 3 agents use
- **THEN** the production dialog "Archive ticket-triage?" opens with its production text and the count of agents that still reference the skill, and the skill is archived only after "Archive skill"

#### Scenario: Archive fails
- **WHEN** the archive call fails
- **THEN** the dialog shows "Archiving failed." and stays open

### Requirement: "..." menu of an agent-only skill

The "..." menu of an agent-only skill SHALL hold "Publish to skill registry" and "Download as .zip". "Publish to skill registry" SHALL create the skill in the skill registry from the current edits and SHALL put a reference to it in the agent configuration in place of the agent-only copy.

#### Scenario: Publish
- **WHEN** the user picks "Publish to skill registry"
- **THEN** the skill registry gains "ticket-triage", the agent replaces the agent-only entry with a reference that follows the latest version, the status line becomes "Shared in your skill registry", and auto-save saves the agent as a new version

#### Scenario: Publish with an invalid skill
- **WHEN** the skill has an invalid file path
- **THEN** publishing stops with the production text "Fix the skill before publishing (scripts/../x.py)."

#### Scenario: Publish fails
- **WHEN** the registry call fails
- **THEN** the view shows "Publish failed." or "Publish failed: {error}" and the agent configuration does not change

### Requirement: Saving a skill

The skill view SHALL have "Cancel" and "Save". For an agent-only skill, "Save" SHALL write the skill into the agent configuration, and auto-save SHALL save it. For a registry skill, "Save" SHALL save a new revision in the skill registry at once, and every agent that follows the latest version SHALL use it. "Save" SHALL be disabled until something changed, while the skill is not valid, and while a save runs.

#### Scenario: Save an agent-only skill
- **WHEN** the user edits an agent-only skill and clicks "Save"
- **THEN** the agent holds the new skill, the view goes back, and auto-save saves the agent as a new version

#### Scenario: Save a registry skill
- **WHEN** the user edits a registry skill and clicks "Save"
- **THEN** the skill registry saves a new revision, the agent configuration does not change, and the agents that follow the latest version use the new revision

#### Scenario: Registry save conflict
- **WHEN** someone saved the registry skill after this view loaded it
- **THEN** the save fails as a conflict and the view shows the production error, and the edits stay

#### Scenario: Save fails
- **WHEN** the registry save fails
- **THEN** the view shows "Save failed." or "Save failed: {error}" and keeps the edits

#### Scenario: Saved, reload failed
- **WHEN** the save works and the reload of the new revision fails
- **THEN** the view shows "Saved, but the latest version could not load. Reopen the skill."

#### Scenario: Save in flight
- **WHEN** the user clicks "Save" again, or the breadcrumb, while the save runs
- **THEN** nothing happens until the save ends

#### Scenario: Cancel
- **WHEN** the skill view has unsaved edits and the user clicks "Cancel"
- **THEN** the edits are dropped with no question and the view goes back

#### Scenario: Leave with unsaved edits
- **WHEN** the skill view has unsaved edits and the user goes back by the breadcrumb, closes or swaps the content
- **THEN** the unsaved-changes dialog of the `agent-panel` capability opens, with a description from the skill view
- **AND** for an agent-only skill the description is the production text "Save your changes to this agent draft, or discard them?"; for a registry skill it says that Save writes the skill registry (text not written; listed for Mahmoud)

### Requirement: Remove a skill from the agent asks first

Removing a skill from the agent from its row SHALL ask first with the remove dialog of canvas F06 f2, filled for the skill ("Remove ticket-triage from this agent?", "Cancel", "Remove"). The dialog SHALL live in `@agenta/entity-ui` next to the agent sections. After the user confirms, the skill with that key SHALL leave the agent, and auto-save SHALL save the agent. A registry skill SHALL stay in the skill registry.

#### Scenario: Remove a registry skill
- **WHEN** the user removes "ticket-triage" from the agent and confirms
- **THEN** the reference leaves the agent, auto-save saves the agent as a new version, and the skill stays in the skill registry

#### Scenario: Cancel the remove
- **WHEN** the user clicks "Cancel"
- **THEN** nothing changes

### Requirement: New skill, choose how

"New skill" SHALL open a view with the line "The new skill is added to your skill registry and to this agent." and the three production ways: "Write from scratch" ("Start with an empty SKILL.md and write it here"), "Upload" ("A .zip, .skill or SKILL.md, opened in the editor") and "Import from a repo" ("Scan a public GitHub repository for SKILL.md folders").

#### Scenario: Choose a way
- **WHEN** the user clicks "New skill" in "Add skills"
- **THEN** the view shows the three ways, and the breadcrumb reads "Add skills › New skill"

#### Scenario: Skills page
- **WHEN** the user clicks "New skill" on the Skills page
- **THEN** the same three ways show, and the new skill goes only to the skill registry

### Requirement: Write from scratch

"Write from scratch" SHALL show the skill editor empty as a step of the "New skill" view, with the title "New skill", the line "Not saved yet", the name placeholder "my-skill" and the production placeholders. The file menu SHALL work before the skill exists. "Create skill" SHALL be off until the name and the SKILL.md text are valid. "Create skill" SHALL add the skill to the skill registry and add a reference to the agent.

#### Scenario: Create
- **WHEN** the user fills a valid name and text and clicks "Create skill"
- **THEN** the skill registry gains the skill, the agent gains a reference that follows the latest version, and auto-save saves the agent as a new version

#### Scenario: Invalid
- **WHEN** the name is empty or not valid
- **THEN** "Create skill" is off, and after a click attempt the empty required fields are marked

#### Scenario: Create fails
- **WHEN** the registry call fails
- **THEN** the view shows "Create failed." or "Create failed: {error}" and keeps the text

### Requirement: Upload a new skill

"Upload" SHALL show the drop zone and the line "Text files only. The upload opens in the editor, and nothing is saved until "Create skill"." A good upload SHALL show the "Write from scratch" step filled with the name, the description and all files, with the line "14 files parsed". Nothing SHALL be saved until "Create skill".

#### Scenario: Good upload
- **WHEN** the user drops a skill folder with 14 text files
- **THEN** the editor opens filled in with "14 files parsed", and the user reviews it before "Create skill"

#### Scenario: No SKILL.md
- **WHEN** the upload has no SKILL.md
- **THEN** the view shows "No SKILL.md found in the upload."

#### Scenario: Unreadable upload
- **WHEN** the upload cannot be read
- **THEN** the view shows "Couldn't read the upload."

### Requirement: Import from a repo

"Import from a repo" SHALL show the production import view: the line "Scan a public GitHub repository for SKILL.md folders.", an address field with "Scan", the list "Skills found · N", rows marked "Already imported", and the button "Import N skills". Imported skills SHALL go to the skill registry and SHALL be added to the agent.

#### Scenario: Scan and import
- **WHEN** the user scans a repository with 4 skills, 2 of them already imported, and clicks "Import 2 skills"
- **THEN** the 2 skills go to the skill registry and the agent gains a reference to each

#### Scenario: Nothing found
- **WHEN** the repository has no skill
- **THEN** the view shows "No skills found in this repository."

#### Scenario: Import fails
- **WHEN** the import call fails
- **THEN** the view shows "Import failed." or "Import failed: {error}"

### Requirement: Read-only skills and states

The skill view SHALL show a built-in skill or an archived skill read only, as production. It SHALL show a loading skeleton while the skill loads, and the production error with "Try again" when the load fails. A person who cannot edit the agent SHALL see every skill read only.

#### Scenario: Built-in skill
- **WHEN** the user opens a built-in skill
- **THEN** the form is read only and shows the production note "Built-in skills are maintained by Agenta and cannot be edited."

#### Scenario: Archived skill
- **WHEN** the agent references an archived registry skill
- **THEN** the view is read only and offers the production action "Restore"

#### Scenario: Loading
- **WHEN** the skill revision is loading
- **THEN** the view shows the production skill form skeleton

#### Scenario: Load error
- **WHEN** the skill cannot load
- **THEN** the view shows "Couldn't load this skill." and "Try again"

#### Scenario: Viewer
- **WHEN** a viewer opens a skill
- **THEN** every field is read only, the "..." menu hides the actions that change the skill, and "Save" does not show

### Requirement: Skills page keeps its own actions

The Skills page container SHALL mount the same skill view and SHALL add the actions that belong to the skill registry: "Add to agent" in the "..." menu and the list of agents that use the skill. These SHALL NOT show when the view is mounted for an agent.

#### Scenario: Add to agent on the Skills page
- **WHEN** the user opens the "..." menu of a skill on the Skills page
- **THEN** the menu holds "Add to agent", "Download as .zip" and "Archive"

#### Scenario: Same view for an agent
- **WHEN** the same skill is open from an agent
- **THEN** "Add to agent" and the "Used by" list do not show
