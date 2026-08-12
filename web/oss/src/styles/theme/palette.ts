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
// WARM BRAND RAMP (light) — the 2026-08-11 recolor. Light mode moved from the
// cool navy/zinc system to the designer's warm paper/ink ramp; every light value
// below is one of these steps (or a documented derivation from one). Dark mode is
// deliberately untouched except the secondary set named in the recolor spec.
// ============================================================================
const GROUND = "#f6f5f3" // page ground, sidebar rail
const PAPER_SOFT = "#f0efed" // soft hairline, row dividers, list selection
const HAIRLINE = "#e5e5e3" // strong hairline: card/section borders
const CONTROL_BORDER = "#d7d7d7" // input/segmented/control borders
const INK_FAINT = "#a3a19f" // disabled / faint labels
const INK_TERTIARY = "#848b8c" // tertiary text + icons
const INK_SECONDARY = "#676770" // secondary/body text
const INK_HOVER = "#413f3f" // primary-button hover, strong tag text
const INK = "#242424" // primary text, primary button
const INK_DEEP = "#1e1c1d" // pressed/active ink
const PAPER = "#fbfaf8" // warm near-white: tinted panel surfaces one hair off the card
/** Yellow #f2f25c is a FILL only — never text, icon, or link in light mode. */
const BRAND_YELLOW = "#f2f25c"
const BRAND_YELLOW_DEEP = "#e7e712"
const FOCUS_LIME = "#d9d92c" // focus ring / composer send (retires #c2d54a)
const OLIVE = "#5e5e08" // links; the only text-safe yellow-family step

// ============================================================================
// CORE — antd-semantic roles (names map 1:1 to antd tokens). Light is the seed;
// dark is the exact darkAlgorithm output today, or an explicit [override].
// ============================================================================

export const surface = {
    base: {light: "#ffffff", dark: "#000000"},
    container: {light: "#ffffff", dark: "#141414"}, // [absorbs] --ag-c-FFFFFF, the #141414 literals
    elevated: {light: "#ffffff", dark: "#242424"}, // [override] [absorbs] 25+ light surfaces → one dark
    layout: {light: GROUND, dark: "#000000"}, // the warm page ground behind white cards
    spotlight: {light: "rgba(36, 36, 36, 0.9)", dark: "#424242"},
    mask: {light: "rgba(36, 36, 36, 0.45)", dark: "rgba(0, 0, 0, 0.45)"},
    containerDisabled: {light: "rgba(36, 36, 36, 0.04)", dark: "rgba(255, 255, 255, 0.08)"},
    infoBg: {light: "#e5f1f9", dark: "#111a2c"}, // antd's colorInfoBg (unified with antd render)
    // List/menu selection on WHITE popup surfaces. The nav rail's white pill is a
    // separate token (shell.selectedBg) because the rail ground is warm, not white.
    controlItemBgActive: {light: PAPER_SOFT, dark: "#57572a"},
    controlItemBgActiveHover: {light: HAIRLINE, dark: "#57572a"},
    infoBgHover: {light: "#d3e7f5", dark: "#111a2c"}, // one step down from infoBg
    controlOutline: {light: "rgba(217, 217, 44, 0.35)", dark: "rgba(251, 251, 96, 0.29)"}, // antd input/select focus glow
    errorOutline: {light: "rgba(217, 76, 74, 0.12)", dark: "rgba(238, 38, 56, 0.11)"}, // antd focus glow on error
    white: {light: "#ffffff", dark: "#ffffff"},
} satisfies Record<string, Pair>

export const text = {
    primary: {light: INK, dark: "rgba(255, 255, 255, 0.85)"},
    secondary: {light: INK_SECONDARY, dark: "rgba(255, 255, 255, 0.65)"},
    tertiary: {light: INK_TERTIARY, dark: "rgba(255, 255, 255, 0.45)"},
    quaternary: {light: INK_FAINT, dark: "rgba(255, 255, 255, 0.25)"},
    heading: {light: INK, dark: "rgba(255, 255, 255, 0.85)"},
    label: {light: INK_SECONDARY, dark: "rgba(255, 255, 255, 0.65)"},
    description: {light: INK_TERTIARY, dark: "rgba(255, 255, 255, 0.45)"},
    disabled: {light: INK_FAINT, dark: "rgba(255, 255, 255, 0.25)"},
    placeholder: {light: INK_FAINT, dark: "rgba(255, 255, 255, 0.38)"}, // [override]
    lightSolid: {light: "#ffffff", dark: "#ffffff"},
    icon: {light: INK_TERTIARY, dark: "rgba(255, 255, 255, 0.45)"}, // mirrors tertiary
    iconHover: {light: INK, dark: "rgba(255, 255, 255, 0.85)"}, // mirrors primary
} satisfies Record<string, Pair>

export const border = {
    default: {light: CONTROL_BORDER, dark: "#424242"}, // [absorbs] --ag-c-BDC7D1, zinc-4
    secondary: {light: HAIRLINE, dark: "#303030"},
    split: {light: PAPER_SOFT, dark: "rgba(253, 253, 253, 0.12)"},
} satisfies Record<string, Pair>

export const fill = {
    fill: {light: "rgba(36, 36, 36, 0.15)", dark: "rgba(255, 255, 255, 0.18)"},
    secondary: {light: "rgba(36, 36, 36, 0.06)", dark: "rgba(255, 255, 255, 0.12)"},
    tertiary: {light: "rgba(36, 36, 36, 0.04)", dark: "rgba(255, 255, 255, 0.08)"},
    quaternary: {light: "rgba(36, 36, 36, 0.02)", dark: "rgba(255, 255, 255, 0.04)"},
    // Default chip/tag fill. antd renders this translucent in light but as an OPAQUE
    // flatten of fill-tertiary in dark (#272727), pinned regardless of backdrop — a
    // translucent token can't match it, so it's stored explicitly per mode.
    chip: {light: "rgba(36, 36, 36, 0.02)", dark: "#272727"},
} satisfies Record<string, Pair>

export const accent = {
    primary: {light: INK, dark: "#f2f25c"}, // [override] warm ink light → brand yellow dark
    primaryHover: {light: INK_HOVER, dark: "#e8e47e"}, // antd colorPrimaryHover (checked-control hover fill)
    primaryText: {light: INK, dark: "#d1d151"}, // derived from the yellow primary
    link: {light: OLIVE, dark: "#8ccfff"}, // [override] [absorbs] the 6× #58a6ff literal
    linkHover: {light: INK, dark: "#b0deff"}, // [override]
    linkActive: {light: INK_DEEP, dark: "#54b5fa"}, // [override]
} satisfies Record<string, Pair>

/**
 * The single hero ("keycap") action per screen — Commit-class buttons only.
 * Flat fill, never white text; yellow stays out of dark chrome, so dark reuses the
 * shipped dark primary instead of #f2f25c.
 */
export const heroAction = {
    bg: {light: BRAND_YELLOW, dark: "#d1d151"},
    hoverBg: {light: BRAND_YELLOW_DEEP, dark: "#dcdc6b"},
    text: {light: INK, dark: "#141414"},
} satisfies Record<string, Pair>

export const semantic = {
    success: {light: "#2e7d3a", dark: "#52c41a"}, // [override]
    successHover: {light: "#3d9a4b", dark: "#52c41a"},
    successBorder: {light: "#b1cfb0", dark: "#274916"}, // successBg mixed 30% toward success
    successBg: {light: "#eaf2e3", dark: "#162312"}, // antd's derived colorSuccessBg (algorithm output)
    warning: {light: "#8a6400", dark: "#faad14"}, // [override]
    warningHover: {light: "#a67a06", dark: "#faad14"},
    warningText: {light: "#8a6400", dark: "#d89614"},
    warningBorder: {light: "#d9c898", dark: "#594214"}, // warningBg mixed 30% toward warning
    warningBg: {light: "#fbf3d9", dark: "#2b2111"}, // antd's own colorWarningBg (gold-1 / dark gold-1)
    error: {light: "#5e0908", dark: "#ff4d4f"}, // [override] [absorbs] --ag-c-FF4D4F
    errorHover: {light: "#7a0f0d", dark: "#e86e6b"}, // antd colorErrorHover (danger btn hover)
    errorActive: {light: "#3f0605", dark: "#ad393a"}, // antd colorErrorActive (danger btn active)
    errorText: {light: "#5e0908", dark: "#dc4446"},
    // The large-only red: ~4:1 on white, so borders and large text only, never body copy.
    errorBorder: {light: "#d94c4a", dark: "#5b2526"},
    errorBg: {light: "#f9e5e5", dark: "#2c1618"}, // antd's derived colorErrorBg (algorithm output)
    info: {light: "#113955", dark: "#1668dc"}, // deep blue light / antd blue dark
    infoHover: {light: "#1b5378", dark: "#1668dc"},
    infoActive: {light: "#0b2739", dark: "#1668dc"},
    infoBorder: {light: "#a5bac8", dark: "#15325b"}, // infoBg mixed 30% toward info
    infoBorderHover: {light: "#7fa0b5", dark: "#15325b"},
    primaryBorder: {light: HAIRLINE, dark: "#57572a"}, // antd colorPrimaryBorder (focus ring); ≠ infoBorder in dark
    primaryBorderHover: {light: INK_FAINT, dark: "#787834"}, // antd colorPrimaryBorderHover (slider track hover)
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

// Component-level light overrides (antd `components` map). Kept minimal: only where a
// global token cannot express the design.
export const componentsLight = {
    Menu: {
        // The nav rail sits on the warm ground, so its selected row is a WHITE pill —
        // whereas `controlItemBgActive` (list/menu selection on white popup surfaces)
        // has to stay a tint to be visible at all.
        itemSelectedBg: "#ffffff",
        itemSelectedColor: INK,
    },
}

// `colorLink` is one of antd's SEED tokens, so a global override is stripped and the
// darkAlgorithm's own derivation is painted instead (#8ccfff seeds to #7ab3dc, the same
// transform that turns #f2f25c into #d1d151). Component tokens are NOT seed-filtered, so
// pinning it on the four components that draw links is what actually lands the value.
const DARK_LINK = accent.link.dark as string

// Component-level dark overrides (antd `components` map).
export const componentsDark = {
    Button: {
        primaryColor: "#141414", // dark text on the bright-yellow primary
        defaultBg: "transparent",
        defaultHoverBg: "rgba(255, 255, 255, 0.04)",
        defaultActiveBg: "rgba(255, 255, 255, 0.08)",
        colorLink: DARK_LINK,
    },
    Drawer: {
        colorBgElevated: "#141414", // full-height drawer = container surface, not elevated
    },
    Typography: {colorLink: DARK_LINK},
    Table: {colorLink: DARK_LINK},
    Transfer: {colorLink: DARK_LINK},
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
    // zinc — the brand neutral ramp, 10-step, near-variant dark. Light is the warm
    // paper→ink ladder (the recolor); dark is unchanged.
    zinc: {
        1: {light: GROUND, dark: "#242424"},
        2: {light: PAPER_SOFT, dark: "#2a2a2a"},
        3: {light: HAIRLINE, dark: "#383838"},
        4: {light: CONTROL_BORDER, dark: "#424242"},
        5: {light: INK_FAINT, dark: "#5c5c5c"},
        6: {light: INK_TERTIARY, dark: "rgba(255, 255, 255, 0.45)"},
        7: {light: INK_SECONDARY, dark: "rgba(255, 255, 255, 0.65)"},
        8: {light: INK_HOVER, dark: "rgba(255, 255, 255, 0.75)"},
        9: {light: INK, dark: "rgba(255, 255, 255, 0.85)"},
        10: {light: INK_DEEP, dark: "rgba(255, 255, 255, 0.95)"},
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

// Alpha fills the codemod routed through --ag-rgba-* (ink-on-white → white-on-dark).
// The `051729-*` KEY names are the frozen CSS var names components consume; the light
// VALUES moved off navy #051729 onto warm ink #242424 with the recolor.
export const alphaFill = {
    "051729-02": {light: "rgba(36, 36, 36, 0.02)", dark: "rgba(255, 255, 255, 0.04)"},
    "051729-04": {light: "rgba(36, 36, 36, 0.04)", dark: "rgba(255, 255, 255, 0.06)"},
    "051729-06": {light: "rgba(36, 36, 36, 0.06)", dark: "rgba(255, 255, 255, 0.08)"},
    "051729-08": {light: "rgba(36, 36, 36, 0.08)", dark: "rgba(255, 255, 255, 0.1)"},
    "051729-10": {light: "rgba(36, 36, 36, 0.1)", dark: "rgba(255, 255, 255, 0.12)"},
    "051729-14": {light: "rgba(36, 36, 36, 0.14)", dark: "rgba(255, 255, 255, 0.16)"},
    "051729-18": {light: "rgba(36, 36, 36, 0.18)", dark: "rgba(255, 255, 255, 0.2)"},
    "051729-45": {light: "rgba(36, 36, 36, 0.45)", dark: "rgba(255, 255, 255, 0.45)"},
    "051729-55": {light: "rgba(36, 36, 36, 0.55)", dark: "rgba(255, 255, 255, 0.6)"},
    "051729-65": {light: "rgba(36, 36, 36, 0.65)", dark: "rgba(255, 255, 255, 0.7)"},
    "051729-72": {light: "rgba(36, 36, 36, 0.72)", dark: "rgba(255, 255, 255, 0.78)"},
    "000-02": {light: "rgba(0, 0, 0, 0.02)", dark: "rgba(255, 255, 255, 0.04)"},
    "000-06": {light: "rgba(0, 0, 0, 0.06)", dark: "rgba(255, 255, 255, 0.08)"},
    "000-45": {light: "rgba(0, 0, 0, 0.45)", dark: "rgba(255, 255, 255, 0.45)"},
    "fff-78": {light: "rgba(255, 255, 255, 0.78)", dark: "rgba(20, 20, 20, 0.82)"},
} satisfies Record<string, Pair>

const TAG_SLOT = {
    blue: {bg: {light: "#e5f1f9", dark: "rgba(140, 207, 255, 0.14)"}, text: {light: "#113955", dark: "#8ccfff"}}, // prettier-ignore
    neutral: {bg: {light: "#ebeaea", dark: "rgba(188, 188, 188, 0.14)"}, text: {light: INK_HOVER, dark: "#bcbcbc"}}, // prettier-ignore
    amber: {bg: {light: "#fbf3d9", dark: "rgba(235, 201, 106, 0.14)"}, text: {light: "#8a6400", dark: "#ebc96a"}}, // prettier-ignore
    olive: {bg: {light: "#f8f8dd", dark: "rgba(209, 209, 81, 0.14)"}, text: {light: OLIVE, dark: "#d1d151"}}, // prettier-ignore
    red: {bg: {light: "#f9e5e5", dark: "rgba(255, 142, 140, 0.14)"}, text: {light: "#5e0908", dark: "#ff8e8c"}}, // prettier-ignore
    // The sixth slot. The categorical set lists five light tag pairs but six dark accents,
    // so the green accent (#8fbf7a) needs a light counterpart: the spec's own success well
    // and success text, not a new colour. The one AA deviation in this block — the spec's
    // success text on its own success well measures 4.45:1, just under the 4.5:1 floor for
    // tag labels, so the TEXT steps one notch darker (4.45 → 4.82). The well is untouched,
    // and semantic.success / status.successText keep #2e7d3a for status use.
    green: {bg: {light: "#eaf2e3", dark: "rgba(143, 191, 122, 0.14)"}, text: {light: "#2c7737", dark: "#8fbf7a"}}, // prettier-ignore
} satisfies Record<string, {bg: Pair; text: Pair}>

// ============================================================================
// FEATURE FAMILIES — already role-shaped in theme-variables.css; moved verbatim.
// ============================================================================

/** One TAG_SLOT rendered as a tag triplet. The system has no separate border hue, so the border
 * takes the fill: these read as flat brand fills, like every other tag drawn from the set. */
const tagTone = (slot: (typeof TAG_SLOT)[keyof typeof TAG_SLOT]) => ({
    text: slot.text,
    bg: slot.bg,
    border: slot.bg,
})

const rgbChannels = (hex: string): string => {
    const h = hex.replace("#", "")
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")
}

/** Outline alpha, one pair for all six slots so the chips read as one set. */
const TAG_OUTLINE_ALPHA = {light: 0.22, dark: 0.3}

/** A tag triplet with the classic bordered-tag outline: the slot's own text colour at low
 * alpha, so the edge stays in the slot's hue without introducing a seventh colour. */
const outlinedTagTone = (slot: (typeof TAG_SLOT)[keyof typeof TAG_SLOT]) => ({
    text: slot.text,
    bg: slot.bg,
    border: {
        light: `rgba(${rgbChannels(slot.text.light as string)}, ${TAG_OUTLINE_ALPHA.light})`,
        dark: `rgba(${rgbChannels(slot.text.dark as string)}, ${TAG_OUTLINE_ALPHA.dark})`,
    } satisfies Pair,
})

/**
 * Reference-tag tones — on the categorical set, one slot each.
 *
 * All six appear side by side in a reference list, so all six slots are used and no two tones
 * collide. The assignment keeps each tone's nearest existing hue (app was blue, variant green,
 * query orange→amber, evaluator magenta→red); testset and environment take the two slots with no
 * near match (neutral, olive) rather than doubling up on a used one.
 *
 * These are the one tag family drawn OUTLINED — reference chips carry an identifier, so the edge
 * bounds it; the flat brand fills elsewhere (environmentTag, presetTag) stay flat.
 */
export const referenceTag = {
    app: outlinedTagTone(TAG_SLOT.blue),
    variant: outlinedTagTone(TAG_SLOT.green),
    testset: outlinedTagTone(TAG_SLOT.neutral),
    query: outlinedTagTone(TAG_SLOT.amber),
    evaluator: outlinedTagTone(TAG_SLOT.red),
    environment: outlinedTagTone(TAG_SLOT.olive),
}

/**
 * Deployment-environment tag tones — on the categorical set.
 *
 * Semantics drive the assignment, not the old hues: production is the live one (green), staging is
 * the "look before you ship" one (amber), development is unremarkable (neutral). The three stay
 * mutually distinguishable, which is the only hard requirement for an environment badge.
 */
export const environmentTag = {
    production: tagTone(TAG_SLOT.green),
    staging: tagTone(TAG_SLOT.amber),
    development: tagTone(TAG_SLOT.neutral),
}

/**
 * CHARTS — the one categorical series set, in FIXED order. Series are assigned by position and
 * cycle; never picked per item. Flat fills only, no gradient ramps.
 *
 * Consumed two ways: as `var(--ag-chart-series-N)` (SVG presentation attributes do resolve
 * `var()`), and as resolved hex through `lib/helpers/chartPalette` for the call sites that
 * derive a value in JS (e.g. an area fill at 8% of the series colour).
 */
export const chartSeries = [
    {light: "#D97757", dark: "#D1D151"},
    {light: "#54B5FA", dark: "#8CCFFF"},
    {light: "#D9D92C", dark: "#FF8E8C"},
    {light: "#113955", dark: "#8FBF7A"},
    {light: "#9D9D9D", dark: "#787878"},
] satisfies Pair[]

/**
 * Chart chrome. THEME-BLIND on purpose: each half carries the literal the chart components
 * rendered inline before tokenization, in both modes, so this is a pure move of where the value
 * lives. That freezes a known defect — grid/axis/tick are navy-on-navy in dark, i.e. barely
 * visible — which is a separate, deliberate fix (see the palette notes in the migration report).
 */
export const chart = {
    grid: {light: "#05172933", dark: "#05172933"}, // cartesian/polar grid lines
    axisLine: {light: "#05172933", dark: "#05172933"}, // axis + tick lines
    axisText: {light: "#666666", dark: "#666666"}, // tick labels
    reference: {light: "#94A3B8", dark: "#94A3B8"}, // threshold / reference lines
    // Unfilled remainder of a stacked bar — the part with no series.
    track: {light: "#E5E5E3", dark: "#333333"},
} satisfies Record<string, Pair>

/**
 * Evaluation run-status dots. One table behind what were three byte-identical copies
 * (StatusCells, RunSummaryCard, MetadataSummaryTable).
 *
 * THEME-BLIND today: both halves carry the shipped literal, so this is a pure consolidation and
 * dark renders unchanged. The light steps are still the pre-recolor Untitled-UI hues — retuning
 * them onto the warm ramp is now a one-line edit here instead of a three-file hunt.
 */
export const runStatus = {
    success: {light: "#12B76A", dark: "#12B76A"},
    processing: {light: "#3B82F6", dark: "#3B82F6"},
    default: {light: "#98A2B3", dark: "#98A2B3"},
    error: {light: "#F04438", dark: "#F04438"},
    warning: {light: "#F79009", dark: "#F79009"},
} satisfies Record<string, Pair>

/** Run-comparison row tints (keep in sync with RUN_COMPARISON_PALETTE). */
export const compareTint = {
    0: {light: "#eff6ff", dark: "rgba(59, 130, 246, 0.14)"},
    1: {light: "#fff7ed", dark: "rgba(249, 115, 22, 0.14)"},
    2: {light: "#f5f3ff", dark: "rgba(139, 92, 246, 0.14)"},
    3: {light: "#ecfdf5", dark: "rgba(16, 185, 129, 0.14)"},
    4: {light: "#fdf2f8", dark: "rgba(236, 72, 153, 0.14)"},
} satisfies Record<number, Pair>

/**
 * Workflow-type chips, drawn from the one categorical set: light uses the tag pairs,
 * dark uses the accents at ~14% alpha. Assignment — completion: olive (plain text in,
 * text out); chat: the neutral "session" pair (a chat is a session of turns); agent:
 * the approved Agent blue, which is pinned by the spec and must not be reassigned.
 */
export const workflowType = {
    completion: {
        bg: {light: "#f8f8dd", dark: "rgba(209, 209, 81, 0.14)"},
        text: {light: OLIVE, dark: "#d1d151"},
    },
    chat: {
        bg: {light: "#ebeaea", dark: "rgba(188, 188, 188, 0.14)"},
        text: {light: INK_HOVER, dark: "#bcbcbc"},
    },
    agent: {
        bg: {light: "#e5f1f9", dark: "rgba(140, 207, 255, 0.14)"},
        text: {light: "#113955", dark: "#8ccfff"},
    },
} satisfies Record<string, {bg: Pair; text: Pair}>

// ============================================================================
// PLAYGROUND SURFACE LADDER — the elevation/containment system (already the
// target pattern: explicit light+dark, roles invert by theme).
// ============================================================================

export const playgroundSurface = {
    // Matches the sidebar rail. The panel starts 1px into this ground, so the ground's only
    // visible expression in light mode is that 1px strip at the rail seam — a darker tone
    // there reads as a second border stacked on the hairline.
    app: {light: GROUND, dark: "#0a0a0c"},
    gutter: {light: GROUND, dark: "#060607"},
    divider: {light: "#ebeaea", dark: "#1c1c1f"},
    raised: {light: PAPER, dark: "#1a1b1e"}, // Configuration panel body (.ag-panel-raised)
    card: {light: "#ffffff", dark: "#212327"},
    cardBorder: {light: HAIRLINE, dark: "#2d3036"},
    inset: {light: GROUND, dark: "#111214"},
    insetBorder: {light: HAIRLINE, dark: "#26282d"},
    canvas: {light: "#ffffff", dark: "#0c0c0e"}, // Chat canvas: white beside the warm config panel
    chat: {light: "#ffffff", dark: "#17181b"},
    chatBorder: {light: HAIRLINE, dark: "#26282d"},
    chip: {light: "#ebeaea", dark: "#2a2a2e"},
    chipBorder: {light: HAIRLINE, dark: "#303035"},
    rowHover: {light: GROUND, dark: "#212327"},
    // Brand accent. Light retires lime #c2d54a for the focus/send green-yellow; dark
    // chrome is frozen by the recolor spec, so it keeps the shipped lime.
    accent: {light: FOCUS_LIME, dark: "#c2d54a"},
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
    border: {light: HAIRLINE, dark: "#2a2c30"},
    // Focused composer: the edge steps up the ink ramp rather than going yellow. Secondary
    // ink — the faint step is the DISABLED tone (backwards for a focused field) and the
    // tertiary step both sits at the bare 3:1 border floor and matches the placeholder.
    focus: {light: INK_SECONDARY, dark: "rgba(194, 213, 74, 0.45)"},
    placeholder: {light: INK_TERTIARY, dark: "#7e828a"},
    sendDisabledBg: {light: PAPER_SOFT, dark: "#26282c"},
    sendDisabledFg: {light: INK_FAINT, dark: "#6e7176"},
    // Quiet warm bubble on the white chat canvas — the fill is nearly white, so the
    // neutral hairline is what makes the bubble legible.
    userBubbleBg: {light: PAPER, dark: "rgba(194, 213, 74, 0.08)"},
    userBubbleBorder: {light: HAIRLINE, dark: "rgba(194, 213, 74, 0.22)"},
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

/** Semantic status wells (playground). Dark text steps use the soft status set. */
export const status = {
    errorWell: {light: "#fcf1f1", dark: "#1e1416"},
    errorWellBorder: {light: "#edc9c8", dark: "#4a2226"},
    errorBg: {light: "#f9e5e5", dark: "#2a1618"},
    errorBorder: {light: "#d94c4a", dark: "#5a2a2e"},
    errorText: {light: "#5e0908", dark: "#ff8e8c"},
    successBg: {light: "#eaf2e3", dark: "#16231a"},
    successBorder: {light: "#b1cfb0", dark: "#2c4a34"},
    successText: {light: "#2e7d3a", dark: "#8fbf7a"},
    warningBg: {light: "#fbf3d9", dark: "#2b2111"},
    warningBorder: {light: "#d9c898", dark: "#594214"},
    warningText: {light: "#8a6400", dark: "#ebc96a"},
} satisfies Record<string, Pair>

/** Evaluations "Application" cell tones. */
export const appVariantCell = {
    row: {light: INK_SECONDARY, dark: "rgba(255, 255, 255, 0.65)"}, // mirrors text.secondary
    label: {light: INK, dark: "rgba(255, 255, 255, 0.85)"}, // mirrors text.primary
    chipBg: {light: "rgba(36, 36, 36, 0.08)", dark: "rgba(255, 255, 255, 0.12)"}, // mirrors fill.secondary
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
    inputBorder: {light: CONTROL_BORDER, dark: "#2e3136"}, // mirrors drawerDark.fieldBorder
    selectedBg: {light: GROUND, dark: "rgba(255, 255, 255, 0.06)"},
    // Card surface: dark elevates above the page (container and page are both #141414,
    // so colorBgContainer gives no elevation) with a near-bg border; light keeps the
    // white-card-with-border look.
    cardBg: {light: "#ffffff", dark: "rgba(255, 255, 255, 0.04)"},
    cardBorder: {light: "#ebeaea", dark: "#232327"},
    cardBorderHover: {light: CONTROL_BORDER, dark: "#3a3a40"},
    cardHoverShadow: {
        light: "0 2px 8px -2px rgba(36, 36, 36, 0.12)",
        dark: "0 2px 8px -2px rgba(0, 0, 0, 0.45)",
    },
} satisfies Record<string, Pair>

/**
 * The tinted panel surface: section headers, config-area chrome, home-page cards —
 * anything that must read as a surface one step off the plain card without going grey.
 *
 * It replaces a `colorFillTertiary`-over-white composite, which flattened to the
 * achromatic #f6f6f6 and read cold. Light is the designer's warm near-white; dark is the
 * value that composite already flattens to (fill.chip.dark, the recorded opaque flatten
 * of fill-tertiary over the container), so dark renders unchanged.
 */
export const tintedSurface = {
    paper: {light: PAPER, dark: fill.chip.dark},
    // Section-header bars sit one step darker than the panel body they head, so the
    // header/body seam reads without a rule. Dark keeps the value the old composite
    // already flattened to, which is a step off the raised body there too.
    sectionHeader: {light: GROUND, dark: fill.chip.dark},
    // EXPERIMENT (founder, light only): expanded config-section content reads as a white
    // sheet on the warm panel body. `transparent` in dark so the content keeps inheriting
    // the panel exactly as shipped — and so reverting is this one value.
    sectionContent: {light: "#ffffff", dark: "transparent"},
} satisfies Record<string, Pair>

// App shell — the navigation rail and the frame lines that separate it and the top
// bars from the content. The rail sits one step darker (light: greyer) than the
// content beside it, and every frame line shares one colour so they read as one frame.
export const shell = {
    railBg: {light: GROUND, dark: "#101010"}, // warm rail beside white content
    line: {light: HAIRLINE, dark: "#2c2c2c"},
    scrollThumb: {light: "rgba(36, 36, 36, 0.22)", dark: "rgba(255, 255, 255, 0.20)"},
    scrollThumbHover: {light: "rgba(36, 36, 36, 0.38)", dark: "rgba(255, 255, 255, 0.34)"},
    // Selected nav row: a WHITE pill with a hairline on the warm rail (a yellow tint
    // was reviewed and rejected). Dark keeps the shipped olive selection.
    selectedBg: {light: "#ffffff", dark: "#3e3d1a"},
    selectedBorder: {light: HAIRLINE, dark: "transparent"},
    selectedText: {light: INK, dark: "#d1d151"},
} satisfies Record<string, Pair>

// Draft chip family (DraftTag). Gold in light; in dark the bg/border collapse to the
// elevated surface + gold text — preserving the current legacy-shim rendering exactly
// (--ag-c-FFFBE6 → colorBgElevated). Candidate cleanup: make dark gold-tinted too.
export const draftTag = {
    text: {light: "#8a6400", dark: "#ebc96a"}, // the soft "waiting/draft" step in dark
    bg: {light: "#fbf3d9", dark: "var(--ag-colorBgElevated)"},
    border: {light: "#d9c898", dark: "var(--ag-colorBgElevated)"},
} satisfies Record<string, Pair>

// Tag colours (`<Tag color="blue|green|…">`, and every `Badge variant=` in @agenta/ui).
//
// These 13 keys are still named for antd's preset hues because that is the vocabulary the
// call sites speak — WORKFLOW_TYPE_PRESET_MAP in @agenta/entities maps every workflow and
// evaluator type onto one of them, and badge.tsx maps each to a `bg-tag-*`/`text-tag-*`
// class. The NAMES are the API; the VALUES are no longer antd's hue ramps.
//
// They now resolve to the one categorical system: the six slots below, light on the tag
// pairs, dark on the accents over a ~14%-alpha well of the same hue. Thirteen names over
// six slots means some names are deliberately indistinguishable — that is the point of
// "one categorical system", and the assignment is FIXED (never per-item), chosen so the
// types that appear side by side stay apart. In the workflow reference picker those are
// agent / chat / completion / custom / evaluator, which take five different slots, and
// agent / chat / completion match the workflowType family above exactly, so the light
// badge and the dark `.ag-type-*` override agree.

export const presetTag = {
    blueBg: TAG_SLOT.neutral.bg, //     chat
    blueText: TAG_SLOT.neutral.text,
    greenBg: TAG_SLOT.green.bg, //      evaluator, exact match, human
    greenText: TAG_SLOT.green.text,
    orangeBg: TAG_SLOT.amber.bg, //     classifiers, matchers, regex, contains
    orangeText: TAG_SLOT.amber.text,
    redBg: TAG_SLOT.red.bg, //          ends with
    redText: TAG_SLOT.red.text,
    purpleBg: TAG_SLOT.blue.bg, //      agent, AI/LLM (the spec-pinned Agent pair)
    purpleText: TAG_SLOT.blue.text,
    cyanBg: TAG_SLOT.olive.bg, //       completion
    cyanText: TAG_SLOT.olive.text,
    magentaBg: TAG_SLOT.green.bg, //    contains JSON
    magentaText: TAG_SLOT.green.text,
    goldBg: TAG_SLOT.amber.bg, //       custom, custom code, code
    goldText: TAG_SLOT.amber.text,
    pinkBg: TAG_SLOT.blue.bg, //        similarity match
    pinkText: TAG_SLOT.blue.text,
    yellowBg: TAG_SLOT.neutral.bg, //   starts with
    yellowText: TAG_SLOT.neutral.text,
    volcanoBg: TAG_SLOT.olive.bg, //    JSON diff, functional, hook
    volcanoText: TAG_SLOT.olive.text,
    geekblueBg: TAG_SLOT.amber.bg, //   semantic similarity, RAG faithfulness
    geekblueText: TAG_SLOT.amber.text,
    limeBg: TAG_SLOT.red.bg, //         webhook, Levenshtein, RAG
    limeText: TAG_SLOT.red.text,
} satisfies Record<string, Pair>

// antd Tabs item colours. antd-themeConfig.json overrides itemColor/itemHoverColor in LIGHT
// only (ThemeContextProvider strips colour overrides in dark), so dark keeps antd's defaults.
export const tabs = {
    item: {light: INK_SECONDARY, dark: "var(--ag-colorText)"}, // light override = colorTextSecondary
    itemHover: {light: INK, dark: "var(--ag-colorPrimaryHover)"}, // light override = colorPrimary
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
    primaryHover: {light: INK_HOVER, dark: "#e8e47e"},
    primaryActive: {light: INK_DEEP, dark: "#a4a443"},
    defaultBg: {light: "#ffffff", dark: "transparent"},
    defaultHoverBg: {light: "#ffffff", dark: "rgba(255, 255, 255, 0.04)"},
    defaultActiveBg: {light: "#ffffff", dark: "rgba(255, 255, 255, 0.08)"},
    textHoverBg: {light: "rgba(36, 36, 36, 0.06)", dark: "rgba(255, 255, 255, 0.08)"}, // antd colorBgTextHover
    textActiveBg: {light: "rgba(36, 36, 36, 0.15)", dark: "rgba(255, 255, 255, 0.18)"}, // antd colorBgTextActive (text/ghost btn pressed)
    link: {light: OLIVE, dark: "#8ccfff"},
    linkHover: {light: INK, dark: "#b0deff"},
    linkActive: {light: INK_DEEP, dark: "#54b5fa"}, // antd colorLinkActive (link btn pressed)
    // antd's disabled Input border (a lighter gray than colorBorder in light).
    disabledInputBorder: {light: HAIRLINE, dark: "#424242"},
} satisfies Record<string, Pair>

// ============================================================================
// ANTD LIGHT TOKEN OVERRIDES — the light twin of DARK_TOKEN_OVERRIDES.
//
// Light mode feeds antd a full token dump (styles/tokens/antd-themeConfig.json) that
// still carries the pre-recolor navy system. Whatever that dump says is what antd
// RENDERS, so palette edits alone would never reach the screen. This map lands the
// palette's light values in the rendered --ant-* variables — the light half of the
// seed-vs-rendered rule. Every value is a role above; the handful of antd-only
// intermediate steps are documented derivations of one.
// ============================================================================
const l = (p: Pair): string => p.light as string

export const antdLight: Record<string, string> = {
    // text
    colorText: l(text.primary),
    colorTextBase: l(text.primary),
    colorTextHeading: l(text.heading),
    colorIconHover: l(text.iconHover),
    colorTextSecondary: l(text.secondary),
    colorTextLabel: l(text.label),
    colorTextTertiary: l(text.tertiary),
    colorTextDescription: l(text.description),
    colorIcon: l(text.icon),
    colorTextQuaternary: l(text.quaternary),
    colorTextDisabled: l(text.disabled),
    colorTextPlaceholder: l(text.placeholder),
    colorTextLightSolid: l(text.lightSolid),
    // surfaces
    colorBgContainer: l(surface.container),
    colorBgElevated: l(surface.elevated),
    colorBgLayout: l(surface.layout),
    colorBgBase: l(surface.base),
    colorBgMask: l(surface.mask),
    colorBgSpotlight: l(surface.spotlight),
    colorBgContainerDisabled: l(surface.containerDisabled),
    colorBorderBg: l(surface.container),
    colorWhite: l(surface.white),
    // borders + fills
    colorBorder: l(border.default),
    colorBorderSecondary: l(border.secondary),
    colorSplit: l(border.split),
    colorFill: l(fill.fill),
    colorFillSecondary: l(fill.secondary),
    colorFillTertiary: l(fill.tertiary),
    colorFillQuaternary: l(fill.quaternary),
    colorFillContent: l(fill.secondary),
    colorFillContentHover: l(fill.fill),
    colorFillAlter: l(fill.quaternary),
    colorFillAlterSolid: GROUND,
    colorBgTextHover: l(button.textHoverBg),
    colorBgTextActive: l(button.textActiveBg),
    // control items + focus
    controlItemBgActive: l(surface.controlItemBgActive),
    controlItemBgActiveHover: l(surface.controlItemBgActiveHover),
    controlItemBgActiveDisabled: l(fill.fill),
    controlItemBgHover: l(fill.tertiary),
    controlOutline: l(surface.controlOutline),
    controlTmpOutline: l(fill.quaternary),
    // primary (warm ink)
    colorPrimary: l(accent.primary),
    colorPrimaryHover: l(accent.primaryHover),
    colorPrimaryActive: l(button.primaryActive),
    colorPrimaryText: l(accent.primaryText),
    colorPrimaryTextHover: l(accent.primaryHover),
    colorPrimaryTextActive: l(button.primaryActive),
    colorPrimaryBg: GROUND,
    colorPrimaryBgHover: PAPER_SOFT,
    colorPrimaryBorder: l(semantic.primaryBorder),
    colorPrimaryBorderHover: l(semantic.primaryBorderHover),
    // links (olive; the only text-safe yellow-family step)
    colorLink: l(accent.link),
    colorLinkHover: l(accent.linkHover),
    colorLinkActive: l(accent.linkActive),
    // info (deep blue)
    colorInfo: l(semantic.info),
    colorInfoText: l(semantic.info),
    colorInfoHover: l(semantic.infoHover),
    colorInfoTextHover: l(semantic.infoHover),
    colorInfoActive: l(semantic.infoActive),
    colorInfoTextActive: l(semantic.infoActive),
    colorInfoBg: l(surface.infoBg),
    colorInfoBgHover: l(surface.infoBgHover),
    colorInfoBorder: l(semantic.infoBorder),
    colorInfoBorderHover: l(semantic.infoBorderHover),
    // success
    colorSuccess: l(semantic.success),
    colorSuccessText: l(semantic.success),
    colorSuccessActive: l(semantic.success),
    colorSuccessHover: l(semantic.successHover),
    colorSuccessTextHover: l(semantic.successHover),
    colorSuccessTextActive: l(semantic.success),
    colorSuccessBg: l(semantic.successBg),
    colorSuccessBgHover: "#dcead1", // successBg one step toward the border
    colorSuccessBorder: l(semantic.successBorder),
    colorSuccessBorderHover: l(semantic.successHover),
    // warning
    colorWarning: l(semantic.warning),
    colorWarningText: l(semantic.warningText),
    colorWarningActive: l(semantic.warning),
    colorWarningHover: l(semantic.warningHover),
    colorWarningTextHover: l(semantic.warningHover),
    colorWarningTextActive: l(semantic.warning),
    colorWarningBg: l(semantic.warningBg),
    colorWarningBgHover: "#f5e8bf", // warningBg one step toward the border
    colorWarningBorder: l(semantic.warningBorder),
    colorWarningBorderHover: l(semantic.warningHover),
    colorWarningOutline: "rgba(138, 100, 0, 0.12)",
    // error — body text is the deep rosewood; #d94c4a is border/large-text only
    colorError: l(semantic.error),
    colorErrorText: l(semantic.errorText),
    colorErrorHover: l(semantic.errorHover),
    colorErrorTextHover: l(semantic.errorHover),
    colorErrorActive: l(semantic.errorActive),
    colorErrorTextActive: l(semantic.errorActive),
    colorErrorBg: l(semantic.errorBg),
    colorErrorBgHover: "#f2d4d4", // errorBg one step toward the border
    colorErrorBorder: l(semantic.errorBorder),
    colorErrorBorderHover: l(semantic.error),
    colorErrorOutline: l(surface.errorOutline),
    // the brand neutral ramp antd exposes as --ant-zinc-*
    "zinc.1": GROUND,
    "zinc.2": PAPER_SOFT,
    "zinc.3": HAIRLINE,
    "zinc.4": CONTROL_BORDER,
    "zinc.5": INK_FAINT,
    "zinc.6": INK_TERTIARY,
    "zinc.7": INK_SECONDARY,
    "zinc.8": INK_HOVER,
    "zinc.9": INK,
    "zinc.10": INK_DEEP,
}

export const palette = {
    surface,
    text,
    border,
    fill,
    accent,
    heroAction,
    semantic,
    shadow,
    antdLight,
    componentsLight,
    componentsDark,
    scales,
    alphaFill,
    referenceTag,
    environmentTag,
    chartSeries,
    chart,
    runStatus,
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
    tintedSurface,
    shell,
}

export default palette
