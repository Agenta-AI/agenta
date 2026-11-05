// @vitest-environment jsdom
import {act, useState} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {buildChangesDiff} from "@/features/testsets/detail/changesDiff"
import {rowChangeText} from "@/features/testsets/detail/CommitTestsetDialog"
import {TestsetToolbar} from "@/features/testsets/detail/TestsetToolbar"

const router = vi.hoisted(() => ({
    push: vi.fn(),
    handlers: new Set<(url: string, options: {shallow: boolean}) => void>(),
}))

vi.mock("next/router", () => ({
    useRouter: () => ({
        push: router.push,
        events: {
            // Only the route change start matters here: it is the one the guard can stop.
            on: (name: string, handler: (url: string, options: {shallow: boolean}) => void) =>
                name === "routeChangeStart" && router.handlers.add(handler),
            off: (name: string, handler: (url: string, options: {shallow: boolean}) => void) =>
                name === "routeChangeStart" && router.handlers.delete(handler),
            emit: vi.fn(),
        },
    }),
}))
vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
vi.mock("@/features/testsets/detail/changesDiff", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/features/testsets/detail/changesDiff")>()),
    useChangesDiff: () => null,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

type ToolbarProps = Parameters<typeof TestsetToolbar>[0]
type Editor = ToolbarProps["editor"]

/** The toolbar with the commit step state the page holds. */
const ToolbarHost = (props: Omit<ToolbarProps, "commitOpen" | "onCommitOpenChange">) => {
    const [commitOpen, setCommitOpen] = useState(false)
    return <TestsetToolbar {...props} commitOpen={commitOpen} onCommitOpenChange={setCommitOpen} />
}

const fakeEditor = (over: Partial<Editor> = {}): Editor => ({
    isNew: false,
    header: {
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
    hasUnsavedChanges: true,
    changesSummary: {
        newTestcases: 1,
        updatedTestcases: 2,
        deletedTestcases: 0,
        renamedColumns: 0,
        addedColumns: 0,
        deletedColumns: 0,
        hasChanges: true,
    },
    isSaving: false,
    columnEditBlocked: "Save or discard your row changes first",
    addRow: vi.fn(() => "new-1"),
    discard: vi.fn(),
    commit: vi.fn(async () => "rev-9"),
    ...over,
})

describe("Testset toolbar, commit and leave prompt", () => {
    let root: Root
    let host: HTMLDivElement

    const onImport = vi.fn()
    const mount = (editor: Editor, canEdit = true, revisionStatus: "ready" | "loading" = "ready") =>
        act(() =>
            root.render(
                <>
                    <ToolbarHost
                        editor={editor}
                        routeId="rev-2"
                        base="/w/ws/p/pr"
                        canEdit={canEdit}
                        revisions={{latestVersion: 5, load: vi.fn(), status: revisionStatus}}
                        onImport={onImport}
                    />
                </>,
            ),
        )
    // The last match: a dialog renders after the toolbar and covers it.
    const button = (label: string) =>
        Array.from(document.querySelectorAll("button"))
            .filter((b) => b.textContent?.trim() === label)
            .at(-1)
    const click = (label: string) => act(async () => button(label)?.click())
    const navigate = (url: string) => {
        for (const handler of router.handlers) handler(url, {shallow: false})
    }
    /** A route change the guard stops: it throws from the handler, inside act for the prompt. */
    const attemptLeave = (url: string): boolean => {
        let stopped = false
        act(() => {
            try {
                navigate(url)
            } catch {
                stopped = true
            }
        })
        return stopped
    }

    beforeEach(() => {
        vi.clearAllMocks()
        router.handlers.clear()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        document.body.innerHTML = ""
    })

    it("Commit is disabled without changes", async () => {
        await mount(fakeEditor({hasUnsavedChanges: false}))
        expect(button("Commit")?.disabled).toBe(true)
        expect(button("Discard")).toBeUndefined()
    })

    it("The commit dialog shows the next version after the latest one", async () => {
        await mount(fakeEditor())
        await click("Commit")
        expect(document.body.textContent).toContain("Commit Changes")
        expect(document.body.textContent).toContain("v2 → v6")
    })

    it("The commit dialog leaves out the next version until the revisions load", async () => {
        await mount(fakeEditor(), true, "loading")
        await click("Commit")
        expect(document.body.textContent).toContain("Version v2")
        expect(document.body.textContent).not.toContain("→")
    })

    it("The commit dialog lists only non-zero change counts", async () => {
        expect(rowChangeText({updatedTestcases: 2, newTestcases: 0, deletedTestcases: 1})).toBe(
            "2 modified, 1 deleted",
        )
        expect(
            rowChangeText({updatedTestcases: 0, newTestcases: 0, deletedTestcases: 0}),
        ).toBeNull()

        await mount(fakeEditor())
        await click("Commit")
        expect(document.body.textContent).toContain("Changes: 2 modified, 1 added")
        expect(document.body.textContent).not.toContain("deleted")
    })

    it("A successful commit goes to the new revision without the leave prompt", async () => {
        router.push.mockImplementation(async (url: string) => navigate(url))
        const editor = fakeEditor()
        await mount(editor)
        await click("Commit")
        await click("Commit")

        expect(editor.commit).toHaveBeenCalledWith("")
        expect(router.push).toHaveBeenCalledWith("/w/ws/p/pr/testsets/rev-9")
        expect(document.body.textContent).not.toContain("Unsaved changes")
    })

    it("A failed commit keeps the dialog open and does not leave", async () => {
        const editor = fakeEditor({commit: vi.fn(async () => null)})
        await mount(editor)
        await click("Commit")
        await click("Commit")

        expect(router.push).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain("Commit Changes")
    })

    it("Save in the leave prompt opens the commit dialog and stays on the page", async () => {
        await mount(fakeEditor())
        expect(attemptLeave("/w/ws/p/pr/testsets")).toBe(true)
        expect(document.body.textContent).toContain("Unsaved changes")
        expect(button("Discard changes")).toBeDefined()

        await click("Save")

        expect(document.body.textContent).toContain("Commit Changes")
        expect(router.push).not.toHaveBeenCalled()
    })

    it("Discard changes in the leave prompt clears the changes and goes on", async () => {
        const editor = fakeEditor()
        router.push.mockImplementation(async (url: string) => navigate(url))
        await mount(editor)
        expect(attemptLeave("/w/ws/p/pr/testsets")).toBe(true)

        await click("Discard changes")

        expect(editor.discard).toHaveBeenCalled()
        expect(router.push).toHaveBeenCalledWith("/w/ws/p/pr/testsets")
    })

    it("A new testset offers Leave without saving", async () => {
        await mount(fakeEditor({isNew: true}))
        expect(attemptLeave("/w/ws/p/pr/testsets")).toBe(true)
        expect(button("Leave without saving")).toBeDefined()
    })

    it("Discard asks first and then clears the changes", async () => {
        const editor = fakeEditor()
        await mount(editor)
        await click("Discard")

        expect(document.body.textContent).toContain("Discard changes?")
        expect(document.body.textContent).toContain(
            "Are you sure you want to discard all unsaved changes?",
        )
        expect(editor.discard).not.toHaveBeenCalled()

        await click("Discard")
        expect(editor.discard).toHaveBeenCalledTimes(1)
    })

    it("Discard and Import are off for a new testset", async () => {
        await mount(fakeEditor({isNew: true}))
        expect(button("Discard")?.disabled).toBe(true)
        expect(button("Import")?.disabled).toBe(true)
    })

    it("Import is off while rows have unsaved changes, as column changes are", async () => {
        await mount(fakeEditor())
        expect(button("Import")?.disabled).toBe(true)
    })

    it("Import opens the import step when nothing is unsaved", async () => {
        await mount(fakeEditor({hasUnsavedChanges: false, columnEditBlocked: null}))
        expect(button("Import")?.disabled).toBe(false)
        await click("Import")
        expect(onImport).toHaveBeenCalledTimes(1)
    })

    it("Every toolbar action is off while a save runs", async () => {
        await mount(fakeEditor({isSaving: true}))
        expect(button("Add row")?.disabled).toBe(true)
        expect(button("Discard")?.disabled).toBe(true)
        expect(button("Commit")?.disabled).toBe(true)
        expect(button("Import")?.disabled).toBe(true)
    })

    it("A reader who may not edit sees no toolbar and no leave prompt", async () => {
        await mount(fakeEditor(), false)
        expect(button("Commit")).toBeUndefined()
        expect(button("Add row")).toBeUndefined()
        expect(button("Import")).toBeUndefined()
        expect(router.handlers.size).toBe(0)
    })

    it("Add row adds a local row and hands its id to the page", async () => {
        const onRowAdded = vi.fn()
        const editor = fakeEditor()
        await act(() =>
            root.render(
                <ToolbarHost
                    editor={editor}
                    routeId="rev-2"
                    base="/w/ws/p/pr"
                    canEdit
                    revisions={{latestVersion: 5, load: vi.fn(), status: "ready"}}
                    onRowAdded={onRowAdded}
                />,
            ),
        )
        await click("Add row")
        expect(onRowAdded).toHaveBeenCalledWith("new-1")
    })
})

describe("Commit preview", () => {
    it("builds both sides of the preview and counts the changes", () => {
        const diff = buildChangesDiff({
            updated: [{id: "a", before: {q: "old"}, after: {q: "new"}}],
            added: [{id: "new-1", after: {q: "fresh"}}],
            deleted: [{id: "b", before: {q: "gone"}}],
            columns: {
                added: ["country"],
                removed: [],
                renamed: [{oldKey: "q", newKey: "question"}],
            },
        })
        expect(diff?.count).toBe(5)
        expect(diff?.original).toEqual({rows: {a: {q: "old"}, b: {q: "gone"}}, columns: ["q"]})
        expect(diff?.modified).toEqual({
            rows: {a: {q: "new"}, "new row 1": {q: "fresh"}},
            columns: ["question", "country"],
        })
    })

    it("returns nothing when nothing changed", () => {
        expect(
            buildChangesDiff({
                updated: [],
                added: [],
                deleted: [],
                columns: {added: [], removed: [], renamed: []},
            }),
        ).toBeNull()
    })
})
