/**
 * The hero's two inks, read from the app tokens (theme.generated.css) on the element:
 * --colorText for the near lines and --colorTextSecondary for the far ones. Dark mode
 * tokens are white with alpha, so each ink is composited over --colorBgContainer.
 */

export type Rgb = [number, number, number]

export interface HeroInks {
    ink: Rgb
    ink2: Rgb
}

// The light tokens, used until the element's tokens can be read.
export const LIGHT_INKS: HeroInks = {ink: [36, 36, 36], ink2: [103, 103, 112]}

type Rgba = [number, number, number, number]

/** Parses "#rgb", "#rrggbb", "#rrggbbaa", "rgb(...)" or "rgba(...)" into 0..255 channels and 0..1 alpha. */
export function parseCssColor(value: string): Rgba | null {
    const v = value.trim().toLowerCase()
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)
    if (hex) {
        const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1]
        const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
        return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
    }
    const fn = /^rgba?\(([^)]+)\)$/.exec(v)
    if (!fn) return null
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const channel = (p: string) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p))
    const alpha =
        parts[3] === undefined
            ? 1
            : parts[3].endsWith("%")
              ? parseFloat(parts[3]) / 100
              : parseFloat(parts[3])
    const out: Rgba = [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha]
    return out.every(Number.isFinite) ? out : null
}

function over(fg: Rgba, bg: Rgba): Rgb {
    const a = fg[3]
    return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))) as Rgb
}

/** Reads the inks from the element's computed tokens; keeps `previous` when a token cannot be read. */
export function readHeroInks(el: Element, previous: HeroInks = LIGHT_INKS): HeroInks {
    const style = getComputedStyle(el)
    const read = (name: string) => parseCssColor(style.getPropertyValue(name))
    const bg = read("--colorBgContainer") ?? [255, 255, 255, 1]
    const ink = read("--colorText")
    const ink2 = read("--colorTextSecondary")
    return {
        ink: ink ? over(ink, bg) : previous.ink,
        ink2: ink2 ? over(ink2, bg) : previous.ink2,
    }
}
