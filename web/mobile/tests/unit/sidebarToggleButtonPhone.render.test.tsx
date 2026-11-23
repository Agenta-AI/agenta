// @vitest-environment jsdom
import {SidebarLayoutContext, SidebarToggleButton} from "@agenta/navigation-ui"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

afterEach(cleanup)

describe("SidebarToggleButton close label", () => {
    it("reads Close the sidebar in the phone sheet", () => {
        render(
            <SidebarLayoutContext.Provider value="phone">
                <SidebarToggleButton onDismiss={() => undefined} />
            </SidebarLayoutContext.Provider>,
        )
        expect(screen.getByRole("button", {name: "Close the sidebar"})).toBeTruthy()
    })

    it("keeps Close navigation in the wider sheet", () => {
        render(<SidebarToggleButton onDismiss={() => undefined} />)
        expect(screen.getByRole("button", {name: "Close navigation"})).toBeTruthy()
    })
})
