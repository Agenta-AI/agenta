# Slack reply identity delta

## MODIFIED Requirements

### Requirement: Outbound sender identity
For an authorized reply to user input from a deployed agent, Agenta SHALL use the agent's configured display name and validated avatar when `chat:write.customize` is granted. It SHALL keep the installed app as the underlying sender and pass the profile on every initial Slack post and chunk. It SHALL use the normal installed-bot identity for legacy deployments or when customization is unavailable. Model output and inbound message text SHALL NOT control sender fields.

#### Scenario: Two agents answer through one installation
- **WHEN** two native deployments answer through the same eligible connection
- **THEN** their posts SHALL show their respective configured names and avatars while using the same installed app and token.

#### Scenario: Missing customization permission
- **WHEN** a legacy connection or an already deployed connection no longer has customization permission
- **THEN** replies SHALL use the installed-bot identity and Agenta SHALL expose the degraded identity state to its operator.

#### Scenario: Untrusted sender override
- **WHEN** inbound content or model output asks to set a human's name or an arbitrary avatar URL
- **THEN** delivery SHALL ignore that override and use only the authorized deployment profile.

### Requirement: Progress and answer delivery
The outbox SHALL use the thread locator for an item's first post. Where updates are supported, later content SHALL edit the stored receipt. The first progress post SHALL use the same profile as the final answer. Updates SHALL preserve the original message identity without sending unsupported identity fields to `chat.update`. A profile change SHALL apply to new posts, not rewrite prior authorship.

#### Scenario: Answer replaces progress
- **WHEN** a customized progress message already has a Slack receipt
- **THEN** the answer SHALL update that receipt and retain its initial sender identity.

#### Scenario: First response
- **WHEN** an item has no prior receipt
- **THEN** delivery SHALL use the thread locator and selected agent profile for its first post.

#### Scenario: Long response
- **WHEN** a response requires multiple Slack posts
- **THEN** every new chunk SHALL use the same sender profile snapshot for that delivery.

#### Scenario: Profile changes during a turn
- **WHEN** an editor changes the agent profile after the first progress post
- **THEN** edits to that message SHALL retain its initial identity and subsequent new deliveries SHALL use the updated profile.

## ADDED Requirements

### Requirement: Profile editing and app identity
Only authorized project editors SHALL configure deployed-agent profiles. Agenta SHALL validate display names and use validated, public, Agenta-managed avatar assets without private or expiring credential-bearing URLs. Setup SHALL explain that the agent is an identity of the shared Agenta app, not a separate Slack user or direct-message inbox.

#### Scenario: Unsafe avatar
- **WHEN** a profile contains an unapproved external URL, a private-network URL, or a credential-bearing URL
- **THEN** Agenta SHALL reject that avatar without fetching it or including it in Slack requests.

#### Scenario: Read-only user edits identity
- **WHEN** a user without project-edit permission attempts to change a deployment profile
- **THEN** Agenta SHALL deny the change.
