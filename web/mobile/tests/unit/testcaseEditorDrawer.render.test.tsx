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
                    columns={[{key: "question", label: "question"}]}
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
                    columns={[]}
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
})
