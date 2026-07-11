# Sessions — frontend integration status & follow-ups

Living status of the agent-chat frontend's integration with the durable Sessions API. It is the
hand-off surface for any agent picking up the remaining work — **check the "Blocked / waiting"
and "Follow-ups" tables before starting**, and update this doc as items land.

The frontend lives in `web/oss/src/components/AgentChatSlice/` (the agent chat) and
`web/packages/agenta-entities/src/session/` (the API + zod boundary + liveness derivation). The
debug drawer is `web/oss/src/components/SessionInspector/`.

## Mental model (why the FE is shaped the way it is)

- **localStorage is the session index + display cache; the server is authoritative per-session.**
  There is intentionally **no** server "list my sessions" endpoint — `query_session_streams` is a
  liveness index, not a conversation list. The runner mints the `session_id`; the browser persists
  it (as the chat tab id) and treats server records/state/streams as per-session truth. See
  `poc-show-sessions-in-web/specs.md` §"The session_id the inspector keys off".
- **Records are the durable conversation.** New sessions persist BOTH user and agent turns as
  records (`record_source` `user`/`agent`), so records-replay reconstructs full history. The
  `done` record terminates a turn (the FE splits assistant bubbles on it).
- **Liveness rides stream flags** (`is_alive ⊇ is_running ⊇ is_attached`). `resumable`/
  `reattachable` and the lifecycle label are derived client-side (`session/core/liveness.ts`).

## Done (shipped in the FE, may be uncommitted)

| Area | What | Where |
|---|---|---|
| Records replay | `AgentEvent` records → v6 `UIMessage[]`, `done`-turn split, user/agent role mapping | `AgentChatSlice/assets/transcriptToMessages.ts` |
| Cache-miss hydration | Empty-cache session hydrates from records; skeleton (not empty-state) while loading; `isSessionFresh` guard skips never-run sessions | `AgentChatSlice/AgentConversation.tsx`, `state/sessionEphemera.ts` |
| SWR revalidate-on-open | Cached session refetches records once (low-pri), adopts only if server strictly ahead + not busy | `AgentConversation.tsx` (`revalidatedRef` effect) |
| Liveness derivation | `deriveStreamNest` / `deriveSessionLifecycle` / `refineLifecycleWithSandbox` (+ 11 unit tests) | `session/core/liveness.ts` |
| Liveness badge | Tab-dot effective status = local run-state, else backend liveness (`running`/`alive`); ONE shared project-wide `is_alive` query for all dots | `AgentChatSlice/state/liveness.ts`, `components/SessionTagBar.tsx` |
| Request priority | Low-priority Fern client for secondary reads (records hydration, liveness) | `agenta-sdk/src/resources.ts`, `session/api/{client,api}.ts` |
| Debug inspector | Streams/Records/States/Mounts/Interactions tabs on the real endpoints | `SessionInspector/` |
| Mount file browser (read-only) | Navigable folder/file tree + text preview in the inspector Mounts tab; whole-tree fetched once, `deriveMountRows` folds it to a one-level view client-side (7 unit tests) | `session/core/mountBrowser.ts`, `session/api` (`queryMountFiles`/`readMountFile`), `SessionInspector/tabs/MountsTab.tsx` |

## Blocked / waiting on others — wire when the dependency lands

| Item | Blocked on | Exact FE seam to wire |
|---|---|---|
| **Warm/cold/dead lifecycle split** | #5197 (native resume; exposes sandbox/`session_states.data` liveness) | `refineLifecycleWithSandbox(lifecycle, sandbox)` already exists in `session/core/liveness.ts` — feed it a sandbox-liveness signal from `getSessionState`, then the dot/`sessionDotStatusAtomFamily` can show warm vs cold vs dead. Grep `FOLLOWUP(sessions,#5197)`. |
| **Resume a NOT-alive (cold/dead) session** | #5197 (runner respawn + remount; today reload is shallow/missing) | Once resume works server-side, hang a "Resume" affordance off `resumable`/lifecycle in `SessionTagBar`/dot. Send path already resends history; verify the runner resurrects the sandbox. |
| **Durable session naming (titles cross-device)** | Ashraf's BE (session name field/endpoint — #5202) | Today `renameSessionAtomFamily` writes localStorage only. When the BE field exists, write-through on rename and read it into the session index (label falls back to first-user-message from records). |
| **Durable interactions (`respondInteraction`)** | Backend (runner doesn't auto-create rows; respond doesn't transition status) | Package `queryInteractions`/`respondInteraction` are ready; live approvals currently flow through messages. Switch when the durable path is wired. |
| **Durable session archive / delete** | Backend — endpoint does not exist (see "Backend asks" below) | FE `deleteSessionAtomFamily` is localStorage-only; there is no way to remove/archive a session's durable data. When a cascade endpoint lands, wire the history-row Delete to call it (and offer archive/unarchive). |

## Backend asks (not FE work — capture for the backend team)

- **Durable session archive/delete cascade.** There is no session-level delete or archive today. The
  only `DELETE` in `apis/fastapi/sessions/router.py` is `delete_session_stream` (the *kill* — soft-
  deletes the stream row + tears down the sandbox + cancels pending gates), which leaves
  **records / states / mounts / interactions intact**. Records/states/interactions have no
  delete/archive endpoint at all; only `mounts` carries `include_archived`. Needed: a
  `POST /sessions/{id}/archive` + `/unarchive` (and/or a hard `DELETE`) that cascades the
  `LifecycleDBA` soft-delete across all facets and is honored by the `*/query` reads via
  `include_archived` — following the archive/unarchive convention in `api/CLAUDE.md`. Until it
  exists, the FE "Delete" is local-only and durable data persists on the backend forever.

## Follow-ups (FE-only, deferrable — not blocked)

| Item | Note | Grep marker |
|---|---|---|
| SWR revalidate on focus/interval | On-open revalidation shipped; focus/interval is a bonus for long-lived tabs | `FOLLOWUP(sessions,swr)` |
| Same-length content reconciliation | Revalidation adopts only when server is strictly LONGER (count-based). A same-length server-side edit/regenerate won't reconcile — content-diffing across live-vs-replay id-spaces is unreliable | `FOLLOWUP(sessions,swr)` |
| id-only cache slim | Drop the `:messages` store (keep the index), derive labels from records — needs a first-user-message preview stamped on the index at send. Trades instant-open for a fetch-per-open | — |
| Read-write mounts | The browser is read-only; the backend also has write/upload/delete/create-folder + archive/unarchive. Add file management + a user-facing mount surface once JP's artifact-level mounts direction lands | — |
| Env-gate the debug `SessionInspector` | It's a debug drawer; the user-facing liveness/history/files surfaces are separate | — |
| Steer / cancel / attach in chat | These control-plane calls only edit Redis locks on the product path (no runner cooperation, no live-turn re-watch) → surfacing them would be no-op stubs. Deliberately NOT wired. Revisit when the runner cooperates | `FOLLOWUP(sessions,lifecycle)` |

## Gotchas (don't relearn these)

- **Shared EE-dev Postgres volume drifts.** In-place migration edits don't re-run on an existing
  volume, so session tables can lag the DBEs (records envelope, `session_interactions` status/tags/
  meta, `session_states` flags/tags/meta all drifted once). Migrations themselves are correct — a
  fresh `--nuke` is clean. Re-verify against a real row; tsc goes false-green (zod strips unknowns).
- **Mount file ops need the object store configured.** `get_mount_files` (and write/upload) 503
  with "Mount storage backend is not configured" unless `AGENTA_STORE_ACCESS_KEY` /
  `AGENTA_STORE_SECRET_KEY` are set (endpoint defaults to `http://seaweedfs:8333`). Mount *rows*
  (create/query) work without it; only file contents need it. The browser renders a "couldn't load
  — store may not be configured" notice in that case (it distinguishes fetch-failed `null` from an
  empty `[]` mount).
- **The zod boundary is the drift check.** `session/core/schema.ts` `.transform()`s the record
  envelope back to consumer names. Fern's compile-time types under-declare `extra="allow"` fields
  (and lag renames like `status` object→string), so always validate through the package functions.
