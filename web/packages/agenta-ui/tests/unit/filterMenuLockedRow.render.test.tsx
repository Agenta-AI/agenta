// @vitest-environment jsdom
import * as React from "react"

import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {FilterMenuRow} from "../../src/filter-menu/FilterMenuRow"
import type {FilterMenuSection} from "../../src/filter-menu/types"

/** The Agent row of a page locked to one agent (A10): read only, a lock, no flyout. */

afterEach(cleanup)

const section = (locked: boolean): FilterMenuSection => ({
    key: "agent",
    label: "Agent",
    value: "a1",
    valueLabel: "Support triage",
    options: [{value: "a1", label: "Support triage"}],
    onChange: () => undefined,
    locked,
})

describe("FilterMenuRow locked", () => {
    it("renders a read-only row that opens nothing", () => {
        const onOpenChange = vi.fn()
        render(
            <FilterMenuRow
                section={section(true)}
                options={[]}
                open={false}
                onOpenChange={onOpenChange}
            />,
        )
        const row = screen.getByRole("button", {name: /Agent/})
        expect(row.getAttribute("aria-disabled")).toBe("true")
        expect(row.getAttribute("aria-haspopup")).toBeNull()
        expect(row.textContent).toContain("Support triage")
        fireEvent.click(row)
        expect(onOpenChange).not.toHaveBeenCalled()
    })

    it("keeps the normal row when not locked", () => {
        const onOpenChange = vi.fn()
        render(
            <FilterMenuRow
                section={section(false)}
                options={[]}
                open={false}
                onOpenChange={onOpenChange}
            />,
        )
        const row = screen.getByRole("button", {name: /Agent/})
        expect(row.getAttribute("aria-haspopup")).toBe("listbox")
        fireEvent.click(row)
        expect(onOpenChange).toHaveBeenCalledWith(true)
    })
})
