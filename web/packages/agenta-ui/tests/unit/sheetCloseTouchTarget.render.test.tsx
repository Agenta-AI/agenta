// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {Sheet, SheetContent, SheetHeader, SheetTitle} from "../../src/components/ui/sheet"
import {TOUCH_TARGET_MINIMUM_PX, touchTargetHitArea} from "../../src/components/ui/touch-target"

/**
 * Every shared drawer and sheet closes through this one button, including the MCP add-server
 * drawer and the permission drawer, and it is a 28px square: short of the 44px touch minimum on
 * both axes. It keeps the square, which centres on the 24px title line, and grows an invisible
 * box to the minimum.
 *
 * Asserted through `touchTargetHitArea` so a later change to the button's size variant has to
 * change the expansion with it. The 8px reach to the right is exactly the header's own gap, so
 * the box stops at the title's edge rather than covering its first characters.
 */
afterEach(cleanup)

const openSheet = () =>
    render(
        <Sheet open>
            <SheetContent side="responsive">
                <SheetHeader>
                    <SheetTitle>Add MCP server</SheetTitle>
                </SheetHeader>
            </SheetContent>
        </Sheet>,
    )

describe("the drawer's Close button", () => {
    it("has a 44px hit area on both axes while keeping its 28px square", () => {
        openSheet()

        const close = screen.getByRole("button", {name: "Close"})
        expect(close.className).toContain("size-control-sm")
        expect(touchTargetHitArea(close.className)).toEqual({
            width: TOUCH_TARGET_MINIMUM_PX,
            height: TOUCH_TARGET_MINIMUM_PX,
        })
    })

    it("gains the hit area with nothing a reader can see", () => {
        // The button is on every drawer in the product, so the expansion had to be invisible
        // rather than a bigger control on surfaces nobody re-reviewed.
        openSheet()

        const close = screen.getByRole("button", {name: "Close"})
        expect(close.className).not.toMatch(/after:(bg|border|text|shadow)-/)
        expect(close.className).toContain("-my-0.5")
    })
})
