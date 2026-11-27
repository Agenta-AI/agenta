// @vitest-environment jsdom
import type {SidebarConfig} from "@agenta/navigation"
import {NavMenu} from "@agenta/navigation-ui"
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

afterEach(cleanup)

const children: SidebarConfig[] = [
    {key: "testsets", title: "Test sets", link: "/testsets"},
    {key: "evaluators", title: "Evaluators", link: "/evaluators"},
]
// A group with no page of its own, as Evaluation is.
const evaluation: SidebarConfig = {
    key: "evaluation",
    title: "Evaluation",
    icon: <span data-testid="flask" />,
    submenu: children,
}
// A group with its own page.
const linked: SidebarConfig = {
    key: "reports",
    title: "Reports",
    icon: <span />,
    link: "/reports",
    submenu: [{key: "weekly", title: "Weekly", link: "/reports/weekly"}],
}

const renderMenu = (props: Partial<Parameters<typeof NavMenu>[0]> = {}) => {
    const onToggleOpenKey = vi.fn()
    const onPopupOpenChange = vi.fn()
    render(
        <NavMenu
            items={[evaluation, linked]}
            collapsed={false}
            onToggleOpenKey={onToggleOpenKey}
            onPopupOpenChange={onPopupOpenChange}
            {...props}
        />,
    )
    return {onToggleOpenKey, onPopupOpenChange}
}

const rowOf = (title: string) =>
    screen.getByText(title).closest("div[class*='rounded-md']") as HTMLElement

describe("a nav group with no page of its own", () => {
    it("opens and closes on a click anywhere on its row, not only on the caret", () => {
        const {onToggleOpenKey} = renderMenu()
        fireEvent.click(screen.getByText("Evaluation"))
        fireEvent.click(screen.getByTestId("flask"))
        expect(onToggleOpenKey.mock.calls).toEqual([["evaluation"], ["evaluation"]])
    })

    it("is one button: Enter and Space toggle it, and it tells its state", () => {
        const {onToggleOpenKey} = renderMenu({openKeys: ["evaluation"]})
        const row = rowOf("Evaluation")
        expect(row.getAttribute("role")).toBe("button")
        expect(row.tabIndex).toBe(0)
        expect(row.getAttribute("aria-expanded")).toBe("true")
        fireEvent.keyDown(row, {key: "Enter"})
        fireEvent.keyDown(row, {key: " "})
        fireEvent.keyDown(row, {key: "a"})
        expect(onToggleOpenKey.mock.calls).toEqual([["evaluation"], ["evaluation"]])
        // The caret stays as a sign of the state, not as a second tab stop.
        expect(row.querySelectorAll("button")).toHaveLength(0)
        expect(row.querySelector("svg")).not.toBeNull()
    })

    it("does not navigate: the row has no link", () => {
        renderMenu()
        expect(rowOf("Evaluation").querySelector("a")).toBeNull()
    })
})

describe("a nav group with its own page", () => {
    it("keeps today's behavior: the row is a link and only the caret toggles", () => {
        const {onToggleOpenKey} = renderMenu()
        const row = rowOf("Reports")
        expect(row.getAttribute("role")).toBeNull()
        expect(row.querySelector("a")?.getAttribute("href")).toBe("/reports")
        fireEvent.click(row)
        fireEvent.keyDown(row, {key: "Enter"})
        expect(onToggleOpenKey).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", {name: "Expand Reports"}))
        expect(onToggleOpenKey.mock.calls).toEqual([["reports"]])
    })
})

describe("the collapsed (icon only) sidebar", () => {
    it("keeps the flyout menu for a group with no page", () => {
        const {onToggleOpenKey, onPopupOpenChange} = renderMenu({collapsed: true})
        const trigger = screen.getByRole("button", {name: "Evaluation"})
        expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
        // jsdom has no PointerEvent, so open the flyout from the keyboard.
        fireEvent.keyDown(trigger, {key: "Enter"})
        expect(onPopupOpenChange).toHaveBeenCalledWith("evaluation", true)
        expect(onToggleOpenKey).not.toHaveBeenCalled()
    })
})
