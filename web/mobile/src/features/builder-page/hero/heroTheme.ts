/**
 * The hero's two inks, read from the app tokens (theme.generated.css) on the element:
 * --colorText for the near lines and --colorTextSecondary for the far ones. In dark mode
 * the lines go one step whiter (--colorTextLightSolid and --colorText) and denser, so they
 * read as clearly on the dark background as the light lines do on white. Dark mode tokens
 * are white with alpha, so each ink is composited over --colorBgContainer.
 */

export type Rgb = [number, number, number]

export interface HeroInks {
    ink: Rgb
    ink2: Rgb
    /** Scales how much the lines cover the background: 1 in light mode. */
    gain: number
}

// The light tokens, used when a token cannot be read.
export const LIGHT_INKS: HeroInks = {ink: [36, 36, 36], ink2: [103, 103, 112], gain: 1}

// Thin light lines on a dark background read fainter than dark lines on white. With this gain
// the dark lines match the light lines' contrast (APCA Lc of the brightest tenth of line pixels).
const DARK_GAIN = 1.5

type Rgba = [number, number, number, number]

/**
 * Parses a token value: "rgba(r, g, b, a)" or hex. theme.generated.css writes "#rrggbb" and
 * rgba(), but the built CSS is minified to the short forms "#rgb" and "#rrggbbaa".
 */
export function parseCssColor(value: string): Rgba | null {
    const v = value.trim().toLowerCase()
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)
    if (hex) {
        const h = hex[1].length <= 4 ? hex[1].replace(/./g, "$&$&") : hex[1]
        const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
        return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
    }
    const fn = /^rgba?\(([^)]+)\)$/.exec(v)
    if (!fn) return null
    const [r, g, b, a = 1] = fn[1].split(",").map(Number)
    const out: Rgba = [r, g, b, a]
    return out.every(Number.isFinite) ? out : null
}

function over(fg: Rgba, bg: Rgba): Rgb {
    const a = fg[3]
    return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))) as Rgb
}

/** Reads the inks from the element's computed tokens. */
export function readHeroInks(el: Element): HeroInks {
    const style = getComputedStyle(el)
    const read = (name: string) => parseCssColor(style.getPropertyValue(name))
    // The app switches theme with the "dark" class of <html>.
    const dark = el.closest(".dark") !== null
    const bg = read("--colorBgContainer") ?? [255, 255, 255, 1]
    const ink = read(dark ? "--colorTextLightSolid" : "--colorText")
    const ink2 = read(dark ? "--colorText" : "--colorTextSecondary")
    return {
        ink: ink ? over(ink, bg) : LIGHT_INKS.ink,
        ink2: ink2 ? over(ink2, bg) : LIGHT_INKS.ink2,
        gain: dark ? DARK_GAIN : 1,
    }
}
