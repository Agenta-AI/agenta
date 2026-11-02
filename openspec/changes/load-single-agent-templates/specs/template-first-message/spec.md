# Template first message

## Purpose

Deliver the remaining setup work in one durable first message with separate visible user text and template-supplied setup context, without a separate installation lifecycle.

## ADDED Requirements

### Requirement: Setup context in the message

The first message SHALL carry the full user request and labeled template-supplied setup context in execution content, with the visible user request in optional `display_content`. The context SHALL include SETUP.md, unresolved connection needs, retained setup choices, and automation recipes still to configure. The model SHALL receive the complete execution content as user-level input. Package content MUST remain labeled as template-supplied text and MUST NOT become platform system instructions.

#### Scenario: Setup supplied

- **WHEN** a package has SETUP.md, optional notes, and an automation recipe
- **THEN** one normal first message carries those instructions and pending actions without requiring an installation-read tool.

#### Scenario: No setup supplied

- **WHEN** setup instructions and recipes are absent
- **THEN** the existing first-message behavior remains valid without fabricated requirements.

### Requirement: Use existing self-configuration

The agent SHALL continue setup with the existing configuration, discovery, connection, file, verification, and automation tools. This change MUST NOT introduce template-specific setup tools.

#### Scenario: Continue setup

- **WHEN** the agent needs a user fact, connection, or schedule after the first message
- **THEN** the existing tools handle it with their existing authorization and approval behavior.

### Requirement: Loading ends at handoff

The loader SHALL finish its responsibility when the first message is durably accepted. It MUST NOT track conversational setup status or gate ordinary runs on a template readiness state.

#### Scenario: Unfinished optional work

- **WHEN** the first message is accepted but the agent has not yet configured an optional automation
- **THEN** loading is complete and the remaining work belongs to the ordinary conversation.

### Requirement: No automatic trigger activation

Loading a template MUST NOT activate schedules or subscriptions. Subsequent activation SHALL use existing agent tools and approval controls.

#### Scenario: Automation recipe

- **WHEN** a package includes a weekday schedule
- **THEN** the first message carries the recipe but no active trigger is created by the loader.

#### Scenario: User declines

- **WHEN** the user declines the proposed schedule during conversation
- **THEN** the agent leaves it inactive and does not treat that choice as a loading failure.

### Requirement: One first message

The session service SHALL atomically deduplicate the first message by session-scoped key and stable payload fingerprint. Replays SHALL return the original input or result; changed content under the same key MUST conflict.

#### Scenario: Idle session replay

- **WHEN** an idle first-message request is retried after timeout or browser refresh
- **THEN** exactly one input is accepted and the original input/result is returned.

#### Scenario: Two tabs

- **WHEN** two tabs submit the same first message concurrently
- **THEN** one transcript message is appended and the other request returns its identity.

#### Scenario: Changed message

- **WHEN** the same delivery key is submitted with different setup text
- **THEN** the service rejects the conflicting payload instead of appending another message.

### Requirement: No secret disclosure

The first message and resource provenance MUST contain no credential values.

#### Scenario: Authenticated MCP

- **WHEN** an endpoint has an API key or OAuth token
- **THEN** the first message identifies the connection need or public reference but does not contain the credential value.

### Requirement: Setup context is hidden from ordinary chat presentation

The playground and mobile transcript SHALL display and copy only the visible user request. Setup context SHALL remain available in authorized execution records and model input. Hiding it is a presentation rule, not a secrecy boundary. The implementation MUST use structured fields rather than removing text by matching prefixes or delimiters. An assistant may still discuss the setup work in its response.

#### Scenario: Visible first message

- **WHEN** the user creates an agent with an edited request and the package supplies SETUP.md
- **THEN** the transcript displays the edited request without the appended setup guidance
- **AND** the model receives both the edited request and labeled setup guidance.

#### Scenario: Refresh and later turn

- **WHEN** the user refreshes or starts a later turn after the first runtime has expired
- **THEN** the transcript still displays only the visible request
- **AND** server-side conversation reconstruction preserves the setup context exactly once.

#### Scenario: Literal guidance wording in user text

- **WHEN** the user's own request contains wording also used to label setup guidance
- **THEN** the full user request remains visible without prefix-based removal.

#### Scenario: Changed context on replay

- **WHEN** a retry reuses a delivery key but changes either visible text or setup context
- **THEN** the original payload fingerprint detects the conflict.

### Requirement: First UI turn has ordinary UI capabilities

A template started from the UI SHALL receive the same effective runtime tools, skills, permissions, and other transient configuration as ordinary UI agent creation with the same user settings. This SHALL apply from the first server-started turn, not only later browser turns. Package resources SHALL be composed with those additions. The implementation SHALL reuse the ordinary UI capability contract, including disabled-tool and build-kit settings, rather than maintain a template-specific tool list.

These additions SHALL remain invocation-scoped. They MUST NOT be saved into the agent's reusable configuration solely because the user loaded it from the playground. Ordinary API and automation invocations MUST NOT acquire UI-only tools as a side effect.

#### Scenario: First-turn input form

- **WHEN** a UI-created template requires a user fact and the ordinary UI enables request_input
- **THEN** the first runtime receives request_input
- **AND** a tool call renders the existing input form whose answer resumes the same session.

#### Scenario: Runtime additions do not overwrite package resources

- **WHEN** the package includes a skill and the UI supplies its normal build skill
- **THEN** both skills are available in the initial run
- **AND** only the package skill is added to the saved agent by template loading.

#### Scenario: Disabled UI capability

- **WHEN** the user disables a capability through the ordinary UI setting
- **THEN** the template's first run respects that setting exactly as an ordinary UI run does.

#### Scenario: Non-UI invocation

- **WHEN** the saved agent runs through an API or automation without UI runtime additions
- **THEN** it retains the ordinary non-UI capability behavior.

### Requirement: Message display contract

The agent service SHALL prepare the complete user-level execution content before calling the runner. It includes the user's request and labeled template setup guidance in that content. It also supplies optional `display_content` with the original visible request. The runner has no template-specific setup logic. It preserves this generic field when writing the user-message record. Conversation reconstruction uses the full execution content.

The same display rule applies to pending frontend messages, saved records, refresh, and copy actions:

| Field state                   | Normal chat behavior                                    |
| ----------------------------- | ------------------------------------------------------- |
| `display_content` absent      | Show the ordinary message content.                      |
| `display_content` is a string | Show that string, including an explicitly empty string. |
| `display_content` is `null`   | Hide the whole message from normal chat.                |

Field presence must survive Python parsing, serialization, Vercel conversion, runner transport, and record persistence. A missing optional value must not be serialized as explicit null. Display content never replaces execution content in model input or server-side history. Attachments keep their ordinary behavior when a text override is present; explicit null hides the whole chat message, including attachments. Authorized execution records retain the complete input.

The frontend already knows the original request when it creates a pending template message. It uses that request for display before backend records arrive. Pending and durable versions must reconcile through stable input/execution/message identity, never a text comparison, because their execution text can differ. The transition must not duplicate the turn or briefly expose setup guidance. Edit and resend paths must keep the execution content separate from the text shown in the editor.

This contract does not add top-level `setup_context` to SDK or runner message types. Template setup composition belongs to the agent service. No model-adapter setup concatenation is needed.

#### Scenario: Legacy message

- **WHEN** a pending message or saved record has no `display_content` field
- **THEN** normal chat displays the original content.

#### Scenario: Explicitly hidden message

- **WHEN** a pending message or saved record has `display_content: null`
- **THEN** normal chat displays no message bubble or attachments
- **AND** execution records and model input retain the full content.

#### Scenario: Pending message becomes durable

- **WHEN** the first saved record replaces the pending template message
- **THEN** the visible request remains unchanged and appears exactly once
- **AND** setup guidance never appears during reconciliation.
