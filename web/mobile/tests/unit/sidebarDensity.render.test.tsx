// @vitest-environment jsdom
import {NavMenu, SidebarDensityContext} from "@agenta/navigation-ui"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

afterEach(cleanup)

const items = [{key: "configuration", title: "Configuration", link: "/configuration"}]

const rowOf = (text: string) => screen.getByText(text).closest("div[class*='rounded-md']")

describe("sidebar density", () => {
    it("keeps the rail's 28 px rows by default", () => {
        render(<NavMenu items={items} collapsed={false} />)
        expect(rowOf("Configuration")?.className).toContain("h-7")
    })

    it("draws 44 px rows in the phone sheet", () => {
        render(
            <SidebarDensityContext.Provider value="touch">
                <NavMenu items={items} collapsed={false} />
            </SidebarDensityContext.Provider>,
        )
        const row = rowOf("Configuration")
        expect(row?.className).toContain("h-11")
        expect(row?.className).not.toContain("h-7")
    })
})
