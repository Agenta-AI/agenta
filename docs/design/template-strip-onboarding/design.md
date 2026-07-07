# Design

This document turns the handoff spec into concrete component and integration designs
for the Agenta frontend. Exact pixel values live in `research.md` section 1; this file
references them by name instead of repeating every number.

## 1. Module layout and placement

New app-layer module (decision D3 in `status.md`; not a `@agenta/*` package yet):

```
web/oss/src/components/TemplateStrip/
├── index.tsx                    # <TemplateStrip /> (header + tabs + pager + card row)
├── components/
│   ├── StripCard.tsx            # 238px card (tile + badges + name + desc)
│   ├── IntegrationBadges.tsx    # 24px overlapping logo badges (18px chip variant)
│   ├── TemplateChip.tsx         # "From template: <name>" provenance chip
│   └── CopiedToast.tsx          # bottom-center dark toast
├── hooks/
│   ├── useStripPager.ts         # scroll state, arrows, counter
│   └── useTemplateProvenance.ts # selected template + composer coupling helpers
├── assets/
│   ├── constants.ts             # copy strings, sizes, localStorage key, CLI command
│   └── codingAgentClipboard.ts  # buildCodingAgentClipboard(text)
└── state.ts                     # stripHiddenAtom (atomWithStorage)
```

Rationale: both consumers (`pages/agent-home` and `AgentChatSlice`) live in the OSS app
layer, and `AgentChatSlice` already imports from `pages/agent-home`, so a shared
app-layer component is consistent with the current graph. The package heuristic ("used
by 2+ features -> package by purpose") would put the presentational strip in
`@agenta/ui`, but the component depends on the app-layer template registry types and
the analytics helper; extracting it means also moving `AgentTemplate` + `PROVIDERS`.
Defer that until a package consumer exists. Flagged as D3.

The template registry (`AGENT_TEMPLATES`, `PROVIDERS`, helpers) stays where it is:
`web/oss/src/components/pages/agent-home/assets/templates.ts`, reused as-is.

## 2. `<TemplateStrip />` component

### Props (by semantic role)

```ts
interface TemplateStripProps {
    // data
    templates: AgentTemplate[]              // the registry (default AGENT_TEMPLATES)
    selectedTemplateKey: string | null      // provenance selection (controlled)
    // config
    surface: "home" | "onboarding" | "agent-chat"
    // home: no hide affordance; playground surfaces: "..." menu with Don't show again
    // policy/behavior callbacks
    onPick: (template: AgentTemplate) => void   // fill composer + chip (owner decides how)
    onHide?: () => void                     // playground surfaces only
    // presentation context
    surfaceColorVar?: string                // CSS var the right-edge fade blends into
    className?: string
}
```

Notes:
- The strip does NOT own the composer or the selection; the page does. `onPick` and
  `selectedTemplateKey` keep it a controlled, presentational component. That is what
  lets three different composers (home AgentComposer, onboarding chat input, agent chat
  input) share it.
- `surface` is config, not policy: it selects header actions ("..." menu or none) and
  is forwarded to analytics by the callers, but the strip itself never creates agents
  or writes analytics beyond the pick callback (callers own capture, matching how
  `useTemplateSelect` / `OnboardingBrowseTemplates` do it today).
- The hidden state is NOT a prop: the strip reads `stripHiddenAtom` itself and renders
  the one-line "Templates hidden · show again" row when hidden and `surface` is a
  playground surface. Home ignores the atom entirely (always visible).
- `surfaceColorVar` defaults to `--ag-colorBgContainer`. The playground chat panel
  passes its chat surface variable so the fade matches the panel background in both
  themes. The fade is `linear-gradient(to right, transparent, var(<surfaceColorVar>))`;
  never a hardcoded white.

### Internal state

- `activeCategory` (local `useState`, default "All"). Tabs = "All" +
  `templateCategories()` (canonical order Engineering/Support/Ops/Docs), each with its
  count. Switching filters in place, resets the scroller to 0, and never changes the
  strip height.
- Pager state via `useStripPager` (a ref on the scroll container + a scroll handler +
  a `ResizeObserver` so `maxScroll` stays correct on container resize, which the
  prototype skips but production needs). Exposes `{atStart, atEnd, counterLabel,
  showPager, pageBy(dir)}` using exactly the prototype math (research.md "Pager math",
  including the 4px tolerance and page-by-3).
- `stripHiddenAtom = atomWithStorage<boolean>("agenta-tpl-strip-hidden", false)` in
  `state.ts`. The key is owner-specified (matches the prototype; deviates from the
  `agenta:` prefix convention, flagged as D6). Jotai's storage atom serializes
  `true`/`false`; nothing else reads this key today, so the value format is free.
- Menu open state: use AntD `Dropdown` (trigger click) with one item ("Don't show
  again", eye-off icon such as Phosphor `EyeSlash`); no hand-rolled overlay.

### Rendering details

- Header: label (14.5px/600) + tab row + right cluster (`ml-auto`): counter, `<` `>`
  buttons, and (playground surfaces) the `...` dropdown. Pager hidden when the filtered
  set is <= 3 cards. Arrow buttons are plain styled `button`s (26px, radius 7) rather
  than AntD Buttons so the border/icon disabled colors match the spec exactly; they get
  `disabled` + `aria-label`s ("Previous templates" / "Next templates").
- Card row: native horizontal scroll with hidden scrollbar and
  `scroll-snap-type: x proximity`; cards `scroll-snap-align: start`, fixed 238px,
  gap 14 (`gap-3.5`). Tailwind can express all of it
  (`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-proximity`).
- Cards are `<button type="button">` elements (keyboard focusable). Hover and selected
  states per spec; selected = `selectedTemplateKey === template.key`.
- Badges: `IntegrationBadges` renders the Composio CDN logos (reuse the `PROVIDERS`
  map + `next/image`, same as `ProviderMarks`) at 24px with `-ml-1.5` overlap on all
  but the first; a `size="chip"` variant renders 18px with 3px gap for the chip. Keep
  `ProviderMarks` untouched for the flag-off grid; the strip module owns its own badge
  component since overlap and sizing differ.
- Fixed height: the row height is whatever one card row measures; nothing inside the
  strip may grow vertically. The hidden state swaps the whole strip for the one-line
  row (that height change is the designed behavior, not layout shift).

## 3. Provenance chip and composer coupling

`useTemplateProvenance` (per composer instance):

```ts
const {selectedTemplate, pick, clear, chipNode, composerClassName} =
    useTemplateProvenance({composerApi})
// composerApi: {setText(text: string): void}  (adapter over RichChatInputHandle.setMarkdown)
```

- `pick(template)`: sets the selection and overwrites the composer text with the
  template message (prototype behavior; picking a different card replaces text and
  chip).
- `clear()`: drops the selection only; text stays.
- Editing text keeps the chip (we never subscribe to text changes to clear it).
- `chipNode`: the `TemplateChip` (mini tile + "From template: <b>name</b>" + 18px
  badges + close). Rendered by the page directly above its composer.
- `composerClassName`: while chipped, the composer wrapper gets border
  `--ag-colorPrimary` at 1.5px and radius `0 14px 14px 14px`; otherwise the strip-era
  default (1.5px `--ag-strip-input-border`, radius 14). Both home's `AgentComposer` and
  the chat panel's `RichChatInput` already take `className` overrides, so this is the
  established mechanism. The chip and composer must be adjacent siblings in a column
  for the docked look (chip has no bottom border).

Selection state lives in local state inside the hook (one instance per surface).
Surfaces never share a selection (a chip on home has nothing to do with a chip in a
chat).

## 4. "Use my coding agent" + toast

- `buildCodingAgentClipboard(text)` in the strip module:

```ts
const CODING_AGENT_INSTALL = "npx skills add Agenta-AI/agenta-skills"
const buildCodingAgentClipboard = (text: string) =>
    `${CODING_AGENT_INSTALL}\n\n` +
    `Then use the Agenta skills to create an agent that does the following:\n\n` +
    `${text.trim() || "<describe your agent>"}`
```

The owner's string is authoritative (NOT the prototype's `npx agenta skills install
agenta-ai/agenta`, and NOT the existing `IDE_INSTALL_COMMAND`, which stays for
flag-off).

- Toast (decision D4): a small custom `CopiedToast` component instead of
  `App.useApp().message`. AntD message renders top-center and restyling it globally to
  the designed bottom-center dark pill would leak into every other message call. The
  custom toast is ~30 lines: fixed bottom-center portal, bg `--ag-colorBgSpotlight`,
  lime check, radius 9, fade in/out, auto-dismiss 2600ms, `role="status"`
  `aria-live="polite"`. Copy failures (clipboard API rejection) fall back to
  `message.error` like `ContinueInIdeModal` does today.
- Button: secondary AntD Button with the two-arrows icon (Phosphor `ArrowsLeftRight`
  or lucide equivalent) and label "Use my coding agent". It replaces "Continue in IDE"
  on flag-on surfaces that show the actions row.

## 5. Per-surface integration

### 5a. Home (`pages/agent-home/index.tsx`)

Flag on renders a new `AgentHomeStrip` layout branch (keep the flag-off JSX untouched):

1. H1 + subtitle (existing `HERO`; subtitle already ends "...then open the
   playground."). The eyebrow tag row can stay for first-run.
2. Composer: reuse `AgentComposer` with a `trailing` override: secondary "Use my coding
   agent" + primary "Create agent ->" (AntD primary; hover/active come from tokens,
   which normalizes the prototype's hover bug). Chip node docked above via
   `useTemplateProvenance`.
3. Strip (mt 30): `surface="home"`, always visible, no hide. `onPick` fills the
   composer + fires analytics (source "template", `mode: "strip"`,
   `surface: "home"`).
4. Restyled Usage card (see 5d) and `YourAgentsTable`, for returning users. First-run
   users get 1-3 only (no usage/table, matching today's first-run branch).
5. Create agent: existing `onCreate` path plus `autoSendSeed: true` (owner decision:
   home creates, navigates to the playground, and auto-sends). Composer analytics
   unchanged (source "composer").
6. Column: `max-w-[780px]` per the design (flag-off keeps 960).

Parked under flag-off: `TemplatesSection` grid + collapsible toggle + category
dropdown, `TemplateSetupDrawer` open path, `useIdeHandoffModal` + `ContinueInIdeModal`,
"Browse all" link to the gallery.

### 5b. Playground-native onboarding (needs `PLAYGROUND_NATIVE_ONBOARDING` on)

The onboarding surface IS `AgentChatPanel` in onboarding mode plus the left
`OnboardingConfigPanel`. Flag-on changes:

1. `AgentChatEmptyState` (onboarding branch): keep H1, switch the subtitle to the
   playground copy ("...then run it right here.", already the current onboarding
   subtitle's meaning; use the design's exact sentence), drop the "Try" starter chips
   and the "Pick a template on the left" hint, and render the strip below the hero
   (design: strip mt 32, composer mt 28). `surface="onboarding"`, hide affordance
   active. `onPick` fills the chat composer (`richInputRef.setMarkdown`, same
   mechanism as today's `onPrefill`) + sets the chip + fires analytics
   (`mode: "strip"`, `surface: "onboarding"`).
2. Composer trailing actions: "Use my coding agent" (copy + toast; replaces the
   `streamIdeBubble` "Continue in IDE" path) + "Create agent" ->
   `handleCreateAgent` -> `onboarding.commit(text)` (existing in-place commit +
   auto-send). Unchanged under flag-off.
3. `OnboardingConfigPanel`: flag-on suppresses its quick-pick list and "Browse all
   templates" (the strip is the only browsing surface). Simplest faithful option: keep
   the left panel showing only its config-preview placeholder content. `browseAll` /
   `OnboardingBrowseTemplates` become unreachable under flag-on.
4. Column width: the design says max-w 780; the chat column (`CHAT_COLUMN`) is 880 and
   shared by the composer, transcript, and banners. We keep 880 on playground surfaces
   so the strip, hero, and composer stay aligned with everything else in the panel.
   Flagged deviation (D5).

### 5c. Agent empty chat (every agent, `AgentChatPanel` normal mode)

When `messages.length === 0` and not onboarding:

1. Render the strip in the chat column directly above the composer block (between the
   empty-state area and the composer, inside the always-mounted composer `Reveal`), so
   picking a template never shifts the composer. `surface="agent-chat"`, hide
   affordance active (shared `stripHiddenAtom`, one key across playground surfaces per
   the design).
2. `onPick`: fill the chat composer + chip (same `useTemplateProvenance` instance the
   panel owns). Sending is a normal chat turn through the existing submit path; the
   model gate (`modelBlocked`) applies as usual.
3. NO actions row on this surface: no "Create agent" (the agent exists) and no "Use my
   coding agent" (this is a chat, not a build-handoff surface). The composer keeps its
   normal send button. This is the reconciliation of the design's actions row with
   this surface; flagged as D2 for the owner.
4. Once a message exists the strip unmounts (empty-chat state only). The chip may
   persist visually until send; after send it clears with the composer.
5. Interaction with the existing empty-state variants: the build-mode agent card and
   `firstRunPrompt` + Start branch stay as they are; the strip appears alongside
   (above the composer), replacing only the `BUILD_STARTERS` pills under flag-on.
   The seeded first-run flow (`firstRunPrompt`) takes visual priority; suppress the
   strip while a first-run prompt is pending so two suggestion systems never stack.

### 5d. Usage card restyle

`UsageSummary` gets a flag-on variant (prop or internal flag read): border
`--ag-colorBorderSecondary`, radius 10, padding `14px 22px`, left cluster (17px chart
icon + "Usage" 14.5/600 + "last 30 days" 12.5 tertiary), inline stats at 13.5px
(`Label` secondary + `value` primary/semibold), right "Expand" text + chevron. Behavior
(expand to `AnalyticsDashboard`) unchanged. Flag-off keeps the current styling.

## 6. Env flag wiring

- `web/oss/src/lib/helpers/dynamicEnv.ts`: add
  `NEXT_PUBLIC_AGENT_TEMPLATE_STRIP: process.env.NEXT_PUBLIC_AGENT_TEMPLATE_STRIP`.
- `pages/agent-home/assets/constants.ts`:

```ts
/** Template-strip experience toggle (`NEXT_PUBLIC_AGENT_TEMPLATE_STRIP`). When true, ... */
export const TEMPLATE_STRIP_MODE =
    (getEnv("NEXT_PUBLIC_AGENT_TEMPLATE_STRIP") || "").toLowerCase() === "true"
```

- Consumers: `agent-home/index.tsx` (layout branch), `AgentChatPanel.tsx` (empty-chat
  strip + onboarding trailing actions), `AgentChatEmptyState.tsx` (hero variant),
  `OnboardingConfigPanel.tsx` (quick-pick suppression), `UsageSummary` (restyle).
- The flag value matrix per surface is in `context.md`.

## 7. Hex-to-token mapping (light is spec; dark is our explicit choice)

Consume as AntD semantic tokens / `--ag-*` variables, never raw hex. New tokens go in
`palette.ts` as a `templateStrip` feature family, then `pnpm generate:tailwind-tokens`.

| Design hex (light) | Used for | Token | Dark value |
| --- | --- | --- | --- |
| `#1c2c3d` | body text, card name, "Templates" label, H1 | `--ag-colorText` (text.primary) | `rgba(255,255,255,.85)` |
| `#1c2c3d` | ACTIVE: tab underline + active tab text weight pair, selected card border, chipped composer border, enabled arrow border/icon | `--ag-colorPrimary` (accent.primary) | `#f2f25c` (brand yellow; app-wide dark convention for active/selected) |
| `#1c2c3d` / `#394857` / `#051729` | primary button bg / hover / active | AntD `Button type="primary"` (colorPrimary + derived hover/active) | yellow primary + AntD-derived states |
| `#586673` | descriptions, chip text, secondary button icon, "show again" link | `--ag-colorTextSecondary` | `rgba(255,255,255,.65)` |
| `#758391` | inactive tabs, "..." icon, "last 30 days" | `--ag-colorTextTertiary` | `rgba(255,255,255,.45)` |
| `#97a4b0` | counter, tab counts, chip close, "Templates hidden" | `--ag-colorTextTertiary` (nearest role; no zinc-5 token exists; do NOT mint one for four quiet labels) | `rgba(255,255,255,.45)` |
| `#bdc7d1` | disabled arrow icon, Expand chevron | `--ag-colorTextQuaternary` | `rgba(255,255,255,.25)` |
| `#bdc7d1` | card hover border | `--ag-colorBorder` (border.default) | `#424242` |
| `#dfe5ea` | disabled arrow border | `--ag-colorBorderSecondary` (nearest) | `#303030` |
| `#eaeff5` | card border, badge border, usage/table borders, menu border | `--ag-colorBorderSecondary` | `#303030` |
| `#d6dee6` | composer border, chip border, secondary button border | NEW `templateStrip.inputBorder` `{light: "#d6dee6", dark: "#2e3136"}` (dark mirrors `drawerDark.fieldBorder`) | `#2e3136` |
| `#f5f7fa` | chip bg, selected card bg | NEW `templateStrip.selectedBg` `{light: "#f5f7fa", dark: "rgba(255,255,255,0.06)"}` | `rgba(255,255,255,.06)` |
| `#f0f3f7` | tab/menu/arrow hover bg | `--ag-colorFillTertiary` | `rgba(255,255,255,.08)` |
| `#ffffff` | card bg, composer bg, arrow bg | `--ag-colorBgContainer` | `#141414` |
| `#ffffff` | badge tile bg | `--ag-colorWhite` (surface.white) - badges stay WHITE in dark so brand logos stay legible | `#ffffff` |
| fade `rgba(255,255,255,0) -> #fff` | right-edge fade | `transparent -> var(surfaceColorVar)` (home: `--ag-colorBgContainer`; chat panel: its chat surface var) | follows the surface |
| `0 2px 8px -2px rgba(28,44,61,.12)` | card hover shadow | NEW `templateStrip.cardHoverShadow` `{light: as spec, dark: "0 2px 8px -2px rgba(0,0,0,0.45)"}` | darker, subtle |
| `0 1px 3px rgb(0 0 0/.05)` | composer shadow | keep literal (matches existing composer overrides) | none / inset hairline, match existing dark composer |
| menu shadow | "..." dropdown | AntD `Dropdown` default (`--ag-boxShadowSecondary`) | AntD default |
| `#1c2c3d` toast bg | copied toast | `--ag-colorBgSpotlight` (surface.spotlight) | `#424242` |
| `#a0d911` toast check | copied toast | `var(--ant-lime-6)` (constant across themes) | `#a0d911` |
| template tile colors | monogram tiles (data-driven) | inline `style` from `template.color`, white initials, constant across themes (as today) | unchanged |

Explicit dark choices to confirm with the owner (D7): yellow primary for
active/selected states, white badge tiles, the two new `templateStrip` palette entries.

## 8. Analytics parity

| Action | Event | Properties |
| --- | --- | --- |
| Strip card pick | `first_agent_intent` | `source: "template"`, `template`, `templateId`, `templateCategory`, `mode: "strip"`, `surface: "home" \| "onboarding" \| "agent-chat"`, `intentValue: category` |
| Create agent (home composer / onboarding) | `first_agent_intent` | unchanged: `source: "composer"`, truncated message, classified `intentValue` |
| Use my coding agent | `first_agent_intent` | `source: "composer"`, `properties: {action: "coding_agent_copy", message}` (new; the old IDE modal fired nothing, flagged as D9) |
| Hide / show strip | none (not required for parity) | optional follow-up |

Callers fire captures (as today); the strip stays analytics-free internally.

## 9. Accessibility and behavior notes

- Tabs: `role="tablist"` semantics or plain buttons with `aria-pressed`; keyboard
  focusable in DOM order.
- Cards: real buttons; selected card gets `aria-pressed="true"`.
- Arrows: `disabled` attribute drives both styling and behavior; scroll still works by
  trackpad when arrows are disabled at bounds.
- Toast: `role="status"`, does not steal focus.
- Reduced motion: `scrollBy({behavior:"smooth"})` is fine; no scale animations
  anywhere (per the design system notes).
- No emoji, no color gradients (edge fade is surface-alpha only).
