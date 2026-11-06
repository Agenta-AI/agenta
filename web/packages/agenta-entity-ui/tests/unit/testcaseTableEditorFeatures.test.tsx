/**
 * The editor features of TestcaseTable: the settings button, the cell popover with Copy and
 * the edited-row marker. Each is off by default, so a picker or a preview (the playground load
 * dialogs, also in the old app) renders exactly as before. The grid is replaced by a plain
 * table, so the test sees what TestcaseTable and EntityTable hand to it.
 */
import {act, type ReactNode} from "react"

import type {TestcaseDataConfig} from "@agenta/entities/testcase"
import {atom, getDefaultStore} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const seen = vi.hoisted(() => ({
    configs: [] as unknown[],
    shell: null as null | {loadNextPage: () => void; enableInfiniteScroll?: boolean},
    columns: [] as {key: string; columnVisibilityLocked?: boolean}[],
    loadMore: [] as unknown[],
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
// The popover measures its anchor; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
}

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
            seen.columns = props.columns
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
const {testcaseMolecule} = await import("@agenta/entities/testcase")

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
    seen.columns = []
    const store = getDefaultStore()
    store.set(testcaseMolecule.atoms.draft("tc-1"), null)
    store.set(testcaseMolecule.atoms.draft("new-1"), null)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

/** Every prop a test set editor would set, except the new feature flags. */
const editorProps = {
    config: {...config, includeNewRows: true},
    selectable: true,
    selectedIds: [] as string[],
    appendColumns: [{key: "__menu", title: "Menu", render: () => "menu-cell"}],
    renderColumnHeader: (header: {key: string; label: string}) => (
        <span data-header={header.key}>{header.label}</span>
    ),
    headerExtra: <button type="button">Add column</button>,
}

/** The settings button. The real shell labels it "Table settings"; alone it says "Columns". */
const SETTINGS_BUTTON = '[aria-label="Table settings"], [aria-label="Columns"]'

const setDraft = (id: string, data: Record<string, unknown>) =>
    act(() => {
        getDefaultStore().set(testcaseMolecule.atoms.draft(id), {id, data})
    })

describe("TestcaseTable editor features", () => {
    it("With the default props the table renders as before the editor features", async () => {
        setDraft("tc-1", {question: "What is the refund window?"})
        await mount(<TestcaseTable {...editorProps} />)

        // Recorded with the code before this change: the same markup, no settings button, no
        // popover and no marker.
        expect(container.querySelector(SETTINGS_BUTTON)).toBeNull()
        expect(container.innerHTML).toMatchInlineSnapshot(
            `"<div class="h-full"><div><div data-testid="toolbar"><button type="button">Add column</button></div><table><thead><tr><th><button type="button" role="checkbox" aria-checked="false" data-state="unchecked" value="on" data-slot="checkbox" class="box-border border-solid font-[inherit] p-0 group relative inline-flex shrink-0 cursor-pointer items-center justify-center align-middle transition-colors size-control-check rounded-control-check border bg-background border-border enabled:hover:border-primary enabled:data-[state=checked]:bg-primary enabled:data-[state=checked]:border-primary enabled:data-[state=checked]:hover:bg-primary-hover enabled:data-[state=checked]:hover:border-transparent outline-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-colorBgContainerDisabled disabled:border-border" aria-label="Select all rows"></button></th><th><span data-header="question">question</span></th><th>Menu</th></tr></thead><tbody><tr data-row="tc-1"><td><button type="button" role="checkbox" aria-checked="false" data-state="unchecked" value="on" data-slot="checkbox" class="box-border border-solid font-[inherit] p-0 group relative inline-flex shrink-0 cursor-pointer items-center justify-center align-middle transition-colors size-control-check rounded-control-check border bg-background border-border enabled:hover:border-primary enabled:data-[state=checked]:bg-primary enabled:data-[state=checked]:border-primary enabled:data-[state=checked]:hover:bg-primary-hover enabled:data-[state=checked]:hover:border-transparent outline-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-colorBgContainerDisabled disabled:border-border" aria-label="Select row"></button></td><td><span class="text-xs whitespace-pre-wrap ">What is the refund window?</span></td><td>menu-cell</td></tr><tr data-row="new-1"><td><button type="button" role="checkbox" aria-checked="false" data-state="unchecked" value="on" data-slot="checkbox" class="box-border border-solid font-[inherit] p-0 group relative inline-flex shrink-0 cursor-pointer items-center justify-center align-middle transition-colors size-control-check rounded-control-check border bg-background border-border enabled:hover:border-primary enabled:data-[state=checked]:bg-primary enabled:data-[state=checked]:border-primary enabled:data-[state=checked]:hover:bg-primary-hover enabled:data-[state=checked]:hover:border-transparent outline-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-colorBgContainerDisabled disabled:border-border" aria-label="Select row"></button></td><td><div class=""><span class="text-xs text-colorTextDescription">—</span></div></td><td>menu-cell</td></tr></tbody></table></div></div>"`,
        )
    })

    it("The settings button sits in the last extra column, and the picker skips row controls", async () => {
        await mount(<TestcaseTable {...editorProps} columnSettings />)

        const heads = [...container.querySelectorAll("th")]
        expect(heads.at(-1)?.textContent).toContain("Menu")
        expect(heads.at(-1)?.querySelector(SETTINGS_BUTTON)).not.toBeNull()
        const locked = Object.fromEntries(
            seen.columns.map((column) => [column.key, Boolean(column.columnVisibilityLocked)]),
        )
        expect(locked).toEqual({__selection: true, question: false, __menu: true})
    })

    it("Without extra columns the settings button gets a column of its own", async () => {
        await mount(<TestcaseTable config={config} columnSettings />)

        expect(seen.columns.map((column) => column.key)).toEqual(["question", "__settings"])
        expect(container.querySelector(SETTINGS_BUTTON)).not.toBeNull()
    })

    it("An edited row and a new row are marked; a saved row without edits is not", async () => {
        await mount(<TestcaseTable {...editorProps} markEditedRows />)
        const marked = () =>
            [...container.querySelectorAll('[data-row] [title="Unsaved changes"]')].map((marker) =>
                marker.closest("[data-row]")?.getAttribute("data-row"),
            )
        expect(marked()).toEqual(["new-1"])

        setDraft("tc-1", {question: "Edited"})
        expect(marked()).toEqual(["tc-1", "new-1"])
    })

    it("Resting on a cell shows its full value with a Copy button", async () => {
        vi.useFakeTimers()
        try {
            setDraft("tc-1", {question: "What is the refund window?"})
            await mount(<TestcaseTable config={config} cellPopover />)
            const cell = container.querySelector('[data-row="tc-1"] .cursor-pointer')
            expect(cell?.textContent).toContain("What is the refund window?")

            await act(async () => {
                cell?.parentElement?.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}))
                cell?.parentElement?.dispatchEvent(new MouseEvent("mouseenter", {bubbles: false}))
                vi.advanceTimersByTime(600)
            })

            const copy = [...document.body.querySelectorAll("button")].find(
                (button) => button.textContent?.trim() === "Copy",
            )
            expect(copy).toBeDefined()
        } finally {
            vi.useRealTimers()
        }
    })
})
