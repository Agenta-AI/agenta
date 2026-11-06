// @vitest-environment jsdom
import * as React from "react"

import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ListTable} from "../../src/list-table/ListTable"
import type {ListTableGroup, ListTableSelection} from "../../src/list-table/types"

/**
 * Opt-in row selection in the list frame: a checkbox column, select all, and an "N selected" bar
 * with the consumer's bulk actions in place of the column names.
 */
afterEach(cleanup)

interface Row {
    id: string
    name: string
    locked?: boolean
}

const GROUPS: ListTableGroup<Row>[] = [
    {
        key: "a",
        label: "First",
        rows: [
            {id: "1", name: "Alpha"},
            {id: "2", name: "Beta"},
        ],
    },
    {key: "b", label: "Second", rows: [{id: "3", name: "Gamma", locked: true}]},
]

const Harness = ({
    initial = [],
    onOpen,
    selectable = true,
}: {
    initial?: string[]
    onOpen?: (row: Row) => void
    selectable?: boolean
}) => {
    const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set(initial))
    const selection: ListTableSelection<Row> = {
        selectedKeys: selected,
        onChange: setSelected,
        canSelect: (row) => !row.locked,
        rowLabel: (row) => `Select ${row.name}`,
        bulkActions: (keys) => <button type="button">Archive {keys.size}</button>,
    }
    return (
        <ListTable<Row>
            columns={[{key: "name", label: "Name", width: "1fr"}]}
            groups={GROUPS}
            rowKey={(row) => row.id}
            renderRow={(row) => <span>{row.name}</span>}
            onOpenRow={onOpen}
            selection={selectable ? selection : undefined}
        />
    )
}

const box = (name: string) => screen.getByRole("checkbox", {name})

describe("ListTable selection", () => {
    it("draws no checkbox column without `selection`", () => {
        render(<Harness selectable={false} />)
        expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
        expect(screen.getByText("Name")).toBeTruthy()
    })

    it("gives each selectable row a checkbox and none to a row that cannot be selected", () => {
        render(<Harness />)
        expect(box("Select Alpha")).toBeTruthy()
        expect(box("Select Beta")).toBeTruthy()
        expect(screen.queryByRole("checkbox", {name: "Select Gamma"})).toBeNull()
    })

    it("ticking a row selects it without opening it, and the bar replaces the column names", () => {
        const onOpen = vi.fn()
        render(<Harness onOpen={onOpen} />)
        fireEvent.click(box("Select Alpha"))
        expect(onOpen).not.toHaveBeenCalled()
        expect(screen.getByRole("status").textContent).toContain("1 selected")
        expect(screen.queryByText("Name")).toBeNull()
        expect(screen.getByRole("button", {name: "Archive 1"})).toBeTruthy()
        expect(box("Select all").getAttribute("data-state")).toBe("indeterminate")
    })

    it("select all ticks every selectable row, then clears them", () => {
        render(<Harness />)
        fireEvent.click(box("Select all"))
        expect(screen.getByRole("status").textContent).toContain("2 selected")
        expect(box("Select all").getAttribute("data-state")).toBe("checked")
        fireEvent.click(box("Select all"))
        expect(screen.queryByRole("status")).toBeNull()
        expect(screen.getByText("Name")).toBeTruthy()
    })

    it("Clear in the bar empties the selection", () => {
        render(<Harness initial={["1", "2"]} />)
        fireEvent.click(screen.getByRole("button", {name: "Clear"}))
        expect(screen.queryByRole("status")).toBeNull()
        expect(box("Select Alpha").getAttribute("data-state")).toBe("unchecked")
    })
})
