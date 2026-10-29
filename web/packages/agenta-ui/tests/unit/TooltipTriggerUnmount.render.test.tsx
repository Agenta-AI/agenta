// @vitest-environment jsdom
import {useState} from "react"

import {act, cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {Button} from "../../src/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "../../src/components/ui/dropdown-menu"
import {Popover, PopoverContent, PopoverTrigger} from "../../src/components/ui/popover"
import {SimpleTooltip} from "../../src/components/ui/tooltip-composed"
import TableSettingsDropdown from "../../src/InfiniteVirtualTable/components/columnVisibility/TableSettingsDropdown"
import type {ColumnVisibilityState} from "../../src/InfiniteVirtualTable/types"

/**
 * `/evaluations` died with "Maximum update depth exceeded" whose stack bottomed out in
 * `safelyDetachRef` under `commitDeletionEffectsOnFiber`: the loop is on UNMOUNT of a subtree,
 * not on mount. A tooltip wrapped around a Radix trigger stacks composed refs onto one button,
 * and detaching that chain sets state on a component inside the very subtree being deleted.
 *
 * Rows in a virtualized table unmount constantly, which is why the row actions cell hit it and
 * page-level chrome did not.
 */

afterEach(cleanup)

const Harness = ({children}: {children: React.ReactNode}) => {
    const [show, setShow] = useState(true)
    return (
        <div>
            <button type="button" onClick={() => setShow(false)}>
                drop
            </button>
            {show ? children : null}
        </div>
    )
}

const expectNoLoopOnUnmount = (children: React.ReactNode) => {
    const errors: string[] = []
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
        errors.push(args.map(String).join(" "))
    })

    try {
        const {container} = render(<Harness>{children}</Harness>)
        const drop = container.querySelector("button")
        expect(drop).not.toBeNull()
        // Deleting only the subtree — the root stays alive, so a setState during ref
        // detachment can schedule another render. Unmounting the whole root cannot.
        act(() => drop!.click())
    } finally {
        spy.mockRestore()
    }

    expect(errors.filter((e) => e.includes("Maximum update depth"))).toEqual([])
}

describe("tooltip-wrapped triggers, unmounted as a subtree", () => {
    it("survives a dropdown trigger being deleted", () => {
        expectNoLoopOnUnmount(
            <DropdownMenu>
                <SimpleTooltip title="Actions">
                    <DropdownMenuTrigger asChild>
                        <Button aria-label="Actions">x</Button>
                    </DropdownMenuTrigger>
                </SimpleTooltip>
                <DropdownMenuContent>menu</DropdownMenuContent>
            </DropdownMenu>,
        )
    })

    it("survives the real settings dropdown being deleted", () => {
        const controls = {
            allKeys: ["a"],
            leafKeys: ["a"],
            hiddenKeys: [],
            setHiddenKeys: () => undefined,
            isHidden: () => false,
            showColumn: () => undefined,
            hideColumn: () => undefined,
            toggleColumn: () => undefined,
            toggleTree: () => undefined,
            reset: () => undefined,
            visibleColumns: [],
            columnTree: [{key: "a", label: "A", checked: true, indeterminate: false, children: []}],
            version: 0,
        } as ColumnVisibilityState<{a: string}>

        expectNoLoopOnUnmount(
            <TableSettingsDropdown<{a: string}>
                controls={controls}
                renderColumnVisibilityContent={() => <div>cols</div>}
            />,
        )
    })

    it("survives a popover trigger being deleted", () => {
        expectNoLoopOnUnmount(
            <Popover>
                <SimpleTooltip title="Columns">
                    <PopoverTrigger asChild>
                        <Button aria-label="Columns">x</Button>
                    </PopoverTrigger>
                </SimpleTooltip>
                <PopoverContent>content</PopoverContent>
            </Popover>,
        )
    })
})
