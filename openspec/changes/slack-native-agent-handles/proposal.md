# Proposal

## Why

Several Agenta agents can share a Slack connection in the backend, but the agent-page action replaces the answering agent. Users need to address each deployed agent with a native Slack handle and recognize its replies without installing a separate app for every agent.

Status: Draft for Mahmoud's review. This change is specified, not implemented. The channels stack has not shipped to production. The baseline is an implementation reference, not a backward-compatibility contract.

## What Changes

- Reuse one installed Slack app and bot token for several agents in one workspace and one Agenta project.
- Provision an Agenta-managed Slack user group for each deployed agent. Route by its immutable group ID, not its visible handle.
- Request the full user-group and customized-posting scope set at installation. Block deployment when required permissions are missing.
- Display each agent's configured name and avatar on new Slack messages, including the first progress message.
- Replace implicit retargeting with add-agent deployment. Keep permissions and removal specific to the selected deployment.
- Use native handles as the agent-addressing model. Do not require a parallel `~slug` mode, old-token fallback, or migration of pre-release connections and conversations.

## Capabilities

### New Capabilities

- `slack-agent-addresses`: Managed user-group lifecycle, indexed ownership, failure recovery, and safe removal.

### Modified Capabilities

- `slack-installation`: Request and assess additional scopes without changing installation ownership or access checks.
- `slack-agent-routing`: Recognize native addresses, resolve conflicts, and preserve conversation and approval ownership.
- `slack-reply-identity`: Select a trusted per-agent sender profile when the installation permits customization.
- `slack-agent-deployment`: Add agents without retargeting another deployment; expose per-agent state and removal.

## Impact

Backend changes affect channel data models, database access, schema definitions, the Slack adapter, authorization setup, resolution, and outbox delivery. Frontend changes affect the shared settings package, generated clients, and both agent-page hosts. No new Slack app or credential is required per agent.

Hosted and customer-owned installs use the final scope set from the start. Development installations can be reinstalled with operator approval; preserving their state is not a release requirement. Slack user-group availability still depends on plan and workspace permissions. The initial release must prove that a group created without members provides usable mentions without notifying humans.

## Non-goals

This change does not implement Enterprise Grid native handles, cross-project installation sharing, multiple agents responding to one message, separate Slack bot users or direct-message inboxes per agent, or changes to Telegram and bridge behavior. It does not add user-token authorization as a workaround for restricted group-management permissions.

The user-group model and workspace-only scope are proposed product choices. This documentation commit does not approve rollout or claim live Slack validation.
