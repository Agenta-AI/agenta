/**
 * The edit hooks on TestcaseTable: a row click, a header slot, a toolbar slot, extra columns
 * and the edit session flag. The grid itself is replaced by a plain table, so the test sees
 * what TestcaseTable and EntityTable hand to it.
 */
import {act, type ReactNode} from "react"

import type {TestcaseDataConfig} from "@agenta/entities/testcase"
import {atom} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const seen = vi.hoisted(() => ({
    configs: [] as unknown[],
    shell: null as null | {loadNextPage: () => void; enableInfiniteScroll?: boolean},
    loadMore: [] as unknown[],
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@agenta/entities/testcase", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/entities/testcase")>()
    const rows = [
        {id: "tc-1", key: "tc-1"},
        {id: "new-1", key: "new-1", __isNew: true},
    ]
    const noop = atom(null, () => undefined)
    // Selectors must return the same atom for the same input, or the table re-renders forever.
    const withNew = atom(rows)
    const serverOnly = atom(rows.filter((row) => !row.__isNew))
    const isLoading = atom(false)
    const columns = atom([{key: "question", label: "question"}])
    const allRowIds = atom(["tc-1"])
    const selectedIds = atom(new Set<string>())
    const controller = {
        selectors: {
            rows: (config: {includeNewRows?: boolean}) => {
                seen.configs.push(config)
                return config.includeNewRows ? withNew : serverOnly
            },
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
    const loadMoreTestcasesAtom = atom(null, (_get, _set, config: unknown) => {
        seen.loadMore.push(config)
    })
    return {...original, testcaseDataController: controller, loadMoreTestcasesAtom}
})

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

vi.mock("@agenta/ui/table", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/ui/table")>()
    return {
        ...original,
        InfiniteVirtualTableFeatureShell: (props: {
            columns: Col[]
            pagination: {rows: Row[]; loadNextPage: () => void}
            tableScope?: {enableInfiniteScroll?: boolean}
            primaryActions?: ReactNode
            tableProps?: {onRow?: (record: Row) => {onClick?: () => void}}
        }) => {
            seen.shell = {
                loadNextPage: props.pagination.loadNextPage,
                enableInfiniteScroll: props.tableScope?.enableInfiniteScroll,
            }
            return (
                <div>
                    <div data-testid="toolbar">{props.primaryActions}</div>
                    <table>
                        <thead>
                            <tr>
                                {props.columns.map((column) => (
                                    <th key={column.key}>{column.title}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {props.pagination.rows.map((record) => (
                                <tr
                                    key={record.id}
                                    data-row={record.id}
                                    onClick={props.tableProps?.onRow?.(record).onClick}
                                >
                                    {props.columns.map((column) => (
                                        <td key={column.key}>{column.render?.(null, record)}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )
        },
    }
})

const {TestcaseTable} = await import("../../src/testcase/TestcaseTable")

const config: TestcaseDataConfig = {scopeId: "scope", revisionId: "rev-1"}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

const mount = async (node: ReactNode) => {
    await act(async () => {
        root.render(node)
    })
}

beforeEach(() => {
    seen.configs = []
    seen.shell = null
    seen.loadMore = []
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe("TestcaseTable edit hooks", () => {
    it("A row click calls onRowClick with the row", async () => {
        const onRowClick = vi.fn()
        await mount(<TestcaseTable config={config} onRowClick={onRowClick} />)
        await act(async () => {
            container.querySelector<HTMLElement>('[data-row="tc-1"]')?.click()
        })
        expect(onRowClick).toHaveBeenCalledWith({id: "tc-1", key: "tc-1"})
    })

    it("An edit session shows a new local row", async () => {
        await mount(<TestcaseTable config={{...config, includeNewRows: true}} />)
        expect(container.querySelector('[data-row="new-1"]')).not.toBeNull()
    })

    it("Without new props the table shows server rows only", async () => {
        await mount(<TestcaseTable config={config} />)
        expect(container.querySelector('[data-row="tc-1"]')).not.toBeNull()
        expect(container.querySelector('[data-row="new-1"]')).toBeNull()
    })

    it("The header slot wraps the column header and the toolbar slot renders", async () => {
        await mount(
            <TestcaseTable
                config={config}
                renderColumnHeader={(header) => (
                    <span data-header={header.key}>Edit {header.label}</span>
                )}
                headerExtra={<button type="button">Add column</button>}
            />,
        )
        expect(container.querySelector('[data-header="question"]')?.textContent).toBe(
            "Edit question",
        )
        expect(container.querySelector('[data-testid="toolbar"]')?.textContent).toBe("Add column")
    })

    it("Extra columns show after the data columns", async () => {
        await mount(
            <TestcaseTable
                config={config}
                appendColumns={[{key: "__menu", title: "Menu", render: () => "menu-cell"}]}
            />,
        )
        const heads = [...container.querySelectorAll("th")].map((th) => th.textContent)
        expect(heads).toEqual(["question", "Menu"])
    })

    it("A server table loads the next page on scroll; a local table has one page", async () => {
        await mount(<TestcaseTable config={config} />)
        expect(seen.shell?.enableInfiniteScroll).toBe(true)
        act(() => seen.shell?.loadNextPage())
        expect(seen.loadMore).toEqual([config])

        await mount(<TestcaseTable config={{...config, useLocal: true}} />)
        expect(seen.shell?.enableInfiniteScroll).toBe(false)
        act(() => seen.shell?.loadNextPage())
        expect(seen.loadMore).toHaveLength(1)
    })
})
