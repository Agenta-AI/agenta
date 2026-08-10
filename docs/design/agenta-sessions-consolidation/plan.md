# Consolidating session logic into a single source of truth

**Status:** PLAN — nothing implemented · **Date:** 2026-08-01 ·
**Branch:** `feat/agenta-mobile-wave-1` (119 commits ahead of `release/v0.106.2`)

**Question asked:** desktop and mobile now both implement session-list ordering, liveness
polling, transcript revalidation and approval answering. Where does the shared logic live so
there is exactly one implementation?

**Answer in one line:** extend `@agenta/entities/session` (fetch/schema/cache/derivation) and
`@agenta/chat` (conversation orchestration) — do **not** create `@agenta/sessions`. The reason
is in §3.

Everything below is grounded in files at the branch tip. Where I could not verify a claim from
code I say so and state what would settle it.

---

## 1. Inventory

### 1.1 `@agenta/entities/session` — the shared layer that already exists

2,021 lines across 12 files (`web/packages/agenta-entities/src/session/`), UI-free (verified:
zero hits for `antd|lexical|@/oss` in the tree). Public surface is
`web/packages/agenta-entities/src/session/index.ts:1-108`.

| Sub-layer | Files | What is there |
| --- | --- | --- |
| `api/` | `api.ts` (730), `client.ts` (106) | Every Fern-backed accessor: `querySessions`, `querySessionStreams`, `querySessionRecords`, `queryInteractions`, `respondInteraction`, `setSessionHeader`, `commandSessionStream`, `killSession`, `delete/archive/unarchiveSession`, mounts. |
| `core/` | `schema.ts` (207), `liveness.ts` (90), `transcriptAdoption.ts` (47), `fileActivity.ts` (126), `mountBrowser.ts` (77), `pathUtils.ts` (22) | Pure derivations. `deriveStreamNest`/`deriveSessionLifecycle`/`refineLifecycleWithSandbox`; `shouldAdoptServerTranscript`. |
| `state/` | `records.ts` (121), `mounts.ts` (247), `fileActivity.ts` (140) | Jotai + `atomWithQuery` caches. `sessionRecordsQueryKey` = `["session","records",projectId,sessionId]` (`state/records.ts:18-19`), 15 s stale, IndexedDB-persisted (`records.ts:23-36`), plus `revalidateSessionRecordsAtom` / `fetchSessionRecordsAtom`. |

Coverage: 67 unit-test files in `web/packages/agenta-entities/tests/unit/`, nine of them
session-specific (`session-transcript-adoption`, `session-liveness`, `session-query-schema`, …).

**This is the current of convergence.** Upstream put `transcriptAdoption.ts` in `core/` this
release and desktop consumes it (`web/oss/src/components/AgentChatSlice/hooks/useSessionHydration.ts:3,86-92`).
Nothing in this plan should fight that.

### 1.2 `@agenta/chat` — the headless conversation core, extracted but **not adopted**

38 files under `web/packages/agenta-chat/src/`, six subpath exports
(`web/packages/agenta-chat/package.json:19-27`), no antd/lexical/virtuoso (verified by grep).

The load-bearing fact:

```
grep -rn "@agenta/chat" web/oss/src   →  0 hits
grep -rn "@agenta/chat" web/ee/src    →  0 hits
grep -rn "@agenta/chat" web/mobile/src → 6 hits
```

`web/oss/package.json:28` declares the dependency and never imports it. The package was
**copy-extracted**, deliberately, and the OSS re-imports were deferred — this is written down
in `docs/design/agenta-mobile/plans/2026-07-12-wp3a-chat-headless-core.md:7-19`:

> "OSS re-import" steps were NOT executed (deferred to the desktop re-plumb) … The original
> same-commit OSS re-imports … are DEFERRED to the desktop re-plumb PR, sequenced after the FE
> PR queue drains and the shadcn branch lands — that PR deletes the OSS copies wholesale.

So the consolidation this document is asked to plan is **already scoped in-repo**, with a
sequencing precondition already stated. The new work is the *session* half (list, liveness,
watch, approvals) that WP3a did not cover.

Measured drift between the OSS original and the package copy (changed-line counts):

| OSS file | package counterpart | drift |
| --- | --- | --- |
| `assets/trace.ts`, `assets/rewind.ts` | `agenta-chat/src/assets/*` | 3 lines each |
| `hooks/useAgentChatQueue.ts` | `agenta-chat/src/hooks/useAgentChatQueue.ts` | 4 |
| `hooks/useAgentModelKeyStatus.ts` | same path | 4 |
| `state/expandState.ts` | `agenta-chat/src/state/expandState.ts` | 6 |
| `assets/toolFormat.ts` | `agenta-chat/src/assets/toolFormat.ts` | 6 |
| `assets/AgentChatTransport.ts` | `agenta-chat/src/transport/AgentChatTransport.ts` | 6 |
| `state/sessionEphemera.ts` | `agenta-chat/src/state/sessionEphemera.ts` | 27 |
| `assets/loadSession.ts` | `agenta-chat/src/assets/loadSession.ts` | 27 |
| `assets/transcriptToMessages.ts` | `agenta-chat/src/assets/transcriptToMessages.ts` | 57 |
| `hooks/useComposerAttachments.ts` | `agenta-chat/src/hooks/useComposerAttachments.ts` | 215 (genuinely diverged) |

**The one that is actually dangerous — `agenta-chat/src/state/sessionMessages.ts`.** Its header
(`:1-7`) says "keep byte-parity on the copied blocks if either side changes", and it has
already broken parity in two behaviourally significant ways while writing **the same
localStorage key**, `agenta:agent-chat:messages` (`sessionMessages.ts:22` vs
`web/oss/src/components/AgentChatSlice/state/sessions.ts:140`):

1. The package passes `undefined` for the storage impl (`sessionMessages.ts:24`) → default jotai
   storage **with** the cross-tab `storage` subscribe. OSS deliberately strips `subscribe`
   (`sessions.ts:102-106`) because an incoming cross-tab replacement unmounted a streaming
   conversation and orphaned its `useChat` stream mid-turn.
2. The package's `writeMessagesWithQuotaGuard` returns `void` (`sessionMessages.ts:44-46`), so it
   has no `{evicted, persisted}` result and no counterpart to
   `agenta:agent-chat:record-counts` (`sessions.ts:154-159`). OSS's watermark guard
   (`sessions.ts:737-747`) is only correct while the two stores move together.

Today this is latent (mobile is read-only and never writes messages). It becomes a live bug the
moment either app writes messages through the package while the other reads OSS's watermark.

### 1.3 `web/oss/src/components/AgentChatSlice` — the desktop app layer

`state/` (11 files) and `hooks/` (18 files). Session-relevant:

- **`state/sessions.ts` (881)** — the scope-keyed model: 5 `atomWithStorage` stores
  (`agenta:agent-chat:{sessions,open-sessions,active-session,messages,record-counts}`,
  `:109-159`), history ordering (`:185-213`), server reconciliation (`:429-505`), rename /
  auto-title (`:581-623`, `setSessionHeader` at `:593,621`), archive/unarchive/delete
  (`:333-405`), husk pruning (`:178-181,278-296`), quota guard (`:667-692`), watermark writes
  (`:725-749`), `nowTick` (`:790-794`), `sessionLabel` (`:808-817`).
- **`state/projectSessions.ts` (103)** — one low-priority `querySessions` per agent scope, key
  `["session-list", projectId, appId]` (`:31`), stale 30 s / refetch 60 s (`:39-41`), dedup +
  client sort (`:55-59`), `activity()` (`:66-70`), `toSummary()` (`:72-85`),
  `useReconcileServerSessions` (`:93-103`). **No windowing is passed** — desktop fetches the
  entire unwindowed list with `include_ended`/`include_archived` both defaulting `true`
  (`web/packages/agenta-entities/src/session/api/api.ts:285-286,299-302`), every 60 s.
- **`state/liveness.ts` (98)** — one project-scoped `querySessionStreams({isAlive:true})`, key
  `["session-liveness","alive",projectId]` (`:33`), stale 10 s (`:40`),
  `refetchInterval: data.length > 0 ? 15_000 : false` (`:42`), focus refetch (`:43`). Consumes
  `deriveStreamNest`/`deriveSessionLifecycle` from the package — **no local re-implementation**.
- **`hooks/useSessionHydration.ts` (280)** — the hybrid-SWR transcript: one
  `adoptServerTranscript` (`:82-129`) shared by hydration / SWR / poll / relay, calling the
  package guard (`:86-92`); watermark set **before** `setMessages` (`:103-109`); remote-run poll
  `15_000 → 60_000` chained `setTimeout` with growth-reset backoff (`:20,27,218-249`); relay
  wiring at `:257-277`, `enabled` scoped to the active session because antd Tabs keeps inactive
  panes mounted (`:255-256`).
- **`hooks/useSessionRecordsWatch.ts` (127)** — SSE relay. **Zero `@agenta/*` imports.** Header
  at `:37-38` states it mirrors `web/mobile/src/features/chat/useSessionWatch.ts`.
- **`hooks/useAgentChatSession.ts` (431)** — transport + `useChat` + every conversation side
  effect, including the approval resume path (`:112-123,140,152-159,417`) and stop/kill
  (`:365-388`).
- `state/{sessionEphemera,expandState,scope,turnCaptures,fileLinks,panelLayout,rightPanel,virtualization,firstRunSeed}.ts` —
  the first two are the ones duplicated into `@agenta/chat`; the rest are desktop-only.

### 1.4 `web/mobile/src/features/{sessions,chat}` — the mobile app layer

24 files. Deps allow `@agenta/{chat,entities,shared,sdk}` and nothing else
(`web/mobile/package.json:23-26`) — no antd, no Lexical, no `@/oss`.

- `sessions/useSessionsInfinite.ts` (33) — `useInfiniteQuery`, page 30, cursor
  `{next: last.id, newest: last.updated_at ?? last.created_at}` (`:26-31`),
  `includeArchived:false` (`:21-23`), stale 30 s, **no client sort**.
- `sessions/useLivenessPoll.ts` (37) — hand-rewritten twin of desktop `state/liveness.ts` in
  react-query form; identical constants (stale 10 s `:19`, `15_000|false` `:20`, focus `:21`);
  local `livenessBySession` (`:28-37`) reading `stream.flags?.is_running` directly instead of
  the package's `deriveSessionLifecycle`. Header at `:9-11` says "mirrors the desktop pattern".
- `sessions/useActionableInteractions.ts` (48) — project-wide
  `queryInteractions({actionableOnly:true})`, `pendingCountBySession` (`:39-48`); refetch
  interval reads the **liveness cache entry cross-query** (`:27-33`).
- `chat/useSessionTranscript.ts` (88) — imports `loadSessionMessages` from `@agenta/chat/assets`
  and `revalidateSessionRecordsAtom` from `@agenta/entities/session` (`:3-4`), then hand-rolls
  the entire adoption guard: session-switch ref (`:24-25`), `refreshed` race guard (`:34,43-45`),
  `inFlight`/`pending` trailing queue (`:26-30,56-59,71-75`), never-adopt-empty (`:65`),
  foreground-only (`:55`). **Does not use `shouldAdoptServerTranscript`** (verified: zero hits
  under `web/mobile`).
- `chat/useSessionWatch.ts` (133) + `chat/watchRelay.ts` (31) — the same SSE endpoint and the
  same retry/throttle constants as desktop's `useSessionRecordsWatch`, plus badge-query
  invalidation (`useSessionWatch.ts:64-69`) and the `watchAwarePollMs` fold (`watchRelay.ts:9-15`).
- `chat/useApprovalActions.ts` (140) + `approvalTargets.ts` (20) + `steer.ts` (33) — the
  detached `/respond` answering path.
- `ChatHeader.tsx:16-21` — session title comes from its own
  `useQuery(["mobile","session-stream",…])` calling `querySessionStreams({sessionId})[0]`.
- Read-only: no rename, no archive, no kill anywhere in `web/mobile`
  (`killSession|archiveSession|setSessionHeader|deleteSession` → 0 hits). The only mutations are
  `commandSessionStream` (`StopButton.tsx:3,16`) and `respondInteraction`.

**Copy-headers:** exactly one file in the whole mobile app carries a copy-provenance header
(`web/mobile/src/middleware.ts:9-16`, a `@agenta/shared/utils/mobileGate` subset with an explicit
"delete the twins when WP2 lands"). Everything else is a *silent* re-implementation with
"mirrors the desktop" prose. That is the more dangerous kind: no marker for a future editor.

---

## 2. Duplication table

`agree?` = do the two implementations produce the same result today.

| # | Concept | Desktop | Mobile | Shared today | Agree? |
| --- | --- | --- | --- | --- | --- |
| 1 | Session-list fetch | `projectSessions.ts:26-44` — unwindowed, whole list, 60 s poll, `references:[{id:appId}]` | `useSessionsInfinite.ts:10-33` — windowed 30, cursor-paged, no poll | `querySessions` (`api.ts:280-340`) | **No.** Different windowing, different archive filter (`includeArchived` default `true` vs explicit `false`), different `references` scoping. |
| 2 | Last-activity key | `activity()` `projectSessions.ts:66-70` = `Date.parse(updated_at ?? created_at)`; `sessionActivity()` `sessions.ts:185` = `lastMessageAt ?? createdAt ?? 0` | `useSessionsInfinite.ts:29` `last.updated_at ?? last.created_at`; `SessionRow.tsx:35` same | none | Yes semantically, **3 copies** of the same expression. |
| 3 | List ordering | client sort `projectSessions.ts:59` **over the merged local+server model** `sessions.ts:189-194` | none — trusts the server | server `coalesce(updated_at, created_at) DESC, id DESC` (`api/oss/src/dbs/postgres/sessions/streams/dao.py:158-178`) | Yes on the server rows. Desktop's sort is **not** redundant — see §5.1. |
| 4 | localStorage fold + reconciliation | `reconcileServerSessionsAtomFamily` `sessions.ts:429-505` (5 stores, husk model, `Math.max` activity merge `:447-448`) | **none** — pure server pages | none | N/A — mobile has no offline model. |
| 5 | Liveness poll | `state/liveness.ts:29-45`, jotai `atomWithQuery` | `useLivenessPoll.ts:12-23`, react-query | `deriveStreamNest`/`deriveSessionLifecycle` (`core/liveness.ts`) | Constants identical; **desktop derives a lifecycle, mobile reads `flags.is_running` raw** (`useLivenessPoll.ts:34`). Diverges for the parked/zombie cases the lifecycle refinement exists to handle. |
| 6 | Transcript replay | `loadSessionMessages` (`oss/.../assets/loadSession.ts`) | `loadSessionMessages` (`@agenta/chat/assets`) | package copy exists, OSS doesn't import it | 27 lines of drift. |
| 7 | Adoption guard | `shouldAdoptServerTranscript` via `useSessionHydration.ts:86-92` | hand-rolled in `useSessionTranscript.ts:24-30,43-45,65` | `core/transcriptAdoption.ts:28-47` | **No.** Mobile's guard has no record-watermark rule at all. |
| 8 | Records revalidation | `revalidateSessionRecordsAtom` (`useAgentChatSession.ts:165-169`, `useSessionHydration.ts:261-271`) | `revalidateSessionRecordsAtom` (`useSessionTranscript.ts:61-62`) | `state/records.ts` | **Yes** — the one clean case. |
| 9 | Watch relay (SSE) | `useSessionRecordsWatch.ts` (127) | `useSessionWatch.ts` (133) + `watchRelay.ts` (31) | none | Same endpoint, same 3 s throttle, same 1 s→30 s jittered backoff, same visibility rule, same auth-refresh-then-reopen. Mobile adds badge invalidation + poll folding. **Two files, one contract.** |
| 10 | Approval answering | re-invoke: `addToolApprovalResponse` → `sendAutomaticallyWhen`/`agentShouldResumeAfterApproval` → `AgentChatTransport` → `POST {serviceUrl}/invoke` (`useAgentChatSession.ts:112-123,152-159`; `AgentConversation.tsx:323-339`) | `respondInteraction` → `POST /sessions/interactions/{id}/respond` (`useApprovalActions.ts:97-101`) | `respondInteraction` exists in the package and desktop uses it only in `SessionInspector/api.ts:132` | **No — genuinely different, and both are correct for their caller.** §5.2. |
| 11 | Pending-approval detection | 3 detectors: `getPendingApprovals` (`components/ApprovalDock.tsx:35-47`), `getPendingConnectInteraction` (`components/InteractionDock.tsx:41-53`), `isHitlPending` (`@agenta/playground`, via `useAgentChatQueue.ts:76`) | 2 detectors: `getPendingApprovals` (`@agenta/chat/model/approvals.ts:29-41`) for the dock, `pendingCountBySession` (`useActionableInteractions.ts:39-48`) for the badge | `@agenta/chat/model/approvals.ts` | **No.** Transcript-derived (last assistant message only) vs interactions-table-derived (all actionable rows, no `kind` filter). They disagree for elicitation rows: list badges, dock can't answer. |
| 12 | Session title | `sessionLabel` (`sessions.ts:808-817`) title → first user text → `Chat N`; rename/auto-title write `setSessionHeader` (`:593,621`) | `session.name ?? "Untitled session"` (`SessionRow.tsx:41`); chat header re-queries the row (`ChatHeader.tsx:16-21,31`) | `setSessionHeader` (`api.ts:~380`) | **No.** Mobile has no fallback chain and no rename. |
| 13 | Archive / delete / kill | `sessions.ts:333-405` + `killSession` (`SessionHistoryMenu.tsx:69`, `useAgentChatSession.ts:371`) | absent | remotes all in the package | N/A — mobile parity gap, not a duplication. |
| 14 | Stop (cooperative cancel) | `commandSessionStream` (`useAgentChatSession.ts:387`) | `commandSessionStream` (`StopButton.tsx:16`) | `api.ts:398-421` | **Yes.** |
| 15 | Query-key namespaces | `["session-list",…]`, `["session-liveness",…]` (jotai) | `["mobile","sessions"…]`, `["mobile","session-liveness"…]`, `["mobile","actionable-interactions"…]`, `["mobile","session-stream"…]` | `sessionRecordsQueryKey`/`sessionMountsQueryKey` only | **No.** This is why `useSessionWatch.ts:64-68` must invalidate react-query keys *and* set a jotai atom. |
| 16 | Message persistence + watermark | `sessions.ts:139-159,667-692,725-749` | none (read-only) | `@agenta/chat/state/sessionMessages.ts` — same localStorage key, drifted | **No** — see §1.2. Latent, becomes live on adoption. |

Net: **rows 2, 5, 6, 7, 9, 11, 15 are true duplication.** Rows 1, 3, 10, 12 are *divergence*
(deliberate or accidental — resolved in §5). Rows 4, 13 are asymmetry, not duplication. Row 8
is the model to copy. Row 16 is a latent defect the consolidation must fix on the way through.

---

## 3. Structural recommendation

### Verdict: **no new package.** Extend `@agenta/entities/session`, and put conversation-level orchestration in `@agenta/chat`.

A new `@agenta/sessions` would have to sit between `entities` and `chat` in the hierarchy
`shared ← ui ← entities ← entity-ui ← playground ← playground-ui`
(`web/AGENTS.md:444-445`; `@agenta/chat` depends on `entities`, `playground`, `shared` —
`web/packages/agenta-chat/package.json:29-33`). Everything it would contain either:

- depends on `session/core/schema.ts` types and `session/api/*` accessors → it would import
  `@agenta/entities`, so it must sit **above** entities; or
- is consumed by `@agenta/chat` → it must sit **below** chat.

That is exactly the slot `@agenta/entities/session` already occupies. Creating a package to
hold code that imports entities and is imported by chat buys one thing (a name) and costs four:
a fifth workspace package to build/lint/typecheck, a new `transpilePackages` entry in two
next.configs, a split of nine already-passing session test files across two suites, and a fresh
boundary argument on every future file ("entities/session or sessions?"). The upstream signal
is unambiguous: `transcriptAdoption.ts` was placed in `entities/session/core` this release, and
desktop imports it from there.

**Where the real split already is, and should stay:**

| Layer | Package | Owns | Test suite |
| --- | --- | --- | --- |
| Data | `@agenta/entities/session` | Fern accessors, zod schemas, pure derivations, shared query caches + revalidate atoms, query-key factories | `agenta-entities` unit (~934) |
| Conversation | `@agenta/chat` | Transcript model, view-models, transport, headless hooks, skin registry — everything that needs `ai`/`@ai-sdk/react` as a peer | `agenta-chat` (207) |
| App | `web/oss`, `web/mobile` | Rendering, layout, virtualization, scroll, routing, per-app query-client wiring | oss tsc gate; mobile (83) |

The rule that keeps them apart: **`@agenta/entities/session` never imports `ai`.**
`@agenta/chat` already declares `ai` and `@ai-sdk/react` as peers
(`agenta-chat/package.json:34-39`). Anything that touches `UIMessage` is chat, not entities.
That is a mechanical test a reviewer can apply without judgement.

### The one new subpath: `@agenta/entities/session` gains a `state/list.ts` and a `hooks/` seam

Two things in the inventory have no home under the current split:

- the **list model** (fetch + windowing + activity key + ordering) — pure data, belongs in
  entities `state/`;
- the **SSE watch relay** — a React hook with a DOM `EventSource` and no `ai` dependency. It
  belongs in entities too, but entities currently has no React-hook precedent in `session/`.
  `session/state/*` is jotai atoms, not hooks. I'd add `session/hooks/useSessionWatch.ts` and a
  `"./session/hooks"` export rather than force a hook into `state/`.

`@agenta/entities` is not React-free (it ships jotai atoms and molecules), so a hook is not a
boundary violation — but it is a new shape for this domain and worth calling out in review.

### The boundary — what does NOT go into the shared layer

A package without a stated exclusion list becomes a dumping ground. Excluded, permanently:

1. **Anything that renders.** No antd, no shadcn, no Lexical, no `react-virtuoso`. Mobile cannot
   import antd; desktop will not import shadcn until the migration lands.
2. **Virtualization and scroll engineering.** `useVirtuosoTranscript.tsx`, `useTranscriptScroll.ts`,
   `useScrollIntent.ts`, `state/virtualization.ts`, `virtuosoState.ts` (desktop);
   `useTranscriptAutoScroll.ts`, `useSessionListScrollRestore.ts` (mobile). These encode
   completely different scrollers with different correctness conditions.
3. **Panel/layout/tab state.** `state/panelLayout.ts`, `state/rightPanel.ts`, and the whole
   open-tabs model in `sessions.ts:123-135,206-213` — antd `Tabs` semantics (inactive panes stay
   mounted, `useSessionHydration.ts:255-256`) are a desktop fact. Mobile is one session per route.
4. **The scope-key concept.** `state/scope.tsx` + `defaultScopeKeyAtom` (`sessions.ts:76-84`,
   which reads `window.location.pathname` with an `/apps/:id` regex) is a desktop routing
   artifact. Mobile scopes by `projectId` from the route.
5. **The localStorage session cache** (`agenta:agent-chat:*`). Mobile has no offline session
   model and does not want one. The *reconciler shape* can be shared as a pure function; the
   five `atomWithStorage` stores stay in `web/oss`.
6. **App-specific query-client policy.** Mobile sets `refetchOnWindowFocus:false` globally
   (`web/mobile/src/lib/queryClient.ts:7-8`) and each hook opts back in; desktop uses jotai
   `atomWithQuery` against a different client. Shared code exposes **query options factories**,
   never mounted queries — the caller decides jotai vs react-query, priority, and focus policy.
7. **Auth.** Desktop uses `supertokens-auth-react` (`useSessionRecordsWatch.ts:3`), mobile
   `supertokens-web-js` via `@/lib/auth`. A shared watch hook takes an
   `onAuthRetry?: () => Promise<unknown>` option; it never imports supertokens.
8. **Onboarding/first-run, drawer scopes, turn inspector, file links** — desktop product
   surfaces with no mobile counterpart.

Positive form of the same rule, borrowed from `@agenta/chat`'s proven shape: **the shared layer
never branches on "desktop" or "mobile".** If a function needs to know which app called it, the
difference is an option the caller passes, or the code is in the wrong layer.

---

## 4. Migration plan

Ordered so desktop never breaks and each step is independently reviewable. "Touches `web/oss`?"
is the column that matters for conflict risk — see §6.

Standing gates for every step:

```bash
cd web/packages/agenta-entities && pnpm run check && pnpm run test:unit   # ~934
cd web/packages/agenta-chat     && pnpm run check && pnpm run test:unit   # 207
cd web/packages/agenta-shared   && pnpm run test:unit                     # 330
cd web/mobile                   && pnpm run types:check && pnpm test      # 83
cd web && pnpm --filter @agenta/oss exec tsc                              # signature diff, not count
cd api && py-run-tests                                                    # sessions 238
```

The oss gate is a **signature diff**, never an error count — the count fluctuates with cache
state (`feedback_tsc_count_gate_masks_new_errors`). Gate on "no error mentions a symbol this
step touched".

| # | Step | Moves | Call sites become | Proof | Touches `web/oss`? | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| **S0** | Fix the drifted twin **before** anything else | Re-align `@agenta/chat/state/sessionMessages.ts` to `sessions.ts` byte-parity: pass `tabLocalStorage()` (port the `subscribe`-stripping storage), and either add the record-count watermark store or make the writer refuse to write the shared key without one | nothing changes (no consumer) | new `agenta-chat` unit test: writing through the package leaves `agenta:agent-chat:record-counts` consistent with the OSS reader's expectation | **No** | revert one file |
| **S1** | Activity key + ordering, one definition | New `session/core/ordering.ts`: `sessionActivityMs(stream)` (= `Date.parse(updated_at ?? created_at)`, NaN→0), `compareByActivityDesc`, `dedupeBySessionId` | `projectSessions.ts:55-70` imports them; `useSessionsInfinite.ts:29` and `SessionRow.tsx:35` import `sessionActivityMs` | entities unit tests over the three current behaviours (NaN, missing `updated_at`, dedupe tie) | yes, ~15 lines in one file | revert; the local copies are 5 lines each |
| **S2** | Shared list query **options** | `session/state/list.ts`: `sessionListQueryKey(projectId, {references, search, windowing})` + `sessionListQueryOptions(...)` returning `{queryKey, queryFn, staleTime}` — **not** a mounted query | `projectSessionsQueryAtomFamily` wraps it in `atomWithQuery`; `useSessionsInfinite` wraps it in `useInfiniteQuery` | key-shape unit test; mobile 83 unchanged; oss tsc | yes, `projectSessions.ts` only | revert; both call sites keep working with inline options |
| **S3** | Liveness derivation parity | nothing moves — mobile switches `useLivenessPoll.ts:28-37` from raw `flags.is_running` to `deriveStreamNest`/`deriveSessionLifecycle` | mobile badge map derived, not read | mobile `livenessBadge.test.ts` extended with a parked/zombie fixture; entities `session-liveness` already covers the derivation | **No** | revert one file |
| **S4** | Shared watch relay | New `session/hooks/useSessionWatch.ts` + `session/core/watchRelay.ts` (URL builder, `MIN_INTERVAL_MS`, jittered backoff, `watchAwarePollMs`). Options: `{sessionId, projectId, enabled, apiUrl, onRecordsChanged, onLifecycle?, onInteraction?, onAuthRetry?}` | `useSessionRecordsWatch.ts` → thin desktop wrapper passing `Session.attemptRefreshingSession`; `useSessionWatch.ts` → thin mobile wrapper passing `tryRefreshSession` + the two badge invalidations | port `web/mobile/tests/unit/watchRelay.test.ts` into `agenta-entities/tests/unit`; both apps' wrappers typecheck | yes, one hook replaced by a wrapper | revert; both hooks are self-contained |
| **S5** | Adoption guard parity | nothing moves — mobile's `useSessionTranscript.ts` adopts `shouldAdoptServerTranscript`; the trailing-refresh queue (`:26-30,56-59`) stays mobile-local for now | mobile gains the record-watermark rule | new mobile unit test for the guard call; entities `session-transcript-adoption` already covers the rule table | **No** | revert one file |
| **S6** | Transcript replay, one copy | Delete `web/oss/.../assets/loadSession.ts` + `transcriptToMessages.ts`; OSS imports `@agenta/chat/assets` | `useSessionHydration.ts:9` and callers re-point | **This is the WP3a "desktop re-plumb" step.** Diff the 27+57 drifted lines first and decide each one; `agenta-chat` fixture tests (207) are the regression net; live smoke on a session with tools + an approval + attachments | **yes, materially** | revert the import swap; the OSS files come back from git |
| **S7** | Pending-approval, one definition | `session/core/pendingApprovals.ts`: `actionableRowsToPending(rows)` alongside chat's transcript-derived `getPendingApprovals`, plus a documented reconciliation rule (which wins when they disagree) | desktop's three detectors and mobile's two collapse to two named functions with one stated precedence | unit tests for the disagreement cases (elicitation row present, transcript tail stale) | yes | revert |
| **S8** | Answer-an-interaction, one entry point | `@agenta/chat` gains `useInteractionAnswer({strategy})` wrapping target selection (`approvalTargets.ts`), the stale re-read, 409 handling, and the settle state machine; strategy `"detached-respond"` \| `"resume-invoke"` injected by the caller | mobile passes `detached-respond`; desktop passes `resume-invoke` and keeps its transport | mobile 83 + the new hook's tests; desktop live smoke on approve / deny / approve-all | yes | revert; mobile's `useApprovalActions` is intact underneath |
| **S9** | Session title + list-row model | `session/core/sessionLabel.ts` (title → first user text → `Chat N`); mobile gains rename via `setSessionHeader` if wanted | both apps share the fallback chain | entities unit test | yes | revert |
| **S10** | Optional, only if desired | Lift the reconciler as a **pure** function `reconcileSessions(local, remote)` into `session/core/reconcile.ts`; the jotai stores stay in `web/oss` | `sessions.ts:429-505` becomes store-plumbing around a pure call | the merge rules (`:443-455`) get a real unit test they don't have today | yes, the biggest single oss diff | revert |

**Steps that need no `web/oss` change at all: S0, S3, S5.** Land those first — they are pure
mobile/package work and cannot conflict with the FE PR queue.

**Steps S1–S2, S4, S7–S9 are small, surgical oss diffs** (one file each, mostly import swaps).
**S6 and S10 are the real re-plumb** and should be their own PR, sequenced last.

---

## 5. The three called-out decisions

### 5.1 Ordering — server-side wins for the fetch; the client sort stays, but for a different reason

The server already orders **both** paths. Windowed:
`api/oss/src/dbs/postgres/sessions/streams/dao.py:156-166` (`apply_windowing(attribute="updated_at",
order="descending")`); unwindowed — the branch desktop hits, since `projectSessions.ts` passes no
`limit`/`next`/`newest` and `querySessions` only attaches `windowing` when a caller opts in
(`api.ts:299-302`) — `dao.py:174-178`:

```python
stmt = stmt.order_by(
    func.coalesce(SessionStreamDBE.updated_at, SessionStreamDBE.created_at).desc(),
    SessionStreamDBE.id.desc(),
)
```

Desktop's own comment says as much (`projectSessions.ts:63-65`: "belt-and-suspenders"). But the
sort at `projectSessions.ts:59` is **not** the sort that orders the desktop sidebar. The sidebar
reads `sessionHistoryAtomFamily` (`sessions.ts:189-194`), which sorts the **merged** model —
local-optimistic rows included. `bumpSessionActivityAtomFamily` stamps `Date.now()` on the
`streaming → settled` transition (`sessions.ts:634-644`) and the reconciler keeps
`Math.max(local, remote)` (`sessions.ts:447-448`). That is what makes a just-finished turn jump
to the top inside the 60 s poll window, before the server row's `updated_at` is refetched.

**Recommendation:**

- The **server ordering is canonical** and both clients must consume the server order as-is. Do
  not sort server pages client-side — for mobile that would be actively wrong, since sorting a
  cursor-paged list breaks the cursor invariant.
- Delete the sort at `projectSessions.ts:59`; keep the dedup (a real need — two rows can share a
  `session_id`), which needs `activity()` regardless.
- Keep `sessions.ts:189-194`. Rename it in review to say what it is: **merge ordering over the
  optimistic local layer**, not list ordering. It is not a second implementation of the server's
  order; it is the price of having an offline cache. If desktop ever drops the localStorage
  cache, this sort goes with it.
- Move the one shared expression (`updated_at ?? created_at → epoch ms`) into
  `session/core/ordering.ts` (S1). Three copies today: `projectSessions.ts:66-70`,
  `useSessionsInfinite.ts:29`, `SessionRow.tsx:35` — plus `sessions.ts:185` on the *local* model,
  which stays separate because its input type is different.
- **Also fix the windowing asymmetry (not strictly ordering, but the same call).** Desktop
  fetches the entire unwindowed session list with `include_ended` and `include_archived` both
  `true`, every 60 s. For a workspace with thousands of sessions that is the scaling cliff of
  this whole feature. Mobile already paginates. I did not measure the payload — **what would
  settle it: a `querySessions` response size and duration on a large EE project.**

### 5.2 Approval answering — the premise "only one binds warm" is not what the evidence says

Both paths bind warm. The evidence:

- **Desktop re-invoke** — `POST {serviceUrl}/invoke` with the full history carrying the
  `{approved, interactionToken}` envelope; runner finds the parked match and calls
  `respondPermission("once"|"reject")` on the **same warm sandbox**
  (`docs/design/agenta-mobile/plans/2026-07-27-mobile-approvals-steering.md:70-83`).
- **Detached `/respond`** — CAS `pending → responded`, then a taskiq worker rebuilds the request
  and fires a detached invoke (`…steering.md:93-100`). The dispatcher was **deliberately given
  fingerprint parity so mobile answers warm-resume** (`…steering.md:452-456`), and the live
  measurement table (`…steering.md:457-465`) labels the respond-dispatcher arm `warm`.

What actually differs — and it is sharper than warm/cold:

| | desktop re-invoke | detached `/respond` |
| --- | --- | --- |
| What the client must hold | invocation URL + full `UIMessage[]` history + hydrated `workflowMolecule` (`buildAgentRequest`, `@agenta/playground`) | interaction `id` + `projectId` only |
| Exactly-once | **none at answer time.** The row is transitioned by the *runner* after resume (`…steering.md:83`). Two clients answering concurrently both fire an invoke | CAS at the endpoint; second answer is a `409`, surfaced as `isInteractionConflict` (`api.ts:172-174`) |
| Who holds the token stream | the answering client — live tokens render immediately | nobody; the answerer learns the outcome from records/watch |
| Config on resume | client sends `data.parameters` inline, draft-aware (`agentRequest.ts:353-372`) — correct even for a dirty draft | server replays the gate's stamped `data.parameters` (`…2026-07-29-effective-turn-config.md:1-20`) — correct as of this branch, degrades to reference-hydration for pre-stamp rows |
| Failure mode if misused | a client that cannot reproduce the exact history gets `approval-mismatch (history) → evict + cold`, and the row **stays pending** (`web/mobile/src/features/chat/useApprovalActions.ts:40-42`; mirrored `api.ts:181-184`) | none of that class |
| Steer / deny-with-note | delivered (desktop sends the note as its own turn, `AgentConversation.tsx:337`) | **dropped on the warm path** — `run-turn.ts` `if (opts.resume)` never calls `session.prompt`; measured (`…steering.md:462`), tracked as #5444 |

**Recommendation: `/respond` is the default and the only *durable* answer path; the re-invoke
is a live-attached fast path, and both go through one entry point (S8).**

Concretely: `useInteractionAnswer({strategy})` in `@agenta/chat` owns everything that is the
same — target selection (`approvalTargets.ts`, including the `token` vs `id` trap documented at
`approvalTargets.ts:6-12`), the pre-answer staleness re-read, 409 tolerance, the
`idle → resuming → idle` settle with the 60 s re-arm. The strategy is the injected difference.
Desktop keeps `resume-invoke` **only while it is the current stream holder** (live gate present,
status streaming/awaiting); a reload-restored cold tail should use `detached-respond` like
mobile, because that is exactly the case where desktop cannot guarantee history fidelity either.

Two things I could not verify and that should be tested before S8 lands:

- **Does a desktop re-invoke race a mobile `/respond` on the same gate?** The desktop path has no
  client-side CAS. *Settles it:* answer one gate from both clients within a second and inspect
  the interactions row + runner log for a double dispatch.
- **Does `/respond` produce a live stream a desktop tab could attach to?** If not, moving desktop
  wholesale to `/respond` would regress perceived latency on approve. *Settles it:* answer via
  `/respond` from a desktop tab with the chat open and time first-token-repaint vs the re-invoke
  path.

### 5.3 The two watch relays — one shared hook, options for the rest

`web/oss/.../useSessionRecordsWatch.ts` (127) and `web/mobile/.../useSessionWatch.ts` (133) +
`watchRelay.ts` (31) are the same protocol implementation twice: same endpoint
(`/sessions/streams/watch?session_id=…&project_id=…`), same `withCredentials`, same 3 s
connect-revalidation throttle, same 1 s→30 s jittered backoff, same
`visibilitychange`-close/reopen, same "only a fatal `CLOSED` retries; refresh auth first, since
the usual cause is a 401 at the token boundary". Desktop's own header says so
(`useSessionRecordsWatch.ts:37-38`).

Differences that become **options**, not forks:

| Difference | Option |
| --- | --- |
| desktop `supertokens-auth-react` vs mobile `supertokens-web-js` | `onAuthRetry?: () => Promise<unknown>` |
| desktop `getAgentaApiUrl()` vs mobile `getApiUrl()` | `apiUrl: string` |
| mobile invalidates `livenessQueryKey`/`actionableInteractionsQueryKey`; desktop invalidates nothing | `onLifecycle?`, `onInteraction?` callbacks |
| mobile folds cadence via `watchAwarePollMs`; desktop's poll is in `useSessionHydration` | export `watchAwarePollMs` as a pure helper; neither app's polling moves |
| desktop's `enabled` is scoped to the *active* tab (antd Tabs keeps panes mounted) | already an `enabled` prop |

`web/mobile/tests/unit/watchRelay.test.ts` becomes the package's test — the pure helpers are
already extracted on the mobile side, which makes this the cheapest high-value step in the plan.

---

## 6. Risk and sequencing

### Context

- This branch is 119 commits ahead of `release/v0.106.2` and has no PR yet.
- The FE PR queue is deep (tsc-cleanup #5464, DrillIn dedup/migration, sessions #5486/#5500,
  attachments/voice #5458/#5459, cancel-steer, batch-approvals #5470 — most of them touching
  `web/oss/src/components/AgentChatSlice`).
- A local antd→shadcn migration branch is in flight against the presentational set.
- Work has twice been stopped for touching OSS agent chat.
- WP3a already recorded the sequencing rule
  (`docs/design/agenta-mobile/plans/2026-07-12-wp3a-chat-headless-core.md:15-17`): the re-plumb
  lands "after the FE PR queue drains and the shadcn branch lands".

### Recommended order

**Wave 0 — now, alongside the current PR.** S0, S3, S5. Zero `web/oss` files. S0 in particular
is a latent-defect fix that should not wait for anything: a package that writes
`agenta:agent-chat:messages` without the watermark, with cross-tab `subscribe` re-enabled, is a
loaded gun pointed at the desktop chat the moment S6 lands.

**Wave 1 — after this branch's PR merges.** S1, S2, S4, S7. Each is one small oss diff (an
import swap or a deleted local helper). Land them as four separate PRs, not one — they touch
different files and a reviewer can approve each in minutes.

**Wave 2 — after the FE queue drains AND the shadcn branch lands.** S6, S8, S9, S10. This is the
WP3a desktop re-plumb, and it deletes OSS copies wholesale.

### Conflict surface per step

| Step | oss files touched | Conflict risk |
| --- | --- | --- |
| S0, S3, S5 | 0 | **none** |
| S1 | `projectSessions.ts` (~15 lines) | low — small file, few open PRs touch it |
| S2 | `projectSessions.ts` | low, but **serialize with S1** (same file) |
| S4 | `hooks/useSessionRecordsWatch.ts` (whole file → wrapper) | low — the file is new on this branch (`git status` shows it added) and has few other editors |
| S7 | `components/ApprovalDock.tsx`, `components/InteractionDock.tsx`, `hooks/useAgentChatQueue.ts` | **medium-high** — #5470 (batch approvals) and the friendly-approvals work both live here |
| S8 | `AgentConversation.tsx`, `hooks/useAgentChatSession.ts` | **high** — `AgentConversation.tsx` is the most-contended file in the repo; cancel-steer, elicitation-resume and approval-batch branches all edit it |
| S9 | `state/sessions.ts` | medium |
| S6 | `assets/loadSession.ts`, `assets/transcriptToMessages.ts` + every importer | **high**, and it is a semantic merge (57 drifted lines) not a textual one |
| S10 | `state/sessions.ts` (~75 lines) | medium-high |

### What must wait for the antd→shadcn branch

Strictly speaking, **nothing in this plan renders**, so none of S0–S10 has a hard shadcn
dependency. But two have a soft one:

- **S6** deletes OSS transcript-building code whose output feeds `AgentMessage.tsx`,
  `ToolActivity.tsx`, `ApprovalDock.tsx` — the exact components the shadcn migration is
  rewriting. Landing S6 first means the shadcn branch rebases onto a changed data source;
  landing it second means one rebase of S6. Second is cheaper.
- **S8** touches `ApprovalDock.tsx`'s call site. Same argument.

S7's *pure* half (the `core/pendingApprovals.ts` function + tests) can land in Wave 1; only the
call-site swap needs to wait.

### Top 3 risks

1. **S6/S8 land into a contended file and get reverted.** `AgentConversation.tsx` and the
   `assets/` transcript pair are edited by at least four in-flight branches. *Mitigation:* Wave 2
   only, one PR per step, and a pre-flight `git log --oneline <base>..<each-open-branch> --
   web/oss/src/components/AgentChatSlice` to see who else is in the file that week.
2. **The `sessionMessages.ts` twin silently corrupts a desktop transcript.** Same localStorage
   key, no watermark, cross-tab subscribe re-enabled — the exact hazard `sessions.ts:102-106`
   was written to prevent. Today it is dormant only because no app mounts both. *Mitigation:*
   S0, in Wave 0, before anything else.
3. **Consolidating approvals flattens a difference that is load-bearing.** The re-invoke and
   `/respond` paths differ in exactly-once semantics, stream ownership, config source **and**
   steer delivery (§5.2). A single "just use `/respond`" would regress live desktop latency and
   silently drop deny-with-note on the warm path (measured, `…steering.md:462`). *Mitigation:*
   S8 shares the *orchestration* and keeps the strategy injectable; run the two verification
   tests in §5.2 before choosing a desktop default.

Runner-up risk worth naming: session-id-keyed `atomFamily` instances are never `.remove()`d
except `expandedValueAtomFamily` (`state/expandState.ts:65-66`). Every shared atom family this
plan adds inherits that leak. Give each new family a documented eviction call site or don't add
it.

---

## 7. Open questions

| # | Question | What would settle it |
| --- | --- | --- |
| Q1 | Should desktop paginate the session list like mobile? | Measure `querySessions` payload size + duration on a large EE project. |
| Q2 | Does a desktop re-invoke race a mobile `/respond` on the same gate? | Answer one gate from both clients within a second; inspect the interactions row and the runner dispatch log. |
| Q3 | Can a desktop tab attach to the stream a `/respond` resume produces? | Answer via `/respond` with the desktop chat open; time first-token repaint against the re-invoke path. |
| Q4 | Is a React hook acceptable inside `@agenta/entities/session` (S4)? | Reviewer call. `entities` already ships jotai atoms; a hook is new for this domain but not for the package. |
| Q5 | When two pending-approval detectors disagree (elicitation row badges the list, dock can't answer it), which is authoritative? | Product decision, needed before S7 can state a precedence rule. |
| Q6 | Which of the 57 drifted lines in `transcriptToMessages.ts` are fixes and which are regressions? | Line-by-line diff review during S6 — I did not read them. |
