// @vitest-environment jsdom
import * as React from "react"

import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {ListTable} from "../../src/list-table/ListTable"
import type {ListTableColumn, ListTableGroup} from "../../src/list-table/types"

afterEach(cleanup)

interface Row {
    id: string
    name: string
}

const COLUMNS: ListTableColumn[] = [
    {key: "name", label: "Name", width: "1fr"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]

const GROUPS: ListTableGroup<Row>[] = [{key: "all", label: null, rows: [{id: "1", name: "A"}]}]

const renderTable = (props: {stickyHeader?: boolean; hideHeader?: boolean}) =>
    render(
        <ListTable<Row>
            columns={COLUMNS}
            groups={GROUPS}
            rowKey={(row) => row.id}
            renderRow={(row) => (
                <>
                    <span>{row.name}</span>
                    <span />
                </>
            )}
            {...props}
        />,
    )

describe("ListTable sr-only header cells", () => {
    // An absolute sr-only cell escapes an unpositioned scroller and widens the whole window.
    it.each([
        {stickyHeader: false, hideHeader: false},
        {stickyHeader: true, hideHeader: false},
        {stickyHeader: false, hideHeader: true},
    ])("keeps the sr-only header inside a positioned scroller (%o)", (props) => {
        const {container} = renderTable(props)
        const scroller = container.firstElementChild as HTMLElement
        expect(scroller.className.split(/\s+/)).toContain("relative")
        expect(scroller.querySelector(".sr-only")).not.toBeNull()
    })
})
