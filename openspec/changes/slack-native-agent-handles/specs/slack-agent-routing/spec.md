# Slack agent routing delta

## REMOVED Requirements

### Requirement: Explicit agent addressing
**Reason**: Native Slack handles replace the pre-release slug-addressing contract.
**Migration**: No production migration is required. Replace the pre-release Slack addressing path during implementation; do not maintain a parallel compatibility mode.

### Requirement: Agent selection precedence
**Reason**: The native-address model defines its own selection order rather than preserve pre-release slug precedence.
**Migration**: No production migration is required. Implement the native selection requirement below and update its callers and tests together.

## ADDED Requirements

### Requirement: Native agent addressing
Agenta SHALL recognize native user-group mention tokens in signed human messages and resolve an active managed group by installation, receiving Slack team, and immutable group ID. Visible handle text SHALL NOT authorize or select an agent. A known non-active managed address SHALL NOT fall through to a default agent. The first release SHALL NOT require support for the pre-release `~slug` address syntax.

#### Scenario: Native group mention alone
- **WHEN** a signed message contains `<!subteam^S123>` or `<!subteam^S123|triage>` for an active managed address in that installation and team
- **THEN** Agenta SHALL treat it as addressed to the mapped agent without requiring a bot mention or `~slug`.

#### Scenario: Renamed group or forged display label
- **WHEN** a mention's group ID matches an active address but its label differs from the stored handle
- **THEN** Agenta SHALL select by the group ID and ignore the label for routing.

#### Scenario: Unrelated user group
- **WHEN** a message mentions a group that has never been managed by this installation
- **THEN** that group SHALL NOT select an Agenta agent or count as an Agenta mention; ordinary conversation and message policies SHALL still apply.

#### Scenario: Removed agent address
- **WHEN** a message explicitly mentions a managed address recorded as non-active
- **THEN** Agenta SHALL start no turn and SHALL NOT substitute a default agent.

#### Scenario: Other workspace group
- **WHEN** a signed event names a group ID known only in another installation or Slack team
- **THEN** Agenta SHALL NOT resolve that other installation's agent or disclose its configuration.

### Requirement: Native agent selection precedence
Agenta SHALL check native agent addresses before conversation-owner and default selection. Explicit native addressing SHALL select the named agent and SHALL NOT answer another agent's pending approval. Without an explicit native address, a matching pending choice SHALL select its owner, an active conversation SHALL select its agent, and otherwise the space or connection default SHALL apply subject to message policy. The pre-release parsing order SHALL NOT constrain this implementation.

#### Scenario: Reply continues a specialist conversation
- **WHEN** a message has no native address, matches no pending choice, and belongs to an active specialist conversation
- **THEN** Agenta SHALL select that specialist rather than the connection default.

#### Scenario: Native mention switches the conversation agent
- **WHEN** a message explicitly addresses research in a conversation previously held by triage
- **THEN** Agenta SHALL select research and apply research's grants and policy without transferring triage's session or pending choices.

#### Scenario: Pending choice answer
- **WHEN** a message has no native address and resolves a pending choice in the conversation
- **THEN** Agenta SHALL select the agent holding that choice.

#### Scenario: Explicit address cannot approve another agent
- **WHEN** a message addresses research while triage is waiting for approval
- **THEN** Agenta SHALL NOT consume it as approval for triage.

#### Scenario: Shared app mention
- **WHEN** a human mentions the installed app without a managed agent handle or an existing conversation owner
- **THEN** Agenta SHALL use the space or connection default, if configured and permitted by policy.

### Requirement: One unambiguous addressed agent
Agenta SHALL start at most one agent from one message. Repeated mentions of the same managed agent SHALL count as one address. Conflicting managed addresses SHALL start no turn and SHALL NOT consume a pending choice.

#### Scenario: Two distinct agents
- **WHEN** a message names both the triage and research managed handles
- **THEN** Agenta SHALL start neither agent and record an ambiguous-address outcome without disclosing agent details to Slack.

#### Scenario: Same agent named twice
- **WHEN** a message repeats one active managed handle
- **THEN** Agenta SHALL resolve one agent, subject to duplicate-event handling and access checks.

### Requirement: Native routing preserves access checks
Resolving a native address SHALL NOT bypass signature verification, connection sender restrictions, connection and agent activity checks, grants, effective message policy, or approval authorization.

#### Scenario: Agent lacks access to the channel
- **WHEN** a valid managed handle is mentioned in a channel that the agent's grants deny
- **THEN** Agenta SHALL start no turn and SHALL NOT disclose the agent's configuration.
