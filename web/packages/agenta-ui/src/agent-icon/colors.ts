/** The agent-icon palette and the colour maths the picker needs. */

/**
 * The swatch row, in order. Each entry pairs the solid colour with its hand-tuned light tint —
 * `tintFor` gets close but not to these, and the row is the one place the difference is visible
 * side by side. A colour typed into the custom field falls back to the derived tint.
 *
 * These are literals rather than palette.ts roles because they are user-chosen DATA, not theme
 * roles: the user picks "the purple one", and that choice must survive a theme retune.
 */
export const AGENT_ICON_COLORS: readonly (readonly [solid: string, tint: string])[] = [
    ["#113955", "#E5F1F9"],
    ["#475569", "#EEF1F5"],
    ["#1668DC", "#E7F0FD"],
    ["#0E7490", "#E2F1F5"],
    ["#0F766E", "#E3F2F0"],
    ["#389E0D", "#EDF7E7"],
    ["#CA8A04", "#FBF4DF"],
    ["#D61010", "#FBE7E7"],
    ["#7C3AED", "#F1EBFD"],
] as const

/**
 * What the picker PREVIEWS for an agent that has no choice yet — the light agent-chip pair, so the
 * preview reads as "this is your agent" rather than as an arbitrary colour.
 *
 * It is not a stored default and no swatch renders as selected until a record exists: the sidebar's
 * dark agent chip is olive, not this navy, so treating it as "already chosen" would let a click on
 * the seemingly-selected swatch change the row in dark mode while looking like a no-op.
 */
export const DEFAULT_AGENT_ICON = {icon: "robot", color: "#113955"} as const

export const clamp = (n: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, n))

export const toRgb = (hex: string): [number, number, number] => {
    const raw = (hex || "").replace("#", "")
    const full =
        raw.length === 3
            ? raw
                  .split("")
                  .map((c) => c + c)
                  .join("")
            : raw.padEnd(6, "0")
    return [
        parseInt(full.slice(0, 2), 16) || 0,
        parseInt(full.slice(2, 4), 16) || 0,
        parseInt(full.slice(4, 6), 16) || 0,
    ]
}

export const hsvToHex = (h: number, s: number, v: number): string => {
    const channel = (n: number) => {
        const k = (n + h / 60) % 6
        const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
        return Math.round(c * 255)
            .toString(16)
            .padStart(2, "0")
    }
    return "#" + channel(5) + channel(3) + channel(1)
}

export const hexToHsv = (hex: string): {h: number; s: number; v: number} => {
    const [r, g, b] = toRgb(hex).map((c) => c / 255)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    let h = 0
    if (delta) {
        if (max === r) h = 60 * (((g - b) / delta) % 6)
        else if (max === g) h = 60 * ((b - r) / delta + 2)
        else h = 60 * ((r - g) / delta + 4)
    }
    return {h: (h + 360) % 360, s: max ? delta / max : 0, v: max}
}

const mix = (hex: string, target: number, amount: number): string =>
    "#" +
    toRgb(hex)
        .map((c) =>
            Math.round(c + (target - c) * amount)
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")

/** A custom colour has no hand-tuned pair, so lighten it 88% toward white for the chip. */
export const tintFor = (hex: string): string => mix(hex, 255, 0.88)

/** A light tint is unreadable on a dark surface, and so is the solid colour, so dark mode lifts the
 * colour toward white. */
export const darkColorFor = (hex: string): string => mix(hex, 255, 0.45)

/** The dark tile is a translucent wash of the LIFTED colour, not the original — washing the dark
 * original leaves an invisible tile. Same construction as palette.ts TAG_SLOT, which washes its
 * dark accent (`rgba(140, 207, 255, 0.14)` under text `#8ccfff`), never the light one. */
export const darkTintFor = (hex: string): string => {
    const [r, g, b] = toRgb(darkColorFor(hex))
    return `rgba(${r}, ${g}, ${b}, 0.16)`
}

/**
 * The tint that goes with a colour. Derived, never stored: a stored tint would freeze against the
 * palette, so retuning a swatch would leave every already-saved agent on the old pair.
 */
export const tintForColor = (hex: string): string => {
    const match = AGENT_ICON_COLORS.find(([solid]) => solid.toLowerCase() === hex.toLowerCase())
    return match ? match[1] : tintFor(hex)
}

export const isHexColor = (value: string): boolean => /^#?[0-9a-f]{6}$/i.test(value.trim())

export const normalizeHex = (value: string): string => {
    const trimmed = value.trim()
    return trimmed.startsWith("#") ? trimmed : `#${trimmed}`
}
