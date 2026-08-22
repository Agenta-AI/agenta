# Agenta Mobile — project index & handoff

**Status: WAVE-1 COMPLETE (2026-07-25)** — WP1 (mobile foundation), WP0 (sessions backend
residual), and WP3a (`@agenta/chat` headless package, copy-extraction mode with OSS
byte-untouched) all built and dual-reviewed on `feat/agenta-mobile-wave-1`, which sits on
**PR #5479's tip (`3c78268700`)**. 35 commits, final coherence sweep clean, not pushed.
Next: wave-2 planning (WP2 auth/drawer → WP3b mobile chat skin → WP4 pages → WP5 gate).
This file is the entry point: what exists, what's done, what's next.

## What this is

A minimal mobile web experience: a **sessions list** (searchable/filterable) + a **chat view**
with playground-identical behavior — nothing else. Served as a separate greenfield Next.js app
at `/m`, doubling as the modernization vehicle for the OSS/EE frontend (shadcn instead of antd,
headless chat core shared between desktop and mobile skins).

### Locked decisions (see design.md for rationale)

| # | Decision |
|---|----------|
| a | Separate `web/mobile` app (Pages Router), not pages in the existing app |
| b | Path mount `/m` behind Traefik (`basePath: "/m"`, no stripprefix) |
| c | Session list is project-wide (not per-user) |
| d | Continue-session uses the latest config used (latest `session_turns.references`) |
| e | Backend residual owned here; no external dependency |
| f | Greenfield design system: shadcn/ui + AI Elements + Tailwind v4 + `motion`; no antd/Lexical, lint-enforced |
| g | Chat = headless core (`@agenta/chat`: hooks/view-models/registries, zero markup) + per-app skins |

## Document map

| Doc | What it is |
|-----|-----------|
| [design.md](./design.md) | The spec (v3). Backend section REVISED 2026-07-18 to the as-built sessions-extensions architecture |
| [chat-headless-contract.md](./chat-headless-contract.md) | Line-level dissection of the chat slice: engine/behavior/presentation classification, the four type leaks, hook APIs, slot contract, WP3a extraction order |
| [plans/2026-07-12-wp1-mobile-foundation.md](./plans/2026-07-12-wp1-mobile-foundation.md) | WP1 plan — **EXECUTED** (see banner in file for deviations) |
| [plans/2026-07-12-wp0-sessions-query-and-stamping.md](./plans/2026-07-12-wp0-sessions-query-and-stamping.md) | WP0 residual plan — **EXECUTED** (see banner: re-audit corrections + execution deltas) |
| [plans/2026-07-12-wp3a-chat-headless-core.md](./plans/2026-07-12-wp3a-chat-headless-core.md) | WP3a plan — **EXECUTED under copy-extraction** (see banners: strategy change + task mapping) |
| [plans/2026-07-25-wp1-infra-tail.md](./plans/2026-07-25-wp1-infra-tail.md) | WP1 infra tail (prod image CI, compose, run.sh) — **EXECUTED** (Tasks 1-5, 7); fixed the latent entrypoint crash in the unbuilt mobile image. Only the first `workflow_dispatch` publish (Task 7 runbook) is still pending, and it's post-merge by design |
| [plans/2026-07-26-wp5-device-gate.md](./plans/2026-07-26-wp5-device-gate.md) | WP5 device gate (flag-gated middleware, both directions) — **EXECUTED** (Tasks T1-T7); default-off, T8 banner-retirement deferred to flag-flip |

Remaining wave-2 plans (WP2 auth + project drawer, WP3b mobile chat skin, WP4 product pages) are
**deliberately unwritten** — they must be planned against the real wave-1 code and the finalized
sessions surface. WP5 is no longer among them: its plan was written and executed (row above).

## Execution state

Branch **`feat/agenta-mobile-wave-1`** (off `feat/sessions-continuity-fixes`, worktree
`.claude/worktrees/big-agents-sessions`). Not pushed. Executed subagent-driven: every task got a
fresh implementer + spec-compliance review + code-quality review; fix rounds were re-reviewed.

### WP1 — foundation (COMPLETE, 8 commits)

| Commit | Content | Review outcome |
|--------|---------|----------------|
| `d0f5c1c0` | `web/mobile/AGENTS.md` + CLAUDE.md symlink; 3 skills (`mobile-app-structure`, `mobile-shadcn-conventions`, `mobile-motion-patterns`) + `.claude/skills` symlinks | spec ✅ (byte-identical to plan) |
| `c914e333` | `@agenta/mobile` scaffold: workspace/turbo wiring, Next 15.5.18, `basePath /m`, standalone output, minimal `_app`/`_document` (shared `agenta-theme` init script), proof-of-life page. Live-verified: `/m`→200, `/`→404 | spec ✅ quality ✅ |
| `629d6e51` | shadcn (components.json/cn/globals.css Tailwind-v4 CSS-first), palette→shadcn token bridge (`scripts/generate-shadcn-tokens.ts` → committed `theme.generated.css`), motion presets, CLI-installed button+skeleton. Tokens verified in compiled CSS | spec ✅ quality **fix-first** |
| `b53094b5` | Review fixes: dark `--accent` olive→`#2a2a2a` (zinc[2]), token **drift guard** (`--check` mode, chained into mobile `lint` AND web `generate:tailwind-tokens`; tamper-tested), `--destructive-foreground` dark→`#141414`, new-token warning, `useMemo`, transitions exposed reduced-aware | re-review ✅ |
| `342cacef` | `eslint.config.mjs`: flat config + hard bans (antd/`@ant-design/*`/app-layer), canary-proven; first full `build-mobile` + standalone check | spec ✅ (byte-identical) quality: 2 plan gaps |
| `54a404c4` | Plan-gap fixes: `react-hooks/rules-of-hooks: error` (+`exhaustive-deps: warn`), lexical ban. All 4 canaries proven | ✅ |
| `bd4671ad` | Dev deployment: entrypoint `__env.js` mirror (guarded), mobile COPY layers in both dev Dockerfiles, `web-mobile` compose service (OSS+EE) behind Traefik `` PathPrefix(`/m`) `` + cache volumes. `docker compose config` validated both editions | spec ✅ quality ✅ |
| `b44cbee4` | Prod `web/mobile/docker/Dockerfile.gh` (mirrors oss gh image; baked `CMD` justified — no compose gh wiring yet). **Image build deferred to a gh CI run** | ✅ |

What works right now: `cd web && pnpm dev-mobile` → http://localhost:3000/m renders the themed
shell (light+dark from the bridged palette); `pnpm build-mobile` produces a standalone server;
`pnpm --filter @agenta/mobile lint` enforces the bans + token sync; the dev compose stacks have
a routable `web-mobile` service (needs a dev-image rebuild to pick up the Dockerfile changes).
Since v0.113.0 the dev stack starts it by default, from the repo root (swap `--oss` for `--ee`
to match the loaded env file): `bash ./hosting/docker-compose/run.sh --oss --dev`. It was opt-in
(`--with-mobile`) for one release because a live dev run showed the second Next dev server pushes
an 8GB Docker VM into OOM-killing the main web app's first big Turbopack compile — dmesg-confirmed
`next-server` kills at ~4.5GB RSS. Running both dev servers comfortably wants a 12GB+ VM, so on a
small VM pass `--no-mobile`.

### WP0 residual — COMPLETE (2026-07-25, 9 commits, all dual-reviewed)

Executed after the rebase onto PR #5479, re-audited first (all four tasks were still needed; the
plan banner carries the corrections). Commits, in order:

| Commit | Content |
|--------|---------|
| `117cd6e4` | R1: `apply_windowing` learns `updated_at`; sessions query + FE wrapper cursor params |
| `11b722f8` | R1 fix: order/cursor ride `coalesce(updated_at, created_at)` (NULL-safe; matches FE `activity()`) |
| `c2ad2393` | R1 fix: **direction-matched id tiebreak in shared windowing** — fixes a latent dup/skip pagination bug for ALL 18 `apply_windowing` call sites (cursor predicates always assumed DESC) |
| `dc7d8499` | R2: `search` (escaped `ilike` on `session_streams.name`) threaded request→core→service→stream-query→DAO; FE param w/ TODO(fern-regen) cast |
| `0afb4125` | R2 polish: trim search term (whitespace ⇒ no filter), tightened tests |
| `c757ca9d` | R3: latest-turn `references` batch-hydrated onto `/sessions/query` rows (new `latest_turn_per_session` DISTINCT-ON helper; core `SessionListItem` DTO; FE `sessionReferenceSchema`) |
| `a159baae` | R3 polish: `.get()` enrichment loop, full-field test pin, IN-list docstring |
| `0c906849` | R4: `session-query-schema.test.ts` — 8-case zod wire pin (stamped/minimal/ended/archived/no-refs/envelope/2 drift-guards) |
| `ab7b09ad` | R4 fix: fixture made server-faithful (phantom `status` removed; reference id → UUID string) |

The mobile list's backend needs are now fully served: true last-activity ordering with working
keyset pagination, title search, agent-labeled rows (references echoed, one batch query per
page), and a drift-pinned wire contract. Suites at close: api sessions 152 passed;
`@agenta/entities` 928 passed; entities typecheck clean.

### WP3a `@agenta/chat` — COMPLETE (2026-07-25, COPY-EXTRACTION mode, 18 commits, all reviewed)

**Mid-execution strategy pivot (Arda's direction):** too many in-flight FE PRs + a local
antd→shadcn branch overlap the OSS `AgentChatSlice`, so the original move-extraction (same-commit
OSS re-imports) was replaced by **copy-extraction: the package copies behavior verbatim
(byte-parity-audited, copy-headers with declared adaptations) and OSS is byte-untouched** — the
branch's only non-package files are the T1 wiring five. Three early move-mode commits were
rewound off the branch after the pivot. The desktop re-plumb (OSS consuming the package,
deleting its local copies) is a follow-up PR sequenced after the FE queue drains.

| Commits | Content |
|---------|---------|
| `3984282642` | T1 scaffold: package + forbidden-deps contract test + workspace/turbo wiring |
| `1d0721e9` `21dee91e` `259e7de1` | C1: neutral types (PendingAttachment, MessageAction) + parts predicates/toolIdentity/partToolName + parseAgentRunError |
| `a1dffc2e` `367af807` `7c369789` `6537a379` `88e4cd88` | C2/C3: toolSummary, approvals, turnStatus, renderModel (predicate-injected), grouping + sessionStatus |
| `2d622f48` `ccc77f4a` `eda687d7` | C4a: asset chain (toolFormat/trace/attachmentRules/files/rewind; transcriptToMessages/loadSession/transport) + state stores (expandState; sessionEphemera — PendingAttachment-based, windowed-list map omitted) |
| `1230499b` `707910d1` `cd341019` | C4b: queue+model-key hooks (verbatim); useComposerAttachments/useApprovalDock; **useAgentConversation** host (+ sessionMessages store copy, turnViewModel with per-mount identity cache). 5 real integration tests: real useChat + real transport over mocked SSE |
| `f9a6155d` | C5: skin registration (registerChatSkin) + resolvers mirroring OSS precedence/fallback chains |
| `f3a50772` `032b125b` | Review polish (updater purity, kind-override header note) + mobile-skills gitignore allowlist |

Package at close: **190 tests / 27 files green**, `pnpm run check` clean, banned-literals grep
empty (no antd/ant-design/virtuoso/lexical/app-layer strings anywhere in src/ incl. comments),
zero-OSS-edit gate proven. The C4/C5 review ran FULL byte-parity diffs (copies differ from OSS
only by headers) and found no undeclared behavioral divergence; the localStorage message key,
quota eviction, throttle, and persist ordering are identical to OSS — no history fork.

### ⚠️ WP3b (mobile skin) gotchas — from the C4/C5 review, read before building the skin

1. **Mount `useAgentConversation` with `key={sessionId}`** — initialMessages, stopped-state,
   hydration flags, and the executed-identity cache seed once per mount; prop-switching the
   sessionId without a remount leaves them stale.
2. **Call `attachments.clear()` after a successful send** — the host clears the draft, not the
   attachment stage (documented in the hook).
3. **Trace-side error refinement is skin-side** — `turns[].status` derives with
   `traceError: null`; layer the per-turn trace summary in the skin (matches where OSS does it).
4. **`useApprovalDock` returns no renderer** — resolve friendly bodies via
   `resolveApprovalBody(toolName)` and names via `resolveToolDisplay` from `./skin`.
5. **The model-key composer gate is not composed into the host** — wire
   `useAgentModelKeyStatus` in the skin's composer.

### WP1 infra tail — EXECUTED (2026-07-26, 3 commits)

Closed the deferred items from WP1's "Chores pending" (prod image CI, compose wiring,
`run.sh` awareness); see
[plans/2026-07-25-wp1-infra-tail.md](./plans/2026-07-25-wp1-infra-tail.md) for the full task
breakdown and grounding facts.

| Commit | Content |
|--------|---------|
| `b93b936bc5` | Fix the mobile gh image's entrypoint env-dir crash (G8): pre-create+chown `/app/oss/public` and `/app/ee/public` so the shared `web/entrypoint.sh` can write `__env.js` as the non-root runtime user |
| `af93751a16` | New `.github/workflows/17-check-mobile.yml`: `@agenta/mobile` typecheck job + per-arch (amd64/arm64) `agenta-web-mobile` image build with PR smoke (`/m`, `/m/__env.js`, non-root check) and `workflow_dispatch` push/merge-manifest/`:latest` publication |
| `03b16ae45a` | `web-mobile` service in all five prod/gh compose files (oss gh/ssl/local, ee gh/local) behind the opt-in `with-web-mobile` profile + `run.sh --with-mobile` |

The image's **first-ever build+serve smoke passed**: ~500MB standalone image, `/m` and
`/m/__env.js` both 200, `/` 404 (basePath), runs as the non-root `agenta` user — all checks
green. Task 5 re-verified (didn't re-add) that mobile lint and `@agenta/chat` unit tests were
already reached by the existing generic CI mechanisms (workflows 11 and 12); only the mobile
image build and `@agenta/mobile` typecheck needed a new job.

### WP5 device gate — EXECUTED (2026-07-26, 5 commits)

> **STATUS UPDATE (2026-08-22, v0.113.0):** the gate now ships **DEFAULT ON**, and the
> `web-mobile` compose service starts with every stack (the `with-web-mobile` profile is
> gone). Both keys became opt-OUTs: only the exact value `false` turns a gate off, and
> `AGENTA_MOBILE_ENABLED=false` (or `run.sh --no-mobile`) holds the service back and forces
> the desktop gate off; `--no-web` implies the same opt-out. The Helm chart deploys `web-mobile`
> and routes `/m` by default; `webMobile.enabled=false` removes both and disables the desktop gate.
> v0.113.0 shipped to production without `/m` because no deployment set the keys — that is what the
> flip fixes. The section below records the original default-off design; read it as history.

Ships the mobile device gate (design.md "Gate and routing") behind a runtime flag,
`AGENTA_MOBILE_GATE`, **default off** (see the status update above): with the flag off, request behavior is byte-identical to
today. A second flag, `AGENTA_MOBILE_REVERSE_GATE` (**default on**, mobile app only), turns off
the reverse direction alone: mobile devices still get sent to `/m`, but nothing is bounced back
out of `/m`. Set it to `false` to test `/m` from a tablet or a desktop browser — iPadOS Safari
sends the macOS desktop UA and Chromium tablets send `sec-ch-ua-mobile: ?0`, so both read as
non-mobile and would otherwise be bounced.
`NoMobilePageWrapper` retirement (T8) is specified but deliberately **not executed** —
it ships only in the deployment window where the flag is actually flipped on. See
[plans/2026-07-26-wp5-device-gate.md](./plans/2026-07-26-wp5-device-gate.md) for the full task
breakdown and grounding facts.

| Commit | Content |
|--------|---------|
| `cf272e1227` | T1: `@agenta/shared/utils/mobileGate` — pure, framework-free decision core (detection, deep-link maps, cookie semantics, documented exceptions); 27 unit tests in the package's vitest harness |
| `6b3aaf5654` | T2: `web/oss/src/middleware.ts` + `web/ee/src/middleware.ts` — twin desktop forward-gate adapters (byte-identical, both NEW files) wrapping the shared core |
| `2df5e4d2a1` | T3: `web/mobile/src/middleware.ts` — reverse-gate middleware carrying a declared verbatim copy of the reverse-gate subset (mobile has zero workspace deps until WP2), new minimal mobile vitest harness, and the "View desktop site" `?view=desktop` escape link on the placeholder page |
| `7be0b8d528` | T4: plumb `AGENTA_MOBILE_GATE` through dev + gh compose files (default `false`), documented in both dev env examples |
| `9ac651525f` | T6: self-skipping Playwright UA-emulation smoke (`web/oss/tests/playwright/acceptance/mobile-gate/gate.spec.ts`), 6 tests, skips unless the runner asserts `AGENTA_MOBILE_GATE=true` |

**Verification highlights:**

- Build proof: all three apps (`oss`, `ee`, `mobile`) print a `ƒ Middleware` row after adding
  their respective `src/middleware.ts`, confirming Next 15.5.18 picks up the placement.
- Zero new tsc signatures in `@agenta/oss` or `@agenta/ee` after wiring the middleware (T2).
  Scope note from the combined post-execution review: the T6 Playwright spec itself adds 9
  signatures to the `@agenta/oss` tsc run (TS2307 `@playwright/test` + implicit-any bindings) —
  the same error class every existing acceptance spec under `tests/playwright/` already
  produces, because playwright specs are type-checked by the `web/tests` harness, not oss tsc.
  Accepted as precedented noise; the clean fix (excluding `tests/playwright` in
  `web/oss/tsconfig.json`) is a separate cleanup, not part of this WP.
- Combined review verdict across the five commits above plus the T7 documentation commit:
  **approve**. Every code block landed byte-identical to
  the plan, the desktop matcher regex was independently confirmed correct against the compiled
  middleware manifest (`/m` and `/m/*` excluded; `/models`-style paths still gated), and the
  middleware bundle carries only the gate core (no transitive leaks). Two deferred hardening
  notes for the agenta_cloud PR: make the gate cookies `secure` conditional on the forwarded
  proto and add `httpOnly` (safe — nothing client-side reads them), and note that EE's first
  deploy with these commits is the first live `ƒ Middleware` proof for EE (its local build
  predates the middleware; the file is a byte-twin of the verified OSS one).
- **T5 live proof** (the load-bearing verification): same standalone binary, two runs, no
  rebuild between them. Flag on (`AGENTA_MOBILE_GATE=true`): mobile UA on `/w` → `307` to `/m/`,
  desktop UA on `/w` → `200`. Same binary, flag unset: mobile UA on `/w` → `200`, no redirect —
  proving `process.env` in middleware is read at request time on the pinned standalone server,
  not build-inlined. Also surfaced a **basePath-stripping observation**: at runtime Next strips
  the `/m` basePath from `nextUrl.pathname` before the mobile middleware handler runs, but the
  handler normalizes defensively either way (needed for unit tests, which construct
  `NextRequest` directly and still see the `/m` prefix).
- **Live QA found two gate defects the review missed (both fixed):** (1) Turbopack's DEV
  middleware sandbox exposes only `.env`-file vars, not the container's process env, so
  `AGENTA_MOBILE_GATE` read `undefined` in `next dev` even with the container env set — dev
  compose commands now mirror the flag into `.env.development.local` at container start
  (prod standalone is unaffected; T5's runtime-read proof stands). (2) With `basePath`, the
  bare root `/m` never matched the `"/((?!...).*)"` matcher (the root strips to an empty
  string), leaving the landing page ungated in BOTH dev and prod — the matcher now carries an
  explicit `"/"` entry. Unit tests construct `NextRequest` directly and bypass Next's matcher
  layer entirely, which is why 27+8 green tests missed it; only a live end-to-end probe
  caught both. Desktop twins are unaffected (no basePath; `/` 308s into gated `/w`).
- **T6 spec self-skip.** `--list` (which does not invoke `global-setup`) confirms the spec
  discovers exactly the expected 6 tests. A real (non-`--list`) run against this worktree with
  no stack running was attempted to observe the runtime skip directly, but `global-setup`
  unconditionally authenticates against `AGENTA_WEB_URL` before any per-test `test.skip` logic
  runs, so it fails with `ERR_CONNECTION_REFUSED` rather than reporting `6 skipped` — exactly the
  fallback the plan anticipated. With the flag confirmed unset in the runner env (the CI
  default), the `test.skip(!gateEnabled, ...)` predicate is proven to evaluate `true`, so the
  6-skipped outcome is correct by construction; observing it as a live Playwright report is an
  operator step against a running stack (flag-on run is likewise an operator step — see Open
  items below).

## Flows-lite + auth-lite + approvals (2026-07-26/27) — EXECUTED

The postponed-fidelity phase Arda redirected into ("keep ui look basic / raw … focus on
navigation / flows / logic"). All raw-UI; the radix-primitives track re-skins later.

- **Flows-lite** ([plan](./plans/2026-07-26-mobile-flows-lite.md), 6 tasks + review fixes,
  commits `cf2792299f…9137760079`): @agenta/* packages wired into the mobile app + both
  container layers; AppProviders (default-store jotai + queryClientAtom + sdk host) +
  route→projectIdAtom ContextSync; root workspace/project resolution (stored → single →
  desktop-continuity → raw picker); sessions list (querySessions windowed cursor, debounced
  search, `includeArchived:false`); read-only transcript replay (loadSessionMessages +
  buildTurnViewModels). Reviewed: approve after 4 fixes. **Live-verified by Arda.**
- **Auth-lite** (commits `2a2f91af61…f0809ee1c4`): gate maps `/auth`→`/m/auth`
  (`/auth/callback` stays desktop — OAuth must land there); headless supertokens-web-js
  (desktop-identical appInfo); refresh-before-verdict + the **provider-scope
  `ensureAuthInit()`** (the SuperTokens fetch interceptor must install before ANY API call —
  live QA caught the sessions query 401ing without it); raw email/password `/m/auth` page
  (OTP/SSO → "use desktop" notice).
- **Approvals** ([plan](./plans/2026-07-27-mobile-approvals-steering.md) — read §1: there is
  NO server-side session SSE; approval answers are fresh `/invoke` POSTs; §4b decisions;
  9 commits `53e1fa427f…2a2ba33f2a` + review fixes `02c36566aa`): M0 badges/polls, M1
  approve/deny/approve-all via the references-only lite resume builder (fire-and-forget) +
  Stop, runner warm-park TTL 5→30min, M2 detached respond composition (api). Reviewed:
  approve; both high-risk contracts traced end-to-end. **Live-unverified:** warm-vs-cold on a
  detached respond (probe: answer via `/respond`, check runner logs `resume key=` vs
  `approval-mismatch`); runner process restart required to activate the TTL.
- **⚠️ Standing follow-ups (Arda: do not forget):** M3 live relay (desktop live-updating a
  phone-resumed turn) and steer-lite (M1.5 specced+unbuilt, gated on runner
  reject-with-feedback #5444; Arda may request next).

## Resume runbook (from here)

1. **Plan wave-2** against the real code (WP2 auth/drawer → WP3b skin → WP4 pages → WP5 gate).
   Planning inputs: the WP0 plan banner (archived_at client filter, auto-title lift into
   `@agenta/entities`, delete-vs-kill swipe semantics, Fern regen for search/include_ended) +
   the WP3b gotchas above + the WP1 gotcha (mobile compose/Dockerfile need `@agenta/*` wiring
   the moment WP2 adds package imports).
2. **Follow-up track (separate, after the FE PR queue + shadcn branch):** desktop re-plumb —
   OSS consumes `@agenta/chat`, deletes its local copies; the copy-headers mark every site.

### Verify-the-foundation smoke (run after any rebase)

```bash
cd web && pnpm install
pnpm --filter @agenta/mobile lint            # bans + tokens:check
pnpm --filter @agenta/mobile types:check
pnpm build-mobile && test -f mobile/.next/standalone/mobile/server.js
pnpm dev-mobile   # → http://localhost:3000/m, check light+dark
```

## Open items & gotchas (do not relearn these)

- **`@agenta/*` deps are deliberately unwired for mobile.** The `web-mobile` compose service has
  **no `web/packages` mount**, and `Dockerfile.gh` copies **no package manifests** — correct
  today (mobile has zero workspace deps) but MUST be added the moment WP2+ imports
  `@agenta/entities`/`@agenta/shared`/`@agenta/chat` (compose volumes + Dockerfile manifest
  copies + turbo `dependsOn` for `@agenta/mobile#build`).
- **Token workflow:** palette changes go through `web/oss/src/styles/theme/palette.ts` → the
  chained `generate:tailwind-tokens` now also regenerates mobile; `theme.generated.css` is
  committed and lint fails if stale. Never hand-edit it. Installing a shadcn component that
  references a NEW token requires extending the VARS role map + `@theme inline` first.
- **shadcn CLI** emits the consolidated `radix-ui` package (not `@radix-ui/react-slot`) — expected.
- **`exhaustive-deps` is `warn`** by choice (rules-of-hooks is the error-class check).
- **Dev `__env.js`:** the entrypoint mirrors it into the bind-mounted `web/mobile/public/` on
  container start (gitignored). Until the dev image is rebuilt with the P5 Dockerfile changes,
  `/m/__env.js` 404s — harmless console noise.
- **Chores:** the `.gitignore` allowlist entries for the `mobile-*` skills are **done** (see
  `.gitignore` — both the `.agents/skills/` and `.claude/skills/` blocks). Still pending: Fern
  regen so the FE `include_ended` param stops being a runtime cast.
- **Mobile image CI + publication runbook** (WP1 infra tail, EXECUTED —
  [plans/2026-07-25-wp1-infra-tail.md](./plans/2026-07-25-wp1-infra-tail.md)):
  `.github/workflows/17-check-mobile.yml` build-verifies + smoke-tests the `agenta-web-mobile`
  image (both arches) on mobile-path PRs and typechecks `@agenta/mobile`; lint (`turbo run lint`
  in workflow 11) and `@agenta/chat` unit tests (recursive package discovery in workflow 12)
  were already covered by their generic mechanisms — verified, not changed. **First publication
  ordering:** `17 - check mobile` no longer publishes `latest` — there is no `push_latest` input,
  and `image_tag=latest` is rejected outright. Publication is owned by `43 - Release to GHCR` in
  the private `agenta_cloud` repo, the same as api, web, services and runner; only after that
  pipeline has published `agenta-web-mobile` once can operators start it from
  `bash ./hosting/docker-compose/run.sh --oss --gh` (or `--ee`). That first publication happened
  (the image starts at v0.111.0), so the opt-in `with-web-mobile` profile was removed in
  v0.113.0 and `web-mobile` now starts with every stack; `run.sh --no-mobile` holds it back.
- **Design-doc staleness:** `docs/designs/sessions/**` predates the streams-merge/turns model;
  don't trust it over the code. The memory file `project_agenta_mobile_discovery` (assistant
  memory) mirrors this handoff.
- **WP5 device gate flag-flip runbook (SUPERSEDED — the gate is default-on since v0.113.0, so
  there is nothing to flip):** once WP2 (mobile auth) and WP4 (product
  pages) are live, per deployment: set `AGENTA_MOBILE_GATE=true` in that deployment's env file,
  recreate the `web`/`web-mobile` services, run the T6 Playwright smoke
  (`web/oss/tests/playwright/acceptance/mobile-gate/gate.spec.ts`) against it to confirm 6
  passed, then land T8 (the prepared, not-yet-executed `NoMobilePageWrapper` retirement commit)
  from [plans/2026-07-26-wp5-device-gate.md](./plans/2026-07-26-wp5-device-gate.md). T8 remains
  **specified but unexecuted** in that plan by design — it is coupled to this flip, not to WP5
  landing.

## Follow-up tracks (post-wave-1, explicitly out of scope for now)

- Desktop playground re-plumb onto `useAgentConversation` (the contract's acceptance test),
  then incremental antd→shadcn skin swaps in OSS/EE.
- Scroll-hook extraction (`useConversationScroll`) — desktop-only, deferred from WP3a.
- Next 16 pilot on `web/mobile`.
- Subdomain (`m.`) mounting option for cloud; session-rename UX coordination (PR #5202).
