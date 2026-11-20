// @vitest-environment jsdom
import {NavMenu, SidebarLayoutContext} from "@agenta/navigation-ui"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

afterEach(cleanup)

const items = [{key: "configuration", title: "Configuration", link: "/configuration"}]

// The row is the element with the 6 px rail radius.
const rowOf = (text: string) => screen.getByText(text).closest("div[class*='rounded-sm']")

describe("sidebar layout", () => {
    it("keeps the rail's 28 px rows by default", () => {
        render(<NavMenu items={items} collapsed={false} />)
        expect(rowOf("Configuration")?.className).toContain("h-7")
    })

    it("draws 44 px rows in the phone sheet", () => {
        render(
            <SidebarLayoutContext.Provider value="phone">
                <NavMenu items={items} collapsed={false} />
            </SidebarLayoutContext.Provider>,
        )
        const row = rowOf("Configuration")
        expect(row?.className).toContain("h-11")
        expect(row?.className).not.toContain("h-7")
        // Edge to edge, as the phone design draws the sheet's rows.
        expect(row?.className).toContain("mb-0")
    })
})

describe("section heading content", () => {
    const section = (key: string, title: string, extra = {}) => ({
        key,
        title,
        alwaysOpen: true,
        groupAction: <button type="button">{`${title} action`}</button>,
        submenu: [{key: `${key}-row`, title: `${title} row`, link: `/${key}`}],
        ...extra,
    })

    it("draws only the heading content in place of a heading's label and controls", () => {
        render(
            <NavMenu
                items={[
                    section("chats", "Chats", {headingContent: <input aria-label="Find chats" />}),
                    section("sessions", "Sessions"),
                ]}
                collapsed={false}
            />,
        )
        expect(screen.getByLabelText("Find chats")).toBeTruthy()
        expect(screen.queryByText("Chats")).toBeNull()
        expect(screen.queryByText("Chats action")).toBeNull()
        // The rows stay, and the other heading draws as before.
        expect(screen.getByText("Chats row")).toBeTruthy()
        expect(screen.getByText("Sessions")).toBeTruthy()
        expect(screen.getByText("Sessions action")).toBeTruthy()
    })
})
