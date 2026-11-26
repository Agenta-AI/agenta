## ADDED Requirements

### Requirement: One tool call is one proposal

One versioned proposal SHALL be one tool call: up to 64 operations against one agent and one base revision. The card SHALL take one answer for the whole call; there SHALL be no approval per row. The buttons SHALL be "Deny" and "Approve", or "Deny all" and "Approve all" when the card holds several changes. Every builder tool that changes something SHALL show a change card: `edit_agent_config`, `create_agent`, the user steps and the changes that apply at once.

#### Scenario: One change
- **WHEN** the builder asks to edit the instructions of "Support triage"
- **THEN** the chat shows one card with "Deny" and "Approve"

#### Scenario: Several operations in one call
- **WHEN** one `edit_agent_config` call changes the instructions, adds a skill and changes the model
- **THEN** the chat shows one card with "Deny all" and "Approve all", not three cards

#### Scenario: Create an agent
- **WHEN** the builder calls `create_agent`
- **THEN** the chat shows one card with the three card parts, the tool sentence as its detail, "Deny" and "Approve"

### Requirement: Three card parts

Every card SHALL have a header with an icon, the change title and its path; a detail; and a footer with the footer note and the buttons. For a change that is part of a version the footer note SHALL be "Saves as v{base + 1}" (see "The version number on the card").

#### Scenario: Edit the instructions
- **WHEN** the builder proposes a change to AGENTS.md of an agent and the call's base is v4
- **THEN** the card header shows "Edit the instructions" and "Instructions › AGENTS.md", and the footer shows "Saves as v5", "Deny" and "Approve"

#### Scenario: Path from the operation target
- **WHEN** the operation target is `["parameters", "agent", {"list": "skills", "key": "release-qa"}, "body"]`
- **THEN** the describer returns the path as a list of segments, and the card joins them with "›"

#### Scenario: Long path
- **WHEN** the path is longer than the header, for example "Skills › ticket-triage › references/urgency-rules.md"
- **THEN** the path is cut with an ellipsis and the full path shows on hover

### Requirement: Four forms of detail

The detail of a versioned change SHALL use one of four forms, one per kind of operation: a text diff (`edit_text`, or `set` on a text), an old value and a new value (`set`), an added item (list add) or a removed item (list remove). An operation the card cannot render SHALL show its title and path only. Old values SHALL come only from the server preview (see "Card data").

#### Scenario: Text diff
- **WHEN** the change edits AGENTS.md and the approval payload has a preview
- **THEN** the detail shows the changed lines with "−" for removed and "+" for added lines and a few lines of context, and "View full diff · 14 lines" when the diff is longer

#### Scenario: Open the full diff
- **WHEN** the user clicks "View full diff · 14 lines"
- **THEN** the full diff opens as a wide view in the right panel, and Back returns to the chat

#### Scenario: Old and new value
- **WHEN** the change sets the model from Claude Sonnet 5.5 to Claude Opus 5.5 and the reasoning from low to medium, and the payload has a preview
- **THEN** the detail shows "Model" with the old value struck through, an arrow and the new value, and the same for "Reasoning"

#### Scenario: Added item
- **WHEN** the change adds the skill "refund-check"
- **THEN** the detail shows the item with a plus mark, its description "Checks if a charge can be refunded" and its files from the operation value, the note "can run as a program" for a file that can run, and "Open the skill"

#### Scenario: Added MCP server
- **WHEN** the change adds the MCP server "linear" at "mcp.linear.app/sse" and the server preview holds its tool list
- **THEN** the detail shows the server with a plus mark, its address, and the line "Tools" with "12 tools, asks before each use"

#### Scenario: MCP server with no tool list
- **WHEN** the server preview has no tool list for the new server
- **THEN** the "Tools" line does not show, and the rest of the card shows

#### Scenario: Removed item
- **WHEN** the change removes Gmail
- **THEN** the detail shows Gmail with a remove mark and "No longer available to the agent", and the main button reads "Remove"

#### Scenario: Preview missing for one call
- **WHEN** the server could not compute the preview of one call
- **THEN** that card shows the proposed values and the text fragments of `edit_text` with a label (text to write) and no old value, and "Approve" still works

#### Scenario: Operation the card cannot render
- **WHEN** an operation has a kind or target the describer does not know
- **THEN** the card shows that operation as a row with its title and path only, and "Approve" still works

### Requirement: Card data

The describer SHALL stay a pure function that returns data and does no fetch. It SHALL return `changes?: ApprovalChange[]`, each with `title`, `path: string[]`, `detail` (`text_diff`, `value_change`, `item` added or removed, or a user step), `effect` (`version` or `immediate`) and `risks`. The card host SHALL pass old values from the approval payload preview to the describer. The browser SHALL NOT compute old values by applying operations to a revision.

#### Scenario: Payload with a server preview
- **WHEN** the approval payload carries the server preview of an `edit_agent_config` call
- **THEN** the host passes the old values to the describer, and each `text_diff` and `value_change` has an `old` value

#### Scenario: Preview missing for one call
- **WHEN** the payload of one call carries no preview
- **THEN** the describer returns `text_diff` with `fragmentsOnly: true` and `value_change` with no `old`, and the browser reads no revision to fill them

#### Scenario: Tool that changes no configuration
- **WHEN** the tool is not a configuration change, for example an integration tool call
- **THEN** the describer returns no `changes`, and the card shows the `sentence`

### Requirement: The version number on the card

A card for a versioned change SHALL show "Saves as v{base + 1}", where base is the version of the call's base revision. The number SHALL NOT update while the card waits. When the latest version of the agent is newer than the base, the card SHALL show the conflict state before the person clicks Approve. After a save, the result row SHALL show the version from the tool result.

#### Scenario: Preview
- **WHEN** the call's base is v4 and v4 is the latest version
- **THEN** the card shows "Saves as v5"

#### Scenario: A version lands before the answer
- **WHEN** someone saves v5 while the card for base v4 waits
- **THEN** the card keeps "Saves as v5" and shows the conflict state before any click (text not written; listed for Mahmoud)

#### Scenario: Saved
- **WHEN** the tool result carries `revision: {id, version: "5"}`
- **THEN** the result row shows "Saved as v5"

### Requirement: Warning lines only for risk

A card SHALL show a warning line when a change adds risk, with a warning border. The kinds SHALL be: fewer questions (`fewer_approvals`), data that leaves Agenta (`data_egress`), a higher cost (`cost`), and something that stops working (`breakage`). The first two come from the operation; `cost` and `breakage` SHALL come from data the server preview carries (provided by the builder agent work). With no such data, the card SHALL show no line of that kind.

#### Scenario: Fewer questions
- **WHEN** the change sets "Close ticket" from "Always ask" to "Allow"
- **THEN** the card shows the warning line "The agent will close tickets without asking you." and a warning border

#### Scenario: Data leaves Agenta
- **WHEN** the change adds the MCP server "linear" at "mcp.linear.app/sse"
- **THEN** the card shows the warning line "Ticket text will go to an outside server." and a warning border

#### Scenario: A larger model costs more
- **WHEN** the change moves the model from Claude Sonnet 5.5 to Claude Opus 5.5 and the server preview carries the price ratio of the two models
- **THEN** the card shows "Each session will cost more. The larger model is about 5 times the price." and a warning border

#### Scenario: No price for one of the models
- **WHEN** the server preview has no price for the old or the new model
- **THEN** the card shows no cost line

#### Scenario: A cheaper model
- **WHEN** the new model costs the same or less than the old one
- **THEN** the card shows no cost line

#### Scenario: Skills that name a removed integration
- **WHEN** the change removes Gmail and the server preview finds 2 skills of the agent whose text mentions Gmail
- **THEN** the card shows "2 skills mention Gmail. They will stop working." and a warning border

#### Scenario: No skill mentions it
- **WHEN** no skill text of the agent mentions the removed item
- **THEN** the card shows no "stops working" line

#### Scenario: Automation that costs money
- **WHEN** the builder proposes a new automation
- **THEN** the card shows "It starts to run at once and each run costs money. It is not part of a version."

#### Scenario: Wider access
- **WHEN** the builder proposes to share the agent with the project
- **THEN** the card shows "Everyone in this project will see the agent and its sessions."

#### Scenario: No risk
- **WHEN** the change edits a line of AGENTS.md
- **THEN** the card shows no warning line and no warning border

#### Scenario: Several risks
- **WHEN** one call holds a permission set to "Allow" and a model change that costs more
- **THEN** the card shows both lines, one under each change

### Requirement: Grouped card

A card with several changes SHALL show the title "{N} changes to {agent}", the request summary, and the changes in up to three groups, in this order: "Saved together as v{base + 1}", "Needs you first", "Applies at once, not part of a version". An empty group SHALL NOT show. Pending calls of one paused turn SHALL show in one grouped card, share "Deny all" and "Approve all", and keep separate results. The footer SHALL show "Open a row to see its details".

#### Scenario: Three groups
- **WHEN** one paused turn holds an `edit_agent_config` call (instructions, skill "refund-check", model) on base v4, a Stripe connection step and a new automation "Daily summary"
- **THEN** the card shows "4 changes to Support triage", "Handle refunds for double charges", the group "Saved together as v5" with "Instructions" "3 lines added, 1 removed", "Skill refund-check" "3 files" and "Model" "Claude Sonnet 5.5 to Claude Opus 5.5", the group "Needs you first" with "Stripe" "Not connected" and "Connect", and the group "Applies at once, not part of a version" with "Automation Daily summary" and "Weekdays at 09:00 UTC"

#### Scenario: Approve all waits for the user step
- **WHEN** a "Needs you first" step is not done
- **THEN** "Approve all" is disabled, and a line says which step to do first (PROPOSED; text not written, listed for Mahmoud)

#### Scenario: User step done
- **WHEN** the user clicks "Connect" in the "Needs you first" group and the connection succeeds
- **THEN** the row shows that Stripe is connected, and "Approve all" is enabled

#### Scenario: Empty group
- **WHEN** the turn holds only versioned changes
- **THEN** only the group "Saved together as v5" shows

#### Scenario: Never mixed
- **WHEN** a change applies at once
- **THEN** it shows in "Applies at once, not part of a version" and never in the "Saved together" group

#### Scenario: Two calls in one turn
- **WHEN** a paused turn holds two `edit_agent_config` calls that wait for approval
- **THEN** they show in one grouped card with one "Saved together" group per call, as production batches pending approvals of one turn

#### Scenario: Open a row
- **WHEN** the user clicks the row "Instructions"
- **THEN** the row opens in place and shows the same detail as the single card for that change

#### Scenario: Deny all
- **WHEN** the user clicks "Deny all"
- **THEN** nothing is saved and nothing is applied, and each call shows its denied result row

#### Scenario: Many changes
- **WHEN** a call carries many changes, up to 64
- **THEN** the group lists its rows, the card scrolls inside the chat, and the footer stays at the bottom of the card

### Requirement: Each call has its own outcome

One call SHALL save all its operations as one version or save nothing. Calls approved together SHALL NOT form one transaction: each call SHALL get its own result row.

#### Scenario: One operation fails
- **WHEN** the user approves a call with 5 operations and the third one cannot apply
- **THEN** no version is saved for that call, its result row says "Not saved", and the builder gets the reason

#### Scenario: Configuration that cannot run
- **WHEN** the server refuses the save because the new configuration cannot run
- **THEN** the result row says "Not saved", and the builder gets the list of problems to fix

#### Scenario: Two approved calls on one base
- **WHEN** two calls on base v4 are approved together with "Approve all"
- **THEN** one call shows "Saved as v5" and the other shows the conflict row, and both rows show

### Requirement: Steps only the user can do happen in the card

A step that needs the person (sign in to an app, paste a secret) SHALL happen inside the card, from the builder tools `request_connection` and `request_secret` (provided by the builder agent work). The card SHALL show "Needs you", the reason, what the agent will be able to do, the footer note and the buttons. The builder SHALL never see a secret value. After the step, or after "Not now", the builder SHALL continue.

#### Scenario: Connect an app
- **WHEN** the builder asks to connect Stripe
- **THEN** the card shows "Connect Stripe", the path "Integrations", "Needs you", "The agent needs Stripe to look up charges. Only you can sign in.", "It will be able to" with "read charges and refunds", the footer note "The builder continues after you connect", "Not now" and "Connect Stripe"

#### Scenario: The user connects
- **WHEN** the user clicks "Connect Stripe" and the sign-in succeeds
- **THEN** the card shrinks to a result row that says Stripe is connected, and the builder continues

#### Scenario: Not now
- **WHEN** the user clicks "Not now"
- **THEN** the card shrinks to a result row, and the builder continues without Stripe

#### Scenario: Sign-in fails or is closed
- **WHEN** the sign-in window is closed or the sign-in fails
- **THEN** the card keeps its buttons and says what failed in plain words, as the production connect request does

#### Scenario: Paste a secret
- **WHEN** the builder asks for the billing key
- **THEN** the card shows "Attach a secret", the path "Secrets", "The script needs a key for your billing API. Paste it here. The builder never sees the value.", "Environment variable" with "BILLING_API_KEY", "Value" with "Paste the secret", the note "Stored in the project vault", "Not now" and "Save & attach"

#### Scenario: Save and attach
- **WHEN** the user pastes a value and clicks "Save & attach"
- **THEN** the browser sends the value to the project vault directly, the secret is attached to the agent as the production secret request does, and the builder gets only the name "BILLING_API_KEY"

#### Scenario: Agent change not saved yet
- **WHEN** an agent change is still waiting for its auto-save and the user clicks "Save & attach"
- **THEN** the card follows the rule of the production secret request dock

#### Scenario: Empty value
- **WHEN** the value field is empty
- **THEN** "Save & attach" is disabled

#### Scenario: Viewer of the chat
- **WHEN** a person who can only read the chat opens it
- **THEN** the user-step card shows "Only the owner can approve" and no field and no button

### Requirement: Changes that apply at once

A change outside the agent version (connect a channel, add an automation, change who can see the agent) SHALL show as a card with `effect: "immediate"`, from builder tools provided by the builder agent work. Its footer note SHALL say that it applies at once and is not part of a version, or what happens next (the next run of an automation), and SHALL NOT show "Saves as vN". Its main button SHALL say what it does. Approve SHALL apply the change at once and save no agent version.

#### Scenario: Connect a channel
- **WHEN** the builder proposes to send urgent tickets to Slack
- **THEN** the card shows "Connect a channel", the path "Channels › Slack", "You asked for urgent tickets in Slack. Install the Agenta app in your workspace, then pick the channel.", "Channel" with "#support-urgent", the footer note "Applies at once. Not part of a version.", "Not now" and "Add to Slack"

#### Scenario: Add an automation
- **WHEN** the builder proposes the automation "Daily summary"
- **THEN** the card shows "Add an automation", the path "Automations", "Daily summary", "Weekdays at 09:00 UTC", "Instruction" with "Summarize yesterday's tickets", the warning line "It starts to run at once and each run costs money. It is not part of a version.", the footer note "Next run: tomorrow 09:00", "Deny" and "Create"

#### Scenario: Change who can see the agent
- **WHEN** the builder proposes to share "Support triage" with the project
- **THEN** the card shows "Change who can see the agent", the path "Access", "Visibility" with "Private" changed to "Shared with project", the warning line "Everyone in this project will see the agent and its sessions.", the footer note "Applies at once. Not part of a version.", "Deny" and "Approve"

#### Scenario: Approve an automation
- **WHEN** the user clicks "Create"
- **THEN** the automation is created and on, the agent version does not change, and the result row says the automation was created (text not written; listed for Mahmoud)

#### Scenario: Install the Slack app
- **WHEN** the user clicks "Add to Slack"
- **THEN** the Slack install opens as the Channels page does, and the channel is connected when the install returns

#### Scenario: The person may not make the change
- **WHEN** the person may not edit automations, channels or the agent's access
- **THEN** the tool refuses, nothing changes, and the result row says "Not saved" with the reason in plain words

#### Scenario: Applying fails
- **WHEN** the server refuses the change
- **THEN** nothing changes, and the result row says "Not saved" with the reason

### Requirement: States after the answer

After the answer, each call SHALL shrink to one result row. The state SHALL derive in one function from the interaction status and the result `status`. The rows are: "Waiting for the agent" with "Your answer is saved."; "Saved as vN" with the request title, "View" and "Revert"; "You denied this change" with "Nothing was saved."; "Not saved" with the reason.

#### Scenario: Approve and wait
- **WHEN** the user clicks "Approve"
- **THEN** the card shows "Waiting for the agent" and "Your answer is saved." until the tool result arrives

#### Scenario: Saved
- **WHEN** the tool result says v5 was saved
- **THEN** the row shows "Saved as v5", "3 changes to Support triage", "View" and "Revert"

#### Scenario: View
- **WHEN** the user clicks "View"
- **THEN** the version history opens on v5 with what it changed

#### Scenario: Revert
- **WHEN** the user clicks "Revert" on "Saved as v5"
- **THEN** the dialog "Revert to v4?" opens, and "Revert" saves v6 with the configuration of v4 (PROPOSED)

#### Scenario: Approve while a form is open
- **WHEN** the user approves while the Instructions view of the same agent holds typed text that is not applied
- **THEN** the builder saves v5, the form stays open with its text, and the open session offers the update instead of moving (session-screen capability)

#### Scenario: Denied
- **WHEN** the user clicks "Deny"
- **THEN** the row shows "You denied this change" and "Nothing was saved."

#### Scenario: Answer fails to send
- **WHEN** the answer cannot reach the server
- **THEN** the card keeps its buttons and shows the production retry text

### Requirement: Conflict

When the agent changed after the builder read it, the save SHALL fail with no version saved, and the result row SHALL show "Not saved", "Someone changed the agent after the builder read it." and "Try again". "Try again" SHALL ask the builder to read the agent again and propose the change on the new version.

#### Scenario: Someone saved first
- **WHEN** another person saves v5 while the builder's card on base v4 waits, and the user approves
- **THEN** nothing is saved, and the row shows "Not saved" with "Try again"

#### Scenario: Try again
- **WHEN** the user clicks "Try again"
- **THEN** the builder reads the latest version and shows a new card on top of it

### Requirement: Only the owner can approve

A person who can read a chat but cannot send to it SHALL see its cards with no buttons and the line "Only the owner can approve" with "You can read this chat.". No keyboard shortcut SHALL answer such a card.

#### Scenario: Shared builder chat
- **WHEN** a teammate opens a builder chat that was shared with them and a card waits
- **THEN** the card shows the change, "Only the owner can approve" and "You can read this chat."

#### Scenario: The person cannot edit the agent
- **WHEN** the owner of the chat approves a change to an agent they may not edit
- **THEN** the tool refuses, nothing is saved, and the row says "Not saved" with the reason in plain words

### Requirement: Same card in the agent's own chat

An approval in the agent's own session (for example the agent that commits its own configuration, or a tool that sends an email) SHALL use the same card: the header with title and path, the detail, the footer with its note, "Deny" and "Approve". The production keyboard rules SHALL stay, and SHALL act only on the focused conversation.

#### Scenario: The agent commits its own configuration
- **WHEN** an agent asks to commit a change to its own instructions
- **THEN** the card shows "Edit the instructions", the diff, "Saves as vN", "Deny" and "Approve"

#### Scenario: A tool call that is not a configuration change
- **WHEN** an agent asks to run an integration tool, for example close a ticket
- **THEN** the card shows the production sentence as its detail and "Deny" and "Approve", with no version line

#### Scenario: Keyboard
- **WHEN** a card waits and the focus is in its conversation
- **THEN** Cmd or Ctrl+Enter approves and Escape denies, as in production, and Escape does nothing while the user types in a field

#### Scenario: Two conversations on screen
- **WHEN** a card waits in the builder panel and the focus is in the page conversation
- **THEN** Cmd or Ctrl+Enter does not answer the builder card

#### Scenario: Phone
- **WHEN** the card shows on a phone
- **THEN** it uses the full width and "Deny" and "Approve" are at least 44 px high
