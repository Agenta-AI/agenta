# Proposal: the /m playground follows an agent's own commit again

## Why

When an agent in the playground calls `commit_revision`, the new version is saved, but `/m`
keeps showing the old one: the version chip, the instructions, the tools and the rest of the
configuration stay on the previous revision until the page is reloaded. The next message in that
session is also still sent against the old revision. `/w` (classic) still updates.

Reproduced on staging (v0.121.2, Pi with Claude Haiku 4.5): on `/m` the chip stayed on v5 after the
agent committed v6, and a reload showed v6. The same request on `/w` moved the chip live from v3 to
v4 and showed "Agent updated this configuration in v4".

### Root cause

The backend still emits the signal. The browser's own capture of the `/services/agent/v0/invoke`
response contains
`{"type": "data-committed-revision", "data": {..., "version": "6"}}`, and the session records hold
the `commit_revision` tool call and its `{"status": "committed", "workflow_revision": {...}}`
result.

`/m` listens in exactly one place: `LiveConversation.tsx:184-195` reads `data-committed-revision`
parts out of `conversation.messages`. Only the direct `useChat` stream ever put that part into the
messages. Every send is now durable: #7095 (`83ac7ccdc1`) removed the direct send path. On the
durable path, `useServerSessionInputs.ts:398` hands the run stream to `readRunAdmission`, which
reads only admission and startup frames and drops everything else. The transcript the user sees is
rebuilt from session records by `transcriptToMessages`, and records never contain that part.

`/w` survived because `bda6a6edad` (2026-09-06, "refresh configuration after live agent
commits") gave the desktop host a second, records-based trigger: `useSessionLivePreview` derives
`committedRevisions` from the `commit_revision` tool records (`committedRevisions.ts`) and calls
`onCommittedRevision` (`AgentConversation.tsx:188-199`). The shared engine that `/m` uses,
`useAgentConversation.ts:1053-1063`, never passes `onCommittedRevision`, so on `/m` that trigger
has no listener.

Timeline, as far as the code shows: the `/m` listener landed in #6887 (`f3cdca0f1c`, 2026-09-16)
and was checked live only with a manual config save, not with a self-commit. The durable queue had
been the default since `377227fe1d` (2026-09-07), except where a deployment set
`AGENTA_SESSIONS_QUEUE=false`; #7095 removed that fallback, so `/m` now never takes the direct
path.

## What Changes

- `useAgentConversation` accepts `onCommittedRevision` and passes it to `useSessionLivePreview`,
  the same wiring `/w` has.
- `/m`'s `LiveConversation` passes a handler that does what its part reader already does:
  invalidate the latest-revision caches and adopt and pin the new revision. The part reader and the
  records reader share one dedupe set.
- A unit test pins the forwarding. It fails without the fix.

## Capabilities

### New Capabilities

- `agent-self-commit-refresh`: every playground view of a session follows the agent's own `commit_revision`, on /m and /w, on every send path.

### Modified Capabilities

None.

## Impact

- Code: `web/packages/agenta-chat/src/hooks/useAgentConversation.ts` (one new optional option) and `web/mobile/src/features/chat/LiveConversation.tsx` (one handler). No backend, SDK or API change. /w is untouched.
- Tests: one new unit test in `@agenta/chat`.
- Out of scope, recorded as follow-ups in `design.md` and `tasks.md`: cross-tab and cross-session propagation of any revision commit, protection of an unsaved local edit against an agent commit, and the "Agent updated this configuration" notice on /m.

### Deferred

Cross-tab and cross-session propagation of any revision commit, protection of an unsaved local
edit against an agent commit, and the "Agent updated this configuration" notice on `/m`. See the
table in `design.md`.
