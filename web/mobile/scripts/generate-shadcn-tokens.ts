/**
 * generate-shadcn-tokens.ts — bridge the workspace theme source of truth
 * (web/oss/src/styles/theme/palette.ts) into shadcn/ui CSS variables for the
 * mobile app, light + dark.
 *
 * Follows the pattern of web/scripts/generate-tailwind-tokens.ts: palette.ts
 * is the ONLY color input; this file only chooses which palette role feeds
 * which shadcn variable. The output (src/styles/theme.generated.css) is
 * committed and must never be edited by hand — change palette.ts or the ROLE
 * MAP below and rerun.
 *
 * Run (from web/mobile): pnpm generate:tokens
 */
import {readFileSync, writeFileSync} from "fs"
import {dirname, resolve} from "path"
import {fileURLToPath} from "url"

import {palette, type ColorValue} from "../../oss/src/styles/theme/palette"

const HERE = dirname(fileURLToPath(import.meta.url)) // web/mobile/scripts
const OUT = resolve(HERE, "../src/styles/theme.generated.css")

/**
 * Palette values are plain strings (a color, or a whole shadow list) except antd() refs, which
 * defer to antd's algorithm default — mobile has no antd to resolve them, so they are rejected.
 */
const color = (v: ColorValue): string => {
    if (typeof v !== "string") {
        throw new Error(`Palette value is an antd() ref, not a color: ${JSON.stringify(v)}`)
    }
    return v
}

const p = palette

// ROLE MAP — which palette role feeds which shadcn variable. The single place
// to retune the bridge. Values are [light, dark].
// Installing a shadcn component that references a NEW token (e.g. bg-sidebar,
// chart-*) requires extending VARS + the @theme inline map first — Tailwind v4
// silently generates nothing for unmapped tokens.
const VARS: Record<string, [string, string]> = {
    // ── Shared @agenta/ui presentational vocabulary (antd-semantic names) ──
    // These let package components (NavMenu, session rows, PanelSection) render verbatim on
    // mobile: same palette source, same class names, mobile's own light/dark values.
    colorText: [color(p.text.primary.light), color(p.text.primary.dark)],
    colorTextSecondary: [color(p.text.secondary.light), color(p.text.secondary.dark)],
    colorTextTertiary: [color(p.text.tertiary.light), color(p.text.tertiary.dark)],
    colorTextQuaternary: [color(p.text.quaternary.light), color(p.text.quaternary.dark)],
    colorBorder: [color(p.border.default.light), color(p.border.default.dark)],
    colorBorderSecondary: [color(p.border.secondary.light), color(p.border.secondary.dark)],
    colorBgContainer: [color(p.surface.container.light), color(p.surface.container.dark)],
    colorBgElevated: [color(p.surface.elevated.light), color(p.surface.elevated.dark)],
    colorFill: [color(p.fill.fill.light), color(p.fill.fill.dark)],
    colorFillSecondary: [color(p.fill.secondary.light), color(p.fill.secondary.dark)],
    colorFillTertiary: [color(p.fill.tertiary.light), color(p.fill.tertiary.dark)],
    colorFillQuaternary: [color(p.fill.quaternary.light), color(p.fill.quaternary.dark)],
    colorPrimary: [color(p.accent.primary.light), color(p.accent.primary.dark)],
    colorSuccess: [color(p.semantic.success.light), color(p.semantic.success.dark)],
    colorSuccessBg: [color(p.semantic.successBg.light), color(p.semantic.successBg.dark)],
    colorSuccessText: [color(p.semantic.success.light), color(p.semantic.success.dark)],
    colorWarning: [color(p.semantic.warning.light), color(p.semantic.warning.dark)],
    colorWarningBg: [color(p.semantic.warningBg.light), color(p.semantic.warningBg.dark)],
    colorWarningText: [color(p.semantic.warningText.light), color(p.semantic.warningText.dark)],
    colorError: [color(p.semantic.error.light), color(p.semantic.error.dark)],
    colorInfoBorder: [color(p.semantic.infoBorder.light), color(p.semantic.infoBorder.dark)],
    // The custom 10-step zinc ramp @agenta/ui's shared styles use (`text-zinc-9`, `bg-zinc-1`).
    // NOT Tailwind's default zinc — a token-mapped brand ramp; the two-digit default scale is a
    // different, theme-blind thing.
    ...Object.fromEntries(
        Object.entries(p.scales.zinc).map(([step, pair]) => [
            `zinc-${step}`,
            [color(pair.light), color(pair.dark)] as [string, string],
        ]),
    ),
    // Section-row icons, chip fills and the destructive/neutral hover fills the shared drill-in
    // controls paint with. Verified missing from the mobile bundle while oss generated them.
    colorIcon: [color(p.text.icon.light), color(p.text.icon.dark)],
    colorIconHover: [color(p.text.iconHover.light), color(p.text.iconHover.dark)],
    colorTextHeading: [color(p.text.heading.light), color(p.text.heading.dark)],
    colorTextDescription: [color(p.text.description.light), color(p.text.description.dark)],
    colorTextDisabled: [color(p.text.disabled.light), color(p.text.disabled.dark)],
    colorWhite: [color(p.surface.white.light), color(p.surface.white.dark)],
    colorFillChip: [color(p.fill.chip.light), color(p.fill.chip.dark)],
    colorErrorBg: [color(p.semantic.errorBg.light), color(p.semantic.errorBg.dark)],
    controlItemBgHover: [
        color(p.fill.quaternary.light),
        color(p.fill.quaternary.dark),
    ],
    // The overlay/status vocabulary the kit's PORTALED surfaces paint with — Tooltip
    // (colorBgSpotlight + colorTextLightSolid), DropdownMenu/Select (colorSplit separators) and the
    // session/status dots (colorInfo). Every one was undefined on mobile: a tooltip rendered as
    // bare text on no background, a dropdown separator as an invisible line.
    colorBgSpotlight: [color(p.surface.spotlight.light), color(p.surface.spotlight.dark)],
    colorTextLightSolid: [color(p.text.lightSolid.light), color(p.text.lightSolid.dark)],
    colorSplit: [color(p.border.split.light), color(p.border.split.dark)],
    colorInfo: [color(p.semantic.info.light), color(p.semantic.info.dark)],
    colorBgLayout: [color(p.surface.layout.light), color(p.surface.layout.dark)],
    colorBgMask: [color(p.surface.mask.light), color(p.surface.mask.dark)],
    colorBgContainerDisabled: [
        color(p.surface.containerDisabled.light),
        color(p.surface.containerDisabled.dark),
    ],
    colorTextPlaceholder: [color(p.text.placeholder.light), color(p.text.placeholder.dark)],
    colorTextLabel: [color(p.text.label.light), color(p.text.label.dark)],
    colorPrimaryBorder: [
        color(p.semantic.primaryBorder.light),
        color(p.semantic.primaryBorder.dark),
    ],
    colorPrimaryBorderHover: [
        color(p.semantic.primaryBorderHover.light),
        color(p.semantic.primaryBorderHover.dark),
    ],
    // The PAGE surface, and it is `surface.container` — NOT `surface.base`. The desktop shell
    // paints its content area #141414 dark / #fff light (Layout/assets/styles.ts), which is
    // exactly this role; `surface.base` is pure black and made every mobile screen read a full
    // step darker than the same page on desktop. The rail stays one step below it
    // (`--ag-sidebar-bg` = shell.railBg #121316), as on desktop.
    background: [color(p.surface.container.light), color(p.surface.container.dark)],
    foreground: [color(p.text.primary.light), color(p.text.primary.dark)],
    // Cards must sit ABOVE the page now that the page is `container` — same step the desktop
    // rail cards use (`colorBgElevated`).
    card: [color(p.surface.elevated.light), color(p.surface.elevated.dark)],
    "card-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
    popover: [color(p.surface.elevated.light), color(p.surface.elevated.dark)],
    "popover-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
    primary: [color(p.accent.primary.light), color(p.accent.primary.dark)],
    // Light primary is brand navy → white text; dark primary is brand yellow →
    // dark text (mirrors componentsDark.Button.primaryColor in palette.ts).
    "primary-foreground": [color(p.surface.white.light), p.componentsDark.Button.primaryColor],
    secondary: [color(p.scales.zinc[1].light), color(p.scales.zinc[1].dark)],
    "secondary-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
    muted: [color(p.scales.zinc[1].light), color(p.scales.zinc[1].dark)],
    "muted-foreground": [color(p.text.secondary.light), color(p.text.secondary.dark)],
    // Dark accent is a NEUTRAL step, not controlItemBgActive.dark (#57572a):
    // shadcn `accent` drives ghost/outline hover fills and the skeleton base.
    // The selection-tint yellow stays desktop-only; introduce a separate token
    // if a selected-state tint is needed later.
    accent: [color(p.surface.controlItemBgActive.light), color(p.scales.zinc[2].dark)],
    "accent-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
    destructive: [color(p.semantic.error.light), color(p.semantic.error.dark)],
    // Not a shadcn role: session liveness needs a third state between the accent (a turn is
    // running, act on it) and muted (ended). Same semantic family the desktop uses for "healthy".
    success: [color(p.semantic.success.light), color(p.semantic.success.dark)],
    // Bright-red fill gets dark text in dark mode, matching the primary treatment.
    "destructive-foreground": [color(p.surface.white.light), p.componentsDark.Button.primaryColor],
    border: [color(p.border.secondary.light), color(p.border.secondary.dark)],
    input: [color(p.border.default.light), color(p.border.default.dark)],
    // ── The surface LADDER, emitted under its desktop `--ag-surface-*` names ──
    // `@agenta/ui/surfaces.css` styles `.ag-app-ground` / `.ag-panel-raised` / `.ag-canvas` /
    // `.ag-surface-card` from these literal names. Without them every shared panel renders on a
    // flat background: the components are identical, but the raised/recessed contrast that makes
    // the desktop workspace read as layered simply is not there.
    "ag-surface-app": [color(p.playgroundSurface.app.light), color(p.playgroundSurface.app.dark)],
    "ag-surface-gutter": [
        color(p.playgroundSurface.gutter.light),
        color(p.playgroundSurface.gutter.dark),
    ],
    "ag-surface-divider": [
        color(p.playgroundSurface.divider.light),
        color(p.playgroundSurface.divider.dark),
    ],
    "ag-surface-raised": [
        color(p.playgroundSurface.raised.light),
        color(p.playgroundSurface.raised.dark),
    ],
    "ag-surface-card": [color(p.playgroundSurface.card.light), color(p.playgroundSurface.card.dark)],
    "ag-surface-card-border": [
        color(p.playgroundSurface.cardBorder.light),
        color(p.playgroundSurface.cardBorder.dark),
    ],
    "ag-surface-inset": [
        color(p.playgroundSurface.inset.light),
        color(p.playgroundSurface.inset.dark),
    ],
    "ag-surface-inset-border": [
        color(p.playgroundSurface.insetBorder.light),
        color(p.playgroundSurface.insetBorder.dark),
    ],
    "ag-surface-canvas": [
        color(p.playgroundSurface.canvas.light),
        color(p.playgroundSurface.canvas.dark),
    ],
    "ag-surface-chat": [color(p.playgroundSurface.chat.light), color(p.playgroundSurface.chat.dark)],
    "ag-surface-chat-border": [
        color(p.playgroundSurface.chatBorder.light),
        color(p.playgroundSurface.chatBorder.dark),
    ],
    "ag-surface-row-hover": [
        color(p.playgroundSurface.rowHover.light),
        color(p.playgroundSurface.rowHover.dark),
    ],
    "ag-surface-raised-shadow": [
        color(p.playgroundSurface.raisedShadow.light),
        color(p.playgroundSurface.raisedShadow.dark),
    ],
    "ag-surface-card-shadow": [
        color(p.playgroundSurface.cardShadow.light),
        color(p.playgroundSurface.cardShadow.dark),
    ],
    "ag-surface-inspector-shadow": [
        color(p.playgroundSurface.inspectorShadow.light),
        color(p.playgroundSurface.inspectorShadow.dark),
    ],
    // ── App-shell vars, emitted under their desktop `--ag-` names ──
    // The shared SidebarShell styles the rail with `var(--ag-sidebar-bg)`/`var(--ag-shell-line)`
    // literally, so mobile must publish the same names off the same palette roles.
    "ag-sidebar-bg": [color(p.shell.railBg.light), color(p.shell.railBg.dark)],
    "ag-shell-line": [color(p.shell.line.light), color(p.shell.line.dark)],
    ring: [color(p.accent.primary.light), color(p.accent.primary.dark)],
    // ── @agenta/ui control primitives (Button/Input/Switch) ──
    // The kit's state tokens, fed from the SAME palette roles that generate the desktop
    // --ag-* layer, so a shared control renders identically in both apps.
    placeholder: [color(p.text.placeholder.light), color(p.text.placeholder.dark)],
    "focus-ring": [color(p.semantic.primaryBorder.light), color(p.semantic.primaryBorder.dark)],
    disabled: [color(p.text.disabled.light), color(p.text.disabled.dark)],
    "disabled-bg": [
        color(p.surface.containerDisabled.light),
        color(p.surface.containerDisabled.dark),
    ],
    "disabled-border": [
        color(p.button.disabledInputBorder.light),
        color(p.button.disabledInputBorder.dark),
    ],
    error: [color(p.semantic.error.light), color(p.semantic.error.dark)],
    "error-hover": [color(p.semantic.errorHover.light), color(p.semantic.errorHover.dark)],
    "error-active": [color(p.semantic.errorActive.light), color(p.semantic.errorActive.dark)],
    "btn-primary-fg": [color(p.button.primaryText.light), color(p.button.primaryText.dark)],
    "btn-primary-hover": [color(p.button.primaryHover.light), color(p.button.primaryHover.dark)],
    "btn-primary-active": [color(p.button.primaryActive.light), color(p.button.primaryActive.dark)],
    "btn-default-bg": [color(p.button.defaultBg.light), color(p.button.defaultBg.dark)],
    "btn-default-hover-bg": [
        color(p.button.defaultHoverBg.light),
        color(p.button.defaultHoverBg.dark),
    ],
    "btn-default-active-bg": [
        color(p.button.defaultActiveBg.light),
        color(p.button.defaultActiveBg.dark),
    ],
    "btn-text-hover-bg": [color(p.button.textHoverBg.light), color(p.button.textHoverBg.dark)],
    "btn-text-active-bg": [color(p.button.textActiveBg.light), color(p.button.textActiveBg.dark)],
    "btn-link": [color(p.button.link.light), color(p.button.link.dark)],
    "btn-link-hover": [color(p.button.linkHover.light), color(p.button.linkHover.dark)],
    "btn-link-active": [color(p.button.linkActive.light), color(p.button.linkActive.dark)],
    // Plain vars referenced VERBATIM inside the kit's arbitrary shadow values
    // (shadow-[0_2px_0_var(--ag-controlOutline)]) — emitted with the desktop's exact names.
    "ag-controlOutline": [
        color(p.surface.controlOutline.light),
        color(p.surface.controlOutline.dark),
    ],
    "ag-errorOutline": [color(p.surface.errorOutline.light), color(p.surface.errorOutline.dark)],
    "ag-colorFillQuaternary": [color(p.fill.quaternary.light), color(p.fill.quaternary.dark)],
    // A full shadow list, not a color — globals.css feeds it to the `shadow-switch-handle`
    // utility the kit's Switch thumb wears, so it flips with the theme like every other token.
    "switch-handle-shadow": [color(p.shadow.switchHandle.light), color(p.shadow.switchHandle.dark)],
    // RichChatInput (the shared composer) styles itself with raw --ag-* custom properties —
    // undefined vars would collapse its border-color to currentColor. Same palette roles that
    // generate the desktop layer.
    "ag-composer-border": [color(p.composer.border.light), color(p.composer.border.dark)],
    "ag-composer-focus": [color(p.composer.focus.light), color(p.composer.focus.dark)],
    "ag-composer-placeholder": [
        color(p.composer.placeholder.light),
        color(p.composer.placeholder.dark),
    ],
    "ag-send-disabled-bg": [
        color(p.composer.sendDisabledBg.light),
        color(p.composer.sendDisabledBg.dark),
    ],
    "ag-send-disabled-fg": [
        color(p.composer.sendDisabledFg.light),
        color(p.composer.sendDisabledFg.dark),
    ],
    "ag-colorText": [color(p.text.primary.light), color(p.text.primary.dark)],
    "ag-colorTextSecondary": [color(p.text.secondary.light), color(p.text.secondary.dark)],
    "ag-colorFillSecondary": [color(p.fill.secondary.light), color(p.fill.secondary.dark)],
    "ag-colorFillTertiary": [color(p.fill.tertiary.light), color(p.fill.tertiary.dark)],
    "ag-surface-accent": [
        color(p.playgroundSurface.accent.light),
        color(p.playgroundSurface.accent.dark),
    ],
    "ag-surface-chat-shadow": [
        color(p.playgroundSurface.chatShadow.light),
        color(p.playgroundSurface.chatShadow.dark),
    ],
    "ag-surface-chip": [
        color(p.playgroundSurface.chip.light),
        color(p.playgroundSurface.chip.dark),
    ],
    "ag-surface-chip-border": [
        color(p.playgroundSurface.chipBorder.light),
        color(p.playgroundSurface.chipBorder.dark),
    ],
}

const block = (selector: string, side: 0 | 1) =>
    `${selector} {\n${Object.entries(VARS)
        .map(([name, pair]) => `    --${name}: ${pair[side]};`)
        .join("\n")}\n}\n`

const css = `/* GENERATED by scripts/generate-shadcn-tokens.ts — DO NOT EDIT.
 * Source of truth: web/oss/src/styles/theme/palette.ts
 * Regenerate: pnpm --filter @agenta/mobile generate:tokens
 */
${block(":root", 0)}
${block(".dark", 1)}`

// --check: drift guard — fail (without writing) if the committed file is stale.
if (process.argv.includes("--check")) {
    let existing: string | null = null
    try {
        existing = readFileSync(OUT, "utf8")
    } catch {
        existing = null
    }
    if (existing !== css) {
        console.error(
            "theme.generated.css is stale — run pnpm --filter @agenta/mobile generate:tokens",
        )
        process.exit(1)
    }
    process.exit(0)
}

writeFileSync(OUT, css)
console.log(`wrote ${OUT}`)
