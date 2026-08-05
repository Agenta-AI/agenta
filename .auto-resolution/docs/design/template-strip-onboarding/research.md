# Research

Everything below was verified against the repo on 2026-07-06. Re-verify before building
on it; the tree carries uncommitted in-flight work (see "In-flight work" at the bottom).

## 1. Design handoff extraction

Source: `/home/mahmoud/code/agenta/design_handoff_template_strip/`.
`Template Strip Prototype.dc.html` is the authoritative component (markup + a
`text/x-dc` state machine). `README.md` and `Template Strip - Implementation Notes.md`
restate the spec. `_ds/agenta-design-system-.../colors_and_type.css` is the token sheet.
The prototype targets AntD 6 + Tailwind 3 + Inter, which matches `web/oss`.

### Strip anatomy (exact values)

Header row (`display:flex; align-items:center; gap:14px`):
- Label "Templates": 14.5px / 600. Never "Optional".
- Category tabs: 13px, padding `5px 11px`, radius `6px 6px 0 0`, count suffix 11px
  `#97a4b0` with 6px gap. Active: color `#1c2c3d`, weight 600, 2px bottom border
  `#1c2c3d`. Inactive: `#758391`, weight 400, transparent border. Hover bg `#f0f3f7`.
  Clicking filters the row in place and resets scroll to 0.
- Right side (`margin-left:auto`, gap 7px): counter "1-3 of 12" (12px `#97a4b0`,
  margin-right 2px), then two 26px arrow buttons (radius 7px, 1px border; enabled
  `#1c2c3d` border + icon, disabled `#dfe5ea` border + `#bdc7d1` icon; 14px chevron SVG,
  stroke-width 2). Pager (counter + arrows) is hidden entirely when the filtered set is
  <= 3 cards.
- Playground only: a 26px `...` button (three 1.7r dots, color `#758391`, radius 7px)
  opening a 200px dropdown (border `#eaeff5`, radius 9, padding 5px, shadow
  `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 10px 24px -6px rgba(5,23,41,0.14)`) with one item:
  "Don't show again" (13px, `#586673`, eye-off icon 14px stroke `#758391`, item padding
  `8px 11px`, radius 6, hover bg `#f0f3f7`). The prototype also has an `inline` actions
  variant (a plain "Don't show again" text button); the default and the one we build is
  `menu`.

Card row (12px below the header):
- Scroll container: `display:flex; gap:14px; overflow-x:auto; padding:2px 2px 6px`,
  scrollbar hidden (`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`),
  `scroll-snap-type:x proximity`.
- Card: `flex:none; width:238px; scroll-snap-align:start`, radius 10, padding 15px,
  border 1px `#eaeff5`, bg white, `transition:border-color .15s, box-shadow .15s`.
  Hover: border `#bdc7d1` + shadow `0 2px 8px -2px rgba(28,44,61,0.12)`. Selected:
  border 1.5px `#1c2c3d` + bg `#f5f7fa`.
- Card contents: top row (`justify-content:space-between`, margin-bottom 11px) holds a
  32px monogram tile (radius 8, white 13px/600 initials, bg = template color) top-left
  and overlapping integration-logo badges top-right (24px white squares, 1px `#eaeff5`
  border, radius 6 (= round(24/4)), 14px icon, each after the first offset
  `margin-left:-6px`). Then name 14.5px/600, margin-bottom 4px; description 12.5px
  `#586673`, line-height 1.45, one sentence.
- Overflow affordance: the 4th card peeks, plus a right-edge fade overlay
  (`position:absolute; top:0; right:0; bottom:6px; width:36px`,
  `linear-gradient(to right, rgba(255,255,255,0), #fff)`, `pointer-events:none`).
- Fixed height always. No expand/collapse, no vertical growth. Filtering swaps card
  content only.

### Pager math (from the prototype's state machine)

- `per = 238 + 14` (card width + gap). Arrows call
  `scrollBy({left: dir * per * 3, behavior: "smooth"})` (page by 3).
- `max = scrollWidth - clientWidth`. `atStart = scrollLeft <= 4`.
  `atEnd = max <= 4 || scrollLeft >= max - 4` (4px tolerance).
- Counter: `first = min(round(scrollLeft / per) + 1, max(cards.length - 2, 1))`, label
  `` `${first}-${min(first + 2, cards.length)} of ${cards.length}` ``.
- State tracked from the container's scroll event (`scrollL`, `maxScroll`).

### Chip + composer (exact values)

- Chip (docked above the composer, rendered only when a template is selected):
  `inline-flex`, gap 8, border 1.5px `#d6dee6` with NO bottom border, bg `#f5f7fa`,
  radius `9px 9px 0 0`, padding `6px 12px`, 12.5px, nowrap. Contents: 18px mini tile
  (radius 5, 9px/600 white initials, template color), text `From template: <b>{name}</b>`,
  18px logo badges (11px icon, gap 3, no overlap), and a `✕` (color `#97a4b0`, padding
  `0 2px`).
- Composer box: border 1.5px (`#d6dee6` normally, `#1c2c3d` while chipped), radius 14
  (while chipped: `0 14px 14px 14px`, squaring the top-left corner under the chip),
  padding `18px 20px`, shadow `0 1px 3px rgb(0 0 0 / 0.05)`, white bg. Textarea 15px,
  line-height 1.55, 3 rows, placeholder = the existing hero placeholder.
- Chip `✕` clears the provenance only; the text stays. Editing the text keeps the chip
  (provenance, not a lock). In the prototype, selecting a card overwrites the composer
  text with the template prompt unconditionally.
- Actions row (margin-top 14px, right-aligned, gap 10px):
  - Secondary "Use my coding agent": 14px/500 `#1c2c3d`, border 1px `#d6dee6`, radius 9,
    padding `9px 16px`, leading two-arrows icon (15px, stroke `#586673`).
  - Primary "Create agent ->": bg `#1c2c3d`, white 14px/500, radius 9, padding
    `9px 18px`, trailing arrow icon. Spec: hover `#394857`, active `#051729`. NOTE: the
    prototype's `.hb-p:hover` wrongly jumps straight to `#051729`; we normalize to the
    spec (which AntD's primary-button hover/active derivation gives us for free).

### "Use my coding agent" copy action

Prototype behavior: write to clipboard, then toast. The OWNER'S corrected clipboard
payload (authoritative, differs from the prototype's command and adds a blank line
before the text):

```
npx skills add Agenta-AI/agenta-skills

Then use the Agenta skills to create an agent that does the following:

<composer text, or "<describe your agent>" if empty>
```

Toast: fixed bottom-center (bottom 26px), bg `#1c2c3d`, white 13.5px, padding
`11px 18px`, radius 9, shadow `0 10px 26px rgba(5,23,41,0.35)`, a green check icon
(15px, stroke `#a0d911`, stroke-width 2.4), gap 9px, auto-dismiss ~2600ms. Text:
"Copied — paste into Claude Code, Cursor, Codex, or any coding agent".

### Hide affordance (playground only)

"Don't show again" collapses the strip to one line: `Templates hidden · show again`
(12.5px `#97a4b0`; "show again" is `#586673`, underlined, `text-underline-offset:3px`).
Persisted in `localStorage["agenta-tpl-strip-hidden"]` ("1"/"0" in the prototype).
"show again" restores. Home never gets the affordance.

### Page contexts

Playground (`Playground Prototype.dc.html` context): padding `64px 40px 60px`, centered
column max-width 780. H1 "What do you want to build?" (30px/600, letter-spacing
-0.02em, margin-bottom 8) + subtitle 15px `#586673` "Describe an agent in plain
language — we'll create and name it, then run it right here." Strip at margin-top 32,
composer at margin-top 28.

Home (`Home Page Prototype.dc.html` context): padding `40px 40px 60px`, same column.
Same H1; subtitle ends "...then open the playground." (the CURRENT `HERO.subtitle`).
Composer first (margin-top 20 after subtitle), strip below at margin-top 30 (no `...`
menu, pager only), then:
- Usage card (margin-top 30): one line, border 1px `#eaeff5`, radius 10, padding
  `14px 22px`, flex gap 14 wrap. Left: 17px chart icon (stroke `#586673`) + "Usage"
  14.5px/600 + "last 30 days" 12.5px `#758391`. Middle (gap 22, margin-left 8): stats
  as `Label <strong>value</strong>` at 13.5px, label `#586673`, value `#1c2c3d`
  (Requests / Latency / Tokens in the mock; the real component also has Cost).
  Right (`margin-left:auto`): "Expand" 13.5px `#586673` + 15px chevron (stroke
  `#bdc7d1`).
- "Your agents" (margin-top 30): h2 18px/600, then a bordered table (border `#eaeff5`,
  radius 10, header row bg `#f5f7fa`, 12.5px/600 `#758391`, columns Name / Last
  modified / Created by). The existing `YourAgentsTable` already matches this shape.

### Prototype template data vs our registry

The prototype ships 12 mock templates with fields
`{id, name, ini, bg, cat, desc, logos[], prompt}` and categories
All/Engineering/Support/Ops/Sales. Our real registry (`AGENT_TEMPLATES`) has 6
templates with categories Engineering(2)/Support(1)/Ops(2)/Docs(1). Owner decision:
reuse ours as-is. Field mapping: `key->id`, `initials->ini`, `color->bg`,
`category->cat`, `description->desc`, `templateProviderSlugs(t)->logos`, and the
"prompt" equivalent is the open decision D1. With 6 templates, only the "All" tab can
exceed 3 cards, so the pager shows only there (per spec: hidden when <= 3).

The prototype inlines brand SVGs for logos; our codebase uses the Composio logo CDN
(`https://logos.composio.dev/api/<slug>` via `PROVIDERS` in `templates.ts`, rendered
with `next/image` in `ProviderMarks`). We keep the CDN images.

### Design-system token sheet (`_ds/.../colors_and_type.css`)

A light-only sheet derived from the app's real AntD tokens. Key facts used in
`design.md`: the zinc scale (`#f5f7fa #eaeff5 #d6dee6 #bdc7d1 #97a4b0 #758391 #586673
#394857 #1c2c3d #051729`), brand = `#1c2c3d` (hover `#394857`, active `#051729`),
`--lime-6: #a0d911`, font Inter 400/500/600. No emoji, no color gradients (the edge
fade is white-alpha only), no scale animations.

## 2. Existing code map (verified)

### Flags and env plumbing

- `web/oss/src/components/pages/agent-home/assets/constants.ts`:
  `TEMPLATE_BUILDER_MODE` (`NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER`) and
  `PLAYGROUND_NATIVE_ONBOARDING` (`NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING`), both
  `(getEnv("...") || "").toLowerCase() === "true"`. Also `HERO` copy (title, the home
  subtitle, the composer placeholder), `COMPOSER` copy (tabIde "Continue in IDE",
  createAgent "Create agent"), `TEMPLATES_SECTION` ("Or start from a template"),
  `IDE_INSTALL_COMMAND` (`npx agenta@latest skills add`, with a TODO to confirm) and
  `buildIdeCommand(prompt)`. NOTE: this file is MODIFIED-UNCOMMITTED in the tree.
- A new `NEXT_PUBLIC_*` var must ALSO be registered in
  `web/oss/src/lib/helpers/dynamicEnv.ts` (the `process.env` passthrough map), or
  `getEnv` never sees it. `NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER` is at line 19 there.

### Home page

`web/oss/src/components/pages/agent-home/index.tsx` (MODIFIED-UNCOMMITTED):
- First-run vs returning driven by agent count (`agentsWorkflowsAtom`), with a
  `?firstRun` override (`useAgentHomeVariants`).
- First run: eyebrow tag + H1 (30px) + subtitle, `AgentComposer`, `TemplatesSection`
  grid. Returning: collapsible "Browse templates" button + `HeightCollapse` around
  `TemplatesSection`, then `UsageSummary`, then `YourAgentsTable`. The collapsible and
  the category dropdown are session additions on the `feat/onboarding-home-ux` lane and
  are superseded when the strip flag is on (they stay for flag-off).
- `AgentComposer` (`components/AgentComposer/index.tsx`) wraps `RichChatInput` from
  `@agenta/ui/rich-chat-input` with `hideSendButton`, `submitOnEnter={false}`, a
  `trailing` slot holding the "Continue in IDE" + "Create agent" buttons, and a
  `className` override for border/radius/shadow (the established override pattern).
  `composerRef` exposes `getMarkdown()` / `setMarkdown()` (a `RichChatInputHandle`).
- `useAgentHomeActions(composerRef).onCreate`: reads the markdown, fires
  `captureFirstAgentIntent(source: "composer", message truncated, intentValue via
  classifyAgentIntent)`, then `createAgent({seedMessage})`. It does NOT currently pass
  `autoSendSeed`.
- `useCreateAgent()` (`hooks/useCreateAgent.ts`): mints an ephemeral
  (`createEphemeralAppFromTemplate({type:"agent"})`), commits it
  (`createWorkflowFromEphemeralAtom`) with a unique slug, stashes
  `agentFirstRunSeedAtom` (`{appId, revisionId, seedMessage, autoSend}`), then either
  `router.push(`${baseAppURL}/${appId}/playground?revisions=${revisionId}`)` or hands
  ids to `onCommitted`. Re-entry latched via `inFlightRef`. The uncommitted
  `agentCreationPrefsAtom` work (in `@agenta/entities` workflow state) is applied inside
  `createEphemeralAppFromTemplate`; build on top, never revert.
- `useTemplateSelect(openSetup)`: template click. BUILDER on -> capture
  (source "template", mode "builder") + `createAgent({name, seedMessage:
  templateBuilderMessage(t)})`. BUILDER off -> capture (mode "setup") + open
  `TemplateSetupDrawer`.
- `useIdeHandoffModal` + `ContinueInIdeModal`: the current "Continue in IDE" modal
  (shows `buildIdeCommand(prompt)` + a Copy button using `App.useApp().message`).
  Parked when the strip flag is on.
- `UsageSummary` (`components/UsageSummary/index.tsx`): already a one-line strip
  (border `--ag-colorBorder`, radius lg, px-4 py-3, stats Requests/Latency/Cost/Tokens
  from `useObservabilityDashboard`, Expand toggles an inline `AnalyticsDashboard`).
  The redesign changes border color/radius/padding/typography, not behavior.
- `YourAgentsTable`: columns Name / Last modified / Created by. Already matches the
  design; no work needed.

### Templates UI today

- `TemplatesSection/index.tsx`: category `Select` dropdown + a responsive card grid
  (fixed 132px rows). `TemplateCard.tsx` (redesigned this session, uncommitted-on-lane):
  34px monogram tile + `ProviderMarks` + name + description, hover border
  `--ag-colorBorder` + the same hover shadow the strip uses.
- `ProviderMarks.tsx`: 26px chips, 1px `--ag-colorBorderSecondary` border, radius 7,
  14px Composio CDN logo via `next/image`, gap 5 (NOT overlapping). The strip needs 24px
  overlapping (-6px) badges: extend this component with size/overlap props or add a
  sibling variant.
- `TemplateSetupDrawer/` and the gallery page (`TemplatesGallery`, route
  `/agent-templates`) stay reachable under flag-off only.

### Playground-native onboarding

- Entry: `OnboardingEntry.tsx` redirects first-run users to `/playground` when
  `PLAYGROUND_NATIVE_ONBOARDING` is on.
- `PlaygroundOnboarding/useAgentOnboarding.ts`: mints the ephemeral, registers it as
  the playground entity, exposes `OnboardingContextValue` with
  `commit(seedMessage, name?)` which reuses `useCreateAgent` with `entityId`,
  `autoSendSeed: true`, and an in-place `onCommitted` (no redirect,
  `history.replaceState`). This commit path is exactly what the strip's "Create agent"
  uses on this surface.
- `OnboardingConfigPanel.tsx`: the LEFT panel quick-pick template list ("Optional ·
  Start from a template", uses `templateBuilderMessage`) + "Browse all templates"
  (sets `browseAll`). Superseded when the strip flag is on.
- `OnboardingBrowseTemplates.tsx`: in-place gallery in the chat column (uses
  `templateBuilderMessage`). Superseded when the strip flag is on.

### Agent chat (the shared composer surface)

`web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx` (~1600 lines,
MODIFIED-UNCOMMITTED with connect-gate work):
- The composer is a `RichChatInput` instance at ~line 1398 (`richInputRef`,
  `CHAT_COLUMN` = a centered `mx-auto max-w-[880px]` column, `className` override,
  `prefix`/`header`/`trailing` slots). Onboarding mode swaps `onSubmit` to
  `handleCreateAgent` (commit, not send), hides the send button, disables
  `submitOnEnter`, and renders the "Continue in IDE" + "Create agent" trailing buttons.
  Normal mode: submit sends, `disabled={modelBlocked}` (the connect-model gate from
  `useAgentModelKeyStatus`, uncommitted work).
- Empty state: `messages.length === 0` renders `AgentChatEmptyState` (onboarding hero
  with "Try" starter chips and `onPrefill` -> `richInputRef.setMarkdown`, OR the
  build-mode agent card with `BUILD_STARTERS`, OR the chat-mode welcome; plus the
  `firstRunPrompt` + Start CTA branch fed by `agentFirstRunSeedAtom`).
- First-run seed: `agentFirstRunSeedAtom` (`state/firstRunSeed.ts`) is consumed here;
  `autoSend` seeds send as soon as the model gate clears (~line 1093).
- Onboarding analytics already fire from here (`captureFirstAgentIntent` with source
  "composer" on `handleCreateAgent`).
- `useOptionalOnboardingContext` is null outside the onboarding playground, so every
  other chat usage is unchanged. The AgentChatSlice already imports from
  `pages/agent-home` (analytics, OnboardingContext), so an import of a shared strip
  module from either place is consistent with the current graph.

### Theme system

- Source of truth `web/oss/src/styles/theme/palette.ts`: semantic roles as
  `{light, dark}` pairs (surface / text / border / fill / accent / semantic / scales /
  feature families like `playgroundSurface`, `composer`, `status`). Generator:
  `pnpm generate:tailwind-tokens` regenerates `theme-variables.css` +
  `theme/antd-overrides.generated.ts` (never hand-edit those).
- Relevant existing pairs (light -> dark):
  `text.primary #1c2c3d -> rgba(255,255,255,.85)`;
  `text.secondary #586673 -> rgba(255,255,255,.65)`;
  `text.tertiary #758391 -> rgba(255,255,255,.45)`;
  `text.quaternary #bdc7d1 -> rgba(255,255,255,.25)`;
  `border.default #bdc7d1 -> #424242`; `border.secondary #eaeff5 -> #303030`;
  `accent.primary #1c2c3d -> #f2f25c` (dark primary is the brand YELLOW);
  `surface.container #ffffff -> #141414`; `surface.spotlight rgba(5,23,41,.9) -> #424242`;
  `fill.tertiary rgba(5,23,41,.04) -> rgba(255,255,255,.08)`;
  `surface.infoBg #f5f7fa -> #242424`.
  There is NO existing role for `#d6dee6` (the `_ds` sheet calls it border-strong) or
  for `#97a4b0` (zinc-5). The playground chat surface family exists
  (`playgroundSurface.chat #ffffff -> #17181b`) and matters for the edge fade color.

### Analytics

`assets/onboardingAnalytics.ts`: `captureFirstAgentIntent(posthog, {source, properties,
intentValue})` -> PostHog `first_agent_intent`. Sources: "template" (with template
name/key/category + `mode`: "builder" | "setup" | "playground_onboarding_gallery"),
"composer" (with truncated message + classified intent), "browse_templates". The strip
MUST keep firing equivalents: template picks with a new `mode: "strip"` (+ a `surface`
property), composer submits unchanged.

## 3. In-flight work in the tree (build on top, never revert)

- Committed lane `feat/onboarding-home-ux` plus uncommitted edits to
  `agent-home/index.tsx` + `assets/constants.ts` (collapsible Browse templates,
  category dropdown, copy tweaks).
- Uncommitted connect-gate work: `AgentChatSlice/AgentChatPanel.tsx`,
  `ConnectModelBanner.tsx`, `useAgentModelKeyStatus.ts`, `@agenta/entities` secret
  atoms.
- Uncommitted `agentCreationPrefsAtom` (`@agenta/entities` workflow state) applied in
  `createEphemeralAppFromTemplate`, plus a self-managed pill fix in
  `agenta-entity-ui` AgentTemplateControl.
- The orchestrator handles lanes/PRs; this workspace does not touch git.

## 4. Verification environment

- Dev stack: `144.76.237.122:8280` (EE dev). Flag flip: add
  `NEXT_PUBLIC_AGENT_TEMPLATE_STRIP=true` to
  `hosting/docker-compose/ee/.env.ee.dev.local`, then run
  `hosting/docker-compose/recreate-web.sh` (NEXT_PUBLIC vars are baked at container
  start, so a recreate is required; source-only edits hot-reload in dev mode).
- The `debug-local-deployment` skill covers login, logs, and API access.
