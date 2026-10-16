# Agent and session sharing

## Why

People need to share an agent without sharing every conversation with it. They also need to invite colleagues to read or contribute to one conversation. Existing prompt and evaluation users must keep their project access.

This change specifies the first release. It does not implement it. Private sessions remain inspectable by project trace readers because trace filtering is outside this release.

## What Changes

- Add private or project visibility to agents, separate from their management owner.
- Add Owner, Participant, and Viewer access to web agent sessions. Sharing covers existing history, future replies, and session files.
- Support changing a project-visible agent back to private without moving its versions or files.
- Let Slack installations run configured agents without linked Agenta users. Agenta readers of Slack sessions follow the agent audience.
- Preserve existing roles, prompts, evaluations, traces, and analytics defaults. Migrate existing agents to project visibility. Migrate old agent chats to private only when a human creator is verified.
- Move access decisions into shared core services and database filtering into database access objects (DAOs).

Admin-only trace access is an accepted restricted policy option, not a global migration default. Under that option, non-admin users lose the analytics currently guarded by the same capability. A separate analytics permission and safe metrics endpoint are future work.

## Capabilities

### New Capabilities

- `agent-resource-access`: Agent visibility, ownership, direct access, and privatization.
- `agent-session-sharing`: Named session roles, sharing changes, and session files.
- `channel-session-access`: Slack session audience and bounded channel execution.
- `sharing-compatibility`: Upgrade classification and existing product behavior.
- `sharing-access-boundaries`: Layer responsibilities, capability checks, and revocation.

### Modified Capabilities

None. Existing Slack addressing and selection behavior remain unchanged. The new channel access checks apply after agent selection. Trace and analytics behavior is explicitly preserved.

## Impact

Changes will affect workflow and session services, channel invocation, file access, list queries, and their UI controls. The design adds `agent_access`, `session_grants`, session access columns, and an immutable artifact reference on channel threads. It does not change span storage or trace query filtering.

The implementation must cover OSS and EE, including EE entitlement shortcuts. All implementation tasks remain unchecked. The review pages identify proposed defaults separately from previously agreed scope.
