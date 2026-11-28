import {describe, expect, it} from "vitest"

import {
    contrastPairs,
    contrastRatio,
    resolveColor,
    statusTints,
    tint,
} from "../../src/foundation/design/contrast"
import {colorAliases, colors} from "../../src/foundation/design/theme.config"

describe("design theme contrast", () => {
    it("computes known WCAG ratios", () => {
        expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1)
        expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2)
    })

    for (const mode of ["light", "dark"] as const) {
        it.each(contrastPairs)(`${mode}: %s on %s is at least %d:1`, (fg, bg, min) => {
            expect(
                contrastRatio(resolveColor(fg, mode), resolveColor(bg, mode)),
            ).toBeGreaterThanOrEqual(min)
        })
    }

    for (const mode of ["light", "dark"] as const) {
        it.each(statusTints)(
            `${mode}: $status text on its 10% tint over $ground is at least 4.5:1`,
            ({status, ground}) => {
                expect(
                    contrastRatio(resolveColor(status, mode), tint(status, ground, mode)),
                ).toBeGreaterThanOrEqual(4.5)
            },
        )
    }

    it("keeps the palette small, two text levels, and every alias on a core color", () => {
        expect(
            colors.filter((c) => /^(muted-)?foreground$|^subtle-foreground$/.test(c.name)).length,
        ).toBe(2)
        // Data (data-*, on-data), code (code-*) and media (scrim, on-scrim, logo-ground) colors are separate groups.
        const uiColors = colors.filter(
            (c) => !/^(data-\d|on-data|code-[a-z]+|scrim|on-scrim|logo-ground)$/.test(c.name),
        )
        expect(uiColors.length).toBeLessThanOrEqual(23)
        const names = new Set(colors.map((c) => c.name))
        for (const to of Object.values(colorAliases)) expect(names.has(to)).toBe(true)
    })

    it("keeps the locked brand values unchanged", () => {
        const locked: Record<string, [string, string]> = {
            primary: ["#242424", "#f2f25c"],
            "primary-hover": ["#413f3f", "#e8e47e"],
            brand: ["#f2f25c", "#d1d151"],
            "brand-hover": ["#e7e712", "#dcdc6b"],
            link: ["#5e5e08", "#8ccfff"],
        }
        for (const [name, [light, dark]] of Object.entries(locked)) {
            expect([resolveColor(name, "light"), resolveColor(name, "dark")]).toEqual([light, dark])
        }
    })

    it("keeps focus neutral: the ring is never brand yellow", () => {
        expect([resolveColor("ring", "light"), resolveColor("ring", "dark")]).toEqual([
            resolveColor("border-strong", "light"),
            resolveColor("border-strong", "dark"),
        ])
    })
})
