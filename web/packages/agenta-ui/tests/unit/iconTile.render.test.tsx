// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {IconTile} from "../../src/components/ui/icon-tile"

afterEach(cleanup)

const tile = () => document.querySelector('[data-slot="icon-tile"]') as HTMLElement

describe("IconTile (the Mark)", () => {
    it.each([
        [16, "size-4", "rounded-sm", "[&_svg]:size-2.5"],
        [20, "size-5", "rounded-sm", "[&_svg]:size-3"],
        [24, "size-6", "rounded-md", "[&_svg]:size-3.5"],
        [32, "size-8", "rounded-md", "[&_svg]:size-4"],
        [40, "size-10", "rounded-lg", "[&_svg]:size-5"],
    ] as const)("size %i is %s with %s corners and a %s glyph", (size, box, radius, glyph) => {
        render(<IconTile size={size} />)
        expect(tile().className).toContain(box)
        expect(tile().className).toContain(radius)
        expect(tile().className).toContain(glyph)
    })

    it("never uses a radius over a quarter of its side", () => {
        const quarter = {16: 4, 20: 5, 24: 6, 32: 8, 40: 10}
        // The /m radius scale (radius in theme.config.ts): sm 4, md 6, lg 8.
        const scale: Record<string, number> = {sm: 4, md: 6, lg: 8}
        for (const [size, max] of Object.entries(quarter)) {
            render(<IconTile size={Number(size) as 16} />)
            const r = scale[tile().className.match(/\brounded-(sm|md|lg)\b/)?.[1] ?? ""]
            expect(r).toBeLessThanOrEqual(max)
            cleanup()
        }
    })

    it("defaults to the neutral 24px Mark", () => {
        render(<IconTile />)
        expect(tile().dataset.size).toBe("24")
        expect(tile().dataset.tone).toBe("neutral")
        expect(tile().className).toContain("bg-secondary")
    })

    it("keeps a caller's className", () => {
        render(<IconTile className="ml-2" />)
        expect(tile().className).toContain("ml-2")
        expect(tile().className).toContain("size-6")
    })
})
