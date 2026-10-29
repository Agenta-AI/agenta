// @vitest-environment jsdom
import {Plugs} from "@phosphor-icons/react"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {IconTile} from "../../src/components/ui/icon-tile"

/**
 * The tile leads a server row, a sheet header and the two empty states, at four sizes the spec
 * pairs with four radii. Getting a pair wrong is invisible in code review and obvious on screen,
 * so each pair is pinned here.
 *
 * The radii are literal pixels rather than the control scale because `rounded-md` is 6px on the
 * desktop app and 8px on mobile: a token would draw two different tiles from one component.
 */
afterEach(cleanup)

const tile = () => screen.getByTestId("tile")

describe("IconTile", () => {
    it.each([
        [24, "size-6", "rounded-[5px]", "[&_svg]:size-[14px]"],
        [28, "size-7", "rounded-[6px]", "[&_svg]:size-4"],
        [32, "size-8", "rounded-[6px]", "[&_svg]:size-4"],
        [44, "size-11", "rounded-[10px]", "[&_svg]:size-[22px]"],
    ] as const)("size %i is a %s box with %s and a %s glyph", (size, box, radius, glyph) => {
        render(
            <IconTile data-testid="tile" size={size}>
                <Plugs />
            </IconTile>,
        )
        expect(tile().className).toContain(box)
        expect(tile().className).toContain(radius)
        expect(tile().className).toContain(glyph)
    })

    it("the info tone fills with the info BACKGROUND and colours the glyph with the foreground", () => {
        render(
            <IconTile data-testid="tile" tone="info">
                <Plugs />
            </IconTile>,
        )
        expect(tile().className).toContain("bg-colorInfoBg")
        expect(tile().className).toContain("text-colorInfo")
        // The spec's inversion: `--info` as the fill with a white glyph. If that ever comes back,
        // it comes back as a decision, not as a drifted class.
        expect(tile().className).not.toContain("bg-colorInfo ")
        expect(tile().className).not.toContain("text-colorWhite")
    })

    it("the muted tone is the empty-state pair", () => {
        render(
            <IconTile data-testid="tile" tone="muted">
                <Plugs />
            </IconTile>,
        )
        expect(tile().className).toContain("bg-colorFillTertiary")
        expect(tile().className).toContain("text-colorTextTertiary")
    })

    it("defaults to the 28px info tile", () => {
        render(
            <IconTile data-testid="tile">
                <Plugs />
            </IconTile>,
        )
        expect(tile().dataset.size).toBe("28")
        expect(tile().dataset.tone).toBe("info")
    })

    it("the glyph inherits currentColor: the tile sets no fill of its own", () => {
        render(
            <IconTile data-testid="tile" tone="info">
                <Plugs />
            </IconTile>,
        )
        const svg = tile().querySelector("svg")
        expect(svg).not.toBeNull()
        // Phosphor paints with `currentColor`, so the tone class on the tile is what colours it.
        expect(svg?.getAttribute("fill")).toBe("currentColor")
        expect(tile().style.color).toBe("")
        expect(tile().style.fill).toBe("")
    })

    it("keeps a caller's className and does not drop the variant classes", () => {
        render(
            <IconTile data-testid="tile" className="ml-2">
                <Plugs />
            </IconTile>,
        )
        expect(tile().className).toContain("ml-2")
        expect(tile().className).toContain("bg-colorInfoBg")
    })
})
