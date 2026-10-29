// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import ColumnVisibilityTrigger from "../../src/InfiniteVirtualTable/components/ColumnVisibilityTrigger"
import TableSettingsDropdown from "../../src/InfiniteVirtualTable/components/columnVisibility/TableSettingsDropdown"
import type {ColumnVisibilityState} from "../../src/InfiniteVirtualTable/types"

/**
 * `/evaluations` died with "Maximum update depth exceeded" once every table started rendering
 * this chrome. The stack was `setRef` recursing inside an `Array.map`, i.e. Radix `composeRefs`,
 * so the loop has to be reproducible from the trigger alone.
 */

interface Row {
    key: string
    name: string
}

const controls: ColumnVisibilityState<Row> = {
    allKeys: ["name", "key"],
    leafKeys: ["name", "key"],
    hiddenKeys: [],
    setHiddenKeys: () => undefined,
    isHidden: () => false,
    showColumn: () => undefined,
    hideColumn: () => undefined,
    toggleColumn: () => undefined,
    toggleTree: () => undefined,
    reset: () => undefined,
    visibleColumns: [],
    columnTree: [
        {key: "name", label: "Name", checked: true, indeterminate: false, children: []},
        {key: "key", label: "Key", checked: true, indeterminate: false, children: []},
    ],
    version: 0,
}

afterEach(cleanup)

/**
 * The structural guard. On `/evaluations` the live DOM showed `data-slot="tooltip-trigger"` ON
 * the trigger button: both `asChild` layers had collapsed onto one element, which is the
 * arrangement that loops. Asserting the two triggers occupy different nodes catches a
 * regression that a render-without-crashing test does not — the loop needs app-level churn to
 * show up, so it will not reproduce here.
 */
const expectTriggersNotCollapsed = (container: HTMLElement) => {
    const button = container.querySelector("button")
    expect(button).not.toBeNull()
    expect(button!.getAttribute("data-slot")).not.toBe("tooltip-trigger")
    expect(container.querySelector('[data-slot="tooltip-trigger"]')).not.toBe(button)
}

describe("ColumnVisibilityTrigger", () => {
    it("keeps the tooltip trigger off the popover trigger's element", () => {
        const {container} = render(
            <ColumnVisibilityTrigger<Row> controls={controls} variant="icon" />,
        )
        expectTriggersNotCollapsed(container)
    })

    it("keeps the tooltip trigger off the settings menu trigger's element", () => {
        const {container} = render(
            <TableSettingsDropdown<Row>
                controls={controls}
                renderColumnVisibilityContent={() => <div>columns</div>}
            />,
        )
        expectTriggersNotCollapsed(container)
    })

    it.each(["icon", "button"] as const)("renders the %s variant without looping", (variant) => {
        const errors: string[] = []
        const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
            errors.push(args.map(String).join(" "))
        })

        try {
            const {container} = render(
                <ColumnVisibilityTrigger<Row> controls={controls} variant={variant} />,
            )
            // Guards the guard: an empty tree would pass every assertion below.
            expect(container.querySelector("button")).not.toBeNull()
        } finally {
            spy.mockRestore()
        }

        expect(errors.filter((e) => e.includes("Maximum update depth"))).toEqual([])
    })

    it("renders the settings dropdown without looping", () => {
        const errors: string[] = []
        const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
            errors.push(args.map(String).join(" "))
        })

        try {
            const {container} = render(
                <TableSettingsDropdown<Row>
                    controls={controls}
                    renderColumnVisibilityContent={() => <div>columns</div>}
                />,
            )
            expect(container.querySelector("button")).not.toBeNull()
        } finally {
            spy.mockRestore()
        }

        expect(errors.filter((e) => e.includes("Maximum update depth"))).toEqual([])
    })
})
