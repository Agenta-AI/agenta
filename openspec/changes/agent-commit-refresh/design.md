# Design: agent self-commit refresh

## Context

### The two signals

| Signal | Carried by | Reaches | Listener on /w | Listener on /m |
| --- | --- | --- | --- | --- |
| `data-committed-revision` stream part | Vercel stream from `/services/agent/v0/invoke` (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:316-323`, `:628-635`) | `conversation.messages` only when `useChat` consumes the stream: regenerate or a legacy approval resume. A durable send's stream goes to `readRunAdmission` (`useServerSessionInputs.ts:398`), which drops it. | `useAgentChatSession.ts:621-628` | `LiveConversation.tsx:184-195` |
| `commit_revision` tool records | Session records, read by `useSessionLivePreview` on every `tool.completed` durable event (`durableEvents.ts:49-55`) through `liveCommittedRevisions` (`committedRevisions.ts:41-64`) | Every subscribed reader of the session, including other tabs | `AgentConversation.tsx:188-199` -> `useAgentChatSession.ts:602-620` | none: `useAgentConversation.ts:1053-1063` does not pass `onCommittedRevision` |

Neither signal is emitted for a manual save. A manual save runs `invalidateAgentCommittedRevisionCache` in the
saving tab only (`agentAutoCommit.ts:187-195`). The project watch's `workflow-changed` event fires
only on an artifact edit such as a rename (`api/oss/src/core/workflows/service.py:1298-1310`), never
on a revision commit.

### Current and expected behavior, per case

"Current" is what the code does today, and whether it was checked live on staging. "Fix" says
whether this change delivers the expected behavior.

| # | Case | Current /w | Current /m | Expected | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Agent commits, session in view, tab focused | Config pane, instructions, tools and version chip move to the new revision, the next send targets it, and "Agent updated this configuration in vN" shows (records path, `useAgentChatSession.ts:602-620`). **Live: v3 -> v4.** | Nothing moves until reload, and the next send still targets the old revision. **Live: stayed v5, reload showed v6.** | Both hosts move to the new revision and send against it. | Yes |
| 1a | Agent name in the sidebar | Moves when the agent calls `rename_agent`: that is an artifact edit -> `workflow-changed` -> `useProjectWatch.ts:57`. `commit_revision` does not change the name. | Same | Same | n/a (already works) |
| 1b | Unsaved local edit in the config pane at that moment | See case 6 | See case 6 | See case 6 | Follow-up |
| 2 | Agent commits while the tab is hidden or the window minimized | `useSessionLivePreview` closes on `visibilitychange` and re-reads the records when the tab is visible again (`useSessionLivePreview.ts:342-352`). A commit made after the first read is still reported, because the baseline survives in the effect closure (`:122`, `:231`). So the pane catches up when the user returns. No rAF dependency. An unfocused but visible window stays connected and updates live. | Nothing (no listener) | Catches up on return, without a reload | Yes (/m gets the /w path) |
| 3 | Agent commits in session A while the user views session B of the same agent, same tab | On /w, A's reader is closed while A is off screen (`visible: onScreen`, `AgentConversation.tsx:147,193`). When A comes back, a new effect run sets a fresh baseline, so the commit is behind it and is never reported. B's pane stays stale until reload. | Nothing | B's pane shows that a newer revision exists; A adopts it on return. | Follow-up |
| 4 | Same session open in two tabs (or /m and /w side by side), one commits | /w tab: the reader is subscribed (`sender: true`) and receives `tool.completed` -> refresh. | /m tab: nothing | Every open view of that session follows the commit | Yes for the same session. A different session of the same agent is case 3. |
| 5 | User saves the config manually | The saving tab moves to the new revision (`agentAutoCommit.ts:187-195`). Other tabs and other sessions get no signal and keep the old revision until reload; unpinned readers refetch only when something else invalidates. A running turn keeps its config; the next send from the saving tab uses the new revision. | Same | Other open views learn about the new revision | Follow-up (needs a project-watch event for revision commits) |
| 6 | Unsaved local edit when the agent commits | Auto-save debounces 1.5 s (`agentAutoCommit.ts:23`) and commits the full configuration of the edited revision with no `base_revision_id` (`commit.ts:240-256`). If the agent committed in between, the user's save lands on top and silently reverts the agent's change. /w holds the flush for 2 s after a self-commit (`SELF_COMMIT_QUIET_MS`, `agentAutoCommit.ts:27,72`), which delays the overwrite without preventing it. (From code; not reproduced live.) | Same, and /m does not set the quiet window because it never sets `agentSelfCommitSignalAtom` | Neither change is silently lost: the save is refused or rebased on the new head, and the user sees a conflict. | Follow-up |
| 7 | Agent commits during a long turn | `tool.completed` triggers a records re-read mid-turn (`durableEvents.ts:49-55`), so the pane moves at the commit, not at the end of the turn. (From code; the live run was checked after the turn.) | Nothing | Moves at the commit | Yes |
| 8 | Commit fails (validation refusal, `commit_failed`) | `liveCommittedRevisions` skips error results and results without `status: "committed"` (`committedRevisions.ts:21,55-62`). The tool card shows the error and the pane does not move. **Live: a validation refusal (record 16) left the pane alone; the agent's retry committed.** | Same card, no move | Same | n/a |
| 9 | Agent commits from Slack, Telegram or an automation, no playground open | A playground opened later reads the latest revision fresh. An already-open playground is case 5. | Same, except a session pinned to a revision (`selectedRevisionAtomFamily`) keeps showing that revision | Same | n/a |
| 10 | /m vs /w | /w has both listeners | /m has only the stream-part listener, which the durable path never feeds | Parity | Yes |

## Goals / Non-Goals

**Goals:** /m follows the agent's own commit in cases 1, 2, 4, 7 and 10, the way /w does today, with the smallest change.

**Non-Goals:** cases 3, 5 and 6 (they need a new server event or a conflict model), and the /m commit notice. They are recorded as follow-ups.

## Decisions

### Decision: reuse the records-based trigger /w already has


1. `useAgentConversation` takes an optional `onCommittedRevision(revision)` and forwards it to its
   `useSessionLivePreview` call. The engine still leaves the reaction to the host, as its header
   comment says.
2. `LiveConversation` passes a handler that calls the reaction it already has, keyed by revision
   id, so a commit seen by both the part reader and the records reader acts once.

Alternatives considered:

- **Parse `data-committed-revision` in `readRunAdmission`.** This would work only in the tab that
  sent, and only while its stream is still attached. The records path also covers other tabs and a
  tab that was hidden. It would also add a second meaning to a function that decides admission.
- **Move the whole reaction into the shared engine.** Both hosts would then change, and /w would
  get a second path next to its own. That is a bigger change than this regression needs.
- **Delete /m's part reader.** Regenerate and legacy approval resumes still stream through
  `useChat`, and /w keeps the same reader. Keeping it costs one line in the shared handler.

### Decision: no tool-name drift guard

The brief suspected that `toolCacheEffects.ts` or `PLATFORM_OPS` had drifted from the SDK op names.
They had not: the records carry `commit_revision` unprefixed (Pi), `canonicalClientToolName` strips
the Claude and Codex wrappers, and `commit_revision` was never in `toolCacheEffects`, which covers
trigger ops only. A drift guard would not have caught this regression, so none is added here.

## Risks / Trade-offs

- The records trigger needs the shared reader to be advertised. When it is not, the durable path gives
  /m no signal, and /w has the same limit today. Staging and cloud advertise it.
- A commit made before the reader's first read is not reported as live. That is on purpose: it
  stops a reload from replaying old commits. The reload already shows the latest revision.
- Adopting a revision pins the session to it, which is what /m's part reader already does.

## Migration Plan

None. This is a frontend-only change and there is no data to migrate. Rollback is a revert.

## Open Questions

- Should cases 3 and 5 be solved with a `revision-committed` project-watch event? That is follow-up 4.1.
