## ADDED Requirements

### Requirement: The word "automation"

Every place in this capability SHALL call the thing an "automation". The word "trigger" SHALL name only its start condition ("Scheduled trigger", "App trigger", "Scheduled triggers", "App triggers"). The tab SHALL be "Automations" and the add button SHALL be "Add automation".

#### Scenario: Tab and button
- **WHEN** the user opens the Configuration content in the panel
- **THEN** the tab reads "Automations" and its button reads "Add automation"

#### Scenario: Warnings and notes
- **WHEN** another capability shows a sentence about this agent's automations (for example the integration account warning)
- **THEN** it says "automation", not "trigger"

### Requirement: Automations list

The Automations tab SHALL list the agent's automations in two groups, "Scheduled triggers" first and "App triggers" second. A group with no automation SHALL NOT show. There SHALL be no sentence above the list. A row SHALL show an icon, the name, one summary line, a status dot and a "..." menu. A click on a row SHALL open the automation view.

#### Scenario: Both kinds
- **WHEN** the agent has one schedule and one app trigger
- **THEN** the list shows "Scheduled triggers" with "Daily summary" and "Weekdays at 09:00 UTC · next in 14h", then "App triggers" with "New Zendesk ticket" and "Zendesk · Ticket created · last run 2m ago"

#### Scenario: Paused automation
- **WHEN** an automation is paused
- **THEN** its summary ends with "paused", for example "Daily at 08:00 UTC · paused", and its status dot is gray

#### Scenario: Only app triggers
- **WHEN** the agent has no scheduled automation
- **THEN** the "Scheduled triggers" heading does not show

#### Scenario: No automation
- **WHEN** the agent has no automation
- **THEN** the tab shows the production text "No automations yet" and the button "Add automation"

#### Scenario: Loading
- **WHEN** the automations are loading
- **THEN** the tab shows skeleton rows in the layout of the list

#### Scenario: Load error
- **WHEN** the automations cannot load
- **THEN** the tab says what failed in plain words and offers "Try again"; the details go to the logs

#### Scenario: Long name
- **WHEN** a name or a summary is longer than the row
- **THEN** it is cut at the end and the full text shows on hover

#### Scenario: Viewer
- **WHEN** the person cannot edit the agent
- **THEN** "Add automation" does not show and the "..." menu offers only "Run history"

### Requirement: Row menu

The "..." menu of a row SHALL hold "Run now", "Run history", "Edit", "Deactivate" (or "Activate" for a paused automation) and "Delete", for both kinds. "Delete" SHALL ask first. The other entries SHALL act at once.

#### Scenario: Open the menu
- **WHEN** the user opens the "..." menu of "Daily summary"
- **THEN** it shows "Run now", "Run history", "Edit", "Deactivate" and "Delete"

#### Scenario: Deactivate
- **WHEN** the user picks "Deactivate"
- **THEN** the automation stops at once, the row shows "paused" and a gray dot, and no agent version is saved

#### Scenario: Run history from the menu
- **WHEN** the user picks "Run history"
- **THEN** the run history view opens in the panel with the breadcrumb "Automations › Daily summary › Run history"

#### Scenario: Delete asks first
- **WHEN** the user picks "Delete"
- **THEN** the dialog "Delete this automation?" opens with "“Daily summary” stops running and leaves your list. Its past runs stay in your history.", "Cancel" and "Delete"

### Requirement: "Add automation" menu

"Add automation" SHALL open a menu with the production entries "App trigger" ("React to an event from a connected app"), "Scheduled trigger" ("Run on a recurring schedule") and "Create with AI" ("Describe it and let AI set it up"). The first two SHALL open the matching form with no switch between kinds. "Create with AI" SHALL open the Builder panel.

#### Scenario: Scheduled trigger
- **WHEN** the user picks "Scheduled trigger"
- **THEN** the form "New automation" for a schedule opens with the breadcrumb "Automations › New automation"

#### Scenario: App trigger
- **WHEN** the user picks "App trigger"
- **THEN** the form "New automation" for an app event opens

#### Scenario: Create with AI
- **WHEN** the user picks "Create with AI"
- **THEN** the right panel swaps to the Builder content with the production starter "I want an automation that" in its composer, and nothing is sent

### Requirement: Scheduled trigger form

The schedule form SHALL show the name with an "On" switch in the title, "Schedule" with "Cadence" (Hourly, Daily, Weekly, Monthly, Cron), "Days", "Time (UTC)" with "Add", the next run, and "Instruction" with "Sent to the agent on every run.". Times SHALL be UTC only. The form SHALL compute the next run. The buttons SHALL be "Cancel" and "Create automation".

#### Scenario: Next run
- **WHEN** the user picks Daily, the weekdays and 09:00
- **THEN** the form shows "Next run Fri, Nov 20, 09:00 UTC · in 14h"

#### Scenario: Cron
- **WHEN** the user picks "Cron"
- **THEN** the form shows the production cron field and the next run it computes (not drawn)

#### Scenario: Create
- **WHEN** the user fills a valid form and clicks "Create automation"
- **THEN** the automation is saved at once for this agent, the list shows it, and no agent version is saved

#### Scenario: Missing time
- **WHEN** no time rule is set
- **THEN** "Create automation" shows the production error "Choose when this automation runs"

#### Scenario: Missing instruction
- **WHEN** the instruction is empty
- **THEN** the form shows the production rule for an empty instruction and does not create the automation

### Requirement: App trigger form

The app event form SHALL show the name with an "On" switch, "Event" with "App" (the app and its connection), "Event", "Add optional filters (N)", "Instruction" with fields that fill in with real values, "Also attach the full event, so the agent can use any detail", "What the agent gets" with "Preview", "Cancel" and "Create automation". "Connect another app" SHALL open the Add integration view.

#### Scenario: Instruction with fields
- **WHEN** the user inserts the fields "ticket.subject" and "requester.email" in the instruction
- **THEN** they show as fields, and the line "Sent to the agent each time this event happens. Fields fill in with the real values." shows under the instruction

#### Scenario: Optional filters
- **WHEN** the user opens "Add optional filters (3)"
- **THEN** the three filters of the event show in place (not drawn)

#### Scenario: Event with no filter
- **WHEN** the event has no filter
- **THEN** the form shows the production line for an event with no filter (`automations.editor.noFilters`; its text has a dash, see notes.md)

#### Scenario: What the agent gets
- **WHEN** the user opens "What the agent gets"
- **THEN** the preview of the message the agent receives shows in place, with "Also attach the full event" applied (not drawn)

#### Scenario: Connect another app
- **WHEN** the user picks "Connect another app"
- **THEN** the Add integration view of the `integrations-accounts` capability opens

#### Scenario: No app connected
- **WHEN** the project has no connected app
- **THEN** the form shows the production text "Connect an app and this automation can run whenever something happens in it."

### Requirement: Automation view

A click on a row SHALL open the automation view: the name with the "On" switch in the title, the line "Runs {agent} · edited {age}", a "Runs" group and a "Settings" group. "Runs" SHALL hold "Run now" in its title, "Next run", "Last run" and "History" with "See all runs". "Settings" SHALL hold "Runs when" and "Instruction" with "Discard" and "Save". "Delete" SHALL be in the view.

#### Scenario: Open an automation
- **WHEN** the user clicks "Daily summary"
- **THEN** the view shows "Runs" with "Next run" "Fri, Nov 20, 09:00 UTC · in 14h", "Last run" "Today 09:00 · did not finish" with a red dot, and "History", then "Settings" with "Runs when" "Weekdays at 09:00 UTC" and the instruction

#### Scenario: Last run opens the run
- **WHEN** the user clicks "Last run"
- **THEN** the run history opens with that run open

#### Scenario: See all runs
- **WHEN** the user clicks "See all runs"
- **THEN** the run history list opens

#### Scenario: Failed last run
- **WHEN** the last run failed
- **THEN** the "Last run" row shows a red dot, and no banner shows above the form

#### Scenario: App trigger view
- **WHEN** the automation is an app trigger
- **THEN** "Next run" does not show, because an event has no planned time (not drawn)

#### Scenario: No run yet
- **WHEN** the automation never ran
- **THEN** "Last run" does not show (not drawn)

### Requirement: Automations apply at once

The "On" switch SHALL turn the automation on or off at once. "Save" in "Settings" SHALL save the automation at once. No automation action SHALL change the agent configuration or save an agent version. Leaving "Settings" with unsaved edits SHALL open the unsaved-changes dialog of the `agent-panel` capability.

#### Scenario: Switch off
- **WHEN** the user turns the switch off
- **THEN** the automation pauses at once and the agent footer still reads "Saved as vN"

#### Scenario: Save settings
- **WHEN** the user changes the instruction and clicks "Save"
- **THEN** the automation is saved and "Save" and "Discard" are disabled again

#### Scenario: Discard
- **WHEN** the user clicks "Discard"
- **THEN** "Runs when" and "Instruction" return to the saved values

#### Scenario: Leave with edits
- **WHEN** the user goes back with unsaved settings
- **THEN** the unsaved-changes dialog opens

#### Scenario: Leave the agent with edits
- **WHEN** the user has unsaved settings in the automation view and leaves the agent (route change, panel close or content swap)
- **THEN** the one leave guard of the agent layout asks first, because the automation guard registers with it

#### Scenario: Save fails
- **WHEN** the save call fails
- **THEN** the view says what failed in plain words and keeps the edits

### Requirement: Run now starts a session in the browser

DECIDED: "Run now" in the row menu, in the "Runs" group, in the empty run history and on the Automations page SHALL start a new session of the agent in the browser with the automation's message, exactly as production does, and SHALL open that session. The entry points MAY share one client hook only if it changes no behavior. "Run now" SHALL be blocked with the production reasons. The run SHALL NOT show in the run history.

#### Scenario: Run a schedule now
- **WHEN** the user clicks "Run now" on "Daily summary"
- **THEN** a new session of the agent starts with the stored instruction, as production does, and the screen moves to that session

#### Scenario: Run an app trigger now
- **WHEN** the user clicks "Run now" on "New Zendesk ticket"
- **THEN** the new session starts with the instruction filled from the newest recorded event of this automation, as production does

#### Scenario: App trigger with no recorded event
- **WHEN** the app trigger has no recorded event
- **THEN** the session starts with the instruction and no event values, as production does

#### Scenario: Not in the run history
- **WHEN** the session that "Run now" started ends
- **THEN** the run history of the automation does not list it, as production

#### Scenario: Unsaved settings
- **WHEN** "Settings" has unsaved edits
- **THEN** "Run now" is disabled and its hover shows the production reason that starts "Save your changes first"

#### Scenario: No instruction
- **WHEN** the automation has no instruction
- **THEN** "Run now" is disabled with "Add an instruction to test this automation"

#### Scenario: No agent
- **WHEN** the automation has no agent
- **THEN** "Run now" is disabled with the production reason for a missing agent

#### Scenario: Request in flight
- **WHEN** the user clicks "Run now" again before the session started
- **THEN** the second click does nothing

#### Scenario: Session start fails
- **WHEN** the new session cannot start
- **THEN** the view shows the production error for a failed session start and stays where it is

#### Scenario: One hook for every entry point
- **WHEN** the user starts "Run now" from the row menu, the "Runs" group, the empty run history or the Automations page
- **THEN** each entry point calls the same client hook and gets the same blocked reasons

### Requirement: Run history list

The run history view SHALL show the title "Run history", the count line "N runs in 30 days", and the runs grouped by day ("Today", "Yesterday", then dates), newest first. A row SHALL show the run label ("Scheduled run", "Test run" or the event), the time and a status dot. A skipped run SHALL show its reason under the label. The panel view SHALL have no filter. An icon SHALL open the full run history page in a new browser tab.

#### Scenario: List
- **WHEN** the user opens the run history of "Daily summary"
- **THEN** it shows "12 runs in 30 days", the group "Today" with "Scheduled run 09:00" and "Test run 08:41", and older groups

#### Scenario: Skipped run
- **WHEN** a run was skipped because the agent needed setup
- **THEN** the row shows a gray dot and "Skipped: agent needs setup" under "Scheduled run"

#### Scenario: Failed run
- **WHEN** a run failed
- **THEN** the row keeps the production look with a red dot, and has no second line

#### Scenario: Test run row
- **WHEN** a row is a captured test event (a delivery marked `is_test`)
- **THEN** its label reads "Test run", as production, and it has no conversation to open

#### Scenario: Full page in a new tab
- **WHEN** the user clicks "Open run history in a new tab"
- **THEN** a new browser tab opens the full run history page of this automation, and the panel does not change

#### Scenario: Many runs
- **WHEN** the automation has more runs than one page
- **THEN** the list loads the next page when the user scrolls to its end, and the count line stays correct

#### Scenario: Loading
- **WHEN** the runs are loading
- **THEN** the view shows skeleton rows and no count line, as production

#### Scenario: Load error
- **WHEN** the runs cannot load
- **THEN** the view shows "Could not load this automation's runs." and a way to retry, as production

### Requirement: Open a run

A click on a run SHALL replace the list with the run: its label, its time, how long it took, and the conversation it had in the session view, read only. The back arrow SHALL return to the list. An icon on the run line SHALL open the run's session as a full session in a new browser tab.

#### Scenario: Open a run
- **WHEN** the user clicks "Scheduled run 09:00"
- **THEN** the view shows "Scheduled run", "Today 09:00 · took 42 s", the instruction, and the agent's answer, with no composer

#### Scenario: Open in a new tab
- **WHEN** the user clicks "Open this run in a new tab"
- **THEN** a new browser tab opens the session of this run at the session route, and the panel stays as it is

#### Scenario: Run with no conversation
- **WHEN** the run never started a session
- **THEN** the view shows "No conversation for this run" and "This run didn't get far enough to start one, so there is no transcript to read.", and the new tab icon does not show

#### Scenario: Conversation cannot open
- **WHEN** the session of the run cannot be opened
- **THEN** the view shows "This conversation can't be opened", as production

#### Scenario: Failed run reason
- **WHEN** the open run failed
- **THEN** the run shows its reason, for example "The agent stopped before finishing."

#### Scenario: Running run
- **WHEN** the open run is still running
- **THEN** the conversation shows the run in progress and the row dot is orange (not drawn)

### Requirement: Wide panel shows list and run side by side

When the run history view is at least 700 px wide, it SHALL show the list at the left and the newest run open at the right. Below 700 px, the run SHALL replace the list. The width of the view, not the width of the window, SHALL decide.

#### Scenario: Widen
- **WHEN** the user clicks "Widen the panel" on the run history
- **THEN** the panel is 760 px wide, the list shows at the left and the newest run shows at the right

#### Scenario: 440 px panel on a wide window
- **WHEN** the panel is 440 px wide and the window is 1440 px wide
- **THEN** the view shows one column

### Requirement: No runs yet

A run history with no run SHALL show "No runs yet", "The first time this automation runs, it shows up here with the conversation it had." and the button "Run now". On the full page, when filters hide every run, it SHALL show "No runs match these filters" and "Reset the filters to see everything this automation has done."

#### Scenario: Empty history
- **WHEN** the automation never ran
- **THEN** the view shows the two lines and "Run now"

#### Scenario: Run from the empty state
- **WHEN** the user clicks "Run now" there
- **THEN** a new session of the agent starts and opens, as "Run now" does elsewhere

#### Scenario: Filters hide every run
- **WHEN** the user filters the full page so that no run matches
- **THEN** the page shows "No runs match these filters" and its line

### Requirement: Filters only on the full page

The full run history page SHALL keep the production filters (Status, Type, Group by). The run history view in the panel SHALL NOT show them.

#### Scenario: Full page
- **WHEN** the user opens the full run history page
- **THEN** the filter menu with Status, Type and Group by shows

### Requirement: Delete an automation keeps its runs

"Delete" in the row menu and in the automation view SHALL open the production dialog "Delete this automation?" before it deletes. After "Delete", the automation SHALL stop and leave the list, and its past runs and their sessions SHALL stay stored.

#### Scenario: Delete from the view
- **WHEN** the user clicks "Delete" in the automation view and confirms
- **THEN** the automation leaves the list, the panel goes back to the Automations tab, and the sessions of its runs still show in the Sessions page

#### Scenario: Cancel
- **WHEN** the user clicks "Cancel"
- **THEN** nothing changes

#### Scenario: Delete fails
- **WHEN** the delete call fails
- **THEN** the dialog says what failed in plain words and the automation stays

### Requirement: Same views in every container

The automation list, the "Add automation" menu, the two forms, the automation view and the run history SHALL be views that the right panel, the Configuration page Automations tab and the Automations page mount. No container SHALL open a drawer for them.

#### Scenario: Configuration page
- **WHEN** the user opens the Automations tab of the Configuration page
- **THEN** it shows the same list with "Add automation" and the groups "Scheduled triggers" and "App triggers", with no version and no save button

#### Scenario: Automations page
- **WHEN** the user opens an automation from the Automations page in the main sidebar
- **THEN** the page mounts the same automation view with "Runs" and "Settings"

#### Scenario: Session panel
- **WHEN** the user picks "Run history" in the panel of a session
- **THEN** the run history opens inside the panel and no 960 px drawer opens
