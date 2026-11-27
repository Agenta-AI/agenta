// @vitest-environment jsdom
import * as React from "react"

import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {InputAffix} from "../../src/components/ui/input-composed"
import {ListTable} from "../../src/list-table/ListTable"
import type {ListTableColumn, ListTableGroup} from "../../src/list-table/types"

/** Small screens and touch never grow a shared control. */

afterEach(cleanup)

const classesOf = (element: Element) => new Set(element.className.split(/\s+/))

interface Row {
    id: string
    name: string
}
const COLUMNS: ListTableColumn[] = [{key: "name", label: "Name", width: "1fr"}]
const GROUPS: ListTableGroup<Row>[] = [
    {key: "today", label: "Today", rows: [{id: "1", name: "First"}]},
]

describe("shared controls on a phone", () => {
    it("keeps a compact row at one height on every screen", () => {
        render(
            <ListTable<Row>
                columns={COLUMNS}
                groups={GROUPS}
                rowKey={(row) => row.id}
                renderRow={(row) => <span>{row.name}</span>}
                onToggleGroup={() => undefined}
                onOpenRow={() => undefined}
                density="compact"
            />,
        )
        const row = screen.getByText("First").closest("[role='button']") as HTMLElement
        // A compact row is one size on every screen: small screens and touch never grow it.
        expect(classesOf(row).has("min-h-row-single")).toBe(true)
        expect([...classesOf(row)].some((c) => c.startsWith("pointer-coarse:min-h-"))).toBe(false)
    })

    it("keeps the default row as it was", () => {
        render(
            <ListTable<Row>
                columns={COLUMNS}
                groups={GROUPS}
                rowKey={(row) => row.id}
                renderRow={(row) => <span>{row.name}</span>}
                onOpenRow={() => undefined}
            />,
        )
        const row = screen.getByText("First").closest("[role='button']") as HTMLElement
        expect(classesOf(row).has("pointer-coarse:min-h-11")).toBe(false)
    })

    it("keeps a search field's height on touch: no grown input inside the frame", () => {
        render(<InputAffix aria-label="Search templates" size="compact-search" />)
        const input = screen.getByRole("textbox", {name: "Search templates"})
        expect([...classesOf(input)].some((c) => c.startsWith("pointer-coarse:h-"))).toBe(false)
        expect(classesOf(input.parentElement as HTMLElement).has("h-control-sm")).toBe(true)
    })
})
