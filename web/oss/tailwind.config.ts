import {theme} from "antd"
import type {Config} from "tailwindcss"
import colors from "tailwindcss/colors"

import antdTailwind from "./src/styles/tokens/antd-tailwind.json"
const token = theme.getDesignToken()

// Theme-aware colors backed by CSS variables defined in styles/theme-variables.css.
// Light values are unchanged; the `.dark` selector flips the variables. Any class
// using these scales (zinc/gray/ag-gray) or the antd semantic token names therefore
// adapts to dark mode automatically without per-component `dark:` variants.
const v = (name: string) => `var(--ag-${name})`
const themeAwareColors = {
    zinc: {
        1: v("zinc-1"),
        2: v("zinc-2"),
        3: v("zinc-3"),
        4: v("zinc-4"),
        5: v("zinc-5"),
        6: v("zinc-6"),
        7: v("zinc-7"),
        8: v("zinc-8"),
        9: v("zinc-9"),
        10: v("zinc-10"),
    },
    gray: {
        50: v("gray-50"),
        100: v("gray-100"),
        200: v("gray-200"),
        300: v("gray-300"),
        400: v("gray-400"),
        500: v("gray-500"),
        600: v("gray-600"),
        700: v("gray-700"),
        800: v("gray-800"),
        900: v("gray-900"),
        950: v("gray-950"),
    },
    "ag-gray": {
        25: v("aggray-25"),
        50: v("aggray-50"),
        100: v("aggray-100"),
        200: v("aggray-200"),
        300: v("aggray-300"),
        400: v("aggray-400"),
        500: v("aggray-500"),
        600: v("aggray-600"),
        700: v("aggray-700"),
        800: v("aggray-800"),
        900: v("aggray-900"),
    },
    // neutral/slate made theme-aware (light = exact Tailwind hex via the vars,
    // dark = role-inverted) so text-neutral-*/bg-slate-* adapt like gray/zinc.
    neutral: {
        50: v("neutral-50"),
        100: v("neutral-100"),
        200: v("neutral-200"),
        300: v("neutral-300"),
        400: v("neutral-400"),
        500: v("neutral-500"),
        600: v("neutral-600"),
        700: v("neutral-700"),
        800: v("neutral-800"),
        900: v("neutral-900"),
        950: v("neutral-950"),
    },
    slate: {
        50: v("slate-50"),
        100: v("slate-100"),
        200: v("slate-200"),
        300: v("slate-300"),
        400: v("slate-400"),
        500: v("slate-500"),
        600: v("slate-600"),
        700: v("slate-700"),
        800: v("slate-800"),
        900: v("slate-900"),
        950: v("slate-950"),
    },
    colorText: v("colorText"),
    colorTextSecondary: v("colorTextSecondary"),
    colorTextTertiary: v("colorTextTertiary"),
    colorTextQuaternary: v("colorTextQuaternary"),
    colorTextHeading: v("colorTextHeading"),
    colorTextLabel: v("colorTextLabel"),
    colorTextDescription: v("colorTextDescription"),
    colorTextDisabled: v("colorTextDisabled"),
    colorTextPlaceholder: v("colorTextPlaceholder"),
    colorTextLightSolid: v("colorTextLightSolid"),
    colorIcon: v("colorIcon"),
    colorIconHover: v("colorIconHover"),
    colorBgContainer: v("colorBgContainer"),
    colorBgElevated: v("colorBgElevated"),
    colorBgLayout: v("colorBgLayout"),
    colorBgBase: v("colorBgBase"),
    colorBgSpotlight: v("colorBgSpotlight"),
    colorBgMask: v("colorBgMask"),
    colorBorder: v("colorBorder"),
    colorBorderSecondary: v("colorBorderSecondary"),
    colorFill: v("colorFill"),
    colorFillSecondary: v("colorFillSecondary"),
    colorFillTertiary: v("colorFillTertiary"),
    colorFillQuaternary: v("colorFillQuaternary"),
    colorSplit: v("colorSplit"),
    colorPrimary: v("colorPrimary"),
    // antd's colorPrimary* state ramp. These come from antd-tailwind.json as LIGHT-ONLY
    // hexes; without these var-backed overrides `bg-colorPrimaryBorder` & co. are frozen
    // at their light value in dark mode (the Slider track was rendering light-blue on black).
    colorPrimaryHover: v("colorPrimaryHover"),
    colorPrimaryBorder: v("colorPrimaryBorder"),
    colorPrimaryBorderHover: v("colorPrimaryBorderHover"),
    colorPrimaryText: v("colorPrimaryText"),
    colorSuccess: v("colorSuccess"),
    colorWarning: v("colorWarning"),
    colorWarningBorder: v("colorWarningBorder"),
    colorWarningText: v("colorWarningText"),
    colorErrorText: v("colorErrorText"),
    colorError: v("colorError"),
    colorErrorBorder: v("colorErrorBorder"),
    // Any name NOT listed here falls through to antd-tailwind.json, a LIGHT-ONLY hex dump,
    // and is frozen at its light value in dark. That is how the slider's dark track broke.
    colorInfo: v("colorInfo"),
    colorInfoBorder: v("colorInfoBorder"),
    colorBgContainerDisabled: v("colorBgContainerDisabled"),
    colorInfoBg: v("colorInfoBg"),
    controlItemBgActive: v("controlItemBgActive"),
    colorWhite: v("colorWhite"),
}

// ── Control scale ────────────────────────────────────────────────
// Geometry + typography for the shadcn control primitives (Button/Input/Badge).
// The single place to retune control sizing: components reference these names and never
// raw pixels. Namespaced (`control-*`, `btn-*`, `input-*`) and purely ADDITIVE, exactly
// like the `tremor-*` scale below, so no existing `h-*`/`rounded-*`/`text-*` changes.
//
// Values are theme-invariant (they don't flip light/dark), which is why they live here
// rather than in palette.ts. They currently encode antd's measured geometry so the
// migration is visually neutral — retune HERE once antd is gone, not in the components.
//
// v4 note: this whole object becomes a `@theme` block; the class names do not change.
const controlScale = {
    height: {
        "control-sm": "24px",
        control: "28px",
        "control-lg": "34px",
        // antd Switch track (default/small) + handle. Own dims — not the control heights.
        switch: "22px",
        "switch-sm": "16px",
        "switch-thumb": "18px",
        "switch-thumb-sm": "12px",
        // antd Checkbox/Radio box (16px) + Radio inner dot (8px) + Checkbox indeterminate dash (7px).
        "control-check": "16px",
        "control-dot": "8px",
        "control-check-dash": "7px",
    },
    width: {
        "control-sm": "24px",
        control: "28px",
        "control-lg": "34px",
        // antd Switch min track width (default/small) + handle.
        switch: "44px",
        "switch-sm": "28px",
        "switch-thumb": "18px",
        "switch-thumb-sm": "12px",
        // antd Checkbox/Radio box (16px) + Radio inner dot (8px) + Checkbox indeterminate dash (7px).
        "control-check": "16px",
        "control-dot": "8px",
        "control-check-dash": "7px",
    },
    borderRadius: {
        "control-sm": "6px",
        control: "8px",
        "control-lg": "10px",
        // antd shape="circle". 50%, not 9999px — they render identically on a square but
        // the parity gate compares computed values.
        "control-round": "50%",
    },
    spacing: {
        // Horizontal padding differs between buttons and inputs at md/lg, so they are
        // separate families rather than one fudged scale.
        "btn-sm": "7px",
        btn: "15px",
        "btn-lg": "15px",
        "input-sm": "7px",
        input: "11px",
        "input-lg": "11px",
        // Vertical padding for inputs: heights are padding + line-height derived (antd's
        // model), not fixed. `ghost` adds 1px to compensate for its missing border.
        "input-y-sm": "0px",
        "input-y": "4px",
        "input-y-lg": "7px",
        "input-y-ghost-sm": "1px",
        "input-y-ghost": "5px",
        "input-y-ghost-lg": "8px",
    },
    // Type ramps. Buttons and fields differ at `sm` (12px vs 10px), so they are separate
    // ramps rather than one averaged scale. Names avoid every colour-token name, because
    // `text-*` is shared between font-size and text-colour utilities.
    // Exact ratios, not rounded decimals: 1.8667 computes to 22.4004px where antd renders
    // 22.4 and the parity gate flags the difference.
    fontSize: {
        "btn-sm": ["12px", {lineHeight: "normal"}] as [string, {lineHeight: string}],
        "btn-md": ["12px", {lineHeight: "normal"}] as [string, {lineHeight: string}],
        "btn-lg": ["14px", {lineHeight: "normal"}] as [string, {lineHeight: string}],
        "field-sm": ["10px", {lineHeight: "1.6666666666666667"}] as [string, {lineHeight: string}],
        "field-md": ["12px", {lineHeight: "1.6666666666666667"}] as [string, {lineHeight: string}],
        "field-lg": ["14px", {lineHeight: "1.5714285714285714"}] as [string, {lineHeight: string}],
        "badge-md": ["12px", {lineHeight: "1.8666666666666667"}] as [string, {lineHeight: string}],
    },
}

// ── shadcn token bridge ──────────────────────────────────────────
// Semantic token names consumed by the shadcn components in
// @agenta/ui, mapped to the palette-derived --ag-* layer (theme-variables.css,
// generated from palette.ts). ONE shared definition for the app + Storybook: flip
// the underlying layer and every component follows; when antd is removed nothing here
// changes. Purely ADDITIVE — the app uses `colorX`-named + default Tailwind classes,
// never these shadcn names, so nothing is overridden. Radius is intentionally NOT
// bridged (theme-invariant; overriding it would change every `rounded-*` in the app).
const shadcnTokens = {
    background: "var(--ag-colorBgContainer)",
    foreground: "var(--ag-colorText)",
    border: "var(--ag-colorBorder)",
    input: "var(--ag-colorBorder)",
    ring: "var(--ag-colorPrimary)",
    // antd's keyboard focus ring is `colorPrimaryBorder` (4px, offset 1px). NOTE: it equals
    // colorInfoBorder in LIGHT (both #d6dee6) but diverges in DARK (olive vs navy) — needs its
    // own token, which the forced-state gate caught.
    "focus-ring": "var(--ag-colorPrimaryBorder)",
    primary: {
        DEFAULT: "var(--ag-colorPrimary)",
        // antd fills a CHECKED control with colorPrimaryHover on hover (Radio/Checkbox).
        hover: "var(--ag-colorPrimaryHover)",
        foreground: "var(--ag-colorTextLightSolid)",
    },
    secondary: {DEFAULT: "var(--ag-colorFillSecondary)", foreground: "var(--ag-colorText)"},
    muted: {DEFAULT: "var(--ag-colorFillTertiary)", foreground: "var(--ag-colorTextSecondary)"},
    accent: {DEFAULT: "var(--ag-colorFillSecondary)", foreground: "var(--ag-colorText)"},
    destructive: {DEFAULT: "var(--ag-colorError)", foreground: "var(--ag-colorTextLightSolid)"},
    popover: {DEFAULT: "var(--ag-colorBgElevated)", foreground: "var(--ag-colorText)"},
    card: {DEFAULT: "var(--ag-colorBgContainer)", foreground: "var(--ag-colorText)"},
    placeholder: "var(--ag-colorTextPlaceholder)",
    // Disabled + interaction states used by the control primitives.
    disabled: {
        DEFAULT: "var(--ag-colorTextDisabled)",
        bg: "var(--ag-colorBgContainerDisabled)",
        border: "var(--ag-input-disabled-border)",
    },
    // Semantic status families (Badge/Tag/status chips): {DEFAULT = text, bg, border}.
    success: {
        DEFAULT: "var(--ag-colorSuccess)",
        bg: "var(--ag-colorSuccessBg)",
        border: "var(--ag-colorSuccessBorder)",
    },
    warning: {
        DEFAULT: "var(--ag-colorWarningText)",
        bg: "var(--ag-colorWarningBg)",
        border: "var(--ag-colorWarningBorder)",
    },
    error: {
        DEFAULT: "var(--ag-colorError)",
        bg: "var(--ag-colorErrorBg)",
        border: "var(--ag-colorErrorBorder)",
        hover: "var(--ag-colorErrorHover)",
        active: "var(--ag-colorErrorActive)",
    },
    info: {
        DEFAULT: "var(--ag-colorInfo)",
        bg: "var(--ag-colorInfoBg)",
        border: "var(--ag-colorInfoBorder)",
    },
    draft: {
        DEFAULT: "var(--ag-draft-text)",
        bg: "var(--ag-draft-bg)",
        border: "var(--ag-draft-border)",
    },
    // antd preset Tag colors (color="blue"/"green"). Namespaced `tag-*` to avoid
    // clobbering Tailwind's default `blue`/`green` scales (used across the app).
    "tag-blue": {DEFAULT: "var(--ag-preset-blue-text)", bg: "var(--ag-preset-blue-bg)"},
    "tag-green": {DEFAULT: "var(--ag-preset-green-text)", bg: "var(--ag-preset-green-bg)"},
    "tag-orange": {DEFAULT: "var(--ag-preset-orange-text)", bg: "var(--ag-preset-orange-bg)"},
    "tag-red": {DEFAULT: "var(--ag-preset-red-text)", bg: "var(--ag-preset-red-bg)"},
    "tag-purple": {DEFAULT: "var(--ag-preset-purple-text)", bg: "var(--ag-preset-purple-bg)"},
    "tag-pink": {DEFAULT: "var(--ag-preset-pink-text)", bg: "var(--ag-preset-pink-bg)"},
    "tag-yellow": {DEFAULT: "var(--ag-preset-yellow-text)", bg: "var(--ag-preset-yellow-bg)"},
    "tag-volcano": {DEFAULT: "var(--ag-preset-volcano-text)", bg: "var(--ag-preset-volcano-bg)"},
    "tag-geekblue": {DEFAULT: "var(--ag-preset-geekblue-text)", bg: "var(--ag-preset-geekblue-bg)"},
    "tag-lime": {DEFAULT: "var(--ag-preset-lime-text)", bg: "var(--ag-preset-lime-bg)"},
    "tag-cyan": {DEFAULT: "var(--ag-preset-cyan-text)", bg: "var(--ag-preset-cyan-bg)"},
    "tag-magenta": {DEFAULT: "var(--ag-preset-magenta-text)", bg: "var(--ag-preset-magenta-bg)"},
    "tag-gold": {DEFAULT: "var(--ag-preset-gold-text)", bg: "var(--ag-preset-gold-bg)"},
    // Button state tokens.
    btn: {
        "primary-fg": "var(--ag-btn-primary-text)",
        "primary-hover": "var(--ag-btn-primary-hover)",
        "primary-active": "var(--ag-btn-primary-active)",
        "default-bg": "var(--ag-btn-default-bg)",
        "default-hover-bg": "var(--ag-btn-default-hover-bg)",
        "default-active-bg": "var(--ag-btn-default-active-bg)",
        "text-hover-bg": "var(--ag-btn-text-hover-bg)",
        "text-active-bg": "var(--ag-btn-text-active-bg)",
        link: "var(--ag-btn-link)",
        "link-hover": "var(--ag-btn-link-hover)",
        "link-active": "var(--ag-btn-link-active)",
    },
    // antd Empty's DEFAULT illustration greys (opaque — see palette.ts `emptyImage`).
    empty: {
        shadow: "var(--ag-empty-shadow)",
        sheet: "var(--ag-empty-sheet)",
        flap: "var(--ag-empty-flap)",
        front: "var(--ag-empty-front)",
        hole: "var(--ag-empty-hole)",
    },
    // Fills.
    chip: "var(--ag-colorFillChip)",
    fill: {
        DEFAULT: "var(--ag-colorFill)",
        secondary: "var(--ag-colorFillSecondary)",
        tertiary: "var(--ag-colorFillTertiary)",
        quaternary: "var(--ag-colorFillQuaternary)",
    },
}

export const createConfig = (content: string[] = []): Config => {
    return {
        darkMode: "selector",
        content: [
            "./src/**/*.{js,ts,jsx,tsx}",
            // Path to Tremor module
            "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
            // Path to @agenta packages
            "../packages/agenta-ui/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-annotation-ui/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-entity-ui/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-entities/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-playground/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-playground-ui/src/**/*.{js,ts,jsx,tsx}",
            ...content,
        ],
        theme: {
            transparent: "transparent",
            current: "currentColor",
            extend: {
                fontFamily: {
                    sans: ["var(--font-inter)"],
                    // Portable app font for content that PORTALS out of the app tree (Radix
                    // Popover/Select dropdowns render into <body>, escaping the `--font-inter`
                    // wrapper scope — and preflight is off, so <body> defaults to serif).
                    // MUST be one NESTED var with the fallback INSIDE var(): a comma list like
                    // `var(--font-inter), var(--ant-font-family)` is invalid-at-computed-value
                    // when --font-inter is unset (the WHOLE property dies → serif). The nested
                    // form falls through to the antd root var during coexistence; drop it once
                    // `--font-inter` is applied globally.
                    portal: ["var(--font-inter, var(--ant-font-family, system-ui, sans-serif))"],
                },
                colors: {
                    ...antdTailwind,
                    // Theme-aware scales (override the static antd-tailwind values
                    // above with CSS-variable-backed ones so dark mode flips them).
                    ...themeAwareColors,
                    // shadcn token bridge (shared by app + Storybook).
                    ...shadcnTokens,
                    // light mode
                    tremor: {
                        brand: {
                            faint: token.colorPrimaryBgHover,
                            muted: token.colorPrimaryBorderHover,
                            subtle: token.colorPrimaryHover,
                            DEFAULT: token.colorPrimary,
                            emphasis: token.colorPrimaryActive,
                            inverted: colors.white,
                        },
                        background: {
                            muted: colors.gray[50],
                            subtle: colors.gray[100],
                            DEFAULT: colors.white,
                            emphasis: colors.gray[700],
                        },
                        border: {
                            DEFAULT: colors.gray[200],
                        },
                        ring: {
                            DEFAULT: colors.gray[200],
                        },
                        content: {
                            subtle: colors.gray[400],
                            DEFAULT: colors.gray[500],
                            emphasis: colors.gray[700],
                            strong: colors.gray[900],
                            inverted: colors.white,
                        },
                    },
                    // dark mode
                    "dark-tremor": {
                        brand: {
                            faint: token.colorPrimaryBgHover,
                            muted: token.colorPrimaryTextHover,
                            subtle: token.colorPrimaryHover,
                            DEFAULT: token.colorPrimary,
                            emphasis: token.colorPrimaryActive,
                            inverted: colors.white,
                        },
                        background: {
                            muted: "#131A2B",
                            subtle: colors.gray[800],
                            DEFAULT: colors.gray[900],
                            emphasis: colors.gray[300],
                        },
                        border: {
                            DEFAULT: colors.gray[800],
                        },
                        ring: {
                            DEFAULT: colors.gray[800],
                        },
                        content: {
                            subtle: colors.gray[600],
                            DEFAULT: colors.gray[500],
                            emphasis: colors.gray[200],
                            strong: colors.gray[50],
                            inverted: colors.gray[950],
                        },
                    },
                },
                boxShadow: {
                    // theme-aware (var-backed, flips under .dark)
                    tertiary: "var(--ag-boxShadowTertiary)",
                    // antd dropdown/popover overlay shadow (boxShadowSecondary).
                    overlay: "var(--ag-boxShadowSecondary)",
                    // antd Switch handle shadow (`handleShadow`, theme-invariant).
                    "switch-handle": "0 2px 4px 0 rgba(0, 35, 11, 0.2)",
                    // antd primary `boxShadow` (Modal content). NOT theme-invariant: the old
                    // literal here was byte-identical to the LIGHT --ag-boxShadowSecondary, so
                    // Dialog/AlertDialog/Toast/Notification rendered a light shadow in dark and
                    // lost dark's 1px elevation ring. Same value in light, correct in dark.
                    dialog: "var(--ag-boxShadowSecondary)",
                    // antd directional Drawer shadows (`boxShadowDrawer*`) — named by the side the
                    // panel sits on (shadow is cast toward the viewport). Theme-invariant literals.
                    "drawer-right":
                        "-6px 0 16px 0 rgba(0, 0, 0, 0.08), -3px 0 6px -4px rgba(0, 0, 0, 0.12), -9px 0 28px 8px rgba(0, 0, 0, 0.05)",
                    "drawer-left":
                        "6px 0 16px 0 rgba(0, 0, 0, 0.08), 3px 0 6px -4px rgba(0, 0, 0, 0.12), 9px 0 28px 8px rgba(0, 0, 0, 0.05)",
                    "drawer-top":
                        "0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)",
                    "drawer-bottom":
                        "0 -6px 16px 0 rgba(0, 0, 0, 0.08), 0 -3px 6px -4px rgba(0, 0, 0, 0.12), 0 -9px 28px 8px rgba(0, 0, 0, 0.05)",
                    // light
                    "tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
                    "tremor-card": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
                    "tremor-dropdown":
                        "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
                    // dark
                    "dark-tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
                    "dark-tremor-card":
                        "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
                    "dark-tremor-dropdown":
                        "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
                },
                borderRadius: {
                    "tremor-small": "0.375rem",
                    "tremor-default": "0.5rem",
                    "tremor-full": "9999px",
                    ...controlScale.borderRadius,
                },
                fontSize: {
                    "tremor-label": ["0.75rem", {lineHeight: "1rem"}],
                    "tremor-default": ["0.875rem", {lineHeight: "1.25rem"}],
                    "tremor-title": ["1.125rem", {lineHeight: "1.75rem"}],
                    "tremor-metric": ["1.875rem", {lineHeight: "2.25rem"}],
                    ...controlScale.fontSize,
                },
                height: {...controlScale.height},
                minHeight: {...controlScale.height},
                width: {...controlScale.width},
                // `size-*` reads theme.size (NOT width/height), so control-scale keys must be
                // spread here too or `size-switch-thumb` etc. silently generate nothing.
                size: {...controlScale.width},
                spacing: {...controlScale.spacing},
                // antd Skeleton `active` shimmer: a gradient band swept across the block.
                keyframes: {
                    skeleton: {
                        "0%": {backgroundPosition: "100% 50%"},
                        "100%": {backgroundPosition: "0 50%"},
                    },
                    // antd Collapse panel height motion (rc-motion collapse): height + opacity.
                    "accordion-down": {
                        from: {height: "0", opacity: "0"},
                        to: {height: "var(--radix-accordion-content-height)", opacity: "1"},
                    },
                    "accordion-up": {
                        from: {height: "var(--radix-accordion-content-height)", opacity: "1"},
                        to: {height: "0", opacity: "0"},
                    },
                    // antd Modal zoom+fade (rc-dialog default motion) + mask fade.
                    "overlay-in": {from: {opacity: "0"}, to: {opacity: "1"}},
                    "overlay-out": {from: {opacity: "1"}, to: {opacity: "0"}},
                    "dialog-in": {
                        from: {opacity: "0", transform: "scale(0.9)"},
                        to: {opacity: "1", transform: "scale(1)"},
                    },
                    "dialog-out": {
                        from: {opacity: "1", transform: "scale(1)"},
                        to: {opacity: "0", transform: "scale(0.9)"},
                    },
                    // antd Drawer slide (per side) — panel translates in from its edge.
                    "sheet-in-right": {
                        from: {transform: "translateX(100%)"},
                        to: {transform: "translateX(0)"},
                    },
                    "sheet-out-right": {
                        from: {transform: "translateX(0)"},
                        to: {transform: "translateX(100%)"},
                    },
                    "sheet-in-left": {
                        from: {transform: "translateX(-100%)"},
                        to: {transform: "translateX(0)"},
                    },
                    "sheet-out-left": {
                        from: {transform: "translateX(0)"},
                        to: {transform: "translateX(-100%)"},
                    },
                    "sheet-in-top": {
                        from: {transform: "translateY(-100%)"},
                        to: {transform: "translateY(0)"},
                    },
                    "sheet-out-top": {
                        from: {transform: "translateY(0)"},
                        to: {transform: "translateY(-100%)"},
                    },
                    "sheet-in-bottom": {
                        from: {transform: "translateY(100%)"},
                        to: {transform: "translateY(0)"},
                    },
                    "sheet-out-bottom": {
                        from: {transform: "translateY(0)"},
                        to: {transform: "translateY(100%)"},
                    },
                    // antd Spin dot pulse (antSpinMove): base opacity 0.3 ramps to 1.
                    "spin-move": {to: {opacity: "1"}},
                    // Config-section title shimmer (ConfigAccordionSection glint sweep).
                    "config-shimmer": {
                        "0%": {maskPosition: "180% 0", WebkitMaskPosition: "180% 0"},
                        "100%": {maskPosition: "-80% 0", WebkitMaskPosition: "-80% 0"},
                    },
                },
                animation: {
                    skeleton: "skeleton 1.4s ease infinite",
                    // 2 sweeps then hold off-screen (forwards) so it ends invisibly.
                    "config-shimmer": "config-shimmer 1.8s ease-in-out 2 forwards",
                    // antd motionDurationMid (0.2s) + motionEaseInOut bezier.
                    "accordion-down": "accordion-down 0.2s cubic-bezier(0.645,0.045,0.355,1)",
                    "accordion-up": "accordion-up 0.2s cubic-bezier(0.645,0.045,0.355,1)",
                    // Modal: mask fade + content zoom (0.2s; zoom uses antd motionEaseOutCirc).
                    "overlay-in": "overlay-in 0.2s ease",
                    "overlay-out": "overlay-out 0.2s ease",
                    "dialog-in": "dialog-in 0.2s cubic-bezier(0.08,0.82,0.17,1)",
                    "dialog-out": "dialog-out 0.2s cubic-bezier(0.6,0.04,0.98,0.34)",
                    // Drawer: slide (0.3s = antd motionDurationSlow, easeOutQuint).
                    "sheet-in-right": "sheet-in-right 0.3s cubic-bezier(0.23,1,0.32,1)",
                    "sheet-out-right": "sheet-out-right 0.3s cubic-bezier(0.755,0.05,0.855,0.06)",
                    "sheet-in-left": "sheet-in-left 0.3s cubic-bezier(0.23,1,0.32,1)",
                    "sheet-out-left": "sheet-out-left 0.3s cubic-bezier(0.755,0.05,0.855,0.06)",
                    "sheet-in-top": "sheet-in-top 0.3s cubic-bezier(0.23,1,0.32,1)",
                    "sheet-out-top": "sheet-out-top 0.3s cubic-bezier(0.755,0.05,0.855,0.06)",
                    "sheet-in-bottom": "sheet-in-bottom 0.3s cubic-bezier(0.23,1,0.32,1)",
                    "sheet-out-bottom": "sheet-out-bottom 0.3s cubic-bezier(0.755,0.05,0.855,0.06)",
                    // antd Spin: 1s linear infinite alternate, dots staggered by animation-delay.
                    "spin-move": "spin-move 1s linear infinite alternate",
                },
            },
        },
        safelist: [
            {
                pattern:
                    /^(bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
                variants: ["hover", "ui-selected"],
            },
            {
                pattern:
                    /^(text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
                variants: ["hover", "ui-selected"],
            },
            {
                pattern:
                    /^(border-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
                variants: ["hover", "ui-selected"],
            },
            {
                pattern:
                    /^(ring-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
            },
            {
                pattern:
                    /^(stroke-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
            },
            {
                pattern:
                    /^(fill-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
            },
        ],
        plugins: [
            require("tailwind-scrollbar")({
                nocompatible: true,
                preferredStrategy: "pseudoelements",
            }),
            // Use class strategy so Ant Design styles remain unaffected
            require("@tailwindcss/forms")({
                strategy: "class",
            }),
            require("@tailwindcss/container-queries"),
        ],
        // When it’s enabled, those styles override Ant Design’s default input styling.
        corePlugins: {
            preflight: false,
        },
    }
}

export default createConfig()
