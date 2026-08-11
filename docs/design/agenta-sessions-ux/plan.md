# Sessions UX: Home + Sessions page (iteration 1)

Status: **implemented** by the sessions-ux PR stack (packages plan:
`docs/design/sessions-packages/plan.md`). Kept for the rationale; the "state of the
world" sections below describe the codebase BEFORE this work.

Sources: Mahmoud's wireframe walkthrough (Slack `C0BBU3T45S5`, thread `1785431787.847539`,
2026-07-30) and the 30-reply thread that followed. The clickable mockup
(`claude.ai/code/artifact/9648bfdb-…`) is **not readable from this environment** — it is served
as a public/non-member artifact. Everything below is grounded in the transcript, the thread
screenshots, and the code. Re-check the layout details against the mockup before building.

## The problem, in Mahmoud's words

> "All my work is with agents … the sessions are the tasks I do, are the work. There is no way for
> me to quickly go to the latest session, to group, to filter, to organize my sessions."

> "There is no way for me to start a new task quite easily. The main action is creating a new agent,
> which is something I don't do every day."

Two failures: the daily-use object (a session) has no home, and the primary action (start a task)
is buried behind the rare action (create an agent).

## Decided

From the thread and follow-up:

| Decision | Source |
| --- | --- |
| Iteration 1 = **Home + Sessions only**. No chrome cleanup (theme toggle, version, menu merge), no analytics page, no agents-page redesign, no automations page. | Arda, reply 19; confirmed |
| Pins are **first-class**, on Home *and* in the sidebar. Not mentioned in the video, but the wireframe shows them and both Arda and Mahmoud use them daily. | Arda reply 13, Mahmoud reply 15 |
| Pins are **local-first**, server-persisted in a second checkpoint. The cost isn't storing them, it's reconciling lists across devices. Build behind a port so the implementation swaps. | Arda 25/27/28, Mahmoud 29 |
| Home shows **what already ran**, not what will run. "Things that have been completed have much more value than things that'll run in future." | Arda reply 13 |
| Triggered sessions are **not** "my sessions" — hidden from the sessions list by default, shown on Home as automation activity. | Arda 13, Mahmoud 18 |
| Clicking a session **deep-links into the playground** — same UI, not a new chat surface. | Mahmoud ~4:24; confirmed |
| Sessions view iteration 1 = **list + filters + pins + row actions**. No board, no grouping, no sort controls, no saved views. | Confirmed |
| Home = **rework `/apps` in place**, keeping the onboarding branch. | Confirmed |
| Automations section = **trigger deliveries** (zero backend work) now, with the proper backend origin-stamp landing immediately after. | Confirmed |
| Mahmoud's "collapse Chat/Build into a show-hide config toggle" is **out of scope** for iteration 1. | Mahmoud ~4:38, explicitly "let's not do everything at the same time" |

## Current state

### What the backend already gives us

`POST /sessions/query` (`api/oss/src/apis/fastapi/sessions/router.py:1636`) returns the durable
project session list. Filters: `references` (agent scoping, GIN-joined through the turns'
references), `search` (case-insensitive title match on `session_streams.name`), `include_ended`,
`include_archived`, and `windowing` (activity-ordered cursor pagination on
`coalesce(updated_at, created_at)`).

Each row (`SessionListItem`, `api/oss/src/core/sessions/dtos.py`) carries: `session_id`, `name`
title, `description`, liveness `flags` (alive ⊇ running ⊇ attached), `created_at`/`updated_at`,
`deleted_at` (= ended, still resumable), `archived_at` (= hidden, restorable), and `references`
(the latest turn's agent — the agent-attribution source for a row label).

`session_streams` (`api/oss/src/dbs/postgres/sessions/streams/dbes.py`) already composes
`TagsDBA`, `MetaDBA` and `FlagsDBA` with a GIN index on `flags`. **Pins, tags and an origin marker
need no migration** — only write paths and query filters.

`POST /sessions/interactions/query` with `actionable_only: true` and no `session_id` returns every
pending HITL request in the project in one call — a complete, unpaginated "waiting on you" index.
Mobile already uses exactly this (`web/mobile/src/features/sessions/useActionableInteractions.ts`).

`POST /triggers/deliveries/query` (`router.py:430`) returns one row per fired subscription or
schedule with `status`, `result`, `error` and `windowing` support, and there is already a frontend
client (`queryTriggerDeliveries` in `@agenta/entities/gatewayTrigger`). This is the automations
source for iteration 1.

There is also a **live SSE channel**, `GET /sessions/streams/watch` (`router.py:539`), emitting
change notifications only (`records-changed`, `lifecycle`, `interaction`) which the client
revalidates against the normal query endpoints. Not modelled by Fern — consumed with a native
`EventSource`; `useSessionRecordsWatch` (oss) and `useSessionWatch` (mobile) already do.

**It is per-session** — the Redis channel is `watch:{project_id}:session:{session_id}`, one pubsub
connection per SSE connection. So a project-wide list cannot subscribe to it without opening one
`EventSource` per row, which is not viable. **The sessions list polls; an open session gets live
updates for free.** A project-scoped watch channel is the proper fix and belongs in checkpoint 2.

### What the frontend already has

- `querySessions` wrapper + zod boundary in `@agenta/entities/session`.
- `projectSessionsQueryAtomFamily(appId)` (`web/oss/src/components/AgentChatSlice/state/projectSessions.ts`)
  — but it is **agent-scoped and disabled without a UUID appId**, so it is not the project-wide list.
- Mobile's session list layer is the closest thing to what we need and is already built and
  live-verified: `useSessionsInfinite`, `useLivenessPoll`, `useActionableInteractions`,
  `pendingFilter`, `mergeSessionRows`. It is app-local under `web/mobile/src/features/sessions/`.
- Session mutations exist: rename (`setSessionHeader`, server-backed), archive/unarchive, delete —
  see `sessions.ts` atom families and `@agenta/entities/session/api`.
- `adoptSessionAtomFamily(scopeKey)` already exists for "open a session I don't know locally",
  written for deep links.
- The sidebar has a dynamic-children registry designed for exactly this
  (`web/oss/src/components/Sidebar/dynamic/registry.ts`: *"Add a new dynamic entity by appending
  one entry here. Nothing else."*).

### Gaps

1. **No project-wide session list atom.** The only list query is agent-scoped.
2. **No session deep-link.** The `?session=` param (`web/oss/src/state/url/session.ts`) is
   observability's trace drawer — unrelated to agent chat sessions. Opening a session from
   elsewhere does not exist.
3. **No origin marker — and this is a correctness problem, not a nicety.** An automation run IS
   a session: every run resolves a session id (`resolveRunSessionId`, `services/runner/src/protocol.ts`)
   and the runner heartbeats it. So automation runs already sit in the session list,
   indistinguishable from a human's own work — the opposite of what both Mahmoud and Arda asked
   for. Separately, the delivery row does not record which session it produced: on the *detached*
   dispatch path, which is the one wired at every composition site, it stores only a `run_id`
   (an API-minted uuid unrelated to the session). The attached path stores `trace_id`, which
   `session_turns.trace_id` could join — but that path isn't live.
4. **No server-side status or tag filter**, and no tag write path (only `setSessionStreamHeader`
   for name/description).
5. **Sessions logic is forked three ways** — `web/oss` `AgentChatSlice/state`, `web/mobile`
   `features/sessions`, `@agenta/entities/session`. Wave 1 of
   `docs/design/agenta-sessions-consolidation/plan.md` already schedules the shared list-query
   options and the shared pending-approval definition. This work should land *as* that wave, not
   alongside it.

## The governing rule

**The server owns membership and ordering; the client only decorates.** A predicate that cannot be
expressed as a server filter is not a filter yet.

Filtering a cursor page client-side filters *the window*, not *the set*: counts are wrong, empty
states are wrong ("no results" on page 1 while page 7 has fifty), and infinite scroll yields jagged
pages. The same rule is why board and grouping cannot be added "for free" later — a group's
membership is unknown until the last page, so each column needs its own cursor, which needs its
group key to be an indexed server filter first.

Three mechanisms satisfy the rule, in order of preference:

1. **A column on the row.** Cheapest and always correct.
2. **ID-set pushdown.** For a predicate living outside the row — a client-held set (pins) or a
   foreign table (pending interactions) — resolve the *complete, small* id set client-side, then
   pass it as `session_ids` and let the server intersect, order and window. Bounded by request
   size, which is fine for tens of ids. This is already how the agent filter works internally
   (`service.py:61-82` resolves turn references → session ids → pushes the set down).
3. **Materialize a hot predicate onto the row.** Only when the join runs on every render. The row
   already mirrors the Redis nest into `flags` for exactly this reason. Mirrored state drifts —
   the codebase already pays for that with an orphan sweep — so mirror the badge, never the
   authoritative read.

## Iteration 1

### WP0 — Reach the filters the backend already has

Almost none of this is new capability; it is capability the public request model hides.

- `SessionStreamQuery.flags` (`is_alive`/`is_running`/`is_attached`) is honoured by the DAO against
  the GIN index on `flags` (`streams/dao.py:138-143`), and the service passes it through — but
  `SessionQueryRequest`/`SessionQuery` never declare it. Exposing it makes Live/Running a real,
  indexed server filter for ~4 lines of model plumbing. No migration, no new query.
- `session_ids` pushdown is likewise already plumbed DAO → service (`streams/dao.py:136-137`), used
  internally by the `references` filter. Expose `session_ids` and add `exclude_session_ids` on the
  public model; that one param serves both pins and waiting-on-you.
- **`count` is the page length, not the total** (`router.py:1660`: `count=len(sessions)`), so every
  filter-chip count is wrong the moment windowing is on. Return a real total: one `COUNT` over the
  same predicate before windowing, on a statement that is already built.

Optional in the same slice, if the pending-approval join proves hot: mirror it onto the row as a
`flags.has_pending_interaction` written on interaction create/resolve, which removes the auxiliary
fetch entirely and gives board columns a ready group key.

Related risk, since the agent filter becomes primary: the `references` path builds the full matching
session-id set in memory before pushing it down (`service.py:65-71`). Unbounded — fine at current
scale, worth watching.

### WP1 — Shared session-list data layer

Lift the mobile list layer into `@agenta/entities/session` so desktop and mobile read one
implementation. This is consolidation Wave 1, done for a reason rather than as a cleanup.

- `sessionListQueryOptions({projectId, references, search, includeEnded, includeArchived, limit})`
  — a query-options factory, never a mounted query (boundary rule from the consolidation plan).
- Project-wide infinite list built on the `next`/`newest` cursor pair. Mobile's
  `useSessionsInfinite` is the reference; the ordering key is server-side
  `coalesce(updated_at, created_at)` DESC.
- `deriveSessionRowStatus(row, pendingCount)` — one definition of live / running / waiting /
  ended / archived, replacing the per-app derivations. Mobile's `deriveStreamNest` +
  `pendingFilter` already encode most of it.
- Pins behind a port: `SessionPinStore { isPinned, toggle, list }`, with a local
  `atomWithStorage` implementation keyed **by project** (`agenta:sessions:pinned` →
  `Record<projectId, sessionId[]>`). Note: the existing session storage atoms are keyed by *app*
  scope; pins must not reuse that shape, since the sessions page is project-wide.
- Migrate `web/mobile` onto the shared layer in the same change, and delete the mobile copies.
  Leaving both is how the fork happened the first time.

Risk: mobile is on a live branch. Do this as its own PR and verify the mobile session list still
works before anything depends on it.

### WP2 — Session deep-link into the playground

The single most load-bearing new mechanism: every row on Home and on the Sessions page needs it.

- Shipped as `useOpenAgentSession()` (+ `sessionOpenTarget(row)` to resolve the target):
  `router.push(`${baseAppURL}/${appId}/playground`)`,
  carrying the target through a small carrier atom (`pendingSessionOpenAtom`) because the
  playground page mounts after navigation. Precedent: `agentFirstRunSeedAtom`
  (`AgentChatSlice/state/firstRunSeed.ts`) solves the identical handoff.
- Consumed after the chat scope resolves → `adoptSessionAtomFamily(appId)({id, title})`, which
  already handles the "this browser has never seen this session" case; records hydration then
  fills the transcript.
- `appId` comes from the row's `references[0].id`. **A session with no turns has no references** —
  its row cannot resolve an agent, so the open action must be disabled with an explanatory
  tooltip rather than navigating somewhere wrong.
- Revision: the playground picks its own default (latest committed). Mobile decided "continue uses
  the latest config *used in* the session"; desktop will diverge here in iteration 1. Record it,
  don't fix it now.

### WP3 — Sessions page

Route `/w/[workspace_id]/p/[project_id]/sessions`, sidebar item between Home and Agents.

Layout: header (search, filter chips, count) → pinned group → virtualized infinite list.

Row: status dot · title · agent chip · last activity · pin toggle · kebab.

- **Title** is `name`, server-backed; sessions without one fall back to the existing
  `sessionLabel` derivation.
- **Agent chip** resolves `references[0].id` through
  `workflowMolecule.selectors.artifactName` — the artifact name, per the entity-display-name rule
  in `web/CLAUDE.md`. Never a revision's `name`.
- **Row actions**: rename (server, `setSessionHeader`), pin (local), archive/unarchive, delete,
  open in playground. Tags are **deferred** — a shared vocabulary stored per-browser would be
  actively misleading, so tags wait for the backend in checkpoint 2.

Filters — **every one runs server-side**, per WP0:

| Filter | Mechanism | Status |
| --- | --- | --- |
| Search (title) | `search` | Already supported |
| Agent | `references` | Already supported |
| Archived / Ended | `include_archived` / `include_ended` | Already supported |
| Live / Running | `flags` | DAO supports it; only the request model hides it (WP0) |
| Waiting on you | `session_ids` pushdown | Client resolves the complete pending set, server intersects (WP0) |
| Pinned | `session_ids` / `exclude_session_ids` | Same mechanism (WP0) |
| Triggered / manual | — | No origin marker existed pre-change; since built (checkpoint 2) |

Pins render as their own group: `querySessions({session_ids: pinned})` for the group (complete and
small enough not to paginate) and `exclude_session_ids: pinned` on the main list so a pinned session
never renders twice. Do **not** fetch pinned rows separately and merge them client-side — that is
two lists with two orderings and a dedup seam.

Freshness is a **poll**, for the reason above: the SSE relay is per-session, so the list has nothing
project-wide to subscribe to. Keep the poll behind one hook so a project-scoped channel (checkpoint 2)
is a substitution rather than a rewrite. Mobile's cadence is the reference — 15s while anything is
alive or pending, stopped when idle, re-checked on focus.

### WP4 — Sidebar sessions section

A collapsible Sessions item with recent sessions as children and a Pinned group above them, per
Mahmoud's screenshot (`Pinned 1`, pin glyph, status dot).

The dynamic-entity registry gives the recent-sessions children for the cost of one entry. The
Pinned group and the per-row status dot exceed what `getLabel`/`childLink` express, so either the
entity config grows a `groups`/`adornment` seam or the sessions section is authored as a custom
section. Decide when building — prefer extending the registry, since a bespoke section forks the
sidebar.

### WP5 — Home rework

`/apps` keeps its `OnboardingEntry` (first run) vs Home branch. The returning-user surface
(`StripHome`) is rebuilt as:

1. **Composer hero** — "What do you want to do?", agent picker, Start. The pieces exist
   (`AgentComposer`, `RichChatInput`, the existing home composer).
2. **Pinned sessions**.
3. **Recent sessions**.
4. **Recent automation runs** — trigger deliveries, newest first, with status and error. (Written
   pre-change: the delivery→session link has since been built — see Backend checkpoints.)
5. **Your agents** — the existing `YourAgentsTable`, condensed.

On the orphaned "+ New agent" button (Arda's screenshot, reply 14): fold it into the agent picker
as a pinned footer item, the same pattern already used for "+ New project" in the project
dropdown. That removes the orphan without inventing a new control.

Mahmoud also wants to start a conversation *from any page*. Not in iteration 1, but build the
composer + picker as a self-contained component so a global ⌘N surface can mount it later without
a rewrite.

## Checkpoint 2 — backend

Immediately after iteration 1 ships, in rough dependency order:

1. ~~**Origin stamp**~~ — pulled forward and built, because the list was otherwise shipping with
   automation runs mixed into your own work. The dispatcher mints the session id, stamps
   `tags["ag.origin"]`, and records it on the delivery; the query grows `origin` /
   `exclude_origin`, and the list hides automations by default. Both dispatch compositions —
   the in-process one in `routers.py` and the queue worker in `worker_queues.py` — build a
   `SessionStreamsService`, so a trigger is stamped whichever path runs it.
2. ~~**Delivery → session link**~~ — built with the stamp above. Home's automation rows can now
   resolve their session; wiring the click is the remaining FE step.
3. **Pin persistence.** `tags` under an `ag.` namespace (Mahmoud's suggestion) plus a query filter.
   The hard part is reconciliation, not storage — the local store from WP1 becomes the optimistic
   layer over it. Agree the tags/meta conventions *first*: Mahmoud's condition was "before we need
   to take a look at tags and meta and how they work not to screw ourselves in the future."
4. **Tag write + filter**, which unblocks the deferred tag row-action.
5. **The remaining status vocabulary server-side.** WP0 covers live/running/waiting; board columns
   need whatever else the status taxonomy ends up containing, each as an indexed filter, so every
   column can carry its own cursor.
6. **Agent self-organization** — tools letting an agent rename, describe and tag its own session
   (Mahmoud ~4:14). This is what makes organization scale past manual curation.
7. **A project-scoped watch channel.** The existing SSE relay is per-session, so the list is stuck
   polling. One `watch:{project_id}:sessions` channel carrying the same change notifications would
   let the sessions page hold a single `EventSource` and revalidate on activity — replacing the poll
   with something that is both fresher and cheaper.

## Out of scope, tracked

Analytics page · agents-page redesign · automations page · Chat/Build mode collapse · breadcrumb,
version-badge, theme-toggle and double-menu chrome cleanup. All acknowledged in the thread as
later steps; Ashraf's "quality over quantity" concern was answered by Mahmoud with
"iteration > perfection, one step at a time", and Arda scoped iteration 1 to sessions.

## Open questions

1. **The mockup is unread.** Section order, wording and the exact filter set on the Sessions view
   should be reconciled against it before WP3 and WP5 are built.
2. **Does `created_by_id` on `session_streams` identify the human or the runner's service
   credential?** If it identifies the human, "my sessions vs everyone's" becomes free, and it may
   also be a cheaper origin signal than a new tag. Verify against live rows before designing
   around it.
3. **Sessions with no turns** (no `references`) appear in the list but cannot be opened. Should
   they be listed at all, or filtered out?
4. **Is a slim whole-project index the cheaper answer?** The rejected alternative: one endpoint
   returning `(session_id, activity, flags, references, name)` for the whole project, fetched
   whole, with the client filtering and grouping exactly and hydrating full rows only for the
   visible window. It fits the thin-references convention and would give board + grouping without
   per-group cursors. Rejected because the track is deliberately moving *away* from unwindowed
   full-list fetches (the 60s full-refetch is the known scaling cliff) and Mahmoud's premise is
   "a lot of sessions". But if the real ceiling is ~2k sessions per project, this collapses most
   of WP0 and WP3 — worth measuring before building.
