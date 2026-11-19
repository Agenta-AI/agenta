## ADDED Requirements

### Requirement: Builder panel header

The builder panel header SHALL show the chat title as a menu button with a down arrow, then the buttons "New chat" ("+"), "Open in the builder" and "Close the builder". A new chat SHALL have the title "New chat". The title menu SHALL list the latest chats about the agent of the screen, then "Chat history".

#### Scenario: Header of a new chat
- **WHEN** the builder panel shows a new chat
- **THEN** the header shows "New chat" with a down arrow, then "+", the button "Open in the builder" and the button "Close the builder"

#### Scenario: Header of a chat with a title
- **WHEN** the builder panel shows the chat "Urgency of the Safari ticket"
- **THEN** the title button shows "Urgency of the Safari ticket", cut with an ellipsis when it is too long

#### Scenario: Title menu
- **WHEN** the user clicks the title
- **THEN** a menu lists the latest chats about this agent with their age, and "Chat history" at the end

#### Scenario: Pick a chat in the title menu
- **WHEN** the user picks "Add the refund skill" in the title menu
- **THEN** that chat opens in the panel

#### Scenario: Close
- **WHEN** the user clicks "Close the builder"
- **THEN** the panel closes, and a running builder answer keeps running

### Requirement: The link from a chat to its agent is kept in this browser
The browser SHALL keep, per user and project, the builder chat ids of each agent, newest first (PROPOSED key `agenta:builder:chats:${userId}:${projectId}`). It SHALL add a chat when its first message is sent from the panel of an agent, and when a builder page chat with no agent gets its first `create_agent` or `edit_agent_config` result. A chat SHALL stay with its first agent. No server field SHALL hold the link.

#### Scenario: First message from the panel
- **WHEN** the user sends the first message of a new chat from the panel of "Support triage"
- **THEN** the browser adds the chat id at the top of the list of "Support triage"

#### Scenario: Builder page chat creates an agent
- **WHEN** a builder page chat with no agent creates "Lead finder"
- **THEN** the browser adds the chat to the list of "Lead finder"

#### Scenario: Chat that edits several agents
- **WHEN** a chat about "Support triage" later edits "Email writer"
- **THEN** the chat stays in the list of "Support triage" only (documented limit)

#### Scenario: Another browser or device
- **WHEN** the user opens the panel of "Support triage" in another browser
- **THEN** that browser has no link for the chats started elsewhere, and the panel opens a new chat (documented limit); those chats still show on the builder page sidebar

#### Scenario: Browser storage not available
- **WHEN** browser storage cannot be read or written
- **THEN** the panel opens a new chat with no "Recent chats" part, and sending works

#### Scenario: Another user on the same browser
- **WHEN** another user signs in on the same browser
- **THEN** the panel reads only that user's key and shows none of the first user's chats

#### Scenario: A stored chat no longer exists
- **WHEN** a stored chat id is deleted or the user can no longer read it
- **THEN** the query does not return it, and the browser drops it from the list

### Requirement: Which chat opens

When the builder panel opens, and when the agent of the screen changes while it is open, the panel SHALL query the stored chats of this agent with `POST /sessions/query` and `session_ids`, newest first, and SHALL open the newest one if its last activity is less than 48 hours old or it still runs. In every other case it SHALL open a new chat. The panel SHALL never show a chat about another agent.

#### Scenario: Recent chat
- **WHEN** the newest stored chat of "Support triage" had its last activity 30 hours ago and the user opens the builder panel
- **THEN** that chat opens

#### Scenario: Old chat
- **WHEN** the newest stored chat of "Support triage" had its last activity 3 days ago
- **THEN** a new chat opens, and the old chat shows under "Recent chats"

#### Scenario: Old chat that still runs
- **WHEN** the newest chat had its last activity 3 days ago and the builder still runs in it
- **THEN** that chat opens

#### Scenario: Renamed old chat
- **WHEN** the user renamed a 5-day-old chat today
- **THEN** that chat counts as recent and opens, because a rename moves the last activity (documented limit)

#### Scenario: Chat started on the builder page
- **WHEN** a builder page chat created or edited "Support triage" first in this browser
- **THEN** that chat counts as a chat about "Support triage" for this rule and the lists

#### Scenario: No chat yet
- **WHEN** no chat about the agent is stored
- **THEN** a new chat opens with no "Recent chats" part

#### Scenario: Chat list fails to load
- **WHEN** the query of the stored chats fails
- **THEN** a new chat opens, the "Recent chats" part says in one line that the list could not be loaded with "Try again", and the composer works

#### Scenario: Another agent
- **WHEN** the panel shows a chat about "Support triage" and the user opens a session of "Email writer"
- **THEN** the panel stays open and the rule runs again for "Email writer"
- **AND** the chat about "Support triage" keeps running if it ran

### Requirement: Same-agent switch keeps the panel

On a move to another session or another screen of the same agent, the panel SHALL NOT run the chat-open rule, and the builder conversation's state SHALL survive: the same chat, its scroll position, the composer text, an open quick action and a running answer that continues. A remount that restores this state SHALL be allowed. A switch inside one page file SHALL render nothing in the builder outside the chip; streaming updates SHALL still render.

#### Scenario: Switch session while typing
- **WHEN** the user typed "Make replies shorter" in the builder composer and opens another session of the same agent
- **THEN** the same chat shows, the composer still holds "Make replies shorter", and the chip still shows "Support triage"

#### Scenario: Open Configuration while typing
- **WHEN** the user typed in the builder composer and opens the skill "ticket-triage" on the Configuration page of the same agent
- **THEN** the composer keeps its text, and only the chip changes to "Support triage · ticket-triage"

#### Scenario: Switch session during an answer
- **WHEN** the builder streams an answer and the user opens the Configuration page of the same agent
- **THEN** the answer keeps streaming in the panel with no reload and no jump of the scroll position

#### Scenario: Render test
- **WHEN** a test switches the page session of the same agent while the builder streams
- **THEN** the test passes if the composer text, the scroll position and an open quick action survive and the answer continues, and the only renders caused by the switch are in the chip; stream updates do not fail the test

### Requirement: New chat

A new chat SHALL show, from top to bottom: the question "What should we change?", the line "I can change, test and explain {agent}.", the composer with the context chip and the placeholder "Ask the builder about this agent", the quick actions "Improve", "Test", "Skills", "Automate" and "Explain", and the part "Recent chats" with up to 3 chats about this agent, their age, and "View all".

#### Scenario: New chat with recent chats
- **WHEN** a new chat opens for "Support triage" and three older chats exist
- **THEN** the panel shows "What should we change?", "I can change, test and explain Support triage.", the composer, the five quick actions, and "Recent chats" with "Shorter replies for billing tickets" and "3d", "Add the refund skill" and "8d", "Why the Safari ticket was not labeled" and "15d"

#### Scenario: Open a recent chat
- **WHEN** the user clicks "Add the refund skill"
- **THEN** that chat opens in the panel

#### Scenario: New chat with fewer chats
- **WHEN** only one older chat exists
- **THEN** "Recent chats" shows one row and "View all"

#### Scenario: Chat appears in the lists after the first message
- **WHEN** the user opens a new chat and leaves it with no message
- **THEN** the chat does not appear in "Recent chats", the title menu or "Chat history"

#### Scenario: Start a new chat with "+"
- **WHEN** the user clicks "+" in a chat with messages
- **THEN** a new chat opens, and the earlier chat appears under "Recent chats"

### Requirement: Quick actions fill the composer

A click on a quick action SHALL open its ready requests under the row of quick actions. Each ready request SHALL show its request and one line under it. A click on a ready request SHALL put its text in the composer and SHALL NOT send it. At most one quick action SHALL be open at a time.

#### Scenario: Open "Test"
- **WHEN** the user clicks "Test"
- **THEN** three ready requests show: "Test with 5 sample tickets" with "I write the tickets and check the answers", "Run this session again on the draft" with "Compares the new answer with the old one", and "Find the tickets it gets wrong" with "Looks at the sessions of the last 7 days"

#### Scenario: Pick a ready request
- **WHEN** the user clicks "Test with 5 sample tickets"
- **THEN** the composer holds that text, the focus moves to the composer, and nothing is sent

#### Scenario: Composer already has text
- **WHEN** the composer holds text and the user picks a ready request
- **THEN** the ready request replaces the composer text

#### Scenario: Close a quick action
- **WHEN** "Test" is open and the user clicks "Test" again or clicks "Skills"
- **THEN** "Test" closes, and in the second case "Skills" opens

### Requirement: Chat history

"View all" and "Chat history" SHALL open the chat history in the same panel, with a back button, the title "Chat history", a search field with the placeholder "Search chats…" and all chats about this agent, newest first, each with its age. The back button SHALL return to the chat the user came from. A click on a row SHALL open that chat.

#### Scenario: Open the history
- **WHEN** the user clicks "View all"
- **THEN** the panel shows "Chat history" with the rows "Shorter replies for billing tickets" "3d" to "Create the Support triage agent" "70d", newest first

#### Scenario: Search
- **WHEN** the user types "refund" in "Search chats…"
- **THEN** the list shows only the stored chats of this agent whose title contains "refund" (the query `search` field), newest first

#### Scenario: Search with no result
- **WHEN** no chat title matches the search
- **THEN** the list says in one line that no chat matches, and clearing the search shows all chats again

#### Scenario: Empty history
- **WHEN** no chat about the agent exists
- **THEN** the history shows one line that says there are no chats yet, and the back button

#### Scenario: Many chats
- **WHEN** the agent has more stored chats than one page of the query
- **THEN** the list loads the next page when the user scrolls to its end

#### Scenario: Back
- **WHEN** the user clicks the back button
- **THEN** the panel shows the chat it showed before, with its composer text

#### Scenario: Loading and error
- **WHEN** the list loads or fails
- **THEN** it shows skeleton rows while it loads, and on failure one line with "Try again"

### Requirement: Open in the builder

"Open in the builder" SHALL open the same chat on the builder page, with the agent of the screen in the agent pane (`?tab=agent:<id>`). The chat SHALL keep its messages and a running answer.

#### Scenario: Open a chat in the builder page
- **WHEN** the user clicks "Open in the builder" in the chat "Urgency of the Safari ticket"
- **THEN** the builder page opens on that chat with "Support triage" in the agent pane

#### Scenario: A new chat with no message
- **WHEN** the user clicks "Open in the builder" in a new chat with text in the composer
- **THEN** the builder page opens a new chat with the same composer text, the chip for "Support triage" and "Support triage" in the agent pane

### Requirement: A builder run continues when the panel closes

A builder run SHALL keep running on the server when the user closes the panel, swaps the content, opens another agent or leaves the agent screens. A running builder chat SHALL show a spinner in the builder's sidebar. When the panel opens again on that chat, it SHALL show the answer so far and keep streaming.

#### Scenario: Close during a run
- **WHEN** the builder runs and the user closes the panel
- **THEN** the run continues, and the chat shows the spinner in the builder's sidebar

#### Scenario: Reopen
- **WHEN** the user opens the builder panel again while the run continues
- **THEN** the same chat opens, because it still runs, and it shows the answer so far

#### Scenario: Run ends while the panel is closed
- **WHEN** the run ends with a change card while the panel is closed
- **THEN** the card waits in the chat, and the chat shows the production "waiting on you" state in the builder's sidebar

### Requirement: Other screens open the builder with a request

A configuration flow SHALL be able to open the builder panel with text in the composer, for example "Create with AI" in the Integrations "+" menu with "I want to connect". The text SHALL NOT be sent. If the panel shows a chat with messages, the request SHALL open in a new chat.

#### Scenario: Create with AI from Integrations
- **WHEN** the user picks "Create with AI" in the Integrations "+" menu
- **THEN** the panel swaps to Builder, a new chat holds "I want to connect" in the composer, and the focus is in the composer

### Requirement: Builder panel states

The builder panel SHALL show a running answer, an error, a loading state and an empty history in the production chat style. A user who can read a builder chat but cannot send to it SHALL see the chat read only.

#### Scenario: Running answer
- **WHEN** the builder answers
- **THEN** the panel shows the production activity line (for example "Worked for 3 s" when done) and the streamed text

#### Scenario: Run error
- **WHEN** the builder run fails
- **THEN** the panel shows the production run error in plain words with a way to try again, and the details go to the logs

#### Scenario: Loading a chat
- **WHEN** the panel opens a chat whose records are not loaded yet
- **THEN** the panel shows skeleton rows in the chat layout, not a spinner in the middle

#### Scenario: Builder not available
- **WHEN** the project has no builder agent available
- **THEN** the header shows no Builder icon

#### Scenario: Read only
- **WHEN** the user opens a builder chat of another person that was shared with them
- **THEN** the chat shows read only, and its change cards say "Only the owner can approve" and "You can read this chat."

#### Scenario: Chips after a reload
- **WHEN** the user reloads the page and the panel opens a chat with sent messages
- **THEN** each sent message shows the chip it was sent with, rebuilt from the stored message, and the composer shows the chip of the page
