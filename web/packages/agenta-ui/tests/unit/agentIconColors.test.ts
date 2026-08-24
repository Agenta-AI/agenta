import {describe, expect, it} from "vitest"

import {
    AGENT_ICON_COLORS,
    DEFAULT_AGENT_ICON,
    clamp,
    darkColorFor,
    darkTintFor,
    hexToHsv,
    hsvToHex,
    isHexColor,
    normalizeHex,
    tintFor,
    tintForColor,
    toRgb,
} from "../../src/agent-icon/colors"

/** Perceived lightness, good enough to assert "this got lighter". */
const luma = (hex: string) => {
    const [r, g, b] = toRgb(hex)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe("toRgb", () => {
    it("reads a six-digit hex", () => {
        expect(toRgb("#113955")).toEqual([17, 57, 85])
    })

    it("expands a three-digit shorthand", () => {
        expect(toRgb("#abc")).toEqual([170, 187, 204])
    })

    it("does not require the leading hash", () => {
        expect(toRgb("113955")).toEqual([17, 57, 85])
    })

    it("returns black rather than NaN for junk", () => {
        expect(toRgb("")).toEqual([0, 0, 0])
        expect(toRgb("#zzzzzz")).toEqual([0, 0, 0])
    })
})

describe("hexToHsv / hsvToHex", () => {
    it.each(AGENT_ICON_COLORS.map(([solid]) => solid))("round-trips %s", (solid) => {
        const {h, s, v} = hexToHsv(solid)
        expect(hsvToHex(h, s, v).toLowerCase()).toBe(solid.toLowerCase())
    })

    it("reports no hue for greys", () => {
        expect(hexToHsv("#808080").s).toBe(0)
        expect(hexToHsv("#000000")).toEqual({h: 0, s: 0, v: 0})
    })

    it("keeps hue in 0..360 for the red wrap-around", () => {
        expect(hexToHsv("#ff0000").h).toBe(0)
        expect(hexToHsv("#ff00ff").h).toBe(300)
    })
})

describe("tintForColor", () => {
    it("uses the hand-tuned pair for a palette colour", () => {
        for (const [solid, tint] of AGENT_ICON_COLORS) {
            expect(tintForColor(solid)).toBe(tint)
        }
    })

    it("matches a palette colour regardless of case", () => {
        expect(tintForColor("#113955".toLowerCase())).toBe("#E5F1F9")
    })

    it("derives a tint for a colour the palette does not have", () => {
        expect(tintForColor("#123456")).toBe(tintFor("#123456"))
    })

    it("always derives something lighter than the colour", () => {
        for (const hex of ["#000000", "#123456", "#7C3AED", "#D61010"]) {
            expect(luma(tintFor(hex))).toBeGreaterThan(luma(hex))
        }
    })
})

describe("dark-mode derivation", () => {
    it("lifts every palette colour toward white", () => {
        for (const [solid] of AGENT_ICON_COLORS) {
            expect(luma(darkColorFor(solid))).toBeGreaterThan(luma(solid))
        }
    })

    it("washes the LIFTED colour, not the original — a dark wash of a dark navy is invisible", () => {
        expect(darkTintFor("#113955")).toBe(
            `rgba(${toRgb(darkColorFor("#113955")).join(", ")}, 0.16)`,
        )
        expect(darkTintFor("#113955")).not.toContain("17, 57, 85")
    })

    it("emits a translucent rgba the browser can parse", () => {
        expect(darkTintFor("#7C3AED")).toMatch(/^rgba\(\d+, \d+, \d+, 0\.16\)$/)
    })
})

describe("isHexColor / normalizeHex", () => {
    it("accepts six digits with or without the hash, in any case", () => {
        expect(isHexColor("#abc123")).toBe(true)
        expect(isHexColor("ABC123")).toBe(true)
        expect(isHexColor("  #abc123  ")).toBe(true)
    })

    it("rejects partial input, so typing a hex does not repaint mid-keystroke", () => {
        expect(isHexColor("#abc")).toBe(false)
        expect(isHexColor("#abc12")).toBe(false)
        expect(isHexColor("#abc1234")).toBe(false)
        expect(isHexColor("#zzzzzz")).toBe(false)
        expect(isHexColor("")).toBe(false)
    })

    it("adds the hash only when it is missing", () => {
        expect(normalizeHex("abc123")).toBe("#abc123")
        expect(normalizeHex("#abc123")).toBe("#abc123")
        expect(normalizeHex("  abc123 ")).toBe("#abc123")
    })
})

describe("palette shape", () => {
    it("holds only valid six-digit hexes", () => {
        for (const [solid, tint] of AGENT_ICON_COLORS) {
            expect(isHexColor(solid)).toBe(true)
            expect(isHexColor(tint)).toBe(true)
        }
    })

    it("has no duplicate colours — a repeat would give two swatches the same selected ring", () => {
        const solids = AGENT_ICON_COLORS.map(([solid]) => solid.toLowerCase())
        expect(new Set(solids).size).toBe(solids.length)
    })

    it("defaults to a colour the palette has a hand-tuned tint for", () => {
        const pair = AGENT_ICON_COLORS.find(([solid]) => solid === DEFAULT_AGENT_ICON.color)
        expect(pair).toBeDefined()
        expect(tintForColor(DEFAULT_AGENT_ICON.color)).toBe(pair![1])
    })
})

describe("clamp", () => {
    it("bounds drag fractions to the track", () => {
        expect(clamp(-0.5, 0, 1)).toBe(0)
        expect(clamp(1.5, 0, 1)).toBe(1)
        expect(clamp(0.25, 0, 1)).toBe(0.25)
    })
})
