// @vitest-environment jsdom
/**
 * The testcase drawer of the test set page. The package drawer shell and the JSON / YAML data
 * editor are stubs that keep the props they get; the testcase state is the real package state.
 * The form is real; its rich text editor is a plain text box, so a test can type into it.
 */
import {act, type ReactNode} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {FieldColumnActions} from "@/features/testsets/detail/fields/TestcaseFieldForm"
import {TestcaseEditorDrawer} from "@/features/testsets/detail/TestcaseEditorDrawer"
import {TestcaseEditorDrawerContent} from "@/features/testsets/detail/TestcaseEditorDrawerContent"

const seen = vi.hoisted(() => ({
    drawer: null as null | Record<string, unknown>,
    editor: null as null | Record<string, unknown>,
}))

vi.mock("@agenta/entity-ui/testcase", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    TestcaseDrawer: (props: Record<string, unknown>) => {
        seen.drawer = props
        return null
    },
    TestcaseDataEditor: (props: Record<string, unknown>) => {
        seen.editor = props
        return null
    },
}))
vi.mock("@agenta/ui/editor", () => ({
    EditorProvider: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@agenta/ui/shared-editor", () => ({
    SharedEditor: ({
        initialValue,
        handleChange,
    }: {
        initialValue: string
        handleChange?: (next: string) => void
    }) => (
        <textarea
            data-testid="rich-editor"
            value={initialValue}
            readOnly={!handleChange}
            onChange={(event) => handleChange?.(event.target.value)}
        />
    ),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()

describe("Testcase drawer", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        seen.drawer = null
        seen.editor = null
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        store.set(testcaseMolecule.actions.discardAll)
    })

    const content = (
        over: {
            isNewRow?: boolean
            viewOnly?: boolean
            testcaseId?: string
            view?: "form" | "json"
            columnActions?: (key: string) => FieldColumnActions | null
            onAddColumn?: () => void
        } = {},
    ) =>
        act(() =>
            root.render(
                <TestcaseEditorDrawerContent
                    testcaseId={over.testcaseId ?? "case-1"}
                    isNewRow={over.isNewRow ?? false}
                    viewOnly={over.viewOnly ?? false}
                    initialPath={[]}
                    onPathChange={vi.fn()}
                    rootViewMode={over.view ?? "json"}
                    collapseSignal={0}
                    columnActions={over.columnActions}
                    onAddColumn={over.onAddColumn}
                />,
            ),
        )

    const drawer = (viewOnly: boolean, onOpenCommit = vi.fn()) =>
        act(() =>
            root.render(
                <TestcaseEditorDrawer
                    testcaseId="case-1"
                    testcaseNumber={1}
                    viewOnly={viewOnly}
                    hasPrevious={false}
                    hasNext
                    onPrevious={vi.fn()}
                    onNext={vi.fn()}
                    onClose={vi.fn()}
                    onOpenCommit={onOpenCommit}
                />,
            ),
        )

    it("A new row shows the not saved note", () => {
        const id = store.set(testcaseMolecule.actions.add, {data: {}})?.id ?? ""
        content({isNewRow: true, testcaseId: id, view: "form"})
        expect(host.textContent).toContain(
            'This is a new testcase that hasn\'t been saved to the server yet. Fill in the fields below and click "Commit" to save all changes.',
        )
        content({isNewRow: false, view: "form"})
        expect(host.textContent).toBe("")
    })

    it("The JSON view shows the fields in row order, with no per-field add or delete", () => {
        content()
        expect(seen.editor).toMatchObject({fieldOrder: "data", fieldControls: false})
    })

    it("A reader opens the drawer in view only mode", () => {
        drawer(true)
        expect(seen.drawer).toMatchObject({viewOnly: true, onOpenCommitModal: undefined})
        content({viewOnly: true})
        expect(seen.editor).toMatchObject({mode: "view", onChange: undefined})
    })

    it("An editor gets Add to queue for a saved row; a reader and a new row get none", () => {
        drawer(false)
        const render = seen.drawer?.renderAddToQueue as (ids: string[]) => unknown
        expect(render(["case-1"])).not.toBeNull()
        // The drawer hands no ids for a row that is not saved yet.
        expect(render([])).toBeNull()

        drawer(true)
        expect(seen.drawer?.renderAddToQueue).toBeUndefined()
    })

    it("An editor opens the commit step from the drawer menu", () => {
        const onOpenCommit = vi.fn()
        drawer(false, onOpenCommit)
        expect(seen.drawer).toMatchObject({viewOnly: false, hasNext: true, hasPrevious: false})
        act(() => (seen.drawer?.onOpenCommitModal as () => void)())
        expect(onOpenCommit).toHaveBeenCalledOnce()
        content()
        expect(seen.editor).toMatchObject({mode: "edit"})
    })

    it("A drawer edit goes to the unsaved row, and a removed field is removed", () => {
        const id = store.set(testcaseMolecule.actions.add, {data: {question: "Q", note: "x"}})?.id
        content({isNewRow: true, testcaseId: id ?? ""})

        act(() => (seen.editor?.onChange as (value: unknown) => void)({question: "Q2"}))

        expect(store.get(testcaseMolecule.atoms.data(id ?? ""))?.data).toEqual({question: "Q2"})
    })

    it("Cancel puts the row back, and a field added in the drawer goes away", () => {
        const id = store.set(testcaseMolecule.actions.add, {data: {question: "Q"}})?.id ?? ""
        const start = store.get(testcaseMolecule.atoms.data(id))
        act(() =>
            root.render(
                <TestcaseEditorDrawer
                    testcaseId={id}
                    testcaseNumber={1}
                    viewOnly={false}
                    hasPrevious={false}
                    hasNext={false}
                    onPrevious={vi.fn()}
                    onNext={vi.fn()}
                    onClose={vi.fn()}
                    onOpenCommit={vi.fn()}
                />,
            ),
        )
        act(() => {
            store.set(testcaseMolecule.actions.update, id, {data: {question: "Q2", extra: "x"}})
        })

        act(() => (seen.drawer?.onRestoreSessionStart as (data: unknown) => void)(start))

        expect(store.get(testcaseMolecule.atoms.data(id))?.data).toEqual({question: "Q"})
    })

    it("Cancel on a row just added removes the row from the grid", () => {
        const id = store.set(testcaseMolecule.actions.add, {data: {question: ""}})?.id ?? ""
        const start = store.get(testcaseMolecule.atoms.data(id))
        act(() =>
            root.render(
                <TestcaseEditorDrawer
                    testcaseId={id}
                    testcaseNumber={1}
                    viewOnly={false}
                    hasPrevious={false}
                    hasNext={false}
                    onPrevious={vi.fn()}
                    onNext={vi.fn()}
                    onClose={vi.fn()}
                    onOpenCommit={vi.fn()}
                    discardOnCancel
                />,
            ),
        )
        expect(store.get(testcaseMolecule.atoms.newIds)).toContain(id)

        act(() => (seen.drawer?.onRestoreSessionStart as (data: unknown) => void)(start))

        expect(store.get(testcaseMolecule.atoms.newIds)).not.toContain(id)
        expect(store.get(testcaseMolecule.atoms.data(id))).toBeNull()
    })

    it("The internal dedup id is not an editable field, and an edit keeps it", () => {
        const id =
            store.set(testcaseMolecule.actions.add, {
                data: {question: "Q", testcase_dedup_id: "dedup-1"},
            })?.id ?? ""
        content({isNewRow: true, testcaseId: id})
        expect(seen.editor?.value).toEqual({question: "Q"})

        act(() => (seen.editor?.onChange as (value: unknown) => void)({question: "Q2"}))

        expect(store.get(testcaseMolecule.atoms.data(id))?.data).toEqual({
            question: "Q2",
            testcase_dedup_id: "dedup-1",
        })
    })

    it("A dedup id typed in the JSON view does not replace the saved one", () => {
        const id =
            store.set(testcaseMolecule.actions.add, {
                data: {question: "Q", testcase_dedup_id: "dedup-1"},
            })?.id ?? ""
        content({isNewRow: true, testcaseId: id})

        act(() =>
            (seen.editor?.onChange as (value: unknown) => void)({
                question: "Q",
                testcase_dedup_id: "typed",
                __dedup_id__: "typed too",
            }),
        )

        expect(store.get(testcaseMolecule.atoms.data(id))?.data).toEqual({
            question: "Q",
            testcase_dedup_id: "dedup-1",
        })
    })

    it("A __proto__ field typed in the JSON view is kept as data", () => {
        const id = store.set(testcaseMolecule.actions.add, {data: {question: "Q"}})?.id ?? ""
        content({isNewRow: true, testcaseId: id})

        const typed = JSON.parse('{"question": "Q", "__proto__": {"polluted": true}}')
        act(() => (seen.editor?.onChange as (value: unknown) => void)(typed))

        const data = store.get(testcaseMolecule.atoms.data(id))?.data ?? {}
        expect(Object.hasOwn(data, "__proto__")).toBe(true)
        expect(Object.getOwnPropertyDescriptor(data, "__proto__")?.value).toEqual({polluted: true})
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    describe("Form", () => {
        const addRow = (data: Record<string, unknown>) =>
            store.set(testcaseMolecule.actions.add, {data})?.id ?? ""
        const dataOf = (id: string) => store.get(testcaseMolecule.atoms.data(id))?.data
        const input = (label: string) =>
            host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
        const section = (name: string) =>
            host.querySelector<HTMLElement>(`section[aria-label="${name}"]`)
        const type = (element: HTMLInputElement | HTMLTextAreaElement, text: string) =>
            act(() => {
                const proto = Object.getPrototypeOf(element) as object
                Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, text)
                element.dispatchEvent(new Event("input", {bubbles: true}))
            })

        it("puts short values in the grid and long values in sections, in column order", () => {
            const id = addRow({
                ticket_id: "T-20418",
                language: "en",
                question: "Line one\nline two\nline three",
                tier: "gold",
                max_items: 5,
                context: {source: "email", score: 0.9},
            })
            content({testcaseId: id, view: "form"})

            expect(input("language")?.value).toBe("en")
            expect(input("language")?.className).not.toContain("font-mono")
            expect(input("tier")?.value).toBe("gold")
            expect(input("ticket_id")?.className).toContain("font-mono")
            expect(input("language")?.closest("section")).toBeNull()
            expect(
                [...host.querySelectorAll("section")].map((item) =>
                    item.getAttribute("aria-label"),
                ),
            ).toEqual(["question", "context"])
            expect(section("context")?.textContent).toContain("object · 2 fields")
        })

        it("a true or false value is a switch that stores a boolean", () => {
            const id = addRow({is_urgent: true})
            content({testcaseId: id, view: "form"})
            const group = host.querySelector('[role="radiogroup"][aria-label="is_urgent"]')
            const option = (label: string) =>
                [...(group?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].find(
                    (item) => item.textContent === label,
                )
            expect(option("true")?.getAttribute("aria-checked")).toBe("true")

            act(() => option("false")?.click())

            expect(dataOf(id)).toEqual({is_urgent: false})
        })

        it("a number stays a number", () => {
            const id = addRow({max_items: 5})
            content({testcaseId: id, view: "form"})
            const field = host.querySelector<HTMLInputElement>("[data-slot=input-number] input")
            expect(field).not.toBeNull()

            type(field as HTMLInputElement, "7")
            act(() => field?.dispatchEvent(new FocusEvent("blur")))
            act(() => field?.dispatchEvent(new FocusEvent("focusout", {bubbles: true})))

            expect(dataOf(id)).toEqual({max_items: 7})
        })

        it("a text field keeps the text editor and a string when the user types true", () => {
            const id = addRow({answer: "yes"})
            content({testcaseId: id, view: "form"})

            type(input("answer") as HTMLInputElement, "true")

            expect(dataOf(id)).toEqual({answer: "true"})
            expect(input("answer")?.value).toBe("true")
            expect(host.querySelector('[role="radiogroup"]')).toBeNull()
        })

        it("JSON that does not parse shows the error line and keeps the last valid value", () => {
            const items = [{sku: "TL-204", qty: 2}]
            const id = addRow({items})
            content({testcaseId: id, view: "form"})
            const editor = () =>
                section("items")?.querySelector<HTMLTextAreaElement>(
                    '[data-testid="rich-editor"]',
                ) as HTMLTextAreaElement

            type(editor(), '[\n  {"sku": "TL-204" "qty": 2}\n]')

            expect(host.querySelector('[role="alert"]')?.textContent).toBe(
                "Not valid JSON: a comma is missing in line 2. The field keeps its last valid value until you fix it.",
            )
            expect(dataOf(id)).toEqual({items})
            // The typed text stays while it does not parse.
            expect(editor().value).toContain('"TL-204" "qty"')

            type(editor(), '[\n  {"sku": "TL-204", "qty": 3}\n]')

            expect(host.querySelector('[role="alert"]')).toBeNull()
            expect(dataOf(id)).toEqual({items: [{sku: "TL-204", qty: 3}]})
            // Its own update does not reformat what the user typed.
            expect(editor().value).toBe('[\n  {"sku": "TL-204", "qty": 3}\n]')
        })

        it("an outside change replaces the typed text of a code field", () => {
            const id = addRow({items: [{a: 1}]})
            content({testcaseId: id, view: "form"})
            act(() => {
                store.set(testcaseMolecule.actions.update, id, {data: {items: [{a: 9}]}})
            })
            const editor = section("items")?.querySelector<HTMLTextAreaElement>("textarea")
            expect(JSON.parse(editor?.value ?? "null")).toEqual([{a: 9}])
        })

        it("an edit marks the row edited, and Cancel puts it back", () => {
            const id = addRow({tier: "gold"})
            act(() => {
                store.set(testcaseMolecule.actions.update, id, {data: {tier: "gold"}})
            })
            const start = store.get(testcaseMolecule.atoms.data(id))
            const open = () =>
                act(() =>
                    root.render(
                        <>
                            <TestcaseEditorDrawer
                                testcaseId={id}
                                testcaseNumber={12}
                                viewOnly={false}
                                hasPrevious={false}
                                hasNext={false}
                                onPrevious={vi.fn()}
                                onNext={vi.fn()}
                                onClose={vi.fn()}
                                onOpenCommit={vi.fn()}
                            />
                            <TestcaseEditorDrawerContent
                                testcaseId={id}
                                isNewRow={false}
                                viewOnly={false}
                                initialPath={[]}
                                onPathChange={vi.fn()}
                                rootViewMode="form"
                                collapseSignal={0}
                            />
                        </>,
                    ),
                )
            open()
            const dirtyBefore = seen.drawer?.isDirty

            type(input("tier") as HTMLInputElement, "silver")
            open()
            expect(dataOf(id)).toEqual({tier: "silver"})
            expect(seen.drawer?.isDirty).toBe(true)

            act(() => (seen.drawer?.onRestoreSessionStart as (data: unknown) => void)(start))
            open()
            expect(dataOf(id)).toEqual({tier: "gold"})
            expect(seen.drawer?.isDirty).toBe(dirtyBefore)
            expect(input("tier")?.value).toBe("gold")
        })

        const openMenu = (name: string) =>
            act(() => {
                host.querySelector(`[aria-label="Field actions for ${name}"]`)?.dispatchEvent(
                    new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
                )
            })
        const menuItem = (label: string) =>
            [
                ...document.querySelectorAll<HTMLElement>(
                    '[role="menuitem"], [role="menuitemradio"]',
                ),
            ].find((item) => item.textContent === label)

        it("the field menu renames and deletes the column through the page's steps", () => {
            const id = addRow({country: "DE", notes: "a\nb"})
            const onRename = vi.fn()
            const onDelete = vi.fn()
            content({
                testcaseId: id,
                view: "form",
                columnActions: (key) =>
                    key === "country" ? {blockedReason: null, onRename, onDelete} : null,
            })

            openMenu("country")
            expect(menuItem("Copy value")).toBeDefined()
            act(() => menuItem("Delete column")?.click())
            expect(onDelete).toHaveBeenCalledOnce()

            openMenu("country")
            act(() => menuItem("Rename column")?.click())
            expect(onRename).toHaveBeenCalledOnce()

            // A field with no column actions has no Rename or Delete.
            openMenu("notes")
            expect(menuItem("Rename column")).toBeUndefined()
            expect(menuItem("Delete column")).toBeUndefined()
        })

        it("Show as changes the editor of that field only", () => {
            const id = addRow({brief: "First line\nsecond line", other: "x\ny"})
            content({testcaseId: id, view: "form"})
            openMenu("brief")
            act(() => menuItem("JSON")?.click())

            expect(section("brief")?.querySelector("textarea")?.value).toBe(
                '"First line\\nsecond line"',
            )
            expect(section("other")?.querySelector("textarea")?.value).toBe("x\ny")
        })

        it("a reader sees the same layout with no inputs and no column actions", () => {
            const id = addRow({tier: "gold", notes: "", context: {a: 1}})
            const columnActions = vi.fn(() => ({
                blockedReason: null,
                onRename: vi.fn(),
                onDelete: vi.fn(),
            }))
            content({testcaseId: id, view: "form", viewOnly: true, columnActions})

            expect(host.querySelector("input")).toBeNull()
            expect(host.textContent).toContain("gold")
            expect(host.textContent).toContain("empty text")
            expect(section("context")).not.toBeNull()
            openMenu("tier")
            expect(menuItem("Copy value")).toBeDefined()
            expect(menuItem("Delete column")).toBeUndefined()
            expect(host.textContent).not.toContain("Add field")
        })

        it("Add field opens the page's add column step", () => {
            const id = addRow({tier: "gold"})
            const onAddColumn = vi.fn()
            content({testcaseId: id, view: "form", onAddColumn})
            const add = [...host.querySelectorAll("button")].find((item) =>
                item.textContent?.includes("Add field"),
            )
            act(() => add?.click())
            expect(onAddColumn).toHaveBeenCalledOnce()
        })
    })
})
