// @vitest-environment jsdom
import {SidebarLayoutContext, SidebarToggleButton} from "@agenta/navigation-ui"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

afterEach(cleanup)

describe("SidebarToggleButton close label", () => {
    it("reads Close sidebar in the phone sheet", () => {
        render(
            <SidebarLayoutContext.Provider value="phone">
                <SidebarToggleButton onDismiss={() => undefined} />
            </SidebarLayoutContext.Provider>,
        )
        expect(screen.getByRole("button", {name: "Close sidebar"})).toBeTruthy()
    })

    it("reads Close sidebar in the wider sheet too", () => {
        render(<SidebarToggleButton onDismiss={() => undefined} />)
        expect(screen.getByRole("button", {name: "Close sidebar"})).toBeTruthy()
    })
})
