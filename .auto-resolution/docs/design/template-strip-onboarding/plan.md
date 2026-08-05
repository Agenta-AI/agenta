# Plan

Slices are sized for Sonnet subagents: each is one focused PR-able change with its own
verification step. Order matters; S1 unblocks everything, S2-S3 unblock the surfaces.
Do not run git/but from implementation subagents; the orchestrator owns lanes and PRs.
Never revert the uncommitted in-flight work listed in `research.md` section 3.

Before each slice: re-read the touched files (the tree moves); re-read the relevant
sections of `design.md` and the exact values in `research.md` section 1.

## S1. Flag plumbing + palette tokens

- Add `NEXT_PUBLIC_AGENT_TEMPLATE_STRIP` to `web/oss/src/lib/helpers/dynamicEnv.ts`.
- Add `TEMPLATE_STRIP_MODE` to `pages/agent-home/assets/constants.ts` (doc comment in
  the style of the two existing flags: what on/off means, why both are kept).
- Add the `templateStrip` feature family to `web/oss/src/styles/theme/palette.ts`
  (`inputBorder`, `selectedBg`, `cardHoverShadow` per the design.md table), register it
  in the exported `palette` object, run `pnpm generate:tailwind-tokens` in `web/`, and
  commit the regenerated `theme-variables.css` + `antd-overrides.generated.ts`.
- Verify: `pnpm lint-fix` clean; generated files contain the new `--ag-*` variables;
  app builds.

## S2. TemplateStrip component

- Build `web/oss/src/components/TemplateStrip/` per design.md section 2:
  `index.tsx`, `StripCard`, `IntegrationBadges`, `useStripPager`, `state.ts`
  (`stripHiddenAtom`, key `agenta-tpl-strip-hidden`), assets/constants.
- Exact values from research.md section 1 (card 238/gap 14/radius 10/padding 15,
  tab spec, pager math with 4px tolerance and page-by-3, counter formula, 36px fade,
  26px arrows, 200px dropdown, hidden one-liner).
- Include the `surface` prop behavior (hide menu only on playground surfaces) and the
  `surfaceColorVar` fade.
- Tokens only, both themes (design.md section 7). No analytics inside the component.
- Verify: render it temporarily on a scratch route or storybook-less harness is NOT
  needed; instead wire it read-only into the home flag-on branch stub (S4 completes
  this) or verify via the S4 slice together. Minimum here: type-check + lint + a unit
  test for the pager math and counter label (pure function extracted from
  `useStripPager`).

## S3. Provenance chip, coding-agent copy, toast

- `TemplateChip`, `useTemplateProvenance`, `CopiedToast`,
  `buildCodingAgentClipboard` per design.md sections 3-4.
- Chip: 18px tile, 12.5px text, 18px badges, close; docked radii (`9 9 0 0` chip,
  `0 14 14 14` composer while chipped); border color swap via
  `--ag-colorPrimary` / `--ag-strip-input-border`.
- Clipboard payload exactly:
  `npx skills add Agenta-AI/agenta-skills` + blank line + "Then use the Agenta skills
  to create an agent that does the following:" + blank line + text (or
  `<describe your agent>`).
- Toast copy: "Copied — paste into Claude Code, Cursor, Codex, or any coding agent",
  2600ms.
- Verify: unit test `buildCodingAgentClipboard` (empty and non-empty); lint;
  type-check.

## S4. Home surface (flag-on branch)

- `pages/agent-home/index.tsx`: add the `TEMPLATE_STRIP_MODE` branch per design.md
  5a. Keep the flag-off JSX byte-for-byte (the collapsible Browse-templates and
  category dropdown are uncommitted session work; do not disturb them).
- `AgentComposer`: accept the strip-era trailing actions ("Use my coding agent" +
  "Create agent ->") and the chip/className coupling. Prefer new optional props over
  a fork; flag-off renders exactly today's buttons.
- `onCreate` flag-on passes `autoSendSeed: true`.
- Analytics per design.md section 8 (`mode: "strip"`, `surface: "home"`).
- Usage card restyle (design.md 5d) behind the same flag.
- Verify on the dev stack (see Verification below): flag on -> new layout, card pick
  fills + chips, ✕ keeps text, edit keeps chip, Create navigates to the playground and
  auto-sends, copy action + toast, usage card one-line. Flag off -> current home
  exactly (drawer, IDE modal, collapsible templates).

## S5. Playground onboarding surface

- `AgentChatEmptyState` onboarding branch: hero copy swap, drop starters/hint, strip
  below hero (design.md 5b). `AgentChatPanel` onboarding trailing actions: replace
  "Continue in IDE" with "Use my coding agent" under the flag; chip coupling on the
  chat composer.
- `OnboardingConfigPanel`: suppress quick-picks + Browse-all under the flag.
- Hide affordance: "..." menu -> collapses to "Templates hidden · show again";
  persists across reload; "show again" restores.
- Verify on the dev stack with `PLAYGROUND_NATIVE_ONBOARDING=true` +
  `NEXT_PUBLIC_AGENT_TEMPLATE_STRIP=true`, fresh account (no agents): hero + strip +
  composer; pick -> fill + chip; Create -> in-place commit + auto-send (no redirect
  flash); hide/show; copy + toast. Flag off -> current onboarding exactly.

## S6. Agent empty-chat surface

- `AgentChatPanel` normal mode: strip above the composer when `messages.length === 0`
  (design.md 5c), shared hidden atom, fill + chip via the panel's provenance instance,
  no actions row, suppressed while a `firstRunPrompt` is pending, unmounts once
  messages exist.
- Verify on the dev stack: open an existing agent with an empty chat -> strip shows;
  pick fills the chat composer + chip; send is a normal turn (model gate respected);
  strip gone after the first message; hide state shared with onboarding; non-empty
  chats unaffected; flag off -> no strip.

## S7. Polish, dark mode, docs, regression sweep

- Pixel pass against the prototypes in a browser (open the `.dc.html` files
  side-by-side). Light mode must match; dark mode must follow the design.md token
  table (verify yellow-primary selected states, white badges, fade blending, toast).
- `pnpm lint-fix` in `web/`; run the web unit tests.
- Keep-docs-in-sync: this workspace's `status.md`, plus a note in the onboarding
  handoff doc (`docs/design/onboarding-revamp/HANDOFF.md`) that the strip flag
  supersedes the collapsible-templates home layout when on.
- Full flag matrix regression per `context.md`: STRIP off with BUILDER on/off,
  ONBOARDING on/off (spot-check the four cells that exist today).

## Verification plan (dev stack)

- Stack: `144.76.237.122:8280` (EE dev). Use the `debug-local-deployment` skill for
  login/logs.
- Flag flip: edit `hosting/docker-compose/ee/.env.ee.dev.local`
  (`NEXT_PUBLIC_AGENT_TEMPLATE_STRIP=true`, and for S5
  `NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING=true`), then run
  `bash hosting/docker-compose/recreate-web.sh`. NEXT_PUBLIC vars are read at container
  start; source edits alone hot-reload, env changes do not.
- Matrix per milestone: {light, dark} x {home, onboarding, agent empty chat} x
  {flag on, flag off}. Dark theme via the app theme toggle.
- Behaviors to walk every time: tab filter (no height change, scroll reset), pager
  (arrows page by 3, counter, disabled at bounds, hidden when <= 3 cards), trackpad
  scroll + snap + fade, card pick/replace/clear, chip docking radii, Create per
  surface, copy + toast content (paste into a scratch buffer and diff against the
  spec string), hide/show persistence (reload), analytics events visible in the
  PostHog debug (or `posthog.capture` console spy).
- New accounts for onboarding tests: mint via the admin endpoint fixtures
  (`api/oss/tests/pytest/utils/accounts.py` pattern) or a fresh signup on the stack.
