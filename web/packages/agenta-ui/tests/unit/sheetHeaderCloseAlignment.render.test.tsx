// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "../../src/components/ui/sheet"

/**
 * The close button centres on a one-line header. On a header with more lines under the title (a
 * description, a meta row), centring put it between the lines, next to nothing; there it stays
 * level with the title. The switch is a `:has()` on the header's content column, so it needs no
 * prop and a one-line header keeps its old alignment.
 */
afterEach(cleanup)

const MULTI_LINE = ":has(>[data-slot=sheet-header-content]>:nth-child(2))"
/** What the selector asks, answered by hand: jsdom cannot parse this `:has()`. */
const isMultiLine = () =>
    header().querySelector(':scope > [data-slot="sheet-header-content"]')!.children.length > 1

const header = () => document.querySelector<HTMLElement>('[data-slot="sheet-header"]')!

describe("the sheet header's close button", () => {
    it("centres on a one-line header", () => {
        render(
            <Sheet open>
                <SheetContent>
                    <SheetHeader>
                        <SheetTitle>Add MCP server</SheetTitle>
                    </SheetHeader>
                </SheetContent>
            </Sheet>,
        )

        expect(header().className).toContain("items-center")
        expect(isMultiLine()).toBe(false)
    })

    it("stays level with the title when lines follow it", () => {
        render(
            <Sheet open>
                <SheetContent>
                    <SheetHeader>
                        <SheetTitle>Session inspector</SheetTitle>
                        <SheetDescription>5312af6a-1ee4</SheetDescription>
                    </SheetHeader>
                </SheetContent>
            </Sheet>,
        )

        expect(header().className).toContain(`[&${MULTI_LINE}]:items-start`)
        expect(isMultiLine()).toBe(true)
    })
})
