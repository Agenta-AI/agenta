## ADDED Requirements

### Requirement: Header layout

The header SHALL show, from left to right: the agent icon, the agent name with a down arrow that opens the agent menu, a free space, the session menu button with a status dot and the session title, a separator, then the icon buttons "Share the conversation", "Files", "Configuration" and "Builder". The header SHALL be one row on desktop widths.

#### Scenario: A session with a title
- **WHEN** the user opens the session "Charged twice for March" of the agent "Support triage"
- **THEN** the header shows "Support triage" at the left and "Charged twice for March" in the session menu button at the right, before the four icons

#### Scenario: A new session with no title yet
- **WHEN** the user opens an empty new session
- **THEN** the session menu button shows the production title of an untitled session, and the four icons show

#### Scenario: Long names
- **WHEN** the agent name or the session title is longer than the space
- **THEN** each is cut with an ellipsis, the session button keeps a maximum width of 240 px, and the icons never move out of the row

#### Scenario: Private agent the user cannot see
- **WHEN** the session belongs to a private agent the user cannot see
- **THEN** the header shows the lock and the production text "Private agent", with no agent menu, no Configuration and no Builder

#### Scenario: No session tab strip
- **WHEN** the user opens any session
- **THEN** the session screen shows no session tab strip above the conversation, because the header and the sidebar replace it

### Requirement: Agent menu

The agent menu SHALL hold "History", "Rename", "Export agent" and "Archive agent". "History" SHALL open the production Version history drawer over the page. "Rename" and "Archive agent" SHALL run the production actions with their production confirmations.

#### Scenario: Open History
- **WHEN** the user picks "History" in the agent menu
- **THEN** the Version history drawer opens over the page with the version list, as on the canvas board S06

#### Scenario: Revert from History
- **WHEN** the user picks v3 in the drawer and clicks "Revert to v3"
- **THEN** the dialog "Revert to v3?" opens, and the configuration-draft capability decides the rest

#### Scenario: History fails to load
- **WHEN** the version list cannot be loaded
- **THEN** the drawer shows the production text "The version history could not be loaded. Retry from the list."

#### Scenario: Archive the agent
- **WHEN** the user picks "Archive agent" and confirms
- **THEN** the agent is archived as in production and the screen leaves the agent

#### Scenario: A user who cannot edit the agent
- **WHEN** the user has no right to edit agents
- **THEN** the agent menu shows "History" and "Export agent" only

### Requirement: Session menu

The session menu SHALL list the latest sessions of this agent with their run state, then "New session", then a link that opens the Sessions page of this agent. A click on a session SHALL open it. The open session SHALL be marked in the list.

#### Scenario: Open another session
- **WHEN** the user opens the session menu and clicks "Login fails on Safari"
- **THEN** that session opens and the right panel keeps its content and its state

#### Scenario: Run state in the list
- **WHEN** a session in the list is running
- **THEN** its row shows the production spinner, and a session that waits on the user shows the production "Waiting on you" state

#### Scenario: Many sessions
- **WHEN** the agent has more sessions than the list shows
- **THEN** the list scrolls inside a fixed height and the link to the Sessions page is the way to see all

#### Scenario: No other session
- **WHEN** the agent has only this session
- **THEN** the menu shows this session, "New session" and the link

#### Scenario: List fails to load
- **WHEN** the list cannot be loaded
- **THEN** the menu says so in one line with "Try again", and "New session" still works

### Requirement: New session

"New session" SHALL open an empty session of this agent on the latest saved version and SHALL put the cursor in the composer. A second click while the first navigation runs SHALL NOT start a second session.

#### Scenario: Start a new session
- **WHEN** the user picks "New session" in the session menu
- **THEN** an empty session opens, it runs on the latest saved version, and the composer has the focus

#### Scenario: Change still saving
- **WHEN** an edit of the agent is still saving and the user picks "New session"
- **THEN** the automatic save goes on, and the new session opens on the latest saved version, as production does

#### Scenario: Double click
- **WHEN** the user clicks "New session" twice quickly
- **THEN** only one session opens

### Requirement: Share shares the conversation

"Share the conversation" SHALL open the production session share flow for this conversation only. It SHALL NOT share the agent. Sharing the agent SHALL stay on the Access tab of Configuration.

#### Scenario: Owner shares
- **WHEN** the owner of the session clicks "Share the conversation"
- **THEN** the production session share dialog opens for this session

#### Scenario: Not the owner
- **WHEN** a user who does not own the session looks at the header
- **THEN** the share button opens the production view of who has access and what this user can do

#### Scenario: A session that cannot be shared
- **WHEN** the session came from a channel or an API key and has no owner
- **THEN** the share button shows the production reason text and no share action

### Requirement: Two conversations on one screen

The session screen SHALL be able to show the page conversation and the builder conversation at the same time. The container SHALL give each conversation its role ("page" or "embedded") as a context value. A role change SHALL keep the conversation's state (composer text, scroll position, an open quick action, a running answer). Shortcuts that act on a run or an approval SHALL act only on the focused conversation. No code SHALL assume that the whole history of a session is in memory.

#### Scenario: Escape stops only the focused run
- **WHEN** both conversations stream an answer and the focus is in the builder composer
- **THEN** Escape stops the builder run, and the agent run continues

#### Scenario: Approve by key
- **WHEN** both conversations show an approval card and the focus is in the page conversation
- **THEN** Cmd+Enter or Ctrl+Enter answers only the card of the page conversation, and `Alt+G` approves only a gate of the page conversation

#### Scenario: Escape with no run
- **WHEN** the focus is in the builder composer, nothing runs, no card waits, and the user presses Escape
- **THEN** the right panel goes back one level or closes, as the agent-panel capability says

#### Scenario: Focus after opening the builder
- **WHEN** the user opens the Builder content with the header icon
- **THEN** the focus moves to the builder composer

#### Scenario: Same-agent switch
- **WHEN** the user opens another session of the same agent
- **THEN** the page conversation changes, and the builder conversation keeps its composer text, scroll position and running answer

#### Scenario: Long history
- **WHEN** a session has more records than one page of the records query
- **THEN** the screen shows it correctly with only part of the records loaded, and no count or check reads all records

### Requirement: Conversation lifetime

A conversation's state SHALL survive every move between sessions and agent pages: the composer text, the scroll position, an open quick action, and a running answer that continues. A remount SHALL be allowed when it restores this state by session id. The session screen SHALL stay one page file for every session, and the agent pages SHALL be views of one agent route. Nothing SHALL be kept in memory for a conversation that is not on screen.

#### Scenario: Move to the Configuration page
- **WHEN** the builder streams an answer in the panel and the user opens the Configuration page of the same agent
- **THEN** the answer keeps streaming, and the composer text and the scroll position are as before

#### Scenario: Leave the agent and come back
- **WHEN** the user typed text in the composer of a session, opens Settings, and opens the same session again
- **THEN** the composer holds the same text and the conversation shows the same scroll position

#### Scenario: Running answer after a return
- **WHEN** an answer was running when the user left the agent and is still running on the server
- **THEN** the conversation reconnects and shows the answer as it continues

#### Scenario: Answer ended while away
- **WHEN** the answer ended while the user was away
- **THEN** the conversation shows the full answer from the records, as production does after a reload

### Requirement: The session picks up a newer saved version

An open session SHALL move to a newer saved version with no click as production does: it follows its agent, no run or approval wait is active, and no save of this tab is armed, running or failed. It SHALL also wait while an open view form has edits; else it SHALL offer "Update to v{{version}}". The browser SHALL run the existing latest-version check also when a `committed` builder result for the agent arrives here, and on window focus.

#### Scenario: Builder saves while the session is idle
- **WHEN** the user approves a builder change that saves v5, and the open session on v4 is idle and no form has edits
- **THEN** the `committed` result arrives in this browser, the check runs, and the session moves to v5 with no click; the next message runs on v5

#### Scenario: A run is active
- **WHEN** the builder saves v5 while the session runs a turn on v4
- **THEN** the turn finishes on v4, and the session moves to v5 when the turn ends

#### Scenario: An approval waits
- **WHEN** the builder saves v5 while the session waits for an approval
- **THEN** the session stays on v4 and offers "Update to v5"

#### Scenario: Open form with edits
- **WHEN** the builder saves v5 while the Instructions view holds typed text that the user did not save
- **THEN** the session stays on v4, offers "Update to v5", and the form keeps its text

#### Scenario: Save of this tab is running
- **WHEN** an automatic save of this tab runs while a builder result for another save arrives
- **THEN** the session does not adopt until the save resolves, as production does

#### Scenario: Pinned session
- **WHEN** the session is pinned to one revision and does not follow its agent
- **THEN** it does not move, and it offers "Update to v5"

#### Scenario: Save from another tab or person
- **WHEN** another person or another browser tab saves v5
- **THEN** this tab finds v5 at its next window focus or visibility change, and runs the same adoption rule

#### Scenario: One check per result
- **WHEN** the user approves a change card in this tab that saves v5
- **THEN** the result clears the latest-version caches and starts one check; a second check that starts before the first answers wins, as production keeps only the newest answer

#### Scenario: Hidden page
- **WHEN** the browser tab is hidden while a save lands
- **THEN** no check runs until the tab is visible again, and then one check runs

### Requirement: Spinner on running sessions

A running session SHALL show the production spinner after its name everywhere a session name shows: the sidebar, the session menu and the Sessions page. A session that waits on the user SHALL show the production "Waiting on you" state.

#### Scenario: A session that runs
- **WHEN** a session has a turn running
- **THEN** its row shows the spinner in the sidebar, the session menu and the Sessions page

#### Scenario: Run ends
- **WHEN** the turn ends
- **THEN** the spinner goes away in all three places

### Requirement: Spark on sessions the builder started
A session with the origin `builder` SHALL show a small spark after its name in the sidebar, the session menu and the Sessions page, with the tooltip "Started by the builder". A session the user started, a session from an automation, and a session with no origin value SHALL show no spark. A running session SHALL show the spinner, and the spark SHALL stay next to it.

#### Scenario: Session from a builder test
- **WHEN** the builder ran a test of "Email writer" and the test session "Zahnwerk GmbH" shows in the sidebar
- **THEN** the row shows the spark, and hovering it shows "Started by the builder"

#### Scenario: Session the user started
- **WHEN** the user started the session
- **THEN** no spark shows

#### Scenario: No origin value
- **WHEN** a session row has no origin value
- **THEN** no spark shows and no error shows

#### Scenario: Running test session
- **WHEN** a test session started by the builder still runs
- **THEN** its row shows the spinner and the spark

#### Scenario: Same mark in every list
- **WHEN** the session shows in the sidebar, the session menu and the Sessions page
- **THEN** all three show the same spark

### Requirement: Session origin comes from the server
The session screen SHALL read who started a session from the session field `origin` (`manual`, `trigger` or `builder`) that the server decodes. Only the server SHALL set the origin `builder` and the link `ag.builder.session_id` to the builder chat; a client value SHALL NOT set them. A builder-started session SHALL offer a link to the builder chat that started it.

#### Scenario: Builder link in the session menu
- **WHEN** the user opens the session menu of a session that the builder started
- **THEN** the menu offers to open the builder chat that started it

#### Scenario: No right to the builder chat
- **WHEN** the reader of a builder-started session cannot open the builder chat that started it
- **THEN** the session still shows the spark, and opening the link shows the production no-access state

#### Scenario: Client sends an origin
- **WHEN** a client sends `ag.origin` or `ag.builder.session_id` on a session write
- **THEN** the server ignores them, and the session keeps its own origin

#### Scenario: Builder chat itself
- **WHEN** the user starts a builder chat
- **THEN** that chat has the origin `manual` and shows no spark

### Requirement: Session screen states

The session screen SHALL keep the production loading, unreachable, no-access and private-agent states. A switch between sessions SHALL keep the header, the sidebar and the right panel on screen and swap only the conversation.

#### Scenario: First load
- **WHEN** the session screen opens for the first time
- **THEN** it shows the production loading state once, and each switch after it shows no full-screen spinner

#### Scenario: Session cannot be opened
- **WHEN** the user has no access to the session
- **THEN** the screen shows the production no-access page with no header icons and no right panel

#### Scenario: Session not found
- **WHEN** the session does not exist or the network fails
- **THEN** the screen shows the production unreachable state with its retry
