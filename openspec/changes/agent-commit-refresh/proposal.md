# Proposal: agent commits reach the playground without surprise upgrades

## Why

When an agent in the playground calls `commit_revision`, the new version is saved, but `/m` keeps
showing the old one: the version chip, the instructions and the tools stay on the previous revision
until a reload, and the next message is still sent against it. `/w` (classic) updates.

Reproduced on staging v0.121.2 (Pi, Claude Haiku 4.5): on `/m` the chip stayed on v5 after the
agent committed v6, and a reload showed v6. On `/w` the chip moved live from v3 to v4.

There is also a quieter gap everywhere: a view the user is not watching (another session of the
same agent, another tab, a hidden tab) has no way to learn that a newer version exists, and the
version drawer shows a list that can be up to 30 s old.

### Root cause of the /m regression

The backend still emits the signal. The browser's capture of `/services/agent/v0/invoke` contains
`{"type": "data-committed-revision", ..., "version": "6"}`, and the session records hold the
`commit_revision` call and its `{"status": "committed", ...}` result.

`/m` listens in one place, `LiveConversation.tsx:184-195`, which reads `data-committed-revision`
parts from `conversation.messages`. Only the direct `useChat` stream put that part there. #7095
(`83ac7ccdc1`) removed the direct send path. A durable send's stream goes to `readRunAdmission`
(`useServerSessionInputs.ts:398`), which drops the part, and the transcript is rebuilt from records.

`/w` survived because `bda6a6edad` gave the desktop host a records-based trigger:
`useSessionLivePreview` derives committed revisions from the tool records and calls
`onCommittedRevision` (`AgentConversation.tsx:188-199`). The shared engine `/m` uses,
`useAgentConversation.ts:1053-1063`, does not pass `onCommittedRevision`.

## What Changes

- **Session in view, agent commits in this turn:** the view follows the commit (Decision 1,
  decided). On `/m` this is the records trigger `/w` already has.
- **Everywhere else, nothing upgrades by itself.** A small pill next to the version chip says
  "vN available · Update". Update switches that session to the latest version. No banner, no popup.
- **New sessions** start from the latest version.
- **The version drawer** re-fetches its list each time it opens and lists newer versions at the
  top, each with an Update action.
- **Detecting a newer version:** one latest-version check when the tab becomes visible, when a
  session is switched to, and when the drawer opens. No polling; nothing while the tab is hidden.

## Capabilities

### New Capabilities

- `agent-version-freshness`: how a playground session learns about, shows, and adopts a newer
  version of its agent.

### Modified Capabilities

None.

## Impact

- Frontend only: `@agenta/chat` (`useAgentConversation`, `useSessionLivePreview` wiring), the
  version chip and the version drawer in `@agenta/playground-ui`, and `/m`'s `LiveConversation`.
  `/w` gains the pill and the drawer behavior; its in-view adoption is unchanged.
- No backend change for version one. A project-watch event for revision commits is an option,
  not a requirement (see `design.md`).
- Deferred: protecting an unsaved local edit from an agent commit (case 6).
