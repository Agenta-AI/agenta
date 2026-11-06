// @vitest-environment jsdom
/**
 * The test set grid over a plain table: the table stub draws the header slot, the row menu
 * column and the toolbar slot, so the test sees what the grid hands to `TestcaseTable`.
 * The editor is a stub: its column and row actions are tested over the real package state in
 * testsetEditorCommit.test.ts.
 */
import {act, type ReactNode} from "react"

import {atom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TestsetGrid} from "@/features/testsets/detail/TestsetGrid"
import type {ColumnEdit} from "@/features/testsets/detail/useTestsetEditor"

const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}))
const columnConfigs = vi.hoisted(() => [] as {searchTerm?: string}[])
vi.mock("@agenta/ui/app-message", () => ({message: toast}))
vi.mock("@agenta/ui/utils", () => ({copyToClipboard: async () => true}))

vi.mock("@agenta/entities/testcase", () => {
    const columns = atom([
        {key: "question", label: "question"},
        {key: "meta.lang", label: "lang", parentKey: "meta"},
        {key: "meta.tone", label: "tone", parentKey: "meta"},
    ])
    const rows = atom([{id: "case-1"}, {id: "new-1"}])
    // A search that shows only case-1.
    const narrowRows = atom([{id: "case-1"}])
    const noRows = atom([] as {id: string}[])
    return {
        testcaseDataController: {
            selectors: {
                columns: (config: {searchTerm?: string}) => {
                    columnConfigs.push(config)
                    return columns
                },
                rows: (config: {scopeId: string}) =>
                    config.scopeId === "empty"
                        ? noRows
                        : config.scopeId === "narrow"
                          ? narrowRows
                          : rows,
            },
        },
    }
})

interface Header {
    key: string
    label: string
    title: ReactNode
    isGroup: boolean
    groupPath: string | null
}
interface Row {
    id: string
    key: string
    __isNew?: boolean
}
const HEADERS: Header[] = [
    {key: "question", label: "question", title: "question", isGroup: false, groupPath: null},
    {key: "meta", label: "meta", title: "meta", isGroup: true, groupPath: null},
    {key: "meta.lang", label: "lang", title: "lang", isGroup: false, groupPath: "meta"},
]
const ROWS: Row[] = [
    {id: "case-1", key: "case-1"},
    {id: "new-1", key: "new-1", __isNew: true},
]

const tableFeatures = vi.hoisted(() => ({last: null as null | Record<string, unknown>}))

vi.mock("@agenta/entity-ui/testcase", () => ({
    TestcaseTable: (props: {
        config: {scopeId: string; searchTerm?: string}
        selectable?: boolean
        selectionDisabled?: boolean
        onSelectionChange?: (ids: string[]) => void
        onRowClick?: (row: Row) => void
        appendColumns?: {
            key?: string
            title?: ReactNode
            render?: (value: unknown, row: Row) => ReactNode
        }[]
        settingsDelete?: {onDelete: () => void; disabled?: boolean; label?: string}
        renderColumnHeader?: (header: Header) => ReactNode
        headerExtra?: ReactNode
        canExportData?: boolean
        columnSettings?: boolean
        cellPopover?: boolean
        markEditedRows?: boolean
    }) => {
        tableFeatures.last = {
            canExportData: props.canExportData,
            columnSettings: props.columnSettings,
            cellPopover: props.cellPopover,
            markEditedRows: props.markEditedRows,
        }
        return (
            <div data-search={props.config.searchTerm ?? ""}>
                {/* Like the real table, no toolbar while there are no rows. */}
                {props.config.scopeId === "empty" ? null : (
                    <div data-testid="toolbar">{props.headerExtra}</div>
                )}
                {props.selectable ? (
                    <button
                        type="button"
                        disabled={props.selectionDisabled}
                        onClick={() => props.onSelectionChange?.(["case-1", "new-1"])}
                    >
                        Select all
                    </button>
                ) : null}
                {/* The settings menu entry, as the real table settings show it. */}
                {props.settingsDelete ? (
                    <button
                        type="button"
                        disabled={props.settingsDelete.disabled}
                        onClick={props.settingsDelete.onDelete}
                    >
                        {props.settingsDelete.label ?? "Delete"}
                    </button>
                ) : null}
                {props.appendColumns?.map((column) => (
                    <div key={column.key} data-header={column.key}>
                        {column.title}
                    </div>
                ))}
                {HEADERS.map((header) => (
                    <div key={header.key} data-header={header.key}>
                        {props.renderColumnHeader ? props.renderColumnHeader(header) : header.title}
                    </div>
                ))}
                {ROWS.map((row) => (
                    <div key={row.id} data-row={row.id}>
                        {props.appendColumns?.map((column, index) => (
                            <span key={index}>{column.render?.(null, row)}</span>
                        ))}
                    </div>
                ))}
            </div>
        )
    },
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const saved = (): Promise<ColumnEdit> => Promise.resolve({ok: true})

const fakeEditor = (over: Partial<Parameters<typeof TestsetGrid>[0]["editor"]> = {}) => ({
    tableConfig: {scopeId: "scope", revisionId: "rev-2", includeNewRows: true},
    readOnly: false,
    columnEditBlocked: null,
    deleteRows: vi.fn(),
    addColumn: vi.fn(saved),
    renameColumn: vi.fn(
        async (oldKey: string, name: string): Promise<ColumnEdit> =>
            name.trim() === oldKey ? {ok: false, reason: "unchanged"} : saved(),
    ),
    deleteColumns: vi.fn(saved),
    ...over,
})

describe("Test set grid", () => {
    let root: Root
    let host: HTMLDivElement

    const press = async (el: Element | null | undefined) => {
        await act(async () => {
            el?.dispatchEvent(
                new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
            )
        })
    }
    const click = async (el: Element | null | undefined) => {
        await act(async () => (el as HTMLElement | null)?.click())
    }
    const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`)
    const item = (text: string) =>
        Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) =>
            el.textContent?.startsWith(text),
        )
    const button = (text: string) =>
        Array.from(document.querySelectorAll("button"))
            .filter((el) => el.textContent?.trim() === text)
            .at(-1)

    const mount = (editor: ReturnType<typeof fakeEditor>, canEdit = true) => {
        const onOpenRow = vi.fn()
        act(() =>
            root.render(<TestsetGrid editor={editor} canEdit={canEdit} onOpenRow={onOpenRow} />),
        )
        return {onOpenRow}
    }

    beforeEach(() => {
        vi.clearAllMocks()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("Search narrows the grid rows, leaves the editor rows alone and clears the selection", async () => {
        vi.useFakeTimers()
        try {
            const editor = fakeEditor()
            mount(editor)
            await click(button("Select all"))
            expect(button("Delete selected")?.hasAttribute("disabled")).toBe(false)
            const box = byLabel("Search testcases...") as HTMLInputElement
            expect(box).not.toBeNull()
            await act(async () => {
                const setValue = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    "value",
                )?.set
                setValue?.call(box, "Peru")
                box.dispatchEvent(new Event("input", {bubbles: true}))
            })
            await act(async () => {
                vi.advanceTimersByTime(300)
            })
            expect(document.querySelector("[data-search]")?.getAttribute("data-search")).toBe(
                "Peru",
            )
            expect(editor.tableConfig).not.toHaveProperty("searchTerm")
            // The header actions read the same columns as the table.
            expect(columnConfigs.at(-1)?.searchTerm).toBe("Peru")
            // The rows selected before the search are no longer selected.
            expect(button("Delete selected")?.hasAttribute("disabled")).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    it("With no rows, Add column still shows", async () => {
        const editor = fakeEditor({
            tableConfig: {scopeId: "empty", revisionId: "new", includeNewRows: true},
        })
        mount(editor)
        expect(button("Add column")).toBeDefined()
        await click(button("Add column"))
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    })

    it("Rename column with an unchanged name changes nothing", async () => {
        const editor = fakeEditor()
        mount(editor)
        await press(byLabel("Column question actions"))
        await click(item("Rename column"))
        expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value).toBe(
            "question",
        )

        await click(button("Rename"))

        expect(editor.renameColumn).toHaveBeenCalledWith("question", "question")
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    it("Delete column asks first, stages the removal and closes the step", async () => {
        const editor = fakeEditor()
        mount(editor)
        await press(byLabel("Column question actions"))
        await click(item("Delete column"))
        expect(document.body.textContent).toContain(
            'Are you sure you want to delete the column "question"?',
        )
        expect(editor.deleteColumns).not.toHaveBeenCalled()

        await click(button("Delete"))

        expect(editor.deleteColumns).toHaveBeenCalledWith(["question"])
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    it("Deleting a group removes every nested column", async () => {
        const editor = fakeEditor()
        mount(editor)
        await press(byLabel("Group meta actions"))
        expect(item("Rename column")).toBeUndefined()
        await click(item("Delete group"))

        await click(button("Delete"))

        // The nested values sit under one top-level key, the only key the server can remove.
        expect(editor.deleteColumns).toHaveBeenCalledWith(["meta"])
    })

    it("A column inside a nested value has no actions", () => {
        mount(fakeEditor())
        expect(host.querySelector('[data-header="meta.lang"]')?.textContent).toBe("lang")
        expect(byLabel("Column lang actions")).toBeNull()
    })

    it("Row delete shows Save to apply changes", async () => {
        const editor = fakeEditor()
        mount(editor)
        await press(document.querySelector('[data-row="case-1"] [aria-label="Actions"]'))
        await click(item("Delete"))

        expect(editor.deleteRows).toHaveBeenCalledWith(["case-1"])
        expect(toast.success).toHaveBeenCalledWith("Deleted testcase. Save to apply changes.")
    })

    it("Bulk delete reports the number of rows", async () => {
        const editor = fakeEditor()
        mount(editor)
        expect(button("Delete selected")?.hasAttribute("disabled")).toBe(true)
        await click(button("Select all"))
        await click(button("Delete selected"))

        expect(editor.deleteRows).toHaveBeenCalledWith(["case-1", "new-1"])
        expect(toast.success).toHaveBeenCalledWith("Deleted 2 testcase(s). Save to apply changes.")
    })

    it("Bulk delete takes only the selected rows the grid still shows", async () => {
        const editor = fakeEditor({
            tableConfig: {scopeId: "narrow", revisionId: "rev-2", includeNewRows: true},
        })
        mount(editor)
        // Both rows are selected; only case-1 is still shown.
        await click(button("Select all"))
        await click(button("Delete selected"))

        expect(editor.deleteRows).toHaveBeenCalledWith(["case-1"])
        expect(toast.success).toHaveBeenCalledWith("Deleted testcase. Save to apply changes.")
    })

    it("A reader without edit_testsets sees no column or row edit actions", async () => {
        mount(fakeEditor(), false)
        expect(byLabel("Column question actions")).toBeNull()
        expect(button("Add column")).toBeUndefined()
        expect(button("Select all")).toBeUndefined()
        await press(document.querySelector('[data-row="case-1"] [aria-label="Actions"]'))
        expect(item("Delete")).toBeUndefined()
        expect(item("Copy ID")).toBeDefined()
    })

    it("While a save runs, no row or column can change", async () => {
        const editor = fakeEditor({
            readOnly: true,
            columnEditBlocked: "Wait for the current save to finish",
        })
        mount(editor)
        expect(byLabel("Column question actions")?.hasAttribute("disabled")).toBe(true)
        expect(byLabel("Add column")?.hasAttribute("disabled")).toBe(true)
        expect(button("Select all")?.hasAttribute("disabled")).toBe(true)
        expect(button("Delete selected")?.hasAttribute("disabled")).toBe(true)
        await press(document.querySelector('[data-row="case-1"] [aria-label="Actions"]'))
        expect(item("Delete")?.getAttribute("aria-disabled")).toBe("true")
        await click(item("Delete"))
        expect(editor.deleteRows).not.toHaveBeenCalled()
    })

    it("A new row has no id to copy", async () => {
        mount(fakeEditor())
        await press(document.querySelector('[data-row="new-1"] [aria-label="Actions"]'))
        expect(item("Edit")).toBeDefined()
        expect(item("Copy ID")).toBeUndefined()
    })
    it("The page actions sit on the search row, before the table", () => {
        act(() =>
            root.render(
                <TestsetGrid
                    editor={fakeEditor()}
                    canEdit
                    onOpenRow={vi.fn()}
                    actions={<button type="button">Commit</button>}
                />,
            ),
        )
        const search = byLabel("Search testcases...")
        const commit = button("Commit")
        // The search box and the actions share one row.
        const row = search?.parentElement?.parentElement
        expect(row?.contains(commit ?? null)).toBe(true)
        expect(row?.querySelector("[data-header]")).toBeNull()
    })

    it("Add column sits in the header of the row menu column and opens the add step", async () => {
        mount(fakeEditor())
        const header = document.querySelector('[data-header="__row_actions"]')
        const add = header?.querySelector('[aria-label="Add column"]')
        expect(add).not.toBeNull()

        await click(add)

        expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Add Column")
    })

    it("An editor gets the table settings, the cell popover and the edited-row marker", () => {
        mount(fakeEditor())
        expect(tableFeatures.last).toEqual({
            canExportData: false,
            columnSettings: true,
            cellPopover: true,
            markEditedRows: true,
        })
    })

    it("A reader who may not edit gets no edited-row marker", () => {
        mount(fakeEditor(), false)
        expect(tableFeatures.last).toMatchObject({markEditedRows: false, columnSettings: true})
    })
})
