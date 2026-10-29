# App-vs-raw-antd divergence audit (Enhanced\* wrappers + global overrides)

> **Why this exists.** Our `@agenta/ui` primitives were built to match **raw antd** in Storybook.
> But the OSS/EE apps rarely render raw antd — they render through **wrappers** (`Enhanced*`) and a
> layer of **global CSS overrides**. This audit inventories every place the app diverges from raw
> antd, quantifies the divergence, records whether it's justified, and flags consolidation.
> **Date:** 2026-07-26.

## Verdict up front
- The **global** layer (antd theme tokens + `globals.css`) is applied **faithfully** in Storybook
  (verified empirically — tokens + cssVars match), so anything global is already in the VRT baseline.
- The **only** divergences that raw-antd VRTs can miss are the **3 `Enhanced*` wrappers**. Of those,
  **only Modal has a VISUAL divergence** (`borderRadius:16`, already fixed in Dialog/AlertDialog).
  Drawer and Button diverge **behaviorally only** (lazy-mount, outside-click, tooltip-bundle) → no
  visual gap for Sheet/Button.
- Every divergence has a **good reason** → they should be **folded into the primitives**, not dropped.
  This is the "Primitive-from-wrapper" consolidation already sketched in `agenta-ui-consolidation.md`.

---

## A. Global overrides — NO gap (already in the VRT baseline)

`globals.css` is imported by Storybook, so the antd half of every VRT already includes these.

| Override | Scope | Affects a primitive? |
|---|---|---|
| `.ag-icon-segmented .ant-segmented-item-label { flex-center }` | opt-in class | Segmented — my primitive centers icons by default (equivalent/better); VRT icon-only = 1.67% (floor) |
| `.dark .auth-locked-input.ant-input-disabled …` | feature class | no (auth screens) |
| `.comparison-table .ant-table-*`, `.evaluation-filters …` | feature class | no (Table not migrated) |
| `.ant-cascader-menu-* { hide loading icon }` | Cascader | no (not migrated) |
| `.agenta-dynamic-code-block` bg strip | editor | no |

→ No general antd-component appearance override is missing from the baseline.

---

## B. `Enhanced*` wrappers — the audit target

Each exists in **two** copies (`oss/src/components/EnhancedUIs/*` and `packages/agenta-ui/*`) — a
duplication in its own right.

| Wrapper | ~Consumers | **Visual** divergence vs raw antd | **Behavioral** divergence | Reason (justified?) | My primitive |
|---|---|---|---|---|---|
| **EnhancedModal** | ~80 (oss 20 + pkg 60) | **`borderRadius: 16`** (raw antd = 10) | lazy mount-on-open; `maxHeight: 90vh` + internal body scroll; `centered`; `destroyOnHidden`; smart container/body/footer style-merge | ✅ small-screen UX + brand radius | **Dialog/AlertDialog**: radius ✅ **fixed**; **maxHeight/scroll ❌ missing**; lazy ❌ |
| **EnhancedDrawer** | (oss + pkg differ slightly) | **none** | lazy mount-on-open; `width`→`styles` merge; `mask:{blur:false}` (= antd default); `closeOnLayoutClick` (outside-click) | ✅ perf + outside-click UX | **Sheet**: visual ✅; lazy/outside-click ❌ |
| **EnhancedButton** | (oss=antd Button; pkg=our Button) | **none** | bundles a `Tooltip` (`label`+`tooltipProps`) | ✅ convenience | **Button**: compose `Tooltip`+`Button asChild` ✅ |

### Notes
- **EnhancedModal is duplicated AND tripled in concept**: oss `EnhancedUIs/Modal` (20) + package
  `EnhancedModal` (60) both do `borderRadius:16` + `maxHeight:90vh` + lazy; my Radix `Dialog` is a
  third modal that now matches the radius but not the height/scroll/lazy behavior.
- **EnhancedButton (package)** already renders our migrated `@agenta/ui` Button; the oss copy still
  wraps antd `Button` → the oss copy is strictly redundant.
- **EnhancedDrawer** copies differ slightly (oss adds `closeOnLayoutClick`); otherwise the same
  width/mask plumbing. No visual divergence either way.

---

## C. Consolidation opportunity

The divergences are legitimate, so the move is to **fold them into the `@agenta/ui` primitives** and
delete the wrappers (the map's "Primitive-from-wrapper"):

1. **Dialog ← EnhancedModal. ✅ DONE (2026-07-26).** The package `EnhancedModal` is now an antd-`Modal`-
   compatible **facade over the Radix `Dialog`** (lazy mount, maxHeight 90vh + body scroll, radius 16,
   default footer, prop translation). Both EnhancedModals (~80 consumers) resolve to it — the oss
   `EnhancedUIs/Modal` is a thin re-export. VRT-verified ~1.4% (floor) vs the app's real modal config.
2. **Sheet ← EnhancedDrawer. ✅ DONE (2026-07-26).** The package `EnhancedDrawer` (`@agenta/ui/drawer`)
   is now an antd-`Drawer`-compatible **facade over the Radix `Sheet`** (lazy mount, width/height,
   placement→side, borderless panel + directional shadow, internal body scroll, prop translation). The
   oss `EnhancedUIs/Drawer` is a thin re-export. VRT-verified < 0.5% vs the app's antd drawer.
3. **Button ← EnhancedButton. ✅ DONE (2026-07-26).** The package `EnhancedButton` is now an
   antd-`Button`/`Tooltip`-compatible **facade over the `@agenta/ui` Button + Radix Tooltip** —
   translates `type`/`danger`→variant, `size`→size, `icon`→leading child, `loading`→LoadingButton,
   `htmlType`→native type; `tooltipProps.title`→Radix tooltip (placement→side). The oss
   `EnhancedUIs/Button` is a thin re-export. Fully off antd; call-sites unchanged. (It composes the
   already-VRT-verified Button + Tooltip, so no new pixel gate needed.)

### Only real *visual* gap found: Modal radius (fixed)
Everything else is behavioral. Behavioral parity (scroll/lazy/outside-click) isn't caught by the
pixel VRT (short static content) but IS needed for a faithful call-site swap — it belongs in the
consolidation, not a quick patch.
