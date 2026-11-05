/**
 * A collapsed group column shows the group value of each row. The grid is replaced by a plain
 * table that renders every leaf column, so the test sees the cells EntityTable builds.
 */
import {act, type ReactNode} from "react"

import {atom} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {collapsedGroupValue} from "../../src/shared/collapsedGroupValue"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

interface Row {
    id: string
    key: string
}
interface Col {
    key: string
    title?: ReactNode
    children?: Col[]
    render?: (value: unknown, record: Row) => ReactNode
}

const leaves = (columns: Col[]): Col[] =>
    columns.flatMap((column) => (column.children ? leaves(column.children) : [column]))

vi.mock("@agenta/ui/table", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/ui/table")>()
    return {
        ...original,
        InfiniteVirtualTableFeatureShell: (props: {columns: Col[]; pagination: {rows: Row[]}}) => {
            const columns = leaves(props.columns)
            return (
                <table>
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th key={column.key} data-col={column.key}>
                                    {column.title}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {props.pagination.rows.map((record) => (
                            <tr key={record.id}>
                                {columns.map((column) => (
                                    <td key={column.key} data-cell={column.key}>
                                        {column.render?.(null, record)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )
        },
    }
})

const {EntityTable} = await import("../../src/shared/EntityTable")

const ROW_DATA: Record<string, Record<string, unknown>> = {
    "tc-1": {customer: {name: "Sam Lee", orders: {count: 18}}, question: "Q"},
}

// Selectors must return the same atom for the same input, or the table re-renders forever.
const rows = atom<Row[]>([{id: "tc-1", key: "tc-1"}])
const isLoading = atom(false)
const columns = atom([
    {key: "question", label: "question"},
    {key: "customer.name", label: "name", parentKey: "customer"},
    {key: "customer.orders.count", label: "count", parentKey: "customer.orders"},
])
const allRowIds = atom(["tc-1"])
const selectedIds = atom(new Set<string>())
const noop = atom(null, () => undefined)
const controller = {
    selectors: {
        rows: () => rows,
        isLoading: () => isLoading,
        columns: () => columns,
        allRowIds: () => allRowIds,
        selectedIds: () => selectedIds,
    },
    actions: {
        setSelection: noop,
        toggleSelection: noop,
        selectAll: noop,
        clearSelection: noop,
        resetSelection: noop,
    },
}
const config = {}
const getRowData = (row: Row) => ROW_DATA[row.id] ?? null

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const collapse = async (groupLabel: string) => {
    const header = [...container.querySelectorAll<HTMLElement>("th *")].find(
        (node) => node.textContent?.startsWith(groupLabel) && node.onclick !== undefined,
    )
    const button = header?.closest<HTMLElement>("button,[role=button]") ?? header
    await act(async () => button?.click())
}

describe("EntityTable collapsed group column", () => {
    it("shows the value of a nested group, not an empty cell", async () => {
        await act(async () => {
            root.render(
                <EntityTable
                    controller={controller as never}
                    config={config}
                    getRowData={getRowData}
                    grouping
                    typeChips={null}
                />,
            )
        })
        await collapse("orders")
        const cell = container.querySelector('[data-cell="__collapsed_customer.orders"]')
        expect(cell).not.toBeNull()
        expect(cell?.textContent).toContain("18")
    })

    it("reads a group by path, and a dotted key as one key first", () => {
        expect(collapsedGroupValue({customer: {orders: {count: 1}}}, "customer.orders")).toEqual({
            count: 1,
        })
        expect(collapsedGroupValue({"meta.lang": {a: 1}}, "meta.lang")).toEqual({a: 1})
        expect(collapsedGroupValue({customer: "text"}, "customer.orders")).toBeUndefined()
        expect(collapsedGroupValue(null, "customer")).toBeUndefined()
    })
})
