// @vitest-environment jsdom
import * as React from "react"

import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {ListTable} from "../../src/list-table/ListTable"
import type {ListTableColumn, ListTableGroup} from "../../src/list-table/types"

/**
 * The opt-in look of the agent pages (A02, A03): a light chevron on the group
 * heading, a line under each row and extra header classes. A list that asks for none of them
 * keeps today's rendering.
 */

afterEach(cleanup)

interface Row {
    id: string
    name: string
}

const COLUMNS: ListTableColumn[] = [{key: "name", label: "Name", width: "1fr"}]
const GROUPS: ListTableGroup<Row>[] = [
    {key: "today", label: "Today", rows: [{id: "1", name: "First"}]},
]

const renderTable = (props: Partial<React.ComponentProps<typeof ListTable<Row>>> = {}) =>
    render(
        <ListTable<Row>
            columns={COLUMNS}
            groups={GROUPS}
            rowKey={(row) => row.id}
            renderRow={(row) => <span>{row.name}</span>}
            onToggleGroup={() => undefined}
            onOpenRow={() => undefined}
            {...props}
        />,
    )

const rowOf = (name: string) => screen.getByText(name).closest("[role='button']") as HTMLElement
const headerRow = () => screen.getByRole("columnheader").parentElement as HTMLElement

describe("ListTable look options", () => {
    it("keeps the default rendering when no option is passed", () => {
        renderTable()
        const row = rowOf("First")
        expect(row.className).toContain("py-[13px]")
        expect(row.className).not.toContain("border-b")
        const caret = screen
            .getByRole("button", {name: /Today/})
            .querySelector("[data-slot='collapse-caret']")
        expect(caret).not.toBeNull()
        expect(headerRow().className).toContain("text-[13px]")
        expect(headerRow().className).toContain("font-medium")
    })

    it("draws the chevron, row lines and the header classes when asked", () => {
        renderTable({
            groupCaret: "chevron",
            rowDividers: true,
            headerClassName: "text-xs font-normal",
        })
        const row = rowOf("First")
        expect(row.className).toContain("border-b")
        const heading = screen.getByRole("button", {name: /Today/})
        expect(heading.querySelector("[data-slot='collapse-caret']")).toBeNull()
        expect(heading.querySelector("svg")).not.toBeNull()
        expect(headerRow().className).toContain("text-xs")
        expect(headerRow().className).toContain("font-normal")
        expect(headerRow().className).not.toContain("font-medium")
    })
})
