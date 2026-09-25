# Design: agent version freshness

## Context

### The signals that exist today

| Signal | Carried by | Who hears it |
| --- | --- | --- |
| `data-committed-revision` stream part | Invoke stream (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:316-323`, `:628-635`) | Only a `useChat`-consumed stream (regenerate, legacy approval resume). Durable sends drop it in `readRunAdmission` (`useServerSessionInputs.ts:398`). Listeners: /w `useAgentChatSession.ts:621-628`, /m `LiveConversation.tsx:184-195`. |
| `commit_revision` tool records | Session records, re-read on each `tool.completed` event (`durableEvents.ts:49-55`, `committedRevisions.ts:41-64`) | Subscribed readers of that session only. Listener on /w: `AgentConversation.tsx:188-199`. None on /m: `useAgentConversation.ts:1053-1063`. |
| Project watch `workflow-changed` | `api/oss/src/core/workflows/service.py:1298-1310` | Every tab (`useProjectWatch.ts:57`). Fires on an artifact edit such as a rename, NOT on a revision commit. |
| Manual save | `agentAutoCommit.ts:187-195` invalidates caches | The saving tab only. |

The version drawer (`AgentVersionHistoryDrawer.tsx:55`) reads
`workflowRevisionsByWorkflowQueryAtomFamily` (`store.ts:705`, `staleTime: 30_000` at `:752`) and
never refetches on open.

### Today and expected, per case

"Fix" marks what this change delivers.

| # | Case | Today /w | Today /m | Expected | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Agent commits during the user's turn, session in view | Adopts: pane, chip and next send move; "Agent updated this configuration in vN" shows (`useAgentChatSession.ts:602-620`). Live: v3 -> v4. | Nothing until reload. Live: stayed v5, reload showed v6. | Adopt, as /w does (Decision 1, decided). | Yes |
| 1a | Agent name in the sidebar | Moves on `rename_agent` (artifact edit -> `workflow-changed`). | Same | Same | n/a |
| 2 | Tab hidden or minimized when the commit happens | The records reader closes when hidden and re-reads on return (`useSessionLivePreview.ts:342-352`), then adopts the commit automatically. | Nothing | No automatic adoption. On return, one latest-version check; if newer, the pill. | Yes |
| 3 | Another session of the same agent, same tab | That session's reader is closed while off screen (`AgentConversation.tsx:147,193`); a missed commit is never reported. Stale until reload. | Stale until reload | On switching to it, one check; if newer, the pill. | Yes |
| 4 | Same agent in another tab, or /m next to /w | A tab reading the same session adopts automatically; a tab on another session stays stale. | Stale | The other tab shows the pill when it becomes visible or is switched to. Never auto-adopts. | Yes |
| 5 | User saves the config manually | Saving tab moves. Other tabs and sessions stay stale; a running turn keeps its config, and the next send from the saving tab uses the new version. | Same | Saving tab moves; others show the pill at their next check. | Yes |
| 6 | Unsaved local edit when the agent commits | Auto-save commits the full config 1.5 s later with no `base_revision_id` (`agentAutoCommit.ts:23`, `commit.ts:240-256`), so the later write silently reverts the agent's change. /w only delays it 2 s (`agentAutoCommit.ts:27,72`). From code, not reproduced. | Same, without the 2 s delay | No silent loss: refuse or rebase the save and show a conflict. | Follow-up |
| 7 | Agent commits mid-turn | Adopts at the commit (re-read on `tool.completed`), from code. | Nothing | Same as case 1, applied at the commit. | Yes |
| 8 | Commit fails | Card shows the error; no change (`committedRevisions.ts:21,55-62`). Live: a refused commit left the pane alone. | Same | Same | n/a |
| 9 | Commit from Slack, Telegram or an automation | A new session reads the latest version. An open session is stale. | Same; a pinned session stays pinned | New sessions start on the latest version. An open session shows the pill at its next check. | Yes |
| 10 | Version drawer | Shows the cached list, up to 30 s old; no refetch on open. | Same | Refetch on every open; newer versions on top, each with Update. | Yes |
| 11 | /m vs /w | /w has both commit listeners | /m has one, never fed | Same behavior on both | Yes |

## Goals / Non-Goals

**Goals:** fix the /m regression for the session in view; make every other view aware of a newer
version without adopting it; make the drawer current; keep backend traffic to one small read per
user action.

**Non-Goals:** automatic adoption anywhere the user is not watching; polling; cross-tab push;
the conflict model for case 6.

## Decisions

### Decision 1 (DECIDED 2026-09-25: Option A): the session in view when the agent commits in this turn

- **Option A, recommended: adopt.** The user asked this agent to change itself, in this
  conversation, and is watching. Adopting is what /w does today and what "used to work" means. The
  records trigger fires only for commits after the reader's baseline, so a reload never replays
  old commits. Cost on /m: forward `onCommittedRevision` from `useAgentConversation` to
  `useSessionLivePreview` and handle it in `LiveConversation` with the dedupe set it already has.
- **Option B: show the pill here too.** One rule everywhere and no automatic cache invalidation at
  all. The user clicks Update after each self-edit, and the next send goes to the old version
  until they do. /w's automatic adoption would be removed.

Mahmoud chose Option A.

### Decision 2: the pill instead of automatic adoption everywhere else

A session that the user is not watching keeps the version it has. The pill ("vN available ·
Update") sits next to the version chip. Update pins the session to the latest version and runs the
same adoption as Option A. Alternative rejected: automatic catch-up on return (/w's current case 2
behavior). It invalidates caches the user did not ask to refresh and can switch a config under a
user who is reading it.

### Decision 3: detect a newer version with one check at three moments

The check reads the variant's latest revision id and version (the existing
`POST /workflows/revisions/retrieve` by variant ref, the call the latest-revision query already
makes) and compares it with the session's version. It runs when the tab becomes visible, when a
session becomes the active one, and when the drawer opens. Nothing runs while the tab is hidden,
and there is no interval.

Existing events considered as a replacement:
- The session's `tool.completed` event covers only commits made in that session, only while its
  reader is open.
- The project watch `workflow-changed` event does not fire on revision commits.
- **Option, not in version one:** publish `workflow-changed` from the revision commit path. Every
  visible tab would then learn at once, with no check. The cost: a backend change, and the handler
  must only mark "newer available" instead of invalidating the latest-revision caches, as
  `useProjectWatch.ts:31` does now. The check stays either way, because a tab that was hidden missed
  the event.

### Decision 4: the drawer refetches on open

The drawer calls `refetch()` on its revisions query each time it opens. Revisions newer than the
session's version are listed at the top with an Update action that behaves like the pill.

### Decision 5: new sessions start on the latest version

A new session resolves the latest version at creation, not a cached one. Today it reads the
latest-revision cache, which can be up to 30 s old.

### Decision 6: how "never by itself" is enforced

- **/m** pins every session to a revision when it opens (`ChatScreen`), after one fresh read of the
  latest revision. Before this, an unpinned session followed the latest-revision query, which
  every commit in the tab and every project-watch `ready` (each return to the tab) re-read, so it
  moved on its own. The pill's Update and the in-view adoption re-pin.
- **Records reader** (`useSessionLivePreview`): hiding the tab drops the live baseline, so the
  re-read on return sets a new one and a commit made while hidden is not reported. That removes
  /w's automatic catch-up (case 2) and keeps /m from gaining it.
- **Same session visible in two tabs** (case 4): both readers are live, so both adopt. A visible
  tab on the session the agent is working in counts as the user watching it. A hidden tab, or a
  tab on another session, gets the pill.
- **/w session switch:** /w's playground holds one revision for all its session tabs, so a
  session switch there changes nothing to check. /w checks on mount, on visibility and on drawer
  open; /m also checks on each session switch.

## Risks / Trade-offs

- The pill makes a stale view explicit but does not remove it: a user can keep sending to an older
  version on purpose. That is the intended contract.
- One read per visibility change or session switch. It stays cheap only if it stays one request;
  no fan-out per open tab of the rail.
- Option A keeps one automatic invalidation, scoped to the session in view and to commits made in
  its own turn.

## Migration Plan

None. This is frontend only. Rollback is a revert.

## Open Questions

- Decision 1: decided, Option A.
- Should the `workflow-changed` option in Decision 3 replace some checks later?
