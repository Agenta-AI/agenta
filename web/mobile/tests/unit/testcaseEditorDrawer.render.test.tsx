// @vitest-environment jsdom
/**
 * The testcase drawer of the test set page. The package drawer shell and the data editor are
 * stubs that keep the props they get; the testcase state is the real package state.
 */
import {act} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TestcaseEditorDrawer} from "@/features/testsets/detail/TestcaseEditorDrawer"
import {TestcaseEditorDrawerContent} from "@/features/testsets/detail/TestcaseEditorDrawerContent"

const seen = vi.hoisted(() => ({
    drawer: null as null | Record<string, unknown>,
    editor: null as null | Record<string, unknown>,
}))

vi.mock("@agenta/entity-ui/testcase", () => ({
    TestcaseDrawer: (props: Record<string, unknown>) => {
        seen.drawer = props
        return null
    },
    TestcaseDataEditor: (props: Record<string, unknown>) => {
        seen.editor = props
        return null
    },
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

    const content = (over: {isNewRow?: boolean; viewOnly?: boolean; testcaseId?: string} = {}) =>
        act(() =>
            root.render(
                <TestcaseEditorDrawerContent
                    testcaseId={over.testcaseId ?? "case-1"}
                    isNewRow={over.isNewRow ?? false}
                    viewOnly={over.viewOnly ?? false}
                    initialPath={[]}
                    onPathChange={vi.fn()}
                    rootViewMode="form"
                    collapseSignal={0}
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
        content({isNewRow: true, testcaseId: id})
        expect(host.textContent).toContain(
            'This is a new testcase that hasn\'t been saved to the server yet. Fill in the fields below and click "Commit" to save all changes.',
        )
        content({isNewRow: false})
        expect(host.textContent).toBe("")
    })

    it("A reader opens the drawer in view only mode", () => {
        drawer(true)
        expect(seen.drawer).toMatchObject({viewOnly: true, onOpenCommitModal: undefined})
        content({viewOnly: true})
        expect(seen.editor).toMatchObject({mode: "view", onChange: undefined})
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
})
