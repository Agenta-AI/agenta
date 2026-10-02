// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {Sheet, SheetContent, SheetTitle} from "../../src/components/ui/sheet"
import {EnhancedDrawer} from "../../src/drawer/EnhancedDrawer"

/**
 * `responsive` is the one prop that keeps a configuration panel correct in both apps: a bottom
 * sheet on a phone, the right-edge drawer from `lg` up. The mobile app had invented it locally
 * and the shared kit had only the four literal edges, so every shared drawer was a right-edge
 * drawer on a phone.
 *
 * jsdom has no layout, so what is checkable here is the class contract: both halves present, the
 * bottom-sheet properties all unset again at `lg` (Tailwind keeps the narrower rule otherwise),
 * and the width reaching the `lg` half only.
 */
afterEach(cleanup)

const panel = () => screen.getByRole("dialog")

const openSheet = (side: "responsive" | "right") =>
    render(
        <Sheet open>
            <SheetContent side={side}>
                <SheetTitle>Panel</SheetTitle>
            </SheetContent>
        </Sheet>,
    )

describe("Sheet side=responsive", () => {
    it("is a bottom sheet below the large breakpoint", () => {
        openSheet("responsive")
        const c = panel().className
        expect(c).toContain("inset-x-0")
        expect(c).toContain("bottom-0")
        expect(c).toContain("max-h-[85vh]")
        expect(c).toContain("rounded-t-2xl")
        expect(c).toContain("border-t")
        expect(c).toContain("data-[state=open]:animate-sheet-in-bottom")
    })

    it("is a floating right-edge drawer from the large breakpoint up", () => {
        openSheet("responsive")
        const c = panel().className
        expect(c).toContain("lg:inset-y-2")
        expect(c).toContain("lg:right-2")
        expect(c).toContain("lg:rounded-xl")
        expect(c).toContain("lg:border-0")
        expect(c).toContain("lg:data-[state=open]:animate-sheet-in-right")
    })

    it("unsets every bottom-sheet property at lg, or the narrower rule would win", () => {
        openSheet("responsive")
        const c = panel().className
        for (const unset of ["lg:inset-x-auto", "lg:mx-0", "lg:max-h-none"]) {
            expect(c).toContain(unset)
        }
    })

    it("floats the literal right edge at every width", () => {
        openSheet("right")
        const c = panel().className
        expect(c).toContain("inset-y-2")
        expect(c).toContain("right-2")
        expect(c).toContain("rounded-xl")
        expect(c).not.toContain("rounded-t-2xl")
        expect(c).not.toContain("lg:")
        expect(c).not.toContain("animate-sheet-in-bottom")
    })

    it("marks the side on the panel, so a consumer can style off it", () => {
        openSheet("responsive")
        expect(panel().dataset.side).toBe("responsive")
    })
})

describe("EnhancedDrawer placement=responsive", () => {
    const open = {open: true, title: "Drawer title", children: <div>body content</div>}

    it("passes the side through to the sheet", () => {
        render(<EnhancedDrawer {...open} placement="responsive" />)
        expect(panel().dataset.side).toBe("responsive")
        expect(panel().className).toContain("lg:w-[var(--ag-sheet-responsive-width,480px)]")
    })

    it("sends a numeric width to the lg half only, never to an inline width", () => {
        render(<EnhancedDrawer {...open} placement="responsive" width={520} />)
        // An inline width would apply on a phone too, where the panel is full width.
        expect(panel().style.width).toBe("")
        expect(panel().style.getPropertyValue("--ag-sheet-responsive-width")).toBe("520px")
    })

    it("passes a string width through unchanged", () => {
        render(<EnhancedDrawer {...open} placement="responsive" width="32rem" />)
        expect(panel().style.getPropertyValue("--ag-sheet-responsive-width")).toBe("32rem")
    })

    it("maps antd `size` the same way for the responsive side", () => {
        render(<EnhancedDrawer {...open} placement="responsive" size="large" />)
        expect(panel().style.getPropertyValue("--ag-sheet-responsive-width")).toBe("736px")
    })

    it("falls back to the variant's own 480px when no width is given", () => {
        render(<EnhancedDrawer {...open} placement="responsive" />)
        expect(panel().style.getPropertyValue("--ag-sheet-responsive-width")).toBe("")
    })

    it("still clamps a right-edge drawer inline, as antd does", () => {
        render(<EnhancedDrawer {...open} placement="right" width={520} />)
        expect(panel().style.width).toBe("520px")
        expect(panel().style.maxWidth).toBe("calc(100% - 1rem)")
    })
})
