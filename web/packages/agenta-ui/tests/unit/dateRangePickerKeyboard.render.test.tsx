// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {DateRangePicker} from "../../src/components/ui/date-range-picker"

/**
 * The day grid was reachable but not operable: every day carried `tabIndex={-1}` and no key
 * handler existed, so a keyboard-only user could open the popover and go no further. It also
 * declared `role="grid"` while rendering one flat list of cells with no rows.
 */

afterEach(cleanup)

const openCalendar = () => {
    const trigger = screen.getAllByRole("button")[0]
    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
}

const grid = () => document.querySelector<HTMLElement>('[role="grid"]')!
const dayButton = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)

describe("DateRangePicker day grid", () => {
    it("gives the grid rows rather than one flat cell list", () => {
        render(<DateRangePicker value={{startTime: "2026-03-10T00:00:00Z"}} onChange={() => {}} />)
        openCalendar()

        const rows = grid().querySelectorAll('[role="row"]')
        // One weekday header row plus one row per week.
        expect(rows.length).toBeGreaterThan(1)
        rows.forEach((row) => expect(row.children.length).toBe(7))
    })

    it("keeps exactly one day in the tab order", () => {
        render(<DateRangePicker value={{startTime: "2026-03-10T00:00:00Z"}} onChange={() => {}} />)
        openCalendar()

        const tabbable = [...document.querySelectorAll("[data-day]")].filter(
            (el) => el.getAttribute("tabindex") === "0",
        )
        expect(tabbable).toHaveLength(1)
    })

    it("moves the roving day with the arrow keys", () => {
        render(<DateRangePicker value={{startTime: "2026-03-10T00:00:00Z"}} onChange={() => {}} />)
        openCalendar()

        expect(dayButton("2026-03-10")?.getAttribute("tabindex")).toBe("0")

        fireEvent.keyDown(grid(), {key: "ArrowRight"})
        expect(dayButton("2026-03-11")?.getAttribute("tabindex")).toBe("0")

        // Down is a week, not a day — the row-wise move is the whole point of a grid.
        fireEvent.keyDown(grid(), {key: "ArrowDown"})
        expect(dayButton("2026-03-18")?.getAttribute("tabindex")).toBe("0")

        fireEvent.keyDown(grid(), {key: "ArrowUp"})
        expect(dayButton("2026-03-11")?.getAttribute("tabindex")).toBe("0")
    })

    it("selects the focused day with Enter", () => {
        const changes: unknown[] = []
        render(
            <DateRangePicker
                value={{startTime: "2026-03-10T00:00:00Z"}}
                onChange={(next) => changes.push(next)}
            />,
        )
        openCalendar()

        fireEvent.keyDown(grid(), {key: "ArrowRight"})
        fireEvent.keyDown(grid(), {key: "Enter"})

        expect(changes.length).toBeGreaterThan(0)
    })
})
