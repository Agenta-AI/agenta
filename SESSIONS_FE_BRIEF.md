# Frontend brief — wire the durable Sessions API into agent chat

## 0. Where you are
- **Worktree:** `/Users/ardaerzin/Documents/GitHub/agenta_open_source/.claude/worktrees/big-agents-sessions`
- **Branch:** `big-agents-add-sessions` = `origin/big-agents` + a clean merge of PR #4916 (`feat/add-sessions`).
- Read `web/AGENTS.md` and the `agenta-package-practices` skill before writing code. Frontend is a pnpm monorepo (Node ≥ 22.13; use Node 24). Run `pnpm lint-fix` in `web/` before committing.

## 1. What PR #4916 actually shipped (read this first)
It is ~95% **backend + generated client**, almost no FE feature code:
- New API domains under `api/oss/src/.../sessions/{states,streams,transcripts,interactions}` + standalone `mounts`.
- The **Fern-generated TS client** for them in `@agentaai/api-client` — this is your entire FE-facing surface. Nothing consumes it yet.
- Design docs in `docs/designs/sessions/` (states / streams / transcripts / interactions) and `docs/designs/mounts/`. **These docs are labelled "draft for discussion / not implemented"** — treat them as intent, and **verify the actual backend wiring is live before building UI on an endpoint** (esp. transcripts ingest worker, interactions beyond `user_approval`). v1 of interactions implements **`user_approval` only**; `user_input` and `tool_call` exist in the schema but are not wired.

So your job is **integration**, not greenfield: connect the existing agent-chat FE (today localStorage-only) to these durable endpoints.

## 2. The new API surface (`@agentaai/api-client` via `getAgentaSdkClient()`)
Get the client the standard way (mirror `web/packages/agenta-entities/src/trace/api/client.ts`):
```ts
import {getAgentaSdkClient} from "@agenta/sdk"
const sessions = getAgentaSdkClient().sessions
const mounts   = getAgentaSdkClient().mounts
```
**Project/app scope ALWAYS rides queryParams, never the body** (standing rule, see `projectScopedRequest` in the trace client): pass `{queryParams: {project_id, application_id}, abortSignal}` as the per-request options arg. Fern methods **throw `AgentaApiError` on non-2xx** — wrap at the boundary.

### `client.sessions.*`
| Method | Endpoint | Purpose |
|---|---|---|
| `invokeStream({session_id, prompt?, force?, detached?})` | POST `/sessions/streams/invoke` | **Start/resume a live run.** `force` steals the run lock; `detached` = fire-and-forget (no held connection). |
| `queryStreams({session_id?, sandbox_live?})` | POST `/sessions/streams/query` | List live stream handles (who's running / attached / sandbox alive). |
| `getLiveness(...)` | GET `/sessions/streams/liveness` | Is a session's run currently alive. |
| `queryTranscripts({session_id})` | POST `/sessions/transcripts/query` | **Durable, append-only event log = the replay source for rendering a conversation.** |
| `getTranscriptEvent({event_id})` | GET `/sessions/transcripts/{event_id}` | One event by id. |
| `getState({session_id})` / `setState({session_id, data, sandbox_id})` | GET/POST `/sessions/states/{session_id}` | Durable SDK `SessionRecord` (opaque JSON) + sandbox resume pointer. |
| `setStateSandboxId(...)` | POST `/sessions/states/{session_id}/sandbox-id` | Update just the resume pointer. |
| `queryInteractions({query, windowing})` | POST `/sessions/interactions/query` | List HITL requests (pending approvals etc.). |
| `fetchInteraction({interaction_id})` | GET `/sessions/interactions/{interaction_id}` | One interaction. |
| `respondInteraction({interaction_id, answer})` | POST `/sessions/interactions/{interaction_id}/respond` | **Resolve a HITL request** (approve/deny/input/tool-result). |
| `querySessionMounts({...})` | POST `/sessions/mounts/query` | Session-scoped view of mounts. |

### `client.mounts.*` (agent working-directory files)
`queryMounts`, `createMount`, `fetchMount`, `editMount`, `archiveMount`/`unarchiveMount`, plus file ops `getMountFiles`, `uploadMountFile`, `writeMountFile`, `deleteMountFile`, `createMountFolder`.

### Key entity shapes (all under `AgentaApi.*` from the client)
- **`SessionTranscript`**: `{id, session_id, project_id, event_index?, sender?, session_update?, payload?, created_at?}` — `payload` is the ACP event (text / tool_call / result). This is what you map → chat messages.
- **`SessionState`**: `{session_id, data (opaque SessionRecord JSON), sandbox_id?}`.
- **`SessionStream`**: `{id, session_id, attached?, sandbox_live?, last_seen_at?, status:{code, message}}`. `StreamStatusCode = Running | Detached | Idle | Ended`.
- **`SessionInteraction`**: `{id, session_id, run_id?, token, kind, status?, data}`. `kind = user_approval | user_input | tool_call`. `status = pending | resolved | denied | cancelled`. `data = {request, references, selector, resolution}`.
- **`SessionMount` / `Mount`**: `{id, session_id, project_id, data: MountData, flags}`.

**Consistency model to respect:** the **transcript renders the question** (append-only, replayable); the **interaction record holds the answer-state** (is it still actionable + what was answered). Don't render HITL from the interactions table — render from the transcript, and use interactions to know if it's still pending/resolved.

## 3. The existing FE you're wiring into — `web/oss/src/components/AgentChatSlice/`
Today this slice is **localStorage-only** with an **ephemeral runner transport**. Files that matter:
- `state/sessions.ts` — the multi-session model. HISTORY (`sessionsByAppAtom`) vs OPEN TABS (`openIdsByAppAtom`) vs messages (`sessionMessagesAtom`), all `atomWithStorage` (localStorage), **scope-keyed** (app id, or `drawer:<entityId>` for the create/edit drawer — see `state/scope.tsx`). Messages keyed by globally-unique session id.
- `assets/loadSession.ts` — **the hydration seam.** `loadSessionMessages(sessionId)` returns `null` today. Its docstring still points at the **old** `/services/agent/v0/load-session` endpoint — that is now **superseded** by `client.sessions.queryTranscripts({session_id})`. This is the single cleanest place to light up server-backed history.
- `assets/transport.ts` + `assets/AgentChatTransport.ts` — the `useChat` (AI SDK v6) transports. Today they POST the agent-protocol envelope to the runner and stream a v6 UI Message Stream; `AgentChatTransport` also handles a batch→one-shot replay. The live run currently does **not** go through `/sessions/streams/invoke`.
- `assets/toAgentaMessage.ts`, `assets/trace.ts`, `assets/rewind.ts`, `assets/files.ts`, `assets/attachments.ts` — message adaptation, trace stamping, edit/rewind, inline `data:` file attachments.
- `components/SessionHistoryMenu.tsx` — the clock-icon history picker (already shipped, localStorage-backed). `components/AgentChatConversation.tsx`, `AgentMessage.tsx`, `ToolActivity.tsx`, `QueuedMessages.tsx` — render surface. `hooks/useAgentChatQueue.ts` — send queue.
- Pages: `web/oss/src/pages/.../apps/[app_id]/agent-chat/index.tsx` (standalone) and the playground panel `AgentChatPanel.tsx`.

Separately, observability already has a **read-only** session viewer (`web/oss/src/components/SharedDrawers/SessionDrawer/`, `components/pages/observability/components/SessionsTable/`) that lists sessions by aggregating `ag.session.id` off traces. That's a different surface — don't conflate it; but the new transcripts API could eventually back its message panel too.

## 4. Suggested work order (each is independently shippable)
1. **Server-backed history (highest value, smallest change).** Implement `loadSessionMessages` against `client.sessions.queryTranscripts({session_id})`: map `SessionTranscript.payload` events → v6 `UIMessage[]` (reuse the vercel/`toAgentaMessage` adapters). Caller already writes the result into `sessionMessagesAtom` before opening the tab. This makes open-from-deep-link / open-from-trace render conversations this browser never ran. **Confirm the transcript ingest worker is actually populating rows first** — if empty, this is a no-op.
2. **Session state / resume.** On session open, `getState` to restore the SDK record + `sandbox_id`; persist via `setState` so a run can resume the same sandbox across reloads/devices. Decide the localStorage-vs-server source-of-truth merge (server wins when present; localStorage is the offline fallback — keep the existing fallback semantics).
3. **HITL interactions.** When the transcript renders an `interaction_request`, cross-check `queryInteractions`/`fetchInteraction` for live status, and wire the approve/deny control to `respondInteraction({interaction_id, answer})`. Scope v1 to `user_approval` (deny/allow, maybe "always"); leave `user_input`/`tool_call` stubbed behind a flag. Build it as a derived view over the transcript, not a second source of truth.
4. **Live run via streams (bigger).** Move the live send from the current runner transport onto `/sessions/streams/invoke` (+ `queryStreams`/`getLiveness` for attach/detach/“someone else is running this” state, and `force` to steal). This is the multi-replica-correct path; verify the backend stream endpoint is live and returns the v6 chunk stream the transport expects before committing to it.
5. **Mounts / files (optional, last).** A file panel over `client.mounts.*` for the agent working directory.

## 5. Conventions (enforced — see memory/AGENTS)
- **Fern client only** (`@agentaai/api-client` via `getAgentaSdkClient()`), never axios, for all new API code.
- Package vs app placement per `agenta-package-practices`. New shared session entity logic likely belongs in a `@agenta/entities`-style package (mirror `trace/api/`), not in `web/oss`. OSS lint **blocks re-exporting `@agenta/*` from app barrels**.
- **Text size 12px (`text-xs`)**, never `text-sm`. **No `size="small"`** on antd controls. Dark mode: use **antd semantic tokens** (`--ag-colorText`, `--ag-colorBorder`, …); `dark:` / `bg-gray-*` / fixed hex are no-ops here.
- Thin-references pattern: query caches store IDs, the molecule/atom is the source of truth.
- Don't put `project_id`/`application_id` in request bodies — queryParams only.
- Before commit: `pnpm lint-fix` in `web/`; run the **oss tsc** manually (relocations can mask new errors — gate on an error-signature diff, not a count).
- Commit messages: no "Claude"/Anthropic/`Co-Authored-By`.

## 6. Verify before asserting done
- The fastest reality check is whether the endpoints return data: hit `queryTranscripts` / `queryStreams` / `queryInteractions` for a real session id and confirm non-empty, correctly-shaped responses. Several of these depend on a runner/worker rebuild that may not be running locally.
- Use the `verify` skill / run the app rather than trusting types — the generated client compiles regardless of whether the backend route is wired.
