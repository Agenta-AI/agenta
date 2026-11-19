## ADDED Requirements

### Requirement: The builder stack is a dependency
The builder layout SHALL build on the builder stack, which the builder agent work provides (builder architecture session). The stack SHALL be rebased onto the program base `feat/builder-layout` and retargeted, in the order 8341, 7409, 8345, then 8346, before any milestone that needs the builder id, its tools or its drive starts its frontend work against a live builder.

#### Scenario: Stack is ready
- **WHEN** the four pull requests are rebased onto the program base and their checks pass
- **THEN** `__ag__builder` resolves in the static catalog, and a run of it can call the four agent tools

#### Scenario: Each pull request shows only its own diff
- **WHEN** the stack is retargeted
- **THEN** 8341 targets the program base, 7409 targets 8341, 8345 targets 7409 and 8346 targets 8345, and each shows only its own diff

#### Scenario: Stack is not ready
- **WHEN** a frontend milestone needs a builder result before the stack is merged
- **THEN** that milestone tests against recorded tool results (fixtures), not against a live builder

### Requirement: No backend change in this program
The builder layout program SHALL change no API, SDK, runner or record code, except two tasks Mahmoud asked for: the default of `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` turns on (task 10.1) and the MCP account name is read at sign-in (task 39.1). Its frontend SHALL read only what production and the builder agent work provide.

#### Scenario: File list of a program PR
- **WHEN** a pull request of the program is opened
- **THEN** it changes no file under `api/`, `sdks/` or `services/`, except the PRs of tasks 10.1 and 39.1

#### Scenario: A frontend milestone needs builder data
- **WHEN** a frontend milestone needs a tool, a result field or a preview that the builder agent work has not merged
- **THEN** the milestone waits for it, or tests against recorded tool results, and does not add backend code

### Requirement: Session origin "builder"
The builder agent work SHALL provide the session origin `builder`, and the frontend SHALL read it. A session that a builder tool starts in another agent SHALL carry `origin` "builder" and the reserved tag `ag.builder.session_id` with the id of the builder chat. Only the server SHALL write both. Session reads SHALL decode them, and `POST /sessions/query` SHALL filter by `origins: ["builder"]`. A builder chat itself SHALL keep the origin "manual".

#### Scenario: Session started by the builder
- **WHEN** the builder starts a test run of "Email writer" from the builder chat "Lead outreach system"
- **THEN** the new session of "Email writer" reads back with `origin` "builder" and a link to the builder chat, and `tags` holds no `ag.` key

#### Scenario: Filter
- **WHEN** a client queries the sessions of "Email writer" with `origins: ["builder"]`
- **THEN** the response lists only the sessions the builder started

#### Scenario: Builder chat keeps manual
- **WHEN** a person starts a builder chat
- **THEN** the chat reads back with `origin` "manual"

#### Scenario: Client cannot set the origin
- **WHEN** a client sends `ag.origin` or `ag.builder.session_id` on a session write
- **THEN** the server stores neither, and the session keeps its own origin

#### Scenario: Reader cannot open the builder chat
- **WHEN** a person who cannot open the builder chat reads a session that the builder started
- **THEN** the session still reads with `origin` "builder" and the link, and opening the link shows the no-access state

#### Scenario: Session with no origin tag
- **WHEN** a session has no `ag.origin` tag
- **THEN** it reads as "manual", as today

### Requirement: Builder tool that runs another agent
The builder agent work SHALL provide a tool that runs another agent of the project once with a given input (the test run; PROPOSED name `run_agent`). It SHALL start a new session of that agent as the person who chats, with origin "builder" and the link to the builder chat, SHALL return the session id at once, and SHALL report progress and the final answer to the builder. It SHALL refuse an agent the person cannot run.

#### Scenario: Test run
- **WHEN** the builder calls the tool for "Email writer" with the input "Write a first email to this lead: Zahnwerk GmbH, Munich."
- **THEN** a session of "Email writer" starts as the person, the result holds its session id, and the builder page can open the session while it runs

#### Scenario: Progress
- **WHEN** the started session is still running
- **THEN** the builder chat stream carries the state of the run, and the session shows the state "Writing"

#### Scenario: Run ends
- **WHEN** the started session ends
- **THEN** the tool result holds the final answer and the status, and the session stays in the Sessions list of "Email writer"

#### Scenario: No right to run
- **WHEN** the person cannot run "Email writer"
- **THEN** the tool returns `access_denied` and no session starts

#### Scenario: Agent needs setup
- **WHEN** "Email writer" cannot run (for example a missing model key)
- **THEN** the tool returns the production run error, and the session records the failure as a production session does

#### Scenario: Approval
- **WHEN** the builder calls the tool
- **THEN** the call asks for approval as a change card, because a run costs money (PROPOSED)

### Requirement: Builder tools read a session and traces
The builder agent work SHALL provide a tool that reads one session (its turns and its revision) and a tool that reads traces with filters (PROPOSED names `read_session` and `read_traces`). Both SHALL run with the rights of the person who chats. The traces tool SHALL check its own permission. Both SHALL return bounded results.

#### Scenario: Read the session of the page
- **WHEN** the user asks "Why did Login fails on Safari get only medium urgency?" with the chip on that session
- **THEN** the builder reads the session that the context line of the message names, and answers from its turns

#### Scenario: Session the person may not read
- **WHEN** the session id names a session the person may not read
- **THEN** the tool returns `access_denied` and reads nothing

#### Scenario: Read traces with the page filters
- **WHEN** the user asks a question on the Analytics page with the period "Last 7 days"
- **THEN** the builder reads the traces of that agent with that filter

#### Scenario: Role without the traces permission
- **WHEN** the person's role does not have the traces permission
- **THEN** the traces tool returns `access_denied`, and the builder says that it cannot read traces for this person

#### Scenario: Long session
- **WHEN** the session has more turns than the tool returns at once
- **THEN** the result holds the last turns and a cursor for older ones, and never the whole history at once

### Requirement: Builder asks for steps only the person can do
The builder agent work SHALL add to the builder tool list the client tools `request_connection` and `request_secret`, which exist on `main`. The browser SHALL show their calls as user-step change cards. A secret value SHALL go from the browser to the project vault; the builder SHALL get only the name of the secret. The builder SHALL continue after the step or after "Not now".

#### Scenario: Connect an app
- **WHEN** the builder needs Stripe and calls `request_connection`
- **THEN** the chat shows the card "Connect Stripe", and after the person connects, the builder gets the connection result and continues

#### Scenario: Not now
- **WHEN** the person clicks "Not now"
- **THEN** the builder gets a declined result and continues without Stripe

#### Scenario: Paste a secret
- **WHEN** the builder calls `request_secret` for "BILLING_API_KEY" and the person clicks "Save & attach"
- **THEN** the value goes to the project vault, and the tool result holds the name and no value

### Requirement: Builder tools for changes that apply at once
The builder agent work SHALL provide tools to attach a secret to an agent, connect a channel, create an automation and change who can see an agent (PROPOSED names `attach_secret`, `connect_channel`, `create_automation`, `set_agent_access`). Each call SHALL ask for approval with a change card. The secret attach SHALL change the agent configuration and save a version (`effect: "version"`); the other three SHALL apply at once (`effect: "immediate"`) and save no version.

#### Scenario: Attach a secret
- **WHEN** the builder attaches the secret `billing-prod` as "BILLING_API_KEY" and the person approves
- **THEN** a new version of the agent is saved with the attachment, and the result holds `revision: {id, version}`

#### Scenario: Create an automation
- **WHEN** the builder proposes "Daily summary" on "Weekdays at 09:00 UTC" and the person clicks "Create"
- **THEN** the automation exists and is active, and no agent version is saved

#### Scenario: Change access
- **WHEN** the builder proposes "Shared with project" and the person approves
- **THEN** the agent is shared with the project at once

#### Scenario: Connect a channel
- **WHEN** the builder proposes the Slack channel "#support-urgent" and the person clicks "Add to Slack"
- **THEN** the browser runs the production Slack install step, and the binding exists after it

#### Scenario: No right
- **WHEN** the person lacks the right for the change
- **THEN** the tool returns `access_denied` and nothing changes

#### Scenario: Denied
- **WHEN** the person denies the card
- **THEN** nothing changes and the builder gets the denial

### Requirement: Risk data on the server preview
The server preview of the builder agent work SHALL carry risks with kinds `cost`, `breakage`, `fewer_approvals` and `data_egress`. A model change SHALL carry the price ratio of the new model to the old one from the API price map. Removing an integration SHALL carry the skills of the agent whose text names it. A new MCP server SHALL carry its tool count when the server can be reached.

#### Scenario: Larger model
- **WHEN** the builder changes the model from Claude Sonnet 5.5 to Claude Opus 5.5
- **THEN** the preview holds a `cost` risk with the ratio 5, and the card shows "Each session will cost more. The larger model is about 5 times the price."

#### Scenario: Removed integration named in skills
- **WHEN** the builder removes Gmail and two attached skills mention Gmail
- **THEN** the preview holds a `breakage` risk with the two skill names

#### Scenario: Model with no price
- **WHEN** the price map has no price for one of the two models
- **THEN** the preview holds no `cost` risk

#### Scenario: New MCP server
- **WHEN** the builder adds the MCP server `linear` and the server answers with 12 tools
- **THEN** the preview holds the tool count, and a `data_egress` risk

#### Scenario: MCP server cannot be reached
- **WHEN** the server does not answer in time
- **THEN** the preview holds no tool count and the card shows no "Tools" line

### Requirement: Builder can ask with a choice form
The builder agent work SHALL add to the builder tool list of PR 8345 the client tool `request_input`, which exists on `main`. The ported builder instructions SHALL ask the "Decisions for you" questions as one `request_input` form with one single-choice field per decision, the recommended option first and as the default, and one free-text field.

#### Scenario: Decisions for you
- **WHEN** the builder needs two decisions before it builds an agent
- **THEN** it calls `request_input` once, with two single-choice fields (each a `oneOf` list with the recommended option first and set as `default`) and one `multiline` text field

#### Scenario: Form in the chat
- **WHEN** the call reaches the browser
- **THEN** the chat shows today's elicitation form, and the run waits for the answer

#### Scenario: User declines
- **WHEN** the user declines or cancels the form
- **THEN** the builder gets the decline result, builds nothing, does not send the form again, and asks in one sentence what to change

#### Scenario: Optimized instructions
- **WHEN** the optimized builder instructions are ported into the catalog entry
- **THEN** the unit tests of the catalog entry pass and the instructions name `request_input` for decisions

### Requirement: Frontend reads the agent tool results
`edit_agent_config` and `create_agent` SHALL return `revision: {id, version}` for the new revision, the same shape as `read_agent_config`, with `status`, `agent` (`name`, `id`, `slug`, optional `url`), `message`, `warnings`, and for `create_agent` also `visibility`. `base_revision_id` SHALL mean only the base to send with the next edit. The builder agent work SHALL return this shape before PR 7409 merges.

#### Scenario: Edit saved
- **WHEN** `edit_agent_config` returns `status` "committed"
- **THEN** the frontend reads `agent.id` and `revision.version`, shows "Saved as v{revision.version}" and clears that agent's latest-revision caches

#### Scenario: Edit changed nothing
- **WHEN** `edit_agent_config` returns `status` "no_change"
- **THEN** the frontend refreshes nothing

#### Scenario: Agent created
- **WHEN** `create_agent` returns `status` "created"
- **THEN** the frontend reads `agent`, `visibility` and `revision`, adds the agent to the agent lists, and the builder page can show it in the agent pane

#### Scenario: Refusal
- **WHEN** a tool returns one of `agent_not_found`, `agent_is_static`, `access_denied` or `create_conflict`
- **THEN** the frontend refreshes nothing and the chat shows the builder's answer

#### Scenario: Denied approval
- **WHEN** the user denies the approval card
- **THEN** no result with `status` arrives and nothing is refreshed

#### Scenario: Open session of the changed agent
- **WHEN** the builder saves a new version of an agent whose session is on screen
- **THEN** this browser runs the existing latest-version check of that agent when the `committed` result arrives, and the session adopts or offers the new version (session-screen capability)

#### Scenario: Open session in another browser
- **WHEN** the builder saves a new version while a session of that agent is open in another browser
- **THEN** that session finds the new version on its next focus or visibility change, as production checks today

### Requirement: Server preview on the approval payload
The builder agent work SHALL provide the server preview (DECIDED). When the approval gate of `edit_agent_config` opens, the server SHALL run the change-set engine on the base revision with the proposed operations, SHALL save nothing, and SHALL attach a bounded preview (old and new value per changed path) to the approval payload. If the preview is missing for one call, the card SHALL show the proposed values with a label.

#### Scenario: Preview attached
- **WHEN** the builder calls `edit_agent_config` with an `edit_text` operation on AGENTS.md
- **THEN** the approval payload holds the old and the new text of that path, and no revision is saved

#### Scenario: Operation on text an earlier operation created
- **WHEN** a later `edit_text` operation edits text that an earlier `set` operation in the same call created
- **THEN** the preview shows the result of both, the same as a save would give

#### Scenario: Preview fails
- **WHEN** the change set cannot apply to the base
- **THEN** the approval payload holds no preview, the gate still opens, and the card shows the proposed values with a label (text to write)

### Requirement: Builder chats can run in /m
The frontend SHALL be able to start, list and reopen builder chats by the builder's static id, and the files pane SHALL show the builder's learning drive, before the builder panel ships.

#### Scenario: Start a chat
- **WHEN** the frontend starts a session with the builder's static workflow id
- **THEN** the run route accepts it and the builder answers

#### Scenario: Reopen a chat
- **WHEN** the user reopens a builder chat
- **THEN** the session reads its static revision and its history loads

#### Scenario: Learning drive
- **WHEN** the files pane opens on a builder chat
- **THEN** it shows the drive under `drives/__ag__builder__learning/` (PR 8346)
