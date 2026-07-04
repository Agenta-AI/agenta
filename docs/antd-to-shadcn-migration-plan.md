# antd → shadcn/ui Migration — Execution Plan

> **Goal: remove antd entirely and adopt shadcn/ui, as fast as possible, with minimum regression.**
> Three phases. antd and shadcn coexist throughout; migration is per-screen; **strictly no functional changes** (UI-layer swap only); **no color theming during the migration** (shadcn default colors now, brand pass later); the existing Playwright suite is the regression gate. Progress metric: **burn-down of `from "antd"` imports — 760 → 0.**
>
> **Base branch: `big-agents`** — all facts and counts below were re-verified against it (the codebase is ~15% larger here than on `main`; the stack and patterns are identical).

## Confirmed decisions

1. **No functional changes — hard rule.** This migration swaps the UI layer only. No behaviour, logic, data-flow, or API changes ride along in migration PRs. The proof is mechanical: every screen's existing functional Playwright spec must pass *unchanged in behaviour*.
2. **Design language:** adopt shadcn's *structural* language (spacing, gap, padding, radius, elevation, motion, component anatomy). **Colors: use shadcn's default palette for now — do not spend time on color theming during the migration.** Brand-color alignment is a **deferred, separate theming pass** after the migration settles (the existing `--ag-*` CSS-var bridge makes that later pass a token-swap, not a rework). Font family needs no work either — the app font (Inter, `--font-inter`) is inherited automatically.
3. **Tailwind stays on v3.4.19.** The v4 sub-migration happens *after* antd is gone (v4's preflight changes collide with the coexistence CSS strategy).
4. **Full antd removal.** No permanent antd islands — the low-volume no-equivalent widgets (`Tree`, `Cascader`, `TreeSelect`, `@ant-design/x`) get rebuilt in Phase 3 so the dependency can actually be deleted. They total ~10 files; keeping them would forfeit the entire payoff (bundle, teardown, single design system) to skip ~2–3 weeks of work.
5. **Evaluations is the one special-cased screen** — highest traffic + risk (large virtualized result tables), migrated last and most carefully. Everything else (incl. Playground, Observability/Traces, Testsets) goes through the normal flow.
6. **Test hardening is lazy, per-screen** — no upfront global pass over the 141 `.ant-*` locators; each screen's broken locators are fixed inside that screen's migration PR.
7. **shadcn base: Base UI (not Radix).** Since Jan 2026, `npx shadcn create` offers both with an identical component API. Base UI wins on all three criteria that matter here: **(a) feature coverage** — it natively ships `NumberField`, `Combobox`, `Autocomplete`, `Menu`/`Menubar`/`NavigationMenu`, and `Toast`, which Radix lacks (Radix needs cmdk for combobox and a hand-built NumberField); this directly shrinks our custom-build tier. **(b) maintenance trajectory** — Base UI is 1.0-stable and actively shipped by the MUI + ex-Radix + Floating UI team, while Radix has been in slow-maintenance mode since the WorkOS acquisition (long-standing combobox/React-19 issues, smaller core team, and Radix's own co-creator publicly calling it a last-resort option). **(c) performance** — tree-shakable with smaller reported bundles, and an active team to fix what surfaces. Risk (newer library, smaller ecosystem) is bounded: shadcn's API is identical across both bases, and the Phase-1 walking skeleton validates the choice before anything wide ships. ⚠️ **Status: the current scaffold on `feat/change-ui-library` was initialized with Radix (`radix-nova`), not Base UI — see the correction list in Phase 1, step 2.**

## Detected stack (facts, verified in repo)

| Concern | Finding |
|---|---|
| Frontend | `web/` pnpm monorepo (`oss/`, `ee/`, `packages/*`, `tests/`); Next.js 15.5.18 **Pages Router**; React 19 (`web/oss/package.json`) |
| antd | v6.1.3 + `@ant-design/icons`, `@ant-design/x` (1 file), `@ant-design/cssinjs`; **zero pro-components** |
| Tailwind | v3.4.19, `darkMode: "selector"`, **preflight already OFF** (`corePlugins.preflight: false`, `web/oss/tailwind.config.ts`) — Tailwind never resets antd today |
| Styling | Already Tailwind-first; `react-jss` in only 12 files; no LESS, no styled-components |
| Theme | antd `ConfigProvider` `cssVar: {key:"agenta"}` bridged to Tailwind via `--ag-*` CSS vars, flipped under `.dark` (`web/oss/src/components/Layout/ThemeContextProvider.tsx`, `web/oss/src/styles/theme-variables.css`); brand: navy `#1c2c3d` light / yellow `#f2f25c` dark; `fontSize: 12`, `controlHeight: 28`, `borderRadius: 8` (`web/oss/src/styles/tokens/antd-themeConfig.json`) |
| Tests | Playwright: 33 acceptance specs (`web/{oss,ee}/tests/playwright/acceptance/`), role-based fixtures, **no visual snapshots today**, 141 `.ant-*`-coupled locators, 6 files with `data-testid` |
| Census | **760 files import antd, 79 symbols.** Top: Typography 381, Button 329, Tooltip 146, Input 133, Tag 126, Space 69, Select 58, Dropdown 58, Form 43, Modal 40, message 38, Table 22 |
| shadcn footprint | None yet (no sonner/cva/RHF/TanStack Table in any package.json) |

**Two structural advantages that make this migration cheaper than typical:** (a) styling is already Tailwind — this is a component-behaviour swap, not a style rewrite; (b) the CSS-variable token bridge (`--ag-*`) already exists — colors are deliberately **not** themed during the migration (shadcn defaults for now), and when the deferred brand-theming pass happens, it's a token swap over this bridge rather than a rework.

**One inverted risk:** preflight is off *for antd's benefit*, but shadcn primitives *expect* preflight. We must give shadcn its reset scoped (a `.shadcn-scope` wrapper over Tailwind's base layer + primitives authored to be reset-independent), never globally — re-enabling global preflight would restyle all 760 antd files at once. This is the riskiest unknown and is deliberately resolved in the first week (Phase 1).

## Component census → work classification

- **Codemod tier (mechanical, scriptable):** Typography 381 (→ `span/h*/p/a` + text classes; shadcn has no Typography by design), Button 329, Tooltip 146, Input 133, Tag→Badge 126, Space/Flex 77 (→ `flex gap-*`, delete), Skeleton 58, Spin 55 (custom Spinner), Divider 37, Alert 33, Card 26, Tabs 25, Switch 25, Collapse→Accordion 16, Segmented→ToggleGroup 14, Radio 14, Checkbox 10, plus small fry (Slider, Badge, Progress, Avatar, Breadcrumb, Empty, Result, Descriptions…). Handled by **jscodeshift codemods + human review + specs**, directory by directory.
- **Composite tier (per-callsite reassembly):** Select+Combobox 58 (searchable/multi are the hard part — **Base UI ships Combobox/Autocomplete natively**, so no extra library), InputNumber→NumberField 21 (**native in Base UI** — was a from-scratch build under Radix), Dropdown 58 (config API → declarative), Popover 47, Modal→Dialog 40 (**centralized: `EnhancedModal` from `@agenta/ui` is already used in 62 files — re-point its internals and those call-sites migrate for free**; `Modal.confirm` → AlertDialog promise helper), message/notification→**Sonner** 42 (also retires the antd `App` context), Drawer→Sheet 14, Splitter→Resizable 5, DatePicker→Calendar+Popover 3, AutoComplete 1, Popconfirm 1, Grid/Layout→CSS ~10.
- **Rewrite tier (the real cost):** **Form 43 → react-hook-form + zod**; **Table 22 → TanStack Table + shadcn markup** (virtualization mandatory — evaluation/observability tables are large-dataset). Both go through shared wrappers built in Phase 1 so per-file conversion is mechanical.
- **Custom-build tier (no shadcn/Base UI equivalent, low volume, Phase 3):** Upload 6 (react-dropzone), Tree 4, Cascader 3, TreeSelect 2, `@ant-design/x` 1. Menu 3 (main nav) drops to a light lift — Base UI ships Menu/Menubar/NavigationMenu primitives, so only the nav's design pass remains; most `MenuProps` imports are Dropdown typing anyway.

Libraries we integrate directly (everything else comes with shadcn's CLI and is not our concern): `react-hook-form` + `@hookform/resolvers` + `zod`, `@tanstack/react-table`, `react-dropzone`.

---

# The three phases

## Phase 1 — Foundation & proof (short, timeboxed; nothing user-facing changes except one small screen)

**Objective: de-risk every unknown and build every shared asset, so Phase 2 is pure throughput.**

1. **Scoped preflight (the critical spike, timebox: days).** `.shadcn-scope`-wrapped Tailwind base layer + primitives written reset-independent (`box-border`, explicit borders, `appearance-none`) as a coding standard. Fallback if scoping fights the cascade: rely on reset-independent primitives alone. Plays into the existing `@layer tailwind-base, antd` ordering in `globals.css`.
2. **shadcn home: `@agenta/primitive-ui` (`web/packages/agenta-primitive-ui`).** Scaffolded on branch `feat/change-ui-library` — the name stays as-is for now (deliberate: `@agenta/ui` already exists; no rename churn during the migration). shadcn components live *only* in this package — no raw `components/ui/` in `web/oss`. Take the **default theme as-is**: default color palette, default `--background`/`--primary`/`--border`/… values, default radius. **No color theming work now** — brand-color alignment is a deferred pass (decision 2). Only wire the dark-mode switch: shadcn's `.dark` token block hooks into the existing `darkMode: "selector"` / `.dark` mechanism, so both systems flip together. Inter is inherited from the app automatically.
   **Outstanding corrections on the branch (verified against `feat/change-ui-library` @ `89b5238322`):**
   - **The scaffold is Radix, not Base UI** — `components.json` says `style: "radix-nova"`, the package and `web/oss` both depend on `radix-ui@^1.6`, and `button.tsx` imports `Slot` from `radix-ui`; zero Base UI references exist on the branch. Re-init with a Base UI style to honour decision 7 (cheap now at one component; expensive after fifty).
   - **Duplicate app-level scaffold must go** — `web/oss/components.json`, `web/oss/src/components/ui/button.tsx`, and `web/oss/src/lib/utils.ts` scaffold shadcn *into the app*, and `web/oss/components.json`'s aliases point future `shadcn add` runs at `@/oss/components/ui`. Delete these and the shadcn deps added to `web/oss/package.json` (`radix-ui`, `shadcn`, `class-variance-authority`, `tailwind-merge`, `tw-animate-css`); the package is the only shadcn home.
   - **Tailwind pipeline mismatch** — the package is authored in Tailwind **v4** syntax (`@theme inline`, `@custom-variant`, `@source`; `tailwindcss@^4.1` devDep) while the app compiles with **v3.4** (decision 3). The app's v3 pipeline scans the package via a content glob but has no `primary`/`foreground`/`ring` theme keys, so shadcn utility classes (`bg-primary`, `ring-ring/50`, …) **won't be generated — components will render unstyled**. Also `web/oss/src/styles/globals.css` now imports `shadcn/tailwind.css` (v4-syntax CSS) into the v3 pipeline. Resolve one way: either author the package in v3-compatible form (tokens registered in the shared `tailwind.config.ts`), or have the package pre-build its own CSS with v4 and ship the compiled stylesheet — but don't mix v4 directives into the v3 build.
   - **Preflight not yet scoped** — the package CSS `@import "tailwindcss"` (v4) includes global preflight; if that stylesheet is ever loaded by the app it clobbers antd everywhere. This is exactly Phase-1 item 1 — must be resolved before the walking skeleton.
   - Minor: `shadcn` CLI pinned as a runtime dependency in both `web/oss` (`^4.12`) and the package (`4.11.0`) — move to devDependencies (or use `pnpm dlx`) and align versions.
3. **shadcn primitives convention.** Primitives get `data-testid` hooks by construction and are authored reset-independent (see item 1).
4. **The four shared assets, built in parallel** (they gate everything downstream):
   - `<Form>` wrapper (RHF + zod; `FormField`/`FormList`/imperative handle mirroring `Form.useForm`),
   - `<DataTable>` wrapper (TanStack + virtualization; antd `columns` → `ColumnDef` adapter; reuse `InfiniteVirtualTable` patterns),
   - **Sonner** toaster (imperative `message`/`notification` replacement),
   - **`EnhancedModal` internals → Dialog** (one wrapper, 62 consuming files cascade).
5. **Codemod suite.** jscodeshift transforms for the codemod tier, dry-run validated against the repo.
6. **Walking skeleton.** Migrate one small leaf-only screen end-to-end — Settings → API keys (existing spec: `oss/tests/playwright/acceptance/settings/api-keys-management.spec.ts`). Proves: scoped preflight, shadcn default theme + dark-mode flip render correctly alongside antd, Sonner, and the merge gate.

**Exit criteria:** skeleton screen live behind a green functional spec with zero antd imports in its subtree; codemods dry-run clean; wrappers API-reviewed. **If the preflight spike fails its timebox, stop and rethink — nothing else is at risk yet.**

## Phase 2 — Mass migration (parallel tracks, burn-down driven)

**Objective: retire the maximum number of antd imports per week without ever breaking a shipped screen.**

Three tracks run concurrently (they don't contend — different files, different skills):

- **Track A — codemod rollout.** Run the Tier-A codemods directory-by-directory. Each batch: codemod → human review → functional specs for affected screens → merge. Small, revertable PRs. This alone retires the bulk of the 760 files (Typography + Button + Tooltip + Input + Tag ≈ 1,100+ import sites).
- **Track B — composites.** Select/Combobox (sequence searchable/multi last), InputNumber→NumberField, Dropdown, Popover, Drawer, remaining Modal stragglers, Grid/Layout. Sonner rollout completes here (42 files), which also removes the antd `App` context.
- **Track C — Form/Table rewrites, screen by screen, ascending risk.** Using the Phase-1 wrappers: Settings forms → Testset management → Prompts → Observability/Traces → Deployment → Playground. **Evaluations is explicitly excluded from Phase 2.** One screen = one PR; no half-screens (avoids mixed design language within a page).

**Merge gate (every PR, all tracks):**
1. **No functional changes** — the PR swaps UI components only; no behaviour, logic, data-flow, or API changes ride along. The affected screens' **functional Playwright specs pass** — the hard gate. Broken `.ant-*` locators for that screen are fixed in the same PR (role/`data-testid` selectors; fixtures already favour `getByRole`).
2. **Zero `from "antd"` imports** in the migrated subtree.
3. Reviewer eyeballs the screen (visual snapshots are *not* merge-blocking — the look intentionally changes; baselines are captured in one batch pass in Phase 3).

**Regression controls:** coexistence isolation (unmigrated screens untouched by construction — scoped preflight guarantees no CSS bleed), codemods instead of hand edits (uniform, reviewable, revertable), wrappers make rewrites mechanical, burn-down dashboard (`grep -c 'from "antd"'`) reviewed weekly to steer effort at what retires the most imports.

**Exit criteria:** every screen except Evaluations is antd-free; antd imports remaining ≈ Evaluations + the custom-build tier.

## Phase 3 — Hard core, custom builds, and removal

**Objective: finish the highest-risk surface, build the last widgets, delete antd.**

1. **Evaluations** — migrated last with the most care: the large virtualized result tables on the `<DataTable>` wrapper (proven across ~17 tables by now), full functional spec pass, staged rollout if needed.
2. **Custom-build tier:** Upload (react-dropzone), Menu (main nav — Base UI primitives cover the mechanics, short design pass for the IA), the tree family (Tree/TreeSelect/Cascader — one headless tree foundation, e.g. react-arborist, covers all three; 9 files), and the `@ant-design/x` chat surface (1 file). InputNumber left this tier — Base UI's NumberField covers it in Track B. Each remaining item gets a brief design/API review before build — they're last precisely because they need thinking, not because they're optional.
3. **Teardown:** remove `ConfigProvider`/`theme`/`@ant-design/*`/`react-jss` remnants; drop antd from every `package.json`. Tremor's Tailwind theme reads antd's `getDesignToken()` at config time, so re-point it at static values or the shadcn vars before antd is deleted. The `--ag-*` bridge can stay as the substrate for the **deferred brand-theming pass** (colors), which happens after the migration — not during it.
4. **Final regression pass:** full Playwright suite on OSS + EE; **capture the visual-snapshot baseline set in one batch** — from here on, snapshots guard the shadcn UI against future drift (this is where visual testing starts paying rent, on a stable target).

**Exit criteria: `grep -r 'from "antd"' web/ → 0`, antd absent from all lockfiles, full suite green, baseline snapshots committed.**

---

## Why this is both the fastest and the safest shape

- **Fast:** the only serial dependency is Phase 1 (short, timeboxed); Phase 2 is three parallel tracks with codemods carrying the volume; the two long poles (Form/Table wrappers) start on day one inside Phase 1.
- **Safe:** every risky unknown (preflight scoping, default-theme rendering, gate flow) is resolved on one tiny screen before anything wide happens; **no functional changes is a hard rule**, so the behavioural gate (functional specs) fully covers what can regress; color theming is deliberately out of scope, removing a whole class of churn; screens are migrated whole and isolated, so a bad PR affects one screen and reverts cleanly; the scariest screen (Evaluations) goes last on battle-tested infrastructure.
- **Minimum regression:** no CSS can leak between the two systems (scoped preflight + preflight-off status quo); codemods eliminate hand-edit variance; locator fixes ship atomically with the screen they cover, so the test net never has a coverage hole; the burn-down metric makes "done" objective rather than vibes.

## Rough effort (t-shirt, validated after Phase 1)

| Item | Size |
|---|---|
| Phase 1 total (spike + tokens + 4 shared assets + codemods + skeleton) | **M** |
| Track A codemod rollout (~700 files) | **M–L** (volume, largely scripted) |
| Track B composites (Select is the bulk) | **L** |
| Track C Form (43) + Table (22) rewrites | **XL** — the dominant cost |
| Phase 3 Evaluations + custom builds + teardown | **L** |

Largest cost drivers: Form rewrites, Table rewrites, Select/Combobox variants. Biggest schedule levers: codemods, parallel tracks, wrappers-first.
