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
    colorPrimaryText: v("colorPrimaryText"),
    colorSuccess: v("colorSuccess"),
    colorWarning: v("colorWarning"),
    colorWarningText: v("colorWarningText"),
    colorErrorText: v("colorErrorText"),
    colorError: v("colorError"),
    colorErrorBorder: v("colorErrorBorder"),
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
            ...content,
        ],
        theme: {
            transparent: "transparent",
            current: "currentColor",
            extend: {
                fontFamily: {
                    sans: ["var(--font-inter)"],
                },
                colors: {
                    ...antdTailwind,
                    // Theme-aware scales (override the static antd-tailwind values
                    // above with CSS-variable-backed ones so dark mode flips them).
                    ...themeAwareColors,
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
                },
                fontSize: {
                    "tremor-label": ["0.75rem", {lineHeight: "1rem"}],
                    "tremor-default": ["0.875rem", {lineHeight: "1.25rem"}],
                    "tremor-title": ["1.125rem", {lineHeight: "1.75rem"}],
                    "tremor-metric": ["1.875rem", {lineHeight: "2.25rem"}],
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
