// @vitest-environment jsdom
import * as React from "react"

import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {InputAffix} from "../../src/components/ui/input-composed"
import {Popover} from "../../src/components/ui/popover"
import {PHONE_TOUCH_TARGET_CLASS} from "../../src/components/ui/touch-target"
import {FilterMenuTrigger} from "../../src/filter-menu/FilterMenuTrigger"
import {ListTable} from "../../src/list-table/ListTable"
import {ListTableLoadMore} from "../../src/list-table/ListTableLoadMore"
import type {ListTableColumn, ListTableGroup} from "../../src/list-table/types"

/**
 * Below 768 px every control has a 44 px tap area (release QA bug 3). The shared controls carry
 * it themselves, so each list, filter and search field that uses them gets it without a change
 * of its own. The desktop sizes do not change: every added class is a `max-md:` one.
 */

afterEach(cleanup)

const classesOf = (element: Element) => new Set(element.className.split(/\s+/))
const hasPhoneTarget = (element: Element) =>
    PHONE_TOUCH_TARGET_CLASS.split(" ").every((token) => classesOf(element).has(token))

interface Row {
    id: string
    name: string
}
const COLUMNS: ListTableColumn[] = [{key: "name", label: "Name", width: "1fr"}]
const GROUPS: ListTableGroup<Row>[] = [
    {key: "today", label: "Today", rows: [{id: "1", name: "First"}]},
]

describe("phone tap areas on shared controls", () => {
    it("gives the filter trigger a 44 px tap area, labelled or icon only", () => {
        render(
            <Popover>
                <FilterMenuTrigger
                    label={null}
                    icon={<span />}
                    defaultLabel="Filter"
                    triggerAriaLabel="Filter agents"
                />
            </Popover>,
        )
        expect(hasPhoneTarget(screen.getByRole("button", {name: "Filter agents"}))).toBe(true)
    })

    it("gives Load more a 44 px tap area", () => {
        render(<ListTableLoadMore onLoadMore={() => undefined} label="Load more" />)
        expect(hasPhoneTarget(screen.getByRole("button", {name: "Load more"}))).toBe(true)
    })

    it("makes a compact row at least 44 px on a phone and the group heading a 44 px target", () => {
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
        expect(classesOf(row).has("py-2")).toBe(true)
        expect(classesOf(row).has("max-md:min-h-11")).toBe(true)
        expect(hasPhoneTarget(screen.getByRole("button", {name: /Today/}))).toBe(true)
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
        expect(classesOf(row).has("max-md:min-h-11")).toBe(false)
    })

    it("lets a search field's input reach 44 px on a phone while its frame keeps its height", () => {
        render(<InputAffix aria-label="Search templates" size="compact-search" />)
        const input = screen.getByRole("textbox", {name: "Search templates"})
        expect(classesOf(input).has("max-md:h-11")).toBe(true)
        expect(classesOf(input.parentElement as HTMLElement).has("h-[30px]")).toBe(true)
    })
})
