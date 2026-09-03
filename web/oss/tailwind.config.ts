import {theme} from "antd"
import type {Config} from "tailwindcss"
import colors from "tailwindcss/colors"

import {controlScale} from "./src/styles/theme/controlScale"
import {shadcnTokens} from "./src/styles/theme/shadcnTokens"
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
    colorWarningBg: v("colorWarningBg"),
    colorWarningBorder: v("colorWarningBorder"),
    colorWarningText: v("colorWarningText"),
    colorErrorText: v("colorErrorText"),
    colorError: v("colorError"),
    colorErrorBorder: v("colorErrorBorder"),
    // Missing here, `bg-colorErrorBg` froze at light `#f9e5e5` — the Account page's
    // delete-account panel painted a pale pink box with white body text on it in dark mode,
    // while its border and title (both listed above) resolved correctly dark.
    colorErrorBg: v("colorErrorBg"),
    colorSuccessBg: v("colorSuccessBg"),
    // Any name NOT listed here falls through to antd-tailwind.json, a LIGHT-ONLY hex dump,
    // and is frozen at its light value in dark. That is how the slider's dark track broke.
    colorInfo: v("colorInfo"),
    colorInfoBorder: v("colorInfoBorder"),
    colorBgContainerDisabled: v("colorBgContainerDisabled"),
    colorInfoBg: v("colorInfoBg"),
    controlItemBgActive: v("controlItemBgActive"),
    colorWhite: v("colorWhite"),
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
            "../packages/agenta-sessions/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-sessions-ui/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-observability-ui/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-home-ui/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-settings/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-settings-ui/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-navigation/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-navigation-ui/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-auth-ui/src/**/*.{js,ts,jsx,tsx}",
            "../packages/agenta-chat/src/**/*.{js,ts,jsx,tsx}",
            // Streamdown ships class-based typography; Tailwind only generates what it scans.
            // Resolved from the workspace store, so the glob works from both oss and ee.
            "../node_modules/.pnpm/streamdown@*/node_modules/streamdown/dist/*.js",
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
                    // `secondary` step of the type scale. `sm` stays stock 14/20 (`body`).
                    xs: ["13px", {lineHeight: "18px"}],
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
                    // Agent startup label (#6047).
                    "text-shimmer": {
                        "0%": {backgroundPosition: "120% 0"},
                        "100%": {backgroundPosition: "-120% 0"},
                    },
                    // The `/` palette's pickers, docked above the composer they grow out of.
                    // Shallower than `dialog-in` (0.9): these span the composer, where a 10% scale
                    // reads as a lurch rather than a zoom.
                    "command-panel-in": {
                        from: {opacity: "0", transform: "scale(0.98) translateY(4px)"},
                        to: {opacity: "1", transform: "scale(1) translateY(0)"},
                    },
                    // Reduced-motion partner for the entrance above.
                    "command-panel-fade": {from: {opacity: "0"}, to: {opacity: "1"}},
                    // Crossfade for content swapped inside an open panel. Starts partway, not at
                    // 0: it is re-keyed per swap, so a restart from 0 would blank the pane when
                    // clicked faster than the fade.
                    "command-panel-swap": {from: {opacity: "0.4"}, to: {opacity: "1"}},
                },
                animation: {
                    skeleton: "skeleton 1.4s ease infinite",
                    // 2 sweeps then hold off-screen (forwards) so it ends invisibly.
                    "config-shimmer": "config-shimmer 1.8s ease-in-out 2 forwards",
                    "text-shimmer": "text-shimmer 2.4s linear infinite",
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
                    // Picker panels: 0.2s sits in the dropdown budget; easeOutQuint is the same
                    // curve the drawer slides on, so docked surfaces share one deceleration.
                    "command-panel-in": "command-panel-in 0.2s cubic-bezier(0.23,1,0.32,1)",
                    "command-panel-fade": "command-panel-fade 0.2s cubic-bezier(0.23,1,0.32,1)",
                    "command-panel-swap": "command-panel-swap 0.12s cubic-bezier(0.23,1,0.32,1)",
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
