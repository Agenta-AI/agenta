// @vitest-environment jsdom
import {createElement, act, type ReactNode} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {revisionMolecule} from "@agenta/entities/testset"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {isTestsetRouteId} from "@/features/testsets/detail/testsetRouteId"
import {useTestsetEditor} from "@/features/testsets/detail/useTestsetEditor"

const saves = vi.hoisted(() => ({
    saved: vi.fn(),
    created: vi.fn(),
}))

vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
vi.mock("@agenta/entities/testset", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/entities/testset")>()
    const {atom} = await import("jotai")
    // One atom for every call: a new atom per render would never settle.
    const header = atom({
        data: {
            testsetId: "set-1",
            testsetName: "Refund questions",
            testsetSlug: undefined,
            description: undefined,
            revisionSlug: undefined,
            revisionVersion: 2,
            commitMessage: undefined,
            author: undefined,
            createdAt: undefined,
            updatedAt: undefined,
        },
        isPending: false,
        isError: false,
    })
    return {
        ...original,
        // The network writes are replaced; the edit session state under them is the real one.
        saveTestsetAtom: atom(null, (_get, _set, params: unknown) => saves.saved(params)),
        saveNewTestsetAtom: atom(null, (_get, _set, params: unknown) => saves.created(params)),
        testsetRevisionHeaderAtomFamily: () => header,
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const REVISION = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"

type Editor = ReturnType<typeof useTestsetEditor>
let latest: Editor | null = null
const editor = (): Editor => {
    if (!latest) throw new Error("The probe did not render")
    return latest
}

function Probe({routeId, nameFromUrl}: {routeId: string; nameFromUrl: string | null}) {
    latest = useTestsetEditor({projectId: "pr", routeId, nameFromUrl})
    return null
}

describe("useTestsetEditor", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    /** Runs an editor action inside act, so the hook re-renders before the next one. */
    const run = <T>(action: () => T): T => {
        let result: T | undefined
        act(() => {
            result = action()
        })
        return result as T
    }

    const mount = (routeId: string, nameFromUrl: string | null = null) => {
        const tree: ReactNode = createElement(
            Provider,
            {store},
            createElement(Probe, {routeId, nameFromUrl}),
        )
        act(() => root.render(tree))
    }

    beforeEach(() => {
        vi.clearAllMocks()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("An id that is not a UUID or new reports not found", () => {
        expect(isTestsetRouteId("not-a-uuid")).toBe(false)
        expect(isTestsetRouteId("new")).toBe(true)
        expect(isTestsetRouteId(REVISION)).toBe(true)

        mount("not-a-uuid")
        expect(editor().notFound).toBe(true)
        expect(editor().header).toBeNull()
    })

    it("Add column on a new test set refuses an empty name and a duplicate name", async () => {
        mount("new", "Greeting checks")

        expect(await act(() => editor().addColumn("   "))).toEqual({ok: false, reason: "empty"})
        expect(await act(() => editor().addColumn(" country "))).toEqual({
            ok: true,
            revisionId: null,
        })
        expect(await act(() => editor().addColumn("country"))).toEqual({
            ok: false,
            reason: "duplicate",
        })
        expect(store.get(revisionMolecule.atoms.pendingColumnOps("new")).add).toEqual(["country"])
        expect(saves.saved).not.toHaveBeenCalled()
    })

    it("Commit on a saved testset returns the new revision id", async () => {
        saves.saved.mockResolvedValue({success: true, newRevisionId: "rev-3"})
        mount(REVISION)
        run(() => editor().addRow())

        let id: string | null = null
        await act(async () => {
            id = await editor().commit("  Added a row ")
        })

        expect(id).toBe("rev-3")
        expect(saves.saved).toHaveBeenCalledWith({
            projectId: "pr",
            testsetId: "set-1",
            revisionId: REVISION,
            commitMessage: "Added a row",
        })
    })

    it("Commit on a new testset uses the name from the URL", async () => {
        saves.created.mockResolvedValue({success: true, revisionId: "rev-1"})
        mount("new", "  Greeting checks ")
        expect(editor().isNew).toBe(true)
        expect(editor().header?.testsetName).toBe("Greeting checks")

        let id: string | null = null
        await act(async () => {
            id = await editor().commit("")
        })

        expect(id).toBe("rev-1")
        expect(saves.created).toHaveBeenCalledWith({
            projectId: "pr",
            testsetName: "Greeting checks",
            commitMessage: undefined,
        })
        expect(saves.saved).not.toHaveBeenCalled()
    })

    it("Discard clears rows and the revision draft", () => {
        mount(REVISION)
        const rowId = run(() => editor().addRow())
        act(() => {
            store.set(revisionMolecule.actions.update, REVISION, {message: "draft"})
        })
        expect(rowId?.startsWith("new-")).toBe(true)
        expect(editor().changesSummary.newTestcases).toBe(1)

        act(() => editor().discard())

        expect(editor().hasUnsavedChanges).toBe(false)
        expect(store.get(testcaseMolecule.newIds)).toEqual([])
        expect(store.get(revisionMolecule.atoms.draft(REVISION))).toBeNull()
    })

    it("A new row has a field for each column, so the row drawer has fields to fill in", async () => {
        mount("new", "Greeting checks")
        await act(() => editor().addColumn("country"))
        await act(() => editor().addColumn("capital"))
        const rowId = run(() => editor().addRow())

        expect(store.get(testcaseMolecule.atoms.data(rowId as string))?.data).toEqual({
            country: "",
            capital: "",
        })
    })

    it("Discard on a new test set clears its rows and columns", async () => {
        mount("new", "Greeting checks")
        run(() => editor().addRow())
        await act(() => editor().addColumn("country"))
        expect(editor().changesSummary.addedColumns).toBe(1)

        act(() => editor().discard())

        expect(editor().hasUnsavedChanges).toBe(false)
        expect(store.get(testcaseMolecule.newIds)).toEqual([])
        expect(store.get(revisionMolecule.atoms.pendingColumnOps("new")).add).toEqual([])
    })

    it("A failed commit keeps the changes and returns no id", async () => {
        saves.saved.mockResolvedValue({success: false, error: new Error("boom")})
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
        mount(REVISION)
        run(() => editor().addRow())

        let id: string | null = "unset"
        await act(async () => {
            id = await editor().commit("x")
        })

        expect(id).toBeNull()
        expect(editor().hasUnsavedChanges).toBe(true)
        expect(editor().isSaving).toBe(false)
        errors.mockRestore()
    })
})
