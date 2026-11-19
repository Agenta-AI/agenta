# session-screen: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements. The contracts are design.md D6 (two conversations and the conversation lifetime) and D7 (a session follows the saved version).

## Words used in this file

- **Session screen**: the screen of one agent session in `/m`. It has the sidebar, the header, the conversation and the right panel.
- **Session**: the code and API word for a conversation. The interface says "chat" for a conversation with the builder.
- **Header**: the one row at the top of the session screen.
- **Agent menu**: the menu that opens from the agent name in the header.
- **Session menu**: the menu that opens from the session title in the header.
- **Page conversation**: the conversation of the agent session that the screen shows. Role `"page"`.
- **Builder conversation**: the builder chat in the right panel. Role `"embedded"`. The builder is the platform agent with the slug `__ag__builder`.
- **Focused conversation**: the conversation that holds the keyboard focus. When the focus is in neither, it is the page conversation.
- **Version**: a saved revision of the agent configuration, shown as "vN".
- **Follows its agent**: the session is bound to the agent and not to one fixed revision. Production computes this as `followsAgent`.
- **Dirty**: an open view form with edits that the user did not save (configuration-draft capability). The agent configuration itself is saved by the production automatic save about 1500 ms after each edit.
- **Session origin**: who started a session: `manual` (a person), `trigger` (an automation) or `builder` (a builder test run of another agent). The server stores it as the reserved tag `ag.origin` and decodes it into the field `origin`.
- **Spark**: the small mark after a session name that means "Started by the builder".
- **Check counter**: a number per agent (workflow id) in memory. Only the watch handler bumps it. `AgentRevisionStatus` runs the latest-version check when it changes.

## Which rule won

- The session screen has no tab strip. The canvas boards Main, S02 and S03 draw none, and the header session menu plus the sidebar take its jobs. PROPOSED, for Mahmoud to confirm. Production shortcuts `Alt+1` to `Alt+9` jump between the tabs of that strip (`web/packages/agenta-ui/src/shortcuts/useSessionShortcuts.ts`, Alt chords at lines 23-29; the exact `Alt+1` to `Alt+9` binding is not verified here); without the strip they need a new list of sessions, or they go. Open question.
- Contradiction 8 (Sessions table columns) is decided by BEHAVIOR 10.6: no "Started by" column and no "Builder" filter.
- The focus rules are new. The design (D6) says shortcuts act on the focused conversation. The order of Escape (run stop and card deny before panel back and close) is PROPOSED; it keeps production behavior for a running answer.
- One trigger for the follow (design.md D7). A builder tool result in this tab does not start the check by itself; the card and the save only clear caches. The cost is at most one watch round trip of delay in the same tab.

## Today's behavior on `origin/main` (5d783fec)

- The header is `web/mobile/src/features/chat/SessionTopBar.tsx`. It renders `AgentPageHeader` with `AgentIdentity` (name, inline rename), `AgentRevisionStatus` (the `vN` chip, the save dot and "Update to vN") and `ShareMenu` (lines 67 to 116). `ShareMenu` is a templates menu with "Save as template" (download a zip) and "Share in marketplace" (`web/mobile/src/features/chat/ShareMenu.tsx:65-107`), not a share of the conversation.
- The conversation share is `SessionSharingControl`, on the session tab strip (`web/mobile/src/features/chat/SessionTabs.tsx:75`). The session list popover is `SessionHistoryMenu` (`SessionTabs.tsx:86`, popover 320 px wide), with the title "Session history" (`chat.mobileSessions.json:15`).
- "Archive agent" and its confirmation text are in `web/packages/agenta-i18n/locales/en/entityUi.agentActions.json:19,26`. Production has no item named "Export agent". The closest production action is "Save as template" (zip download) in `ShareMenu`. Which action "Export agent" runs is not verified.
- New session: `web/mobile/src/features/chat/useStartBlankSession.ts` mints an id and navigates; a second tap returns the pending id (lines 37 to 50).
- Version history drawer: `web/packages/agenta-playground-ui/src/components/AgentVersionHistory/AgentVersionHistoryDrawer.tsx` (780 px, line 199). It opens from the `vN` chip (`AgentRevisionStatus.tsx:206`). Texts in `playground.versionHistory.json`.
- Running spinner in the sidebar: `web/mobile/src/features/nav/useMobileNavItems.tsx:115`. In lists: `web/packages/agenta-sessions-ui/src/SessionCardList.tsx:76`. The same list already marks an automation session with a bolt (`SessionCardList.tsx:79`, `:171`); the spark goes in the same place.
- Session origin: `SessionOrigin` has only `manual` and `trigger` (`api/oss/src/core/sessions/types.py:49-51`). The server reads the tag `ag.origin` and decodes it; a row with no tag reads as `manual`, and an unknown value reads as no origin (`api/oss/src/dbs/postgres/sessions/streams/mappings.py:30, 110-120`). The sessions query filters by `origin` and `exclude_origin` (`api/oss/src/apis/fastapi/sessions/models.py:111-114`). No session has the origin `builder` today, and no spark exists.
- Run shortcuts: Escape stops a streaming run and `Alt+G` approves one gate, for any conversation on screen (`web/mobile/src/features/chat/LiveConversation.tsx:854-874`, the check is `isOnScreen` at line 859). The approval card binds Cmd or Ctrl+Enter and Escape for any card on screen (`web/packages/agenta-chat/src/components/ApprovalCard.tsx:190-210`). With two conversations on screen this must change to the focused conversation.
- Route lifetime: the route component renders below the app providers (`web/mobile/src/pages/_app.tsx:66`). When the route changes to another page file, React unmounts the old page and everything below it. Every session already uses one page file (`web/mobile/src/pages/w/[workspace_id]/p/[project_id]/sessions/[session_id].tsx`, no remount on a session switch), and the agent pages are views of the agent route (`agents/[agent_id].tsx`). The requirement is that state survives (design.md D6): inside each page file the builder conversation usually needs no restore; a move between the two remounts it, and it restores its state by session id (task 7.2).
- Picking up a newer version:
  - A session starts pinned to the latest revision when it opens (`web/mobile/src/features/chat/ChatScreen.tsx:132-145`).
  - `autoUpdateRevision` is true when the session follows its agent, the liveness poll answered, and no turn is active (`ChatScreen.tsx:173-174`).
  - `AgentRevisionStatus` applies the newer version only when nothing is saving, failed or dirty, else it shows "Update to v{{version}}" (`AgentRevisionStatus.tsx:125-134`; text `playground.agentHeader.json:19`). Its "dirty" is the draft store only; a local form in an open view does not count today, because drawers hold their own copy. The change adds an open view form with edits to the wait.
  - The newer version is looked for on mount, on page visible, on a session switch and after an auto-commit save in this tab (`web/packages/agenta-playground/src/state/execution/latestVersionCheck.ts:3, 12-16`; `AgentRevisionStatus.tsx:104-111`). A save by the builder tool `edit_agent_config` is a server commit and starts none of these.
  - The project watch handler on `workflow-changed` only clears the workflow queries (`web/packages/agenta-sessions/src/watch/useProjectWatch.ts:67`). The server publishes `workflow-changed` only in `edit_workflow` (rename, flags, folder), not when a revision is committed (`api/oss/src/core/workflows/service.py:2209, 2265-2277`).
  - The change, frontend only (task 8.3): the latest-version check also runs when a `committed` result of `edit_agent_config` or `create_agent` for this agent arrives in this browser, and on window focus; its production triggers stay (`latestVersionCheck.ts:44-50`: mount, `visibilitychange`, a save of this tab). The server event does not change. A save by another person shows at the next focus or visibility change of this tab.
- Mobile keeps its own latest-revision cache key (`web/mobile/src/features/chat/useAgentEntity.ts:45`); it is under the prefix that commit invalidation clears.
- A message sent before the automatic save ran uses the draft store and the service records a draft run (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:325, 369-393`), as production does. This capability does not change it.

## Other places that mount the changed parts

- `AgentRevisionStatus` is also the revision chip of the classic playground header (`AgentRevisionStatus.tsx:58-62`). Changes to its update rule reach that surface too.
- `SessionCardList` renders in `SessionsPane`, `SessionHistoryMenu`, `SessionListCard` and `SessionListPanel`.
- `useSessionShortcuts` is shared with the classic playground.
- `ApprovalCard` renders in every conversation; its key binding change (focus only) reaches the playground too.

## Foundation work in this capability

Task 3.3 (the header in place of the old layout, Foundation A), task 30 (session origin `builder`, builder agent work), task 43 (the spark and the link to the builder chat), section 7 (conversation role and lifetime, Foundation B), task 8.3 (the check on a builder result and on focus, and the wait while an open view form has edits; Foundation B).

## Backend work

- None in this program.
- Session origin `builder` (task 30, provided by the builder agent work): the enum value, the decode, the query filter, the link tag `ag.builder.session_id` to the builder chat, and the frontend session type. Only the server writes them. The test-run builder tool (task 31) is the writer; until it merges no session has the origin. The spark and the link (task 43) read the decoded fields.

## States described but not drawn

The spark in the session menu and on the Sessions page, the link to the builder chat in the session menu and its no-access state, open menus (agent menu, session menu, Share popover), the "Update to vN" offer in the new header, the spinner in the session menu, the restored composer and scroll after a return, the reconnect to a running answer, loading and error states. The canvas draws the header with the panel closed and open.

## Text

- From the canvas, new: "Share the conversation", "Export agent".
- New, from the canvas and HANDOFF section 5: "Started by the builder" (tooltip of the spark).
- Not written; listed for Mahmoud: the label of the session menu link to the builder chat that started the session.
- From production: "History", "Rename", "Archive agent", "New session", "Private agent", "Update to v{{version}}", "Waiting on you", "The version history could not be loaded. Retry from the list.".
- Not drawn and not confirmed: the label of the link to the Sessions page in the session menu. PROPOSED: production "Sessions" (`chat.mobileSessions.json:16`).
