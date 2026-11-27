import {colors, type ThemeMode} from "./theme.config"

// WCAG 2.x relative luminance of a #rrggbb color.
function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16)
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const c = v / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

export function resolveColor(name: string, mode: ThemeMode): string {
    const entry = colors.find((c) => c.name === name)
    if (!entry) throw new Error(`Unknown color "${name}"`)
    const value = entry.value[mode]
    // A translucent #rrggbbaa color is checked as it paints over the background.
    return value.length === 9 ? over(value, resolveColor("background", mode)) : value
}

function over(rgba: string, ground: string): string {
    const alpha = parseInt(rgba.slice(7, 9), 16) / 255
    const [c, g] = [rgba.slice(0, 7), ground].map((h) => parseInt(h.slice(1), 16))
    const mix = [16, 8, 0].map((sh) =>
        Math.round(((c >> sh) & 255) * alpha + ((g >> sh) & 255) * (1 - alpha)),
    )
    return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

// The color a `<name>/<percent>` tint paints over a solid ground.
export function tint(name: string, ground: string, mode: ThemeMode, percent = 10): string {
    const [c, g] = [resolveColor(name, mode), resolveColor(ground, mode)].map((h) =>
        parseInt(h.slice(1), 16),
    )
    const ch = (v: number, shift: number) => (v >> shift) & 255
    const mix = [16, 8, 0].map((sh) =>
        Math.round(ch(c, sh) * (percent / 100) + ch(g, sh) * (1 - percent / 100)),
    )
    return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

/** Every foreground/background pair the system promises, with its minimum ratio. */
export const contrastPairs: [foreground: string, background: string, min: number][] = [
    ["foreground", "background", 12],
    ["foreground", "muted", 12],
    ["foreground", "popover", 12],
    ...["background", "muted", "secondary", "accent", "selected", "popover"].map(
        (bg): [string, string, number] => ["muted-foreground", bg, 4.5],
    ),
    ["background", "foreground", 4.5],
    ["background", "primary", 4.5],
    ["brand-foreground", "brand", 4.5],
    ["background", "destructive", 4.5],
    ["link", "background", 4.5],
    ["link", "muted", 4.5],
    ["border-strong", "background", 3],
    ["border-strong", "muted", 3],
    ["border-strong", "secondary", 3],
    ["border-strong", "selected", 3],
    ...["destructive", "success", "warning", "info"].flatMap((s): [string, string, number][] => [
        [s, "background", 4.5],
        [s, "muted", 4.5],
    ]),
    ...["keyword", "string", "number", "function", "property"].flatMap(
        (c): [string, string, number][] => [
            [`code-${c}`, "background", 4.5],
            [`code-${c}`, "muted", 4.5],
        ],
    ),
]

/** Status text on its own 10% tint, over each ground a badge or banner sits on. */
export const statusTints = ["destructive", "success", "warning", "info"].flatMap((s) =>
    (["background", "muted"] as const).map((ground) => ({status: s, ground})),
)
