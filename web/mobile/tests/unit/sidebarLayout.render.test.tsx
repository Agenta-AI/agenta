// @vitest-environment jsdom
import {NavMenu, SidebarLayoutContext} from "@agenta/navigation-ui"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

afterEach(cleanup)

const items = [{key: "configuration", title: "Configuration", link: "/configuration"}]

// The row is the element with the 6 px rail radius.
const rowOf = (text: string) => screen.getByText(text).closest("div[class*='rounded-md']")

describe("sidebar layout", () => {
    it("keeps the rail's 28 px rows by default", () => {
        render(<NavMenu items={items} collapsed={false} />)
        expect(rowOf("Configuration")?.className).toContain("h-row-dense")
    })

    it("draws the rail's 28 px rows in the phone sheet: small screens never get bigger rows", () => {
        render(
            <SidebarLayoutContext.Provider value="phone">
                <NavMenu items={items} collapsed={false} />
            </SidebarLayoutContext.Provider>,
        )
        const row = rowOf("Configuration")
        expect(row?.className).toContain("h-row-dense")
        expect(row?.className).not.toContain("h-11")
    })
})
