# Agent and session sharing

## Why

Today every project member can read every agent and chat in the project, and the organization-owner and EE no-RBAC shortcuts open everything. People need private agents and chats inside a team project, and they need to invite named colleagues to one chat. This is milestone M3, after M1 and M2. Shared rules are in `docs/design/sharing-program/CONTRACT.md`.

## What Changes

- Agents and web agent sessions get a visibility (`private` or `project`) and an optional owner. Sessions also get named Viewer and Participant invitations, which cover history, later replies, and session files.
- Ownership follows CONTRACT.md section 7, in order: a turn's human sender, a human in a browser session, a human schedule's principal. They create private items by default. Everything else, including every API key, creates ownerless project-visible items, and an ownerless agent has no access row. Slack sessions are always ownerless and project-visible.
- Shortcuts do not open private items.
- Every point where a run starts or resumes checks the session and the agent, including browser runs on their first heartbeat.
- When the owner leaves, their private items lock for everyone. Their project-visible agents become ownerless, and an admin can take ownership.
- The share step discloses the agent's connections, shared session files and tool results, and trace readers. The invite field lists the project's members.
- Existing agents and chats become project-visible, owned by their recorded creator. Sharing changes are audited.
- M3 ships in one release. `/w` creates project-visible chats and agents. Accepted risk: rolling back to pre-M3 code makes private items visible to their project.

## Capabilities

### New Capabilities

- `agent-resource-access`: agent visibility, ownership, creation.
- `agent-session-sharing`: session roles, sharing, insertion paths, approvals, disclosure, files.
- `channel-session-access`: Slack session access.
- `sharing-access-boundaries`: resource policy, execution admission, list parity, owner-leaves lock, serialized writes, default visibility, audit.

### Modified Capabilities

None.

## Non-goals

- Trace privacy (M9), credential ownership (M5, M7), run credential propagation (M2).
- Service accounts and personal API keys (M6). Until then an API key cannot use a private agent.
- Admin access to locked agents, session ownership transfer, project-wide Participant access, per-agent invitations.
- Runner and SDK changes.
