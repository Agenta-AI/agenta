/**
 * palette.ts — the single source of truth for theme colors (light + dark).
 *
 * PHASE 1 (this file): a LOSSLESS extraction of the values currently scattered
 * across theme-variables.css + ThemeContextProvider.tsx. No colors are invented.
 * Dark values that antd's darkAlgorithm derives were SNAPSHOTTED to their exact
 * current output (computed headlessly from the live config), so every dark value
 * is visible and directly editable here — and the app looks identical.
 *
 * The app does not consume this file yet. The generator (phase 2) turns it into
 * theme-variables.css, the antd dark overrides, the --ag-c-* shim, and the
 * tailwind map. Anything NOT in this file keeps deriving from antd's algorithm.
 *
 * VALUE FORMS
 *   "#141414" / "rgba(...)" — an explicit color. Edit it directly.
 *   antd("boxShadow")       — "use antd's algorithm default for this" (light-side
 *                             shadows only; the dark shadow is the tuned override).
 */

export interface AntdRef {
    readonly antd: string
}
export type ColorValue = string | AntdRef
export interface Pair {
    light: ColorValue
    dark: ColorValue
}

/** Defer this value to antd's algorithm default (used only for light shadows). */
const antd = (token: string): AntdRef => ({antd: token})

// ============================================================================
// CORE — antd-semantic roles (names map 1:1 to antd tokens). Light is the seed;
// dark is the exact darkAlgorithm output today, or an explicit [override].
// ============================================================================

export const surface = {
    base: {light: "#ffffff", dark: "#000000"},
    container: {light: "#ffffff", dark: "#141414"}, // [absorbs] --ag-c-FFFFFF, the #141414 literals
    elevated: {light: "#ffffff", dark: "#242424"}, // [override] [absorbs] 25+ light surfaces → one dark
    layout: {light: "#ffffff", dark: "#000000"},
    spotlight: {light: "rgba(5, 23, 41, 0.9)", dark: "#424242"},
    mask: {light: "rgba(5, 23, 41, 0.45)", dark: "rgba(0, 0, 0, 0.45)"},
    containerDisabled: {light: "rgba(5, 23, 41, 0.04)", dark: "rgba(255, 255, 255, 0.08)"},
    infoBg: {light: "#f5f7fa", dark: "#111a2c"}, // antd's colorInfoBg (unified with antd render)
    controlItemBgActive: {light: "#f5f7fa", dark: "#57572a"}, // yellow-tinted: derived from brand primary
    controlOutline: {light: "rgba(5, 23, 41, 0.1)", dark: "rgba(251, 251, 96, 0.29)"}, // antd input/select focus glow
    errorOutline: {light: "rgba(214, 16, 16, 0.06)", dark: "rgba(238, 38, 56, 0.11)"}, // antd focus glow on error
    white: {light: "#ffffff", dark: "#ffffff"},
} satisfies Record<string, Pair>

export const text = {
    primary: {light: "#1c2c3d", dark: "rgba(255, 255, 255, 0.85)"},
    secondary: {light: "#586673", dark: "rgba(255, 255, 255, 0.65)"},
    tertiary: {light: "#758391", dark: "rgba(255, 255, 255, 0.45)"},
    quaternary: {light: "#bdc7d1", dark: "rgba(255, 255, 255, 0.25)"},
    heading: {light: "#1c2c3d", dark: "rgba(255, 255, 255, 0.85)"},
    label: {light: "#586673", dark: "rgba(255, 255, 255, 0.65)"},
    description: {light: "#758391", dark: "rgba(255, 255, 255, 0.45)"},
    disabled: {light: "#bdc7d1", dark: "rgba(255, 255, 255, 0.25)"},
    placeholder: {light: "#bdc7d1", dark: "rgba(255, 255, 255, 0.38)"}, // [override]
    lightSolid: {light: "#ffffff", dark: "#ffffff"},
    icon: {light: "#758391", dark: "rgba(255, 255, 255, 0.45)"}, // mirrors tertiary
    iconHover: {light: "#1c2c3d", dark: "rgba(255, 255, 255, 0.85)"}, // mirrors primary
} satisfies Record<string, Pair>

export const border = {
    default: {light: "#bdc7d1", dark: "#424242"}, // [absorbs] --ag-c-BDC7D1, zinc-4
    secondary: {light: "#eaeff5", dark: "#303030"},
    split: {light: "rgba(5, 23, 41, 0.06)", dark: "rgba(253, 253, 253, 0.12)"},
} satisfies Record<string, Pair>

export const fill = {
    fill: {light: "rgba(5, 23, 41, 0.15)", dark: "rgba(255, 255, 255, 0.18)"},
    secondary: {light: "rgba(5, 23, 41, 0.06)", dark: "rgba(255, 255, 255, 0.12)"},
    tertiary: {light: "rgba(5, 23, 41, 0.04)", dark: "rgba(255, 255, 255, 0.08)"},
    quaternary: {light: "rgba(5, 23, 41, 0.02)", dark: "rgba(255, 255, 255, 0.04)"},
    // Default chip/tag fill. antd renders this translucent in light but as an OPAQUE
    // flatten of fill-tertiary in dark (#272727), pinned regardless of backdrop — a
    // translucent token can't match it, so it's stored explicitly per mode.
    chip: {light: "rgba(5, 23, 41, 0.02)", dark: "#272727"},
} satisfies Record<string, Pair>

export const accent = {
    primary: {light: "#1c2c3d", dark: "#f2f25c"}, // [override] navy → brand yellow
    primaryHover: {light: "#394857", dark: "#e8e47e"}, // antd colorPrimaryHover (checked-control hover fill)
    primaryText: {light: "#1c2c3d", dark: "#d1d151"}, // derived from the yellow primary
    link: {light: "#1c2c3d", dark: "#58a6ff"}, // [override] [absorbs] the 6× #58a6ff literal
    linkHover: {light: "#1c2c3d", dark: "#79b8ff"}, // [override]
    linkActive: {light: "#1c2c3d", dark: "#3b8eea"}, // [override]
} satisfies Record<string, Pair>

export const semantic = {
    success: {light: "#389e0d", dark: "#52c41a"}, // [override]
    successBorder: {light: "#b7eb8f", dark: "#274916"},
    successBg: {light: "#f6ffed", dark: "#162312"}, // antd's derived colorSuccessBg (algorithm output)
    warning: {light: "#faad14", dark: "#faad14"}, // [override] (same tone)
    warningText: {light: "#faad14", dark: "#d89614"},
    warningBorder: {light: "#ffe58f", dark: "#594214"},
    warningBg: {light: "#fffbe6", dark: "#2b2111"}, // antd's own colorWarningBg (gold-1 / dark gold-1)
    error: {light: "#d61010", dark: "#ff4d4f"}, // [override] [absorbs] --ag-c-FF4D4F
    errorHover: {light: "#de4040", dark: "#e86e6b"}, // antd colorErrorHover (danger btn hover)
    errorActive: {light: "#ab0d0d", dark: "#ad393a"}, // antd colorErrorActive (danger btn active)
    errorText: {light: "#d61010", dark: "#dc4446"},
    errorBorder: {light: "#ef9f9f", dark: "#5b2526"},
    errorBg: {light: "#fbe7e7", dark: "#2c1618"}, // antd's derived colorErrorBg (algorithm output)
    info: {light: "#1c2c3d", dark: "#1668dc"}, // unified with antd's colorInfo (navy light / blue dark)
    infoBorder: {light: "#d6dee6", dark: "#15325b"}, // antd's derived colorInfoBorder
    primaryBorder: {light: "#d6dee6", dark: "#57572a"}, // antd colorPrimaryBorder (focus ring); ≠ infoBorder in dark
    primaryBorderHover: {light: "#97a4b0", dark: "#787834"}, // antd colorPrimaryBorderHover (slider track hover)
} satisfies Record<string, Pair>

// Overlay/elevation shadows. Dark is the hand-tuned override (a 1px light ring +
// dark drops); light defers to antd's default. Strings, not colors.
export const shadow = {
    overlay: {
        // antd boxShadowSecondary — the popup/overlay shadow (dropdowns, popovers). A fixed
        // antd constant (not theme-derived), so it is emitted as --ag-boxShadowSecondary; dark
        // is the hand-tuned override antd resolves boxShadow/boxShadowSecondary to.
        light: "0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)",
        dark: "0 0 0 1px rgba(255, 255, 255, 0.16), 0 6px 16px 0 rgba(0, 0, 0, 0.44), 0 3px 6px -4px rgba(0, 0, 0, 0.52), 0 9px 28px 8px rgba(0, 0, 0, 0.28)",
    },
    tertiary: {
        light: "0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px 0 rgba(0, 0, 0, 0.02)",
        dark: "0 0 0 1px rgba(255, 255, 255, 0.12), 0 1px 2px 0 rgba(0, 0, 0, 0.30), 0 1px 6px -1px rgba(0, 0, 0, 0.20), 0 2px 4px 0 rgba(0, 0, 0, 0.20)",
    },
    drawerRight: {
        light: antd("boxShadowDrawerRight"),
        dark: "-1px 0 0 0 rgba(255, 255, 255, 0.16), -6px 0 16px 0 rgba(0, 0, 0, 0.44), -3px 0 6px -4px rgba(0, 0, 0, 0.52), -9px 0 28px 8px rgba(0, 0, 0, 0.28)",
    },
    drawerLeft: {
        light: antd("boxShadowDrawerLeft"),
        dark: "1px 0 0 0 rgba(255, 255, 255, 0.16), 6px 0 16px 0 rgba(0, 0, 0, 0.44), 3px 0 6px -4px rgba(0, 0, 0, 0.52), 9px 0 28px 8px rgba(0, 0, 0, 0.28)",
    },
    drawerTop: {
        light: antd("boxShadowDrawerTop"),
        dark: "0 1px 0 0 rgba(255, 255, 255, 0.16), 0 6px 16px 0 rgba(0, 0, 0, 0.44), 0 3px 6px -4px rgba(0, 0, 0, 0.52), 0 9px 28px 8px rgba(0, 0, 0, 0.28)",
    },
    drawerBottom: {
        light: antd("boxShadowDrawerBottom"),
        dark: "0 -1px 0 0 rgba(255, 255, 255, 0.16), 0 -6px 16px 0 rgba(0, 0, 0, 0.44), 0 -3px 6px -4px rgba(0, 0, 0, 0.52), 0 -9px 28px 8px rgba(0, 0, 0, 0.28)",
    },
} satisfies Record<string, Pair>

// Component-level dark overrides (antd `components` map).
export const componentsDark = {
    Button: {
        primaryColor: "#141414", // dark text on the bright-yellow primary
        defaultBg: "transparent",
        defaultHoverBg: "rgba(255, 255, 255, 0.04)",
        defaultActiveBg: "rgba(255, 255, 255, 0.08)",
    },
    Drawer: {
        colorBgElevated: "#141414", // full-height drawer = container surface, not elevated
    },
}

// ============================================================================
// SCALES — role-inverted Tailwind ramps. CONSOLIDATION NOTE: gray, neutral, and
// slate share a BYTE-IDENTICAL dark ladder (darkNeutral below); zinc and ag-gray
// are near-variants (flagged) to reconcile later. Light stays per-scale.
// ============================================================================

/** The one dark neutral ladder gray/neutral/slate all resolve to. */
const darkNeutral = {
    50: "#1a1a1a",
    100: "#242424",
    200: "#2a2a2a",
    300: "#383838",
    400: "#5c5c5c",
    500: "#8c8c8c",
    600: "rgba(255, 255, 255, 0.55)",
    700: "rgba(255, 255, 255, 0.65)",
    800: "rgba(255, 255, 255, 0.75)",
    900: "rgba(255, 255, 255, 0.85)",
    950: "rgba(255, 255, 255, 0.92)",
} as const

const lightGray = {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
    950: "#030712",
} as const
const lightNeutral = {
    50: "#fafafa",
    100: "#f5f5f5",
    200: "#e5e5e5",
    300: "#d4d4d4",
    400: "#a3a3a3",
    500: "#737373",
    600: "#525252",
    700: "#404040",
    800: "#262626",
    900: "#171717",
    950: "#0a0a0a",
} as const
const lightSlate = {
    50: "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
    950: "#020617",
} as const

const rampFrom = (light: Record<number, string>): Record<number, Pair> =>
    Object.fromEntries(
        Object.keys(light).map((k) => [
            k,
            {light: light[+k], dark: darkNeutral[+k as keyof typeof darkNeutral]},
        ]),
    )

export const scales = {
    // gray / neutral / slate — SAME dark ladder, different light ramp
    gray: rampFrom(lightGray),
    neutral: rampFrom(lightNeutral),
    slate: rampFrom(lightSlate),
    // zinc — brand slate ramp, 10-step, near-variant dark
    zinc: {
        1: {light: "#f5f7fa", dark: "#242424"},
        2: {light: "#eaeff5", dark: "#2a2a2a"},
        3: {light: "#d6dee6", dark: "#383838"},
        4: {light: "#bdc7d1", dark: "#424242"},
        5: {light: "#97a4b0", dark: "#5c5c5c"},
        6: {light: "#758391", dark: "rgba(255, 255, 255, 0.45)"},
        7: {light: "#586673", dark: "rgba(255, 255, 255, 0.65)"},
        8: {light: "#394857", dark: "rgba(255, 255, 255, 0.75)"},
        9: {light: "#1c2c3d", dark: "rgba(255, 255, 255, 0.85)"},
        10: {light: "#051729", dark: "rgba(255, 255, 255, 0.95)"},
    },
    // ag-gray — Untitled-UI ramp, near-variant dark (#242424/#2f2f2f/#3d3d3d)
    agGray: {
        25: {light: "#fcfcfd", dark: "#1a1a1a"},
        50: {light: "#f9fafb", dark: "#242424"},
        100: {light: "#f2f4f7", dark: "#242424"},
        200: {light: "#e4e7ec", dark: "#2f2f2f"},
        300: {light: "#d0d5dd", dark: "#3d3d3d"},
        400: {light: "#98a2b3", dark: "#5c5c5c"},
        500: {light: "#667085", dark: "#8c8c8c"},
        600: {light: "#475467", dark: "rgba(255, 255, 255, 0.55)"},
        700: {light: "#344054", dark: "rgba(255, 255, 255, 0.65)"},
        800: {light: "#1d2939", dark: "rgba(255, 255, 255, 0.75)"},
        900: {light: "#101828", dark: "rgba(255, 255, 255, 0.85)"},
    },
} satisfies Record<string, Record<number, Pair>>

// Alpha fills the codemod routed through --ag-rgba-* (navy-on-white → white-on-dark).
export const alphaFill = {
    "051729-02": {light: "rgba(5, 23, 41, 0.02)", dark: "rgba(255, 255, 255, 0.04)"},
    "051729-04": {light: "rgba(5, 23, 41, 0.04)", dark: "rgba(255, 255, 255, 0.06)"},
    "051729-06": {light: "rgba(5, 23, 41, 0.06)", dark: "rgba(255, 255, 255, 0.08)"},
    "051729-08": {light: "rgba(5, 23, 41, 0.08)", dark: "rgba(255, 255, 255, 0.1)"},
    "051729-10": {light: "rgba(5, 23, 41, 0.1)", dark: "rgba(255, 255, 255, 0.12)"},
    "051729-14": {light: "rgba(5, 23, 41, 0.14)", dark: "rgba(255, 255, 255, 0.16)"},
    "051729-18": {light: "rgba(5, 23, 41, 0.18)", dark: "rgba(255, 255, 255, 0.2)"},
    "051729-45": {light: "rgba(5, 23, 41, 0.45)", dark: "rgba(255, 255, 255, 0.45)"},
    "051729-55": {light: "rgba(5, 23, 41, 0.55)", dark: "rgba(255, 255, 255, 0.6)"},
    "051729-65": {light: "rgba(5, 23, 41, 0.65)", dark: "rgba(255, 255, 255, 0.7)"},
    "051729-72": {light: "rgba(5, 23, 41, 0.72)", dark: "rgba(255, 255, 255, 0.78)"},
    "000-02": {light: "rgba(0, 0, 0, 0.02)", dark: "rgba(255, 255, 255, 0.04)"},
    "000-06": {light: "rgba(0, 0, 0, 0.06)", dark: "rgba(255, 255, 255, 0.08)"},
    "000-45": {light: "rgba(0, 0, 0, 0.45)", dark: "rgba(255, 255, 255, 0.45)"},
    "fff-78": {light: "rgba(255, 255, 255, 0.78)", dark: "rgba(20, 20, 20, 0.82)"},
} satisfies Record<string, Pair>

// ============================================================================
// FEATURE FAMILIES — already role-shaped in theme-variables.css; moved verbatim.
// ============================================================================

/** Reference-tag tones. */
export const referenceTag = {
    app: {
        text: {light: "#175cd3", dark: "var(--ant-blue-7)"},
        bg: {light: "#eff8ff", dark: "var(--ant-blue-1)"},
        border: {light: "#b2ddff", dark: "var(--ant-blue-3)"},
    },
    variant: {
        text: {light: "#027a48", dark: "var(--ant-green-7)"},
        bg: {light: "#ecfdf3", dark: "var(--ant-green-1)"},
        border: {light: "#abefc6", dark: "var(--ant-green-3)"},
    },
    testset: {
        text: {light: "#5925dc", dark: "var(--ant-purple-7)"},
        bg: {light: "#f4ebff", dark: "var(--ant-purple-1)"},
        border: {light: "#d6bbfb", dark: "var(--ant-purple-3)"},
    },
    query: {
        text: {light: "#b93815", dark: "var(--ant-volcano-7)"},
        bg: {light: "#fef6ee", dark: "var(--ant-volcano-1)"},
        border: {light: "#f9dbaf", dark: "var(--ant-volcano-3)"},
    },
    evaluator: {
        text: {light: "#c01048", dark: "var(--ant-magenta-7)"},
        bg: {light: "#fff1f3", dark: "var(--ant-magenta-1)"},
        border: {light: "#fcceee", dark: "var(--ant-magenta-3)"},
    },
    environment: {
        text: {light: "#0f766e", dark: "var(--ant-cyan-7)"},
        bg: {light: "#ecfdf3", dark: "var(--ant-cyan-1)"},
        border: {light: "#99f6e4", dark: "var(--ant-cyan-3)"},
    },
}

/** Deployment-environment tag tones. */
export const environmentTag = {
    production: {
        text: {light: "#237804", dark: "var(--ant-green-7)"},
        bg: {light: "#d9f7be", dark: "var(--ant-green-1)"},
        border: {light: "#d9f7be", dark: "var(--ant-green-3)"},
    },
    staging: {
        text: {light: "#fa541c", dark: "var(--ant-volcano-7)"},
        bg: {light: "#fff2e8", dark: "var(--ant-volcano-1)"},
        border: {light: "#fff2e8", dark: "var(--ant-volcano-3)"},
    },
    development: {
        text: {light: "#722ed1", dark: "var(--ant-purple-7)"},
        bg: {light: "#f9f0ff", dark: "var(--ant-purple-1)"},
        border: {light: "#f9f0ff", dark: "var(--ant-purple-3)"},
    },
}

/** Run-comparison row tints (keep in sync with RUN_COMPARISON_PALETTE). */
export const compareTint = {
    0: {light: "#eff6ff", dark: "rgba(59, 130, 246, 0.14)"},
    1: {light: "#fff7ed", dark: "rgba(249, 115, 22, 0.14)"},
    2: {light: "#f5f3ff", dark: "rgba(139, 92, 246, 0.14)"},
    3: {light: "#ecfdf5", dark: "rgba(16, 185, 129, 0.14)"},
    4: {light: "#fdf2f8", dark: "rgba(236, 72, 153, 0.14)"},
} satisfies Record<number, Pair>

/** Workflow-type chips (dark-defined; light falls back to the type's own tint). */
export const workflowType = {
    completion: {bg: "rgba(79, 209, 181, 0.14)", text: "#4fd1b5"},
    chat: {bg: "rgba(106, 168, 255, 0.14)", text: "#6aa8ff"},
    agent: {bg: "rgba(185, 140, 255, 0.14)", text: "#b98cff"},
}

// ============================================================================
// PLAYGROUND SURFACE LADDER — the elevation/containment system (already the
// target pattern: explicit light+dark, roles invert by theme).
// ============================================================================

export const playgroundSurface = {
    app: {light: "#e9ebee", dark: "#0a0a0c"},
    gutter: {light: "#eceef1", dark: "#060607"},
    divider: {light: "#ededee", dark: "#1c1c1f"},
    raised: {light: "#ffffff", dark: "#1a1b1e"}, // Configuration panel; --ag-sidebar-bg tracks this
    card: {light: "#ffffff", dark: "#212327"},
    cardBorder: {light: "#e7e8eb", dark: "#2d3036"},
    inset: {light: "#f3f4f6", dark: "#111214"},
    insetBorder: {light: "#e7e8eb", dark: "#26282d"},
    canvas: {light: "#f4f5f7", dark: "#0c0c0e"},
    chat: {light: "#ffffff", dark: "#17181b"},
    chatBorder: {light: "#e7e8eb", dark: "#26282d"},
    chip: {light: "#edeef0", dark: "#2a2a2e"},
    chipBorder: {light: "#e3e4e6", dark: "#303035"},
    rowHover: {light: "#f3f4f6", dark: "#212327"},
    accent: {light: "#c2d54a", dark: "#c2d54a"}, // brand accent, constant across themes
    raisedShadow: {
        light: "0 1px 3px rgba(16, 18, 22, 0.05)",
        dark: "inset 0 1px 0 rgba(255, 255, 255, 0.045)",
    },
    cardShadow: {
        light: "0 1px 2px rgba(16, 18, 22, 0.06)",
        dark: "0 1px 2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.03)",
    },
    chatShadow: {light: "0 1px 2px rgba(16, 18, 22, 0.06)", dark: "0 1px 3px rgba(0, 0, 0, 0.45)"},
    inspectorShadow: {
        light: "-8px 0 24px rgba(16, 18, 22, 0.08)",
        dark: "-8px 0 24px rgba(0, 0, 0, 0.35)",
    },
} satisfies Record<string, Pair>

export const composer = {
    border: {light: "#e7e8eb", dark: "#2a2c30"},
    focus: {light: "#c2d54a", dark: "rgba(194, 213, 74, 0.45)"},
    placeholder: {light: "#767b82", dark: "#7e828a"},
    sendDisabledBg: {light: "#eceef1", dark: "#26282c"},
    sendDisabledFg: {light: "#a6abb1", dark: "#6e7176"},
    userBubbleBg: {light: "#f4f6e4", dark: "rgba(194, 213, 74, 0.08)"},
    userBubbleBorder: {light: "#dde4a0", dark: "rgba(194, 213, 74, 0.22)"},
} satisfies Record<string, Pair>

// Drawer tier — dark-only today (light falls back to antd defaults).
export const drawerDark = {
    scrim: "rgba(6, 6, 8, 0.6)",
    sheet: "#1e1f22",
    divider: "#2a2c30",
    fieldBg: "#141517",
    fieldBorder: "#2e3136",
    fieldFocus: "#c2d54a",
    segTrack: "#141517",
    segActive: "#2c2f34",
    rail: "#1a1b1e",
    card: "#26282c",
    cardBorder: "#33363c",
    cardHover: "#2b2e33",
    tagBg: "rgba(255, 255, 255, 0.05)",
    tagText: "#9a9a9f",
    shadow: "-16px 0 40px rgba(0, 0, 0, 0.5)",
}

/** Semantic status wells (playground). */
export const status = {
    errorWell: {light: "#fdf3f3", dark: "#1e1416"},
    errorWellBorder: {light: "#f3d0ce", dark: "#4a2226"},
    errorBg: {light: "#fdecec", dark: "#2a1618"},
    errorBorder: {light: "#f5c6c4", dark: "#5a2a2e"},
    errorText: {light: "#c0362f", dark: "#f0857c"},
    successBg: {light: "#eaf6ec", dark: "#16231a"},
    successBorder: {light: "#bfe3c6", dark: "#2c4a34"},
    successText: {light: "#2e7d3a", dark: "#7fcf8f"},
} satisfies Record<string, Pair>

/** Evaluations "Application" cell tones. */
export const appVariantCell = {
    row: {light: "rgba(15, 23, 42, 0.55)", dark: "rgba(255, 255, 255, 0.65)"}, // mirrors text.secondary
    label: {light: "rgba(15, 23, 42, 0.85)", dark: "rgba(255, 255, 255, 0.85)"}, // mirrors text.primary
    chipBg: {light: "rgba(5, 23, 41, 0.08)", dark: "rgba(255, 255, 255, 0.12)"}, // mirrors fill.secondary
} satisfies Record<string, Pair>

/** Editor variable-token chips (painted via inline JS in TokenNode.ts). */
export const editorChip = {
    purple: {light: "#a855f7", dark: "#c084fc"},
    redBg: {light: "#fef2f2", dark: "#2a1215"},
    redStrong: {light: "#b91c1c", dark: "#ff7875"},
    redSoft: {light: "#f87171", dark: "#a8353a"},
} satisfies Record<string, Pair>

/** TemplateStrip feature family: colors with no existing semantic role. */
export const templateStrip = {
    inputBorder: {light: "#d6dee6", dark: "#2e3136"}, // mirrors drawerDark.fieldBorder
    selectedBg: {light: "#f5f7fa", dark: "rgba(255, 255, 255, 0.06)"},
    // Card surface: dark elevates above the page (container and page are both #141414,
    // so colorBgContainer gives no elevation) with a near-bg border; light keeps the
    // white-card-with-border look.
    cardBg: {light: "#ffffff", dark: "rgba(255, 255, 255, 0.04)"},
    cardBorder: {light: "#eaeff5", dark: "#232327"},
    cardBorderHover: {light: "#bdc7d1", dark: "#3a3a40"},
    cardHoverShadow: {
        light: "0 2px 8px -2px rgba(28, 44, 61, 0.12)",
        dark: "0 2px 8px -2px rgba(0, 0, 0, 0.45)",
    },
} satisfies Record<string, Pair>

// App shell — the navigation rail and the frame lines that separate it and the top
// bars from the content. The rail sits one step darker (light: greyer) than the
// content beside it, and every frame line shares one colour so they read as one frame.
export const shell = {
    railBg: {light: "#ffffff", dark: "#121316"},
    line: {light: "#e3e5e9", dark: "#2b2d32"},
    scrollThumb: {light: "rgba(15, 23, 42, 0.22)", dark: "rgba(255, 255, 255, 0.20)"},
    scrollThumbHover: {light: "rgba(15, 23, 42, 0.38)", dark: "rgba(255, 255, 255, 0.34)"},
} satisfies Record<string, Pair>

// Draft chip family (DraftTag). Gold in light; in dark the bg/border collapse to the
// elevated surface + gold text — preserving the current legacy-shim rendering exactly
// (--ag-c-FFFBE6 → colorBgElevated). Candidate cleanup: make dark gold-tinted too.
export const draftTag = {
    text: {light: "#d48806", dark: "#d48806"},
    bg: {light: "#fffbe6", dark: "var(--ag-colorBgElevated)"},
    border: {light: "#ffe58f", dark: "var(--ag-colorBgElevated)"},
} satisfies Record<string, Pair>

// antd preset Tag colors (`<Tag color="blue|green|…">`): color-1 bg + color-7 text.
// Distinct from the semantic tokens (e.g. green-7 text here vs colorSuccess green-6).
//
// DELIBERATE DEVIATION FROM antd — WCAG AA (4.5:1). antd's own color-7-on-color-1 pairing
// fails AA on 5 of these 16 pairs, so those 5 are bumped one or two steps DOWN antd's own
// ramp (never a custom colour). Measured against the paired bg, before → after:
//   gold   light  2.76 → 6.53  (step 7 → 9; the worst pair in the set)
//   cyan   light  3.39 → 5.82  (step 7 → 8)
//   green  light  3.37 → 5.44  (step 7 → 8)
//   orange light  3.34 → 5.09  (step 7 → 8)
//   purple dark   3.39 → 5.66  (dark step 7 → 8)
// The other 11 pairs already pass and stay on antd's default step. Values come from
// `generate()` in @ant-design/colors, not hand-mixed. This is the ONE place the palette
// knowingly diverges from antd, so the tag parity rows carry `data-vrt-expected`.
export const presetTag = {
    blueBg: {light: "#e6f4ff", dark: "#111a2c"},
    blueText: {light: "#0958d9", dark: "#3c89e8"},
    greenBg: {light: "#f6ffed", dark: "#162312"},
    greenText: {light: "#237804", dark: "#6abe39"},
    orangeBg: {light: "#fff7e6", dark: "#2b1d11"},
    orangeText: {light: "#ad4e00", dark: "#e89a3c"},
    redBg: {light: "#fff1f0", dark: "#2a1215"},
    redText: {light: "#cf1322", dark: "#e84749"},
    purpleBg: {light: "#f9f0ff", dark: "#1a1325"},
    purpleText: {light: "#531dab", dark: "#ab7ae0"},
    cyanBg: {light: "#e6fffb", dark: "#112123"},
    cyanText: {light: "#006d75", dark: "#33bcb7"},
    magentaBg: {light: "#fff0f6", dark: "#291321"},
    magentaText: {light: "#c41d7f", dark: "#e0529c"},
    goldBg: {light: "#fffbe6", dark: "#2b2111"},
    goldText: {light: "#874d00", dark: "#e8b339"},
} satisfies Record<string, Pair>

// antd Tabs item colours. antd-themeConfig.json overrides itemColor/itemHoverColor in LIGHT
// only (ThemeContextProvider strips colour overrides in dark), so dark keeps antd's defaults.
export const tabs = {
    item: {light: "#586673", dark: "var(--ag-colorText)"}, // light override = colorTextSecondary
    itemHover: {light: "#1c2c3d", dark: "var(--ag-colorPrimaryHover)"}, // light override = colorPrimary
} satisfies Record<string, Pair>

// antd `Empty`'s DEFAULT illustration (empty/empty.js). antd hard-codes four OPAQUE greys
// and themes the drawing only by dimming the whole <svg> to `opacityImage` (0.65) in dark.
// Opacity is load-bearing: the paper sits behind the envelope front, so a translucent fill
// token (colorFill/colorFillTertiary) lets it ghost through — antd never does. Dark values
// are each light grey pre-composited at 0.65 over colorBgContainer (#141414), which is
// exactly what antd's group-opacity produces, since every shape is opaque.
export const emptyImage = {
    shadow: {light: "#f5f5f7", dark: "#a6a6a8"}, // ground ellipse (carries its own fillOpacity .8)
    sheet: {light: "#f5f5f7", dark: "#a6a6a8"}, // the paper behind the envelope
    flap: {light: "#aeb8c2", dark: "#787f85"}, // back flap (darkest grey)
    front: {light: "#dce0e6", dark: "#96999d"}, // envelope front + speech bubble
    hole: {light: "#ffffff", dark: "#adadad"}, // punched-out marks inside the bubble
} satisfies Record<string, Pair>

// Button state tokens (rest / hover / active). Several are theme-specific overrides
// (text-on-primary flips to dark on the light-yellow dark primary; default bg is white
// in light but transparent in dark). Derived from the antd Button component config.
export const button = {
    primaryText: {light: "#ffffff", dark: "#141414"}, // text on primary bg
    primaryHover: {light: "#394857", dark: "#e8e47e"},
    primaryActive: {light: "#051729", dark: "#a4a443"},
    defaultBg: {light: "#ffffff", dark: "transparent"},
    defaultHoverBg: {light: "#ffffff", dark: "rgba(255, 255, 255, 0.04)"},
    defaultActiveBg: {light: "#ffffff", dark: "rgba(255, 255, 255, 0.08)"},
    textHoverBg: {light: "rgba(5, 23, 41, 0.06)", dark: "rgba(255, 255, 255, 0.08)"}, // antd colorBgTextHover
    textActiveBg: {light: "rgba(5, 23, 41, 0.15)", dark: "rgba(255, 255, 255, 0.18)"}, // antd colorBgTextActive (text/ghost btn pressed)
    link: {light: "#1c2c3d", dark: "#4e90dc"},
    linkHover: {light: "#394857", dark: "#79b8ff"},
    linkActive: {light: "#051729", dark: "#3b8eea"}, // antd colorLinkActive (link btn pressed)
    // antd's disabled Input border (a lighter gray than colorBorder in light).
    disabledInputBorder: {light: "#d9d9d9", dark: "#424242"},
} satisfies Record<string, Pair>

export const palette = {
    surface,
    text,
    border,
    fill,
    accent,
    semantic,
    shadow,
    componentsDark,
    scales,
    alphaFill,
    referenceTag,
    environmentTag,
    draftTag,
    presetTag,
    tabs,
    emptyImage,
    button,
    compareTint,
    workflowType,
    playgroundSurface,
    composer,
    drawerDark,
    status,
    appVariantCell,
    editorChip,
    templateStrip,
    shell,
}

export default palette
