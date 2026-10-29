# Agenta Mobile — Design

**Status:** v3 approved · **wave-1 COMPLETE** (WP1 + WP0 + WP3a, on PR #5479 tip; WP3a via copy-extraction, OSS untouched) — see [README.md](./README.md)
**Date:** 2026-07-12 (backend revised 2026-07-18; WP0 + WP3a executed 2026-07-25)
**Owner:** Arda (FE + BE slice), no external backend dependency

## Goal

A minimal mobile web experience. It shows exactly two product surfaces:

1. A **sessions list** — all chat sessions in the current project, searchable and filterable.
2. A **chat view** — enter or continue a session, with the same behavior and data flow as the
   agent playground's chat (no build mode, no config panel, no inspectors).

Everything else (apps, observability, settings, evaluations, …) stays desktop-only.

Beyond the product surfaces, the mobile app is a **greenfield foundation**: a modern stack
(shadcn/ui, Tailwind, `motion`, no antd) whose components are built to be adopted back into the
OSS/EE apps step by step — mobile is the first consumer, not a fork.

## Non-goals

- No mobile versions of any dashboard/data-heavy page.
- No native app, no offline support, no push notifications (v1).
- No new chat *capabilities* — same transport, same message vocabulary, same HITL semantics as
  the playground; only the render layer is new.
- No cross-project session aggregation (the sessions API is project-scoped by credential).
- No big-bang desktop migration — the playground adopts the new chat package as a follow-up
  track, not in the mobile critical path.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| a | Foundation | **Separate `web/mobile` Next.js app** (Pages Router), not pages inside the existing app |
| b | Mounting | **Path mount `/m`** behind Traefik (`basePath: "/m"`); subdomain remains a later option for cloud |
| c | List scope | **Project-wide** sessions (not per-user "my sessions") |
| d | Continue-session config | **Latest config used in the session**, resolved from the session→agent linkage stamped at run time, with a trace-derived fallback for pre-stamping sessions |
| e | Backend work | Done in this workstream (new query endpoint + stamping); no dependency on the sessions-continuity track |
| f | Design system | **Greenfield: no antd.** shadcn/ui + Vercel AI Elements for the chat, Tailwind, `motion` for animation. Reused package components get refactored, not dragged along |
| g | Chat architecture | **Headless core + per-app skins.** All stateful/behavioral chat logic lives in a shared `@agenta/chat` package (hooks, view-models, registries — zero markup, zero styles); each app "dresses" it with its own presentational components: mobile in shadcn/AI Elements, the playground with its existing antd rendering re-plumbed onto the core (follow-up track) |

## Why a separate app

Findings that drove decision (a):

- The existing `_app` wraps every page in ~10 providers plus a globally mounted drawer/modal
  fleet with **no bundle-level opt-out** (auth routes are visually lighter, not bundle-lighter).
  In-app mobile pages can never be light.
- The `@agenta/*` packages have **zero upward imports** into `web/oss`/`web/ee` — a new app can
  consume the state/data packages cleanly.
- Auth is free: SuperTokens cookies are parent-domain scoped, so a same-host `/m` app shares the
  session automatically (`SuperTokens.init()` with the same `appInfo`, `apiBasePath: "/api/auth"`).
- Traefik already has the pattern: the `services` router uses `PathPrefix` + stripprefix; a
  `PathPrefix(`/m`)` router auto-wins over the web catch-all by rule length.

The mobile app is **edition-agnostic**: built from packages only, one app serving OSS and EE/cloud.
(EE reuses OSS via tsconfig alias shadowing; the mobile app deliberately opts out of that scheme by
never importing app-layer code.)

**Next version:** scaffold on the workspace's pinned Next 15.5 (Pages Router) to avoid dual-major
friction (pnpm override enforces `>=15.5.18 <16`, several packages pin `next <16` peers). The
mobile app becomes the pilot for the Next 16 upgrade as a follow-up task.

## Design system (greenfield)

No antd, no `@ant-design/x`, no Lexical in the mobile app. The stack:

- **shadcn/ui** primitives (button, input, sheet/drawer, dialog, command, skeleton, …) installed
  registry-style, themed via CSS variables.
- **Vercel AI Elements** (shadcn registry components for AI: Conversation, Message, Response,
  Reasoning, Tool, PromptInput, …) as the base of the chat render layer — a natural fit since the
  chat already runs on AI SDK v6 `useChat`.
- **Markdown:** Streamdown (the AI Elements `Response` renderer) replaces
  `@ant-design/x-markdown` + Prism + KaTeX.
- **Composer:** AI Elements `PromptInput` (textarea-based, attachment-ready) replaces the Lexical
  `RichChatInput` for mobile. Rich mentions/slash features are not needed in v1.
- **Motion:** the `motion` npm package for all transitions (already a repo dependency in OSS, so
  no new design-system fragmentation).
- **Theming:** shadcn CSS variables bridged from the existing source of truth
  (`web/oss/src/styles/theme/palette.ts` → generated tokens), light + dark from day one.
- **Tailwind:** the mobile app uses the latest Tailwind + shadcn toolchain, unconstrained. There
  is **no cross-toolchain coupling**: the shared `@agenta/chat` package is headless (no markup,
  no styles, no Tailwind), so the OSS app's Tailwind v3 and the mobile app's version never meet.
  Each skin is styled entirely with its host app's toolchain.

**Modernization path:** the playground re-plumbs its existing antd chat rendering onto the
headless core in a follow-up track (zero visual change, pure de-duplication), after which OSS
surfaces can swap skin components to shadcn one at a time. This is the "step by step"
modernization vehicle.

## Gate and routing

Replace the `NoMobilePageWrapper` banner mechanism with a redirect gate.

**Detection:** server-side, in Next `middleware.ts` (new — none exists today), using
`sec-ch-ua-mobile` with a User-Agent regex fallback. No client-side viewport sniffing for the
gate (the current banner's ResizeObserver approach causes flash-of-desktop and hydrates the full
provider stack before deciding).

**Rules:**

- Mobile device → any desktop route: redirect into `/m`.
  - Playground/session deep links map to their mobile equivalent: a link carrying a session
    reference lands in that session's mobile chat; a bare playground/agent link lands on the
    sessions list filtered to that agent.
  - Any other link lands on the sessions list (`/m/w/{ws}/p/{proj}/sessions`), resolving
    workspace/project the same way post-login redirect does today.
- Desktop device → `/m/...` link: reverse redirect to the desktop equivalent (mobile session URL →
  playground with that session).
- Escape hatch both ways: a `agenta-mobile-optout` / `agenta-mobile-optin` cookie set by
  "View desktop site" / "Open mobile version" links; middleware honors it. This also fixes the
  current banner's dismissal-not-persisted annoyance.
- `NoMobilePageWrapper` is retired when the gate is actually turned **on**, not when its code
  ships. WP5 landed the gate default-off (`AGENTA_MOBILE_GATE`), so retiring the wrapper any
  earlier would leave a mobile visitor with neither the gate nor the blocker. **Since v0.113.0
  the gate is default-on**, so T8 is now unblocked and is the open follow-up: the only mobile
  visitors who still reach the wrapper are the ones who chose the desktop view (the
  `agenta-mobile-optout` cookie) or a deployment that set `AGENTA_MOBILE_GATE=false`, and for
  the first group the blocker is a dead end.

**URL scheme (mobile app, under basePath `/m`):**

- `/auth` (+ `/auth/callback`) — mobile sign-in
- `/w/{workspace_id}/p/{project_id}/sessions` — list
- `/w/{workspace_id}/p/{project_id}/sessions/{session_id}` — chat
- `/` — resolve context (last-used workspace/project, same resolution as post-login) → redirect to list

## Authentication

The gate redirects mobile users away from the desktop app — including its `/auth` pages — so the
mobile app needs its own sign-in surface:

- Built headless on `supertokens-web-js` (not the prebuilt React UI), rendered with shadcn forms.
- Auth-mode discovery via the existing `/auth/discover` endpoint (password vs OTP), matching the
  desktop's `usesDynamicLoginMethods` behavior; SSO providers via redirect flow with a mobile
  `/auth/callback` page that lands back in `/m`.
- Session already established on desktop → cookies are shared, no sign-in shown.
- Unauthenticated access to any `/m/*` route → `/m/auth?redirectTo=...`.
- Post-auth: same workspace/project resolution as the desktop's post-login redirect, landing on
  the sessions list. Invite-acceptance and post-signup surveys stay desktop-only: a brand-new
  user signing up on mobile gets the default workspace path; invited-user acceptance links keep
  routing to desktop (documented exception in the middleware map).

## Backend: session list + linkage

> **REVISED 2026-07-18.** The sessions-extensions work that landed on this branch during the
> week of 2026-07-17 built most of what this section originally proposed, through a different
> (better) architecture. This section now describes the AS-BUILT state plus the small mobile
> residual. The original proposal (heartbeat `tags` stamping, `SessionSummary` projection) is
> superseded — do not implement it.

### As built (by the sessions-extensions track)

- **`POST /sessions/query`** exists on a new root `SessionsRootRouter` → `SessionsService`
  (`api/oss/src/apis/fastapi/sessions/router.py` ~L1190+), returning `{count, sessions}` of
  full `SessionStream` rows, with `Windowing` pagination, a `references` filter (agent/workflow
  refs, resolved by joining through `session_turns.references`), and `include_ended` (soft-
  deleted rows kept so durable history stays listable). Root ops also exist: delete, archive,
  unarchive.
- **Title is a real header:** `session_streams.name`/`description` (`HeaderDBA`, migration 015),
  with a rename endpoint (`PUT /sessions/streams/header`) already wired to the FE rename flow.
- **Agent linkage lives on `session_turns.references`** (new turns domain, migration 014; GIN
  jsonb_path_ops): the runner appends a turn row per run with
  `buildWorkflowReferences(runContext.workflow)` + `trace_id`. This satisfies decision (d) —
  latest config used — via the latest turn row, and the dirty-config caveat holds unchanged
  (draft runs carry no revision ref).
- **FE data layer exists:** Fern-regenerated `getSessionsClient().querySessions(...)` wrapped in
  `@agenta/entities/session` (`querySessions`), plus an app-scoped list atom
  (`projectSessionsQueryAtomFamily`) and a server-over-localStorage reconciler in the OSS
  AgentChatSlice. `session_states` is gone (merged into streams); spans gained indexed
  `session_id`/`user_id`/`agent_id` columns.

Mobile consumes this as-is: project-wide list = `querySessions` without a `references` filter;
per-agent filter = the existing `references` filter; continue-session = resolve the session's
latest turn (turns endpoints exist) → references → hydrate that revision.

### Residual gaps (the revised WP0 scope) — CLOSED, kept as the record of what was scoped

> **Status (2026-07-25): all five items below are implemented.** They are left here as the gap
> analysis that produced WP0, not as open work. Ordering rides `coalesce(updated_at, created_at)`
> with a direction-matched id tiebreak, search is an escaped `ilike` on the stream name,
> references are batch-hydrated by `latest_turn_per_session` (one `DISTINCT ON` query, not
> per-session), and the zod wire test exists. Only the optional Fern regen for `include_ended`
> is still outstanding. See the README's "WP0 residual" section for the commit-by-commit record.

1. **`updated_at` ordering/cursor** — the query DAO windows on `id` (uuid7 ≈ creation order);
   the FE sorts client-side per page, which breaks "last-activity" ordering across pages for
   infinite scroll. Add `updated_at` support to `apply_windowing` + switch the sessions query
   to it.
2. **Title search** — `SessionQuery` has no free-text filter; `name` is now a real column, so
   this is a plain `ilike`.
3. **References echo on list rows** — `/sessions/query` rows do not carry the session's agent
   references, but the mobile list must label each row with its agent and resolve
   continue-session without N per-session turn lookups. Hydrate latest-turn references onto the
   response rows (the service already joins turns for filtering).
4. **Runtime-shape zod test for `querySessions`** — the wrapper + schema exist but the drift-
   pinning unit test was never written (the false-green tsc class).
5. Optional, deferrable: liveness-flags filter on the root query (mobile can filter client-side
   from the returned `flags`); Fern regen so `include_ended` stops being a runtime cast.

## Frontend architecture

### The chat: headless core + per-app skins

A code dissection of the current slice grounds this split: roughly 65% of the 2,200-line
`AgentConversation.tsx` is app-agnostic orchestration trapped inline, the presentational layer
is cleanly antd/x, and three registries (clientTools, approvals, toolDisplay) already share one
`Record<string, Renderer>` + resolver pattern. Three layers:

**Layer 1 — Engine (exists, reused as-is):** `buildAgentRequest`, stream/batch negotiation,
`agentMessageQueue`/HITL predicates, `agentShouldResumeAfterApproval`,
`buildRenderMap`/`renderKindFor` (all `@agenta/playground`); `@agenta/entities/session`
(records/streams/liveness); pure adapters currently in `assets/*` (`transcriptToMessages`,
`toolDisplay`, `toolFormat`, `rewind` core, `files`, `trace`); elicitation parsing/validation
(already in `@agenta/shared/utils`). The `useChat` (AI SDK v6) engine and message-part
vocabulary.

**Layer 2 — Behavior (`@agenta/chat`, new headless package: hooks + view-models + registries,
zero markup/styles/Tailwind):** lifts the orchestration blocks currently inline in components:

- `useAgentConversation({entityId, sessionId})` — the host: `useChat` wiring, transport memo,
  hydration sequencing, queue wiring, approval extraction/response, session-status derivation
  (`idle|running|awaiting|error`), error stamping, persist-on-settle, self-commit handling,
  stop/rewind orchestration. Returns `{turns: TurnViewModel[], status, error, send, stop,
  regenerate, rewind → RewindPlan, isHydrating, isEmpty}` — the skin renders, never orchestrates.
- `useTurnRenderModel` — the turn render model (tool-call folding, superseded-gate dedup,
  client-tool split, empty-turn collapsing, hasAnswer/noResponse/error derivation) lifted from
  `AgentMessage.tsx`.
- `useComposerAttachments` — File-based attachment state (validation, limits, encoding to parts).
  This **kills the antd `UploadFile` leak** in `sessionEphemera`/composer state.
- `useSessionHydration`, `useApprovalDock`, `useClientToolDispatch`; `useAgentChatQueue` and
  `useAgentModelKeyStatus` already exist as clean headless hooks and move in.
- `useConversationScroll` — the desktop scroll engineering (SC-1..4, anchor preservation, jump
  pill, virtuoso variant) as a **desktop-only opt-in**; mobile uses native scroll and never
  imports it. Virtuoso types move out of the shared ephemera store.
- The three registries, generalized: skins register component values against the same keys the
  core resolves (`renderKindFor` → clientTool widget; tool name → approval body;
  `resolveToolDisplay` → label/source/kind). Expand-state keys (`expandState.ts`) stay shared.

**Layer 3 — Skins (per app, presentational only, props are data + callbacks, no antd/x types in
the contract):** the slot set a skin provides: `MessageBubble`, `TextPart` (markdown),
`ReasoningPart`, `FilePart`, `ToolActivityGroup`/`ToolRow`, `ApprovalCard` + approval-body
registry entries, elicitation field kinds, `ErrorPart`, `QueuedChip`, `Composer`,
`AttachmentTray`, `EmptyState`, skeletons, `MessageToolbar` (neutral action descriptors, not
antd-x `Actions` items), `WorkingIndicator`, timestamps/trace metrics.

- **Mobile skin** lives in `web/mobile` (shadcn registry style), built on AI Elements
  (Conversation, Message, Response/Streamdown, Tool, PromptInput) + `motion`. Elicitation v1
  covers core kinds (text, select, confirm) in shadcn form controls; exotic kinds (e.g. the cron
  builder) render a generic fallback with a "finish on desktop" affordance.
- **Desktop skin** is the existing antd/x markup, re-plumbed onto the core hooks in the
  follow-up track — zero visual change, pure de-duplication. Until then, OSS immediately
  consumes the *lifted pure blocks* (turn render model, status/error derivation, tool
  summarization, hydration hook) by importing them back from `@agenta/chat` — cheap,
  behavior-neutral moves that prevent core/OSS drift — while its 2,200-line host keeps its
  remaining inline JSX until the re-plumb.

**Known neutralization work** (the four spots where antd/desktop types leak into logic today):
`UploadFile` as attachment state, `Bubble` prop shaping in `AgentMessage`, antd-x `Actions`
items as the toolbar data shape, react-virtuoso `StateSnapshot` in shared session ephemera.
Desktop-only surfaces (build mode, turn inspector, right panel, onboarding hero, template strip,
virtualization) are all already null-gated and simply absent from the mobile skin.

**Behavior parity is by construction, not eyeballed:** engine + behavior are literally shared
code; skins are contract-tested per slot against recorded session fixtures.

The full dissection (classification table with file:line references, the four type leaks, the
hook API sketch, the complete slot/prop contract, and the WP3a extraction order) lives in
[chat-headless-contract.md](./chat-headless-contract.md).

### Component architecture and UX principles

These are requirements, not suggestions, for every mobile surface:

- **No slab components.** Pages are thin route shells; each feature is a folder of small
  single-purpose components, one component per file. Indicatively:

  ```text
  web/mobile/src/
    pages/                      # thin route shells only (Pages Router)
    middleware.ts               # device gate (reverse direction)
    features/
      auth/                     # SignInForm, OtpForm, SsoButtons, AuthCallback, states/
      sessions/                 # SessionListScreen, SessionCard, SessionSearchBar,
                                # AgentFilterChips, LivenessDot, states/ (Skeleton, Empty, Error)
      chat/                     # ChatScreen, ChatHeader, states/; conversation itself from @agenta/chat
      project-drawer/           # ProjectDrawer, WorkspaceSwitcher, ProjectSwitcher, UserCard
    components/ui/              # shadcn registry components
    lib/                        # motion presets, context resolution, state atoms, api glue
  ```

- **States are designed, not defaulted.** Every screen and every data-bearing component defines
  its loading, empty, error, and partial states as first-class sibling components (a `states/`
  folder per feature). Skeletons mirror the final layout geometry so content replaces them
  without shift. Errors carry a retry affordance and preserve entered state (a failed send never
  loses the draft).
- **Motion design** with the `motion` package, defined once as shared presets in `lib/motion`:
  - list → chat: shared-axis push (card → header continuity), back gesture/button reverses it;
  - project drawer: spring-based sheet;
  - skeleton → content: crossfade, no layout jump;
  - message entrance/streaming: subtle, consistent with the playground's feel;
  - all presets respect `prefers-reduced-motion`.
- **Seamless flow:** scroll position on the list is preserved across list↔chat navigation;
  opening a session renders replayed history instantly from cache when available while records
  hydrate; the composer is never blocked by hydration.

### Mobile screens

- **Sessions list:** server-driven from `POST /sessions/query` via a new `querySessions` wrapper
  in `@agenta/entities/session` (Fern + zod). Search input, agent filter chips, liveness dots
  (one project-wide `querySessionStreams(is_alive)` poll, as on desktop). Infinite scroll via
  Windowing cursor.
- **Chat:** resolve session → stamped references → hydrate that revision into `workflowMolecule`
  (required: the invoke URL is derived from molecule state) → records replay → mount the mobile
  skin over `useAgentConversation`. Sending, HITL approvals, and elicitation work with playground
  semantics by construction (shared behavior layer, full-history resend model unchanged).
  Unresolvable references → read-only replay with a notice.
- **Project drawer:** hamburger → sheet with workspace/project switcher (thin fetchers over the
  existing org/project endpoints — minimal mobile-local state, not the desktop app-layer slice),
  user info, sign-out, "View desktop site".

### Deployment

- Third build target: `build-mobile` turbo filter, standalone output, own Dockerfile stage (or a
  second `server.js` in the existing web image — decide in implementation by image-size impact).
- Compose service `web-mobile` with `traefik.http.routers.web-mobile.rule=PathPrefix(`/m`)`,
  port 3000; ssl variant adds the `Host()` + certresolver labels like the existing web service.
- `entrypoint.sh` writes `__env.js` for the mobile public dir (same mechanism).

## Skill and instruction infrastructure (before implementation)

Set up the guidance layer first so every implementation session (Claude/Codex/Cursor) works to the
same standard, per the repo's instruction-organization model:

- `web/mobile/AGENTS.md` (+ `CLAUDE.md` symlink): the app's conventions — no antd, states-first
  components, one component per file, motion presets usage, shadcn registry workflow, token
  bridge rules.
- Skills in `.agents/skills/` (symlinked into `.claude/skills/`):
  - `mobile-shadcn-conventions` — how we install/extend registry components, theming via the
    palette bridge, AI Elements usage patterns;
  - `mobile-motion-patterns` — the shared presets, when to animate, reduced-motion rules;
  - `mobile-app-structure` — feature-folder layout, states/ convention, data-flow rules
    (entities wrappers only, no app-layer imports).
- Wire the existing plugin skills (Next.js, shadcn, React best practices) into the workflow by
  referencing them from the AGENTS.md so sessions load them when working under `web/mobile`.
- Tooling in the same pass: eslint/prettier config for the new app (including an import-ban on
  `antd`, `@ant-design/*`, and `@/oss/*`), CI typecheck/lint jobs.

## Error handling

- Middleware never hard-fails: on any detection ambiguity, fall through to the requested app.
- Sessions list: empty ("no sessions yet"), error (retry), and offline states are distinct
  designed components.
- Chat: unresolvable references → read-only replay + notice; records fetch failure → retry
  affordance; send failure preserves the draft and surfaces inline.
- Auth: discovery/SSO failures fall back to password form with an explanatory state.

## Testing

- **BE:** pytest coverage for `POST /sessions/query` (pagination, filters, permission gate) and
  stamping (references/title present after an invoke) using the standard ephemeral-account
  fixtures.
- **FE unit:** `@agenta/chat` behavior hooks are unit-testable without DOM (view-model in/out
  against recorded session fixtures — turn render model, status/error derivation, queue/approval
  flows); mobile skin gets per-slot render tests against the same fixtures; `querySessions` zod
  schema pin (runtime-shape test — tsc goes false-green on wire drift).
- **Lifted-block neutrality:** the pure blocks OSS re-imports from `@agenta/chat` (turn render
  model, status derivation, tool summarization, hydration) are covered by before/after fixture
  tests proving identical output — the only OSS-facing change in the mobile critical path.
- **E2E:** Playwright mobile-viewport pass: gate redirect (both directions + opt-out cookie),
  auth, list → open session → send a turn → approve a HITL request.
- **Playground regression (follow-up track only):** when the playground re-plumbs its skin onto
  `useAgentConversation`, full chat-flow regression before merge.

## Work packages

| WP | Scope | Depends on |
|----|-------|------------|
| WP0 | **EXECUTED.** BE residual (revised 2026-07-18 — list/title/linkage landed via sessions-extensions): `updated_at` windowing, title search, references echo on list rows, `querySessions` zod test | — |
| WP1 | Foundation: skill/instruction infrastructure, `web/mobile` scaffold, shadcn + token bridge + motion presets, lint import-bans, compose/Traefik/`__env.js` | — |
| WP2 | Auth: mobile sign-in (headless SuperTokens + shadcn), callback, context resolution, project drawer | WP1 |
| WP3a | `@agenta/chat` headless core: lift the behavior blocks (host hook, turn render model, hydration, approvals, attachments neutralization), generalize the registries, fixture tests; OSS re-imports the lifted pure blocks (behavior-neutral) | — |
| WP3b | Mobile chat skin: shadcn/AI Elements slot components + `motion`, per-slot fixture tests | WP1, WP3a |
| WP4 | Product pages: sessions list + chat screen, transitions, designed states | WP0, WP2, WP3b |
| WP5 | Gate: UA middleware both directions, deep-link mapping, opt-out cookies, retire `NoMobilePageWrapper` | WP1 (app must exist) |
| — | Follow-up track (separate): playground re-plumbs its antd skin onto the core (zero visual change), then swaps skin slots to shadcn incrementally; Next 16 pilot on `web/mobile` | WP3a |

WP0, WP1, and WP3a are independent and parallelizable; WP2 and WP3b fan out from WP1. WP3a is
the intellectual core (the seam) but is mostly code *moves* of already-app-agnostic blocks; WP3b
is greenfield. The only OSS-facing change in the mobile critical path is the re-import of lifted
pure blocks, gated by before/after fixture tests.

## Risks and coordination

- **The sessions backend is under active development** (the sessions-extensions track landed the
  turns domain, root sessions ops, and the states→streams merge the week of 2026-07-17, and more
  is coming). The residual WP0 items are small additive changes to that track's surface —
  coordinate before building so they land in its style and don't collide with in-flight work.
  Re-audit `/sessions/query` and the FE list layer immediately before starting WP4.
- **Two design systems during transition** is deliberate and time-boxed by the adoption track:
  new surfaces are shadcn-only; antd surfaces retire as packages get adopted. The line to hold:
  no antd in `web/mobile` or `@agenta/chat`, ever (lint-enforced).
- **Contract design is the real risk in WP3a** — a slot contract that leaks presentation
  assumptions (or misses a data need) forces churn on both skins. Mitigated by deriving the
  contract from the dissection of the real code (the slot list above is grounded in what the antd
  components actually consume), and by treating the desktop re-plumb as the contract's acceptance
  test in the follow-up track.
- **Drift window until the desktop re-plumb** — the OSS host keeps some inline orchestration
  (scroll, JSX assembly) until the follow-up track lands. Bounded by immediately re-importing the
  lifted pure blocks (turn model, status/error, hydration) so the semantics that matter cannot
  fork; the window should be kept short.
- **Schema drift class:** entities wrappers use local zod; runtime-shape tests are mandatory.
- **Old sessions** without stamped references degrade to read-only or latest-committed-revision
  continue — acceptable for v1, self-heals as sessions accrue turns.
