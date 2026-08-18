# Fresh-session prompt — post-112 visual parity, surfaces 2–6

Copy everything below the line into a new session.

---

Read `docs/design/sessions-ux-stack/VRT-SESSION-HANDOFF.md` and
`docs/design/sessions-ux-stack/ee-vs-112.1-diff-inventory.md` in full before doing anything.
The inventory's §4b (sidebar batch, closed) and its "Harness fixes" list are the parts that
tell you how to work; read those twice.

Branch `fix/post-112-reconcile`, worktree `sessions-ux`. We are closing visual and functional
gaps the mobile-extraction lane introduced, by comparing local EE dev against deployed prod
v0.112.1. The sidebar is DONE (0.09% differing in light and dark, committed). Everything else
in §9 is open.

**Source of truth, in this order:** if `origin/release/v0.112.2` addresses the gap, 112.2 wins;
otherwise deployed v0.112.1 is truth. Check 112.2 explicitly for every gap before fixing —
`git ls-tree origin/release/v0.112.2 <path>` and
`git diff origin/release/v0.112.1 origin/release/v0.112.2 -- <path>`. Do not skip it. Half the
sidebar findings changed shape once I checked.

**Do these surfaces in this order, one batch per surface:**

1. **Settings pages** — every sub-page: Account, Organizations, Projects, Members, AI providers,
   API Keys, Secrets, Tools, Triggers, Webhooks, Access & Security, Audit Log, Preferences,
   Usage & Billing. The Members page already has open findings (V-01…V-07, D-11, D-14) — start
   there and treat them as unverified leads, not facts.
2. **Playground** — config pane drill-ins (Model, Instructions, Tools, Skills, Advanced,
   Subscriptions, Schedules, Files), agent creation, templates gallery, onboarding canvas.
3. **Chat** — streaming, tool steps, approvals, elicitation.
4. **Sessions** — tabs, list, cards, rename, delete.
5. **Observability** — empty AND with data: table, drawer, dashboard charts, filters. D-03 and
   D-06 are open leads here.

## The workflow — no shortcuts

Per surface: put PROD in an exact named state → screenshot → put LOCAL in the same state
(seed the data if the state needs data) → screenshot → run the VRT **per strip** → open EVERY
contact sheet → collect ALL issues → fix as ONE batch → re-run that surface's VRT.

**Do not fix-one-verify-one.** Capture every state axis the page has: light AND dark, empty AND
with-data, and each interactive surface (dropdown, tooltip, popover, drawer, modal) open as its
own classified shot. Slugs encode it: `settings-members.dark.empty`,
`playground.light.tools-dropdown-open`.

## Environment

- LOCAL `http://localhost:3000` (web/ee, Next dev, this worktree). PROD `https://eu.cloud.agenta.ai`.
- Viewport 1800×942 CSS. **Verify DPR before trusting any capture** — the headed browser has
  handed out both 1 and 2 in different sessions. The tooling derives it, but check.
- **Arda runs the dev server and the browser. Do not start, restart, or kill them.** Ask.

## Tooling — in `scratchpad/qa112/`, already hardened. Use it, don't rebuild it

`source env.sh` first. Then `shot.sh <slug> <local|prod> [light|dark]`,
`vrt.py <slug> [strip]`, `regions.py <slug> [max] [perSheet] [strip]`. Python is
`$SP/vrtenv/bin/python`. `strips.py` holds the named strips.

It already handles: masking the Next.js dev badge, per-strip diffing, deriving DPR, resolving
tabs by URL, and waiting for pixel-quiet before capturing. If you find yourself writing an
ad-hoc probe script, stop — extend the harness instead.

## Traps — every one of these already cost real time

- **Diff per strip, never whole-page.** The same capture read 2.08% whole-page and 7.42% on the
  sidebar strip. A big content block buries everything else.
- **Open every contact sheet, not the top region.** 64 of 65 regions went unexamined once.
- **A capture taken mid-render invents findings.** It produced a full page of phantom
  "rows missing/shifted" results TWICE. The signature: local reports FEWER ink bands than prod
  while a DOM read afterwards shows every row present. `shot.sh` now gates on pixel-quiet; if
  you ever bypass it, re-shoot and confirm before believing a layout finding.
- **Measure, don't guess tokens.** A `colorPrimaryBg` guess made the selected row worse. Sample
  the pixels: a resting fill is tens of thousands of uniform px, so
  `Counter(crop.getdata()).most_common()` gives the exact value on both builds. Then find the
  token that already holds it — the rail's trio existed the whole time.
- **Theme colours flow from `palette.ts` → `pnpm generate:tailwind-tokens`.** Never hand-edit
  `theme-variables.css` or `antd-overrides.generated.ts`.
- **Query the exact element the style question is about.** A computed-style check on `Back`
  matched a wrapping `<div>` and nearly closed a real font bug as antialiasing.
- **Preflight is OFF in this repo**, so a bare `<button>` does not inherit `font-family` and
  renders Arial. This is a bug CLASS — check it on every extracted component you touch.
- **Ink bands beat `getBoundingClientRect`.** Comparing rect `y` across builds compares an antd
  `<li>` to our `<div>` and lies. Profile ink rows out of the PNG instead.
- **LOCAL is a DEV build, PROD is PRODUCTION.** Dev-only overlays and React dev warnings are not
  regressions. Sub-pixel glyph differences between the two builds are not either.
- **`$B goto` is aborted by the SPA** on many routes. Navigate by clicking, then assert the URL.
- **`$B screenshot --clip` is PAGE-relative.** Use `--viewport` or `--selector`.
- **Query more than `<a>`.** Rows are often `<div>`s.

### Browse-daemon rules (three browser teardowns came from breaking these)

- **Never `closetab`.** Closing the active page tore down the whole headed context. Duplicate
  tabs are harmless — `env.sh` resolves by URL.
- **Never probe flags** (`$B viewport --help` killed the browser).
- **`$B status`/`tabs` auto-spawn a headless daemon** when none exists, which then occupies the
  slot a relaunch needs. `Mode: headed` = the real browser; `Mode: launched` + `about:blank` =
  a stray one you created. Don't poll a dead browser; ask Arda.
- **A failed `$B connect` overwrites `.gstack/browse.json`** and loses the live daemon's token,
  after which the running browser is unreachable (`Unauthorized` on its port).
- **Cookie import is not a route to a logged-in headless browser.** The sessions are not in
  everyday Chrome and not in the persistent profile's cookie DB.
- **A dying daemon looks exactly like a broken app.** Assert health in the same breath as any
  "clicking does nothing" claim.

## Before landing anything

`pnpm lint-fix` in `web/`, then oss tsc
(`pnpm --filter @agenta/oss exec tsc --noEmit -p tsconfig.json`), mobile tsc (same with
`@agenta/mobile`), and the affected suites. Record findings in the inventory as you go — including
the ones that turn out to be wrong, and why. Commit per surface; do not push unless asked.
Never put Claude/Anthropic/Co-Authored-By in a commit message.
