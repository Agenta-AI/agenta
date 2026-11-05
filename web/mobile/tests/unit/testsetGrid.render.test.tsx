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
vi.mock("@agenta/ui/app-message", () => ({message: toast}))
vi.mock("@agenta/ui/utils", () => ({copyToClipboard: async () => true}))

vi.mock("@agenta/entities/testcase", () => {
    const columns = atom([
        {key: "question", label: "question"},
        {key: "meta.lang", label: "lang", parentKey: "meta"},
        {key: "meta.tone", label: "tone", parentKey: "meta"},
    ])
    return {testcaseDataController: {selectors: {columns: () => columns}}}
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

vi.mock("@agenta/entity-ui/testcase", () => ({
    TestcaseTable: (props: {
        config: {searchTerm?: string}
        selectable?: boolean
        selectionDisabled?: boolean
        onSelectionChange?: (ids: string[]) => void
        onRowClick?: (row: Row) => void
        appendColumns?: {render?: (value: unknown, row: Row) => ReactNode}[]
        renderColumnHeader?: (header: Header) => ReactNode
        headerExtra?: ReactNode
    }) => (
        <div data-search={props.config.searchTerm ?? ""}>
            <div data-testid="toolbar">{props.headerExtra}</div>
            {props.selectable ? (
                <button
                    type="button"
                    disabled={props.selectionDisabled}
                    onClick={() => props.onSelectionChange?.(["case-1", "new-1"])}
                >
                    Select all
                </button>
            ) : null}
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
    ),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const saved = (): Promise<ColumnEdit> => Promise.resolve({ok: true, revisionId: "rev-3"})

const fakeEditor = (over: Partial<Parameters<typeof TestsetGrid>[0]["editor"]> = {}) => ({
    isNew: false,
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
        const onColumnSaved = vi.fn()
        const onOpenRow = vi.fn()
        act(() =>
            root.render(
                <TestsetGrid
                    editor={editor}
                    canEdit={canEdit}
                    onOpenRow={onOpenRow}
                    onColumnSaved={onColumnSaved}
                />,
            ),
        )
        return {onColumnSaved, onOpenRow}
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
            expect(button("Delete")?.hasAttribute("disabled")).toBe(false)
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
            // The rows selected before the search are no longer selected.
            expect(button("Delete")?.hasAttribute("disabled")).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    it("Rename column with an unchanged name changes nothing", async () => {
        const editor = fakeEditor()
        const {onColumnSaved} = mount(editor)
        await press(byLabel("Column question actions"))
        await click(item("Rename column"))
        expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value).toBe(
            "question",
        )

        await click(button("Rename and save"))

        expect(editor.renameColumn).toHaveBeenCalledWith("question", "question")
        expect(onColumnSaved).not.toHaveBeenCalled()
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    it("Delete column asks first and removes the column", async () => {
        const editor = fakeEditor()
        const {onColumnSaved} = mount(editor)
        await press(byLabel("Column question actions"))
        await click(item("Delete column"))
        expect(document.body.textContent).toContain(
            'Are you sure you want to delete the column "question"?',
        )
        expect(editor.deleteColumns).not.toHaveBeenCalled()

        await click(button("Delete and save"))

        expect(editor.deleteColumns).toHaveBeenCalledWith(["question"])
        expect(onColumnSaved).toHaveBeenCalledWith("rev-3")
    })

    it("Deleting a group removes every nested column", async () => {
        const editor = fakeEditor()
        mount(editor)
        await press(byLabel("Group meta actions"))
        expect(item("Rename column")).toBeUndefined()
        await click(item("Delete group"))

        await click(button("Delete and save"))

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
        expect(button("Delete")?.hasAttribute("disabled")).toBe(true)
        await click(button("Select all"))
        await click(button("Delete"))

        expect(editor.deleteRows).toHaveBeenCalledWith(["case-1", "new-1"])
        expect(toast.success).toHaveBeenCalledWith("Deleted 2 testcase(s). Save to apply changes.")
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
        expect(button("Delete")?.hasAttribute("disabled")).toBe(true)
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
})
