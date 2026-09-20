# Slack agent routing delta

## MODIFIED Requirements

### Requirement: Explicit agent addressing
The Slack adapter SHALL retain `~slug` and app-mention addressing and recognize native user-group mention tokens in signed human messages. Agenta SHALL resolve an active managed group by installation, receiving Slack team, and immutable group ID. Visible handle text SHALL NOT authorize or select an agent. A recognized disabled or failed address SHALL NOT fall through to a default agent.

#### Scenario: Legacy slug
- **WHEN** a human message contains `~triage` and no conflicting explicit address
- **THEN** Agenta SHALL resolve `triage` within the receiving connection and preserve legacy policy checks.

#### Scenario: Native group mention alone
- **WHEN** a signed message contains `<!subteam^S123>` or `<!subteam^S123|triage>` for an active managed address in that installation and team
- **THEN** Agenta SHALL treat the message as addressed to the mapped agent without requiring a bot mention or `~slug`.

#### Scenario: Renamed group or forged display label
- **WHEN** a mention's group ID matches an active address but its label differs from the stored handle
- **THEN** Agenta SHALL select by the group ID and ignore the label for routing.

#### Scenario: Unrelated user group
- **WHEN** a message mentions a group that has never been managed by this installation
- **THEN** that group SHALL NOT select an Agenta agent or count as an Agenta mention; otherwise applicable legacy conversation and message policies SHALL remain unchanged.

#### Scenario: Removed agent address
- **WHEN** a message explicitly mentions a managed address recorded as disabled, failed, or pending removal
- **THEN** Agenta SHALL start no turn and SHALL NOT substitute a default agent.

#### Scenario: Other workspace group
- **WHEN** a signed event names a group ID known only in another installation or Slack team
- **THEN** Agenta SHALL NOT resolve that other installation's agent or disclose its configuration.

### Requirement: Agent selection precedence
Agenta SHALL resolve and check explicit agent addresses before selecting a conversation owner when a managed native address is present. Without a native address, the existing pending-choice, conversation, slug, and default order SHALL remain unchanged. Native-address input SHALL NOT answer another agent's pending approval. Unaddressed replies SHALL continue the existing pending choice or active conversation. Unknown explicit legacy slugs SHALL NOT fall back to a default.

#### Scenario: Reply continues a specialist conversation
- **WHEN** a message has no explicit address, matches no pending choice, and belongs to an active specialist conversation
- **THEN** Agenta SHALL select that specialist rather than the connection default.

#### Scenario: Slug switches the conversation agent
- **WHEN** a message names `~research`, contains no native address, matches no pending choice, and an active conversation belongs to another agent
- **THEN** Agenta SHALL bypass that conversation's agent and resolve `research` in the connection.

#### Scenario: Native mention switches the conversation agent
- **WHEN** a message explicitly addresses an active research handle in a conversation previously held by triage
- **THEN** Agenta SHALL select research and apply research's grants and policy without transferring triage's session or pending choices.

#### Scenario: Unknown explicit slug
- **WHEN** explicit legacy addressing is reached and the slug does not exist
- **THEN** Agenta SHALL return no agent rather than silently choose a default.

#### Scenario: Pending choice answer
- **WHEN** a message has no native address and resolves a pending choice in the conversation
- **THEN** Agenta SHALL preserve selection of the agent holding that choice.

#### Scenario: Explicit address cannot approve another agent
- **WHEN** a message addresses research while triage is waiting for approval
- **THEN** Agenta SHALL NOT consume that message as approval for triage.

## ADDED Requirements

### Requirement: One unambiguous addressed agent
Agenta SHALL start at most one agent from one message. Repeated mentions of the same managed agent SHALL count as one address. Conflicting managed addresses or disagreement between a managed address and a legacy slug SHALL start no turn and SHALL NOT consume a pending choice.

#### Scenario: Two distinct agents
- **WHEN** a message names both the triage and research managed handles
- **THEN** Agenta SHALL start neither agent and record an ambiguous-address outcome without disclosing agent details to Slack.

#### Scenario: Same agent named twice
- **WHEN** a message repeats one active managed handle and contains no conflicting slug
- **THEN** Agenta SHALL resolve one agent, subject to existing duplicate-event handling and access checks.

#### Scenario: Native and legacy disagreement
- **WHEN** a message names the managed triage group and `~research`
- **THEN** Agenta SHALL reject the ambiguous selection rather than use parsing order to choose a winner.

### Requirement: Native routing preserves access checks
Resolving a native address SHALL NOT bypass signature verification, connection sender restrictions, connection and agent activity checks, grants, effective message policy, or approval authorization.

#### Scenario: Agent lacks access to the channel
- **WHEN** a valid managed handle is mentioned in a channel that the agent's grants deny
- **THEN** Agenta SHALL start no turn and SHALL NOT disclose the agent's configuration.
