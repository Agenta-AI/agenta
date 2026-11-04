// @vitest-environment jsdom
/**
 * The Test set editor over the real package state: the real save atoms, the real testcase
 * table data controller and the real paginated store. Only the HTTP client is replaced, so each
 * test checks the commit body that would reach the server.
 */
import {act, createElement} from "react"

import {
    loadMoreTestcasesAtom,
    testcaseDataController,
    testcaseMolecule,
} from "@agenta/entities/testcase"
import {revisionMolecule} from "@agenta/entities/testset"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TestcaseEditorDrawerContent} from "@/features/testsets/detail/TestcaseEditorDrawerContent"
import {useRevisionsList} from "@/features/testsets/detail/useRevisionsList"
import {useTestsetEditor} from "@/features/testsets/detail/useTestsetEditor"

const http = vi.hoisted(() => ({get: vi.fn(), post: vi.fn(), put: vi.fn()}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
}))
/**
 * The JSON code input inside the drawer. Only this Lexical input is a stub: the drawer and the
 * package `TestcaseDataEditor` around it are real, so their projection and merge run.
 */
const jsonInput = vi.hoisted(() => ({
    text: "",
    type: null as null | ((text: string) => void),
}))
vi.mock("@agenta/ui/drill-in", async (original) => ({
    ...(await original<object>()),
    JsonEditorWithLocalState: (props: {
        initialValue: string
        onValidChange: (text: string) => void
    }) => {
        jsonInput.text = props.initialValue
        jsonInput.type = props.onValidChange
        return null
    },
}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT = "project-1"
const TESTSET = "0b9f6c1e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"
const VARIANT = "1c0a7d2f-2d3e-4f40-9b0c-1d2e3f4a5b6c"
const REVISION = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
const NEW_REVISION = "7a2d3e4f-5b6c-4d7e-9f80-1b2c3d4e5f60"

/** The saved rows of the revision, as the server sends them. */
const serverRows = () => [
    {id: "case-1", data: {question: "What is the refund window?", answer: "30 days"}},
    {id: "case-2", data: {question: "Do you ship abroad?", answer: "Yes"}},
]

/** 25 rows; only row 23 has a "reply" column, past the 20 rows the table reads columns from. */
const manyRows = () =>
    Array.from({length: 25}, (_, index) => ({
        id: `case-${index + 1}`,
        data:
            index === 22
                ? {question: `Question ${index + 1}`, answer: "Yes", reply: "Old reply"}
                : {question: `Question ${index + 1}`, answer: "Yes"},
    }))

let rowsOnServer: {id: string; data: Record<string, unknown>}[] = serverRows()
/** When set, the rows query answers this many rows per page and a cursor for the rest. */
let rowsPerPage: number | null = null
let failFullRevision = false
let failCommit = false
let revisionsInList: {id: string; version: string}[] = []
/** The `data` of the full revision, when a test needs a shape other than `rowsOnServer`. */
let fullRevisionData: Record<string, unknown> | null | undefined = undefined
/** While set, the revision read and the commit request wait for it, so a test can act then. */
let hold: Promise<void> | null = null

/** Answers each request the package sends, by URL. */
const routeHttp = () => {
    http.get.mockImplementation(async (url: string) => {
        if (url.endsWith(`/testsets/revisions/${REVISION}`)) {
            await hold
            return {
                data: {
                    testset_revision: {
                        id: REVISION,
                        testset_id: TESTSET,
                        testset_variant_id: VARIANT,
                        name: "Refund questions",
                        version: "2",
                    },
                },
            }
        }
        if (url.endsWith(`/testsets/variants/${VARIANT}`)) {
            return {data: {testset_variant: {id: VARIANT, name: "Refund questions"}}}
        }
        throw new Error(`Unexpected GET ${url}`)
    })
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        if (url.endsWith("/testcases/query") && body.testset_revision_ref) {
            // The cursor is the index of the next row. A page loaded by an earlier test in the
            // same scope asks again with its cursor, and gets only the rows past it.
            const cursor = (body.windowing as {next?: string} | undefined)?.next
            const start = cursor ? Number(cursor) : 0
            const rows = rowsOnServer.slice(start, start + (rowsPerPage ?? rowsOnServer.length))
            const end = start + rows.length
            return {
                data: {
                    count: rows.length,
                    testcases: rows,
                    windowing: {next: end < rowsOnServer.length ? String(end) : null},
                },
            }
        }
        if (url.endsWith("/simple/testsets/")) {
            return {
                data: {
                    testset: {id: TESTSET, name: "Refund questions", revision_id: "rev-created"},
                },
            }
        }
        if (url.endsWith("/testsets/revisions/commit")) {
            await hold
            if (failCommit) throw new Error("Request failed with status code 500")
            return {
                data: {
                    testset_revision: {
                        id: NEW_REVISION,
                        version: "3",
                        data: {testcases: [{id: "case-9", data: {}}]},
                    },
                },
            }
        }
        if (url.endsWith("/testsets/revisions/query") && body.testset_revision_refs) {
            if (failFullRevision) throw new Error("Request failed with status code 500")
            return {
                data: {
                    count: 1,
                    testset_revisions: [
                        {
                            id: REVISION,
                            testset_id: TESTSET,
                            testset_variant_id: VARIANT,
                            version: "2",
                            data:
                                fullRevisionData !== undefined
                                    ? fullRevisionData
                                    : {
                                          testcase_ids: rowsOnServer.map((row) => row.id),
                                          testcases: rowsOnServer,
                                      },
                        },
                    ],
                },
            }
        }
        if (url.endsWith("/testsets/revisions/query") && body.testset_refs) {
            return {
                data: {
                    count: revisionsInList.length,
                    testset_revisions: revisionsInList.map((revision) => ({
                        ...revision,
                        testset_id: TESTSET,
                    })),
                },
            }
        }
        if (url.endsWith("/testsets/query")) {
            return {
                data: {count: 1, testsets: [{id: TESTSET, name: "Refund questions"}]},
            }
        }
        throw new Error(`Unexpected POST ${url}`)
    })
}

interface CommitBody {
    testset_revision: {
        testset_id: string
        revision_id?: string
        delta: {
            rows?: {
                replace?: {id: string; data: Record<string, unknown>}[]
                add?: {data: Record<string, unknown>}[]
                remove?: string[]
            }
            columns?: Record<string, unknown>
        }
    }
}

/** The bodies of every commit request sent. */
const commitBodies = (): CommitBody[] =>
    http.post.mock.calls
        .filter(([url]) => String(url).endsWith("/testsets/revisions/commit"))
        .map(([, body]) => body as CommitBody)

/** The body of the first commit request, or null when none was sent. */
const commitBody = (): CommitBody | null => commitBodies()[0] ?? null

type Editor = ReturnType<typeof useTestsetEditor>
let latest: Editor | null = null
const editor = (): Editor => {
    if (!latest) throw new Error("The probe did not render")
    return latest
}

function Probe({routeId}: {routeId: string}) {
    latest = useTestsetEditor({projectId: PROJECT, routeId, nameFromUrl: "Refund questions"})
    return null
}

const store = getDefaultStore()

const flush = async () => {
    for (let round = 0; round < 10; round++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
}

describe("useTestsetEditor commit over the real package state", () => {
    let root: Root
    let host: HTMLDivElement
    let queryClient: QueryClient

    const mount = async (routeId = REVISION) => {
        act(() =>
            root.render(
                createElement(
                    QueryClientProvider,
                    {client: queryClient},
                    createElement(Probe, {routeId}),
                ),
            ),
        )
        await flush()
    }

    const run = <T>(action: () => T): T => {
        let result: T | undefined
        act(() => {
            result = action()
        })
        return result as T
    }

    const commit = async () => {
        let id: string | null = null
        await act(async () => {
            id = await editor().commit("Edited rows")
        })
        return id
    }

    beforeEach(() => {
        vi.clearAllMocks()
        revisionsInList = []
        rowsOnServer = serverRows()
        rowsPerPage = null
        failFullRevision = false
        failCommit = false
        fullRevisionData = undefined
        hold = null
        routeHttp()
        queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        store.set(queryClientAtom, queryClient)
        store.set(projectIdAtom, PROJECT)
        store.set(sessionAtom, true)
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        latest = null
    })

    it("An edit to a saved row is sent as a row replace", async () => {
        await mount()
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {answer: "14 days"}}))
        expect(editor().changesSummary.updatedTestcases).toBe(1)

        expect(await commit()).toBe(NEW_REVISION)

        expect(commitBody()?.testset_revision.delta.rows?.replace).toEqual([
            {
                id: "case-1",
                data: {question: "What is the refund window?", answer: "14 days"},
                set_id: TESTSET,
            },
        ])
    })

    it("An edit to a saved row on the second page is sent as a row replace", async () => {
        rowsOnServer = manyRows()
        rowsPerPage = 20
        await mount()
        const rowIds = () =>
            store
                .get(testcaseDataController.selectors.rows(editor().tableConfig))
                .map((row) => row.id)
        expect(rowIds()).toHaveLength(20)

        // The grid calls this when the reader scrolls near the end.
        act(() => store.set(loadMoreTestcasesAtom, editor().tableConfig))
        await flush()
        expect(rowIds()).toHaveLength(25)

        run(() => store.set(testcaseMolecule.actions.update, "case-23", {data: {answer: "No"}}))
        expect(editor().changesSummary.updatedTestcases).toBe(1)

        expect(await commit()).toBe(NEW_REVISION)

        expect(commitBody()?.testset_revision.delta).toEqual({
            columns: undefined,
            rows: {
                replace: [
                    {
                        id: "case-23",
                        data: {question: "Question 23", answer: "No", reply: "Old reply"},
                        set_id: TESTSET,
                    },
                ],
            },
        })
    })

    /** Opens the drawer on a row in the JSON view, as the page does. */
    const openDrawerJson = async (testcaseId: string) => {
        await mount()
        act(() =>
            root.render(
                createElement(
                    QueryClientProvider,
                    {client: queryClient},
                    createElement(Probe, {routeId: REVISION}),
                    createElement(TestcaseEditorDrawerContent, {
                        testcaseId,
                        isNewRow: false,
                        viewOnly: false,
                        initialPath: [],
                        onPathChange: () => undefined,
                        rootViewMode: "json",
                        collapseSignal: 0,
                    }),
                ),
            ),
        )
        await flush()
    }

    /** Types the given object into the JSON view. */
    const typeJson = (value: Record<string, unknown>) =>
        act(() => jsonInput.type?.(JSON.stringify(value, null, 2)))

    it("A JSON edit in the drawer keeps an untouched null field null", async () => {
        rowsOnServer = [{id: "case-1", data: {question: "Q", answer: null}}]
        await openDrawerJson("case-1")
        expect(JSON.parse(jsonInput.text)).toEqual({question: "Q", answer: null})

        typeJson({question: "Q2", answer: null})
        expect(await commit()).toBe(NEW_REVISION)

        expect(commitBody()?.testset_revision.delta).toEqual({
            columns: undefined,
            rows: {
                replace: [{id: "case-1", data: {question: "Q2", answer: null}, set_id: TESTSET}],
            },
        })
    })

    it("A field added in the drawer JSON is saved and a field removed there is dropped", async () => {
        await openDrawerJson("case-2")

        typeJson({answer: "Only to Canada", region: "North America"})
        expect(await commit()).toBe(NEW_REVISION)

        expect(commitBody()?.testset_revision.delta).toEqual({
            columns: undefined,
            rows: {
                replace: [
                    {
                        id: "case-2",
                        data: {answer: "Only to Canada", region: "North America"},
                        set_id: TESTSET,
                    },
                ],
            },
        })
    })

    it("A field that only a row past the first 20 has shows in the drawer", async () => {
        rowsOnServer = manyRows()
        await openDrawerJson("case-23")

        expect(JSON.parse(jsonInput.text)).toEqual({
            question: "Question 23",
            answer: "Yes",
            reply: "Old reply",
        })
    })

    it("Rename saves at once as its own version with only the rename", async () => {
        await mount()

        expect(await act(() => editor().renameColumn("answer", " reply "))).toEqual({
            ok: true,
            revisionId: NEW_REVISION,
        })

        expect(commitBodies()).toHaveLength(1)
        expect(commitBody()?.testset_revision).toMatchObject({
            testset_id: TESTSET,
            revision_id: REVISION,
            delta: {columns: {replace: [["answer", "reply"]]}},
        })
        expect(commitBody()?.testset_revision.delta.rows).toBeUndefined()
        expect(store.get(revisionMolecule.atoms.pendingColumnOps(REVISION))).toMatchObject({
            add: [],
            remove: [],
            rename: [],
        })
    })

    it("Delete saves at once as its own version with only the removal", async () => {
        await mount()

        expect(await act(() => editor().deleteColumns(["answer"]))).toEqual({
            ok: true,
            revisionId: NEW_REVISION,
        })

        expect(commitBodies()).toHaveLength(1)
        expect(commitBody()?.testset_revision.revision_id).toBe(REVISION)
        expect(commitBody()?.testset_revision.delta).toEqual({
            rows: undefined,
            columns: {remove: ["answer"]},
        })
    })

    it("Deleting columns saves one version that removes them all", async () => {
        rowsOnServer = [{id: "case-1", data: {question: "Q", answer: "A", meta: {lang: "en"}}}]
        await mount()

        expect(await act(() => editor().deleteColumns(["answer", "meta"]))).toEqual({
            ok: true,
            revisionId: NEW_REVISION,
        })

        expect(commitBodies()).toHaveLength(1)
        expect(commitBody()?.testset_revision.delta).toEqual({
            rows: undefined,
            columns: {remove: ["answer", "meta"]},
        })
    })

    it("Add saves at once as its own version with only the new column", async () => {
        await mount()

        expect(await act(() => editor().addColumn(" country "))).toEqual({
            ok: true,
            revisionId: NEW_REVISION,
        })

        expect(commitBodies()).toHaveLength(1)
        expect(commitBody()?.testset_revision.revision_id).toBe(REVISION)
        expect(commitBody()?.testset_revision.delta).toEqual({
            rows: undefined,
            columns: {add: ["country"]},
        })
    })

    it("Column actions are refused while rows have unsaved edits", async () => {
        await mount()
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {answer: "14 days"}}))

        const refusal = {
            ok: false,
            reason: "rowChanges",
            message: "Save or discard your row changes first",
        }
        expect(editor().columnEditBlocked).toBe("Save or discard your row changes first")
        expect(await act(() => editor().renameColumn("answer", "reply"))).toEqual(refusal)
        expect(await act(() => editor().addColumn("country"))).toEqual(refusal)
        expect(await act(() => editor().deleteColumns(["answer"]))).toEqual(refusal)

        expect(commitBodies()).toHaveLength(0)
        expect(store.get(revisionMolecule.atoms.pendingColumnOps(REVISION))).toMatchObject({
            add: [],
            remove: [],
            rename: [],
        })
        expect(editor().changesSummary.updatedTestcases).toBe(1)
    })

    it("A new row also blocks column actions until it is saved or discarded", async () => {
        await mount()
        run(() => editor().addRow())

        expect(editor().columnEditBlocked).toBe("Save or discard your row changes first")
        expect(await act(() => editor().addColumn("country"))).toMatchObject({
            ok: false,
            reason: "rowChanges",
        })
        expect(commitBodies()).toHaveLength(0)

        act(() => editor().discard())
        expect(editor().columnEditBlocked).toBeNull()
    })

    it("A rename to a name used only by a row past the first 20 is refused", async () => {
        rowsOnServer = manyRows()
        await mount()
        // The loaded column list does not know the name: it reads only the first 20 rows.
        const columnKeys = store
            .get(testcaseDataController.selectors.columns(editor().tableConfig))
            .map((column) => column.key)
        expect(columnKeys).not.toContain("reply")

        expect(await act(() => editor().renameColumn("answer", "reply"))).toEqual({
            ok: false,
            reason: "duplicate",
        })
        expect(await act(() => editor().addColumn("reply"))).toEqual({
            ok: false,
            reason: "duplicate",
        })
        expect(commitBodies()).toHaveLength(0)
    })

    it("A rename is refused when the full column list cannot be read", async () => {
        failFullRevision = true
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()

        expect(await act(() => editor().renameColumn("answer", "reply"))).toEqual({
            ok: false,
            reason: "columnsUnknown",
            message: "Could not check the column names. Try again.",
        })
        expect(commitBodies()).toHaveLength(0)
        errors.mockRestore()
    })

    it("A failed column save leaves no pending column change behind", async () => {
        failCommit = true
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()

        expect(await act(() => editor().renameColumn("answer", "reply"))).toEqual({
            ok: false,
            reason: "failed",
            message: "Failed to save changes",
        })

        expect(store.get(revisionMolecule.atoms.pendingColumnOps(REVISION))).toMatchObject({
            add: [],
            remove: [],
            rename: [],
        })
        expect(editor().hasUnsavedChanges).toBe(false)
        expect(editor().isSaving).toBe(false)
        errors.mockRestore()
    })

    it("A rename with an empty or unchanged name sends nothing", async () => {
        await mount()

        expect(await act(() => editor().renameColumn("answer", "  "))).toEqual({
            ok: false,
            reason: "empty",
        })
        expect(await act(() => editor().renameColumn("answer", " answer "))).toEqual({
            ok: false,
            reason: "unchanged",
        })
        expect(commitBodies()).toHaveLength(0)
    })

    it("Row edits and a new row still commit together with Save", async () => {
        await mount()
        run(() => store.set(testcaseMolecule.actions.update, "case-2", {data: {answer: "No"}}))
        const rowId = run(() => editor().addRow())
        run(() =>
            store.set(testcaseMolecule.actions.update, rowId ?? "", {
                data: {question: "Is gift wrap free?", answer: "Yes"},
            }),
        )
        run(() => editor().deleteRows(["case-1"]))

        expect(await commit()).toBe(NEW_REVISION)

        expect(commitBody()?.testset_revision.delta).toEqual({
            columns: undefined,
            rows: {
                replace: [
                    {
                        id: "case-2",
                        data: {question: "Do you ship abroad?", answer: "No"},
                        set_id: TESTSET,
                    },
                ],
                add: [{data: {question: "Is gift wrap free?", answer: "Yes"}, set_id: TESTSET}],
                remove: ["case-1"],
            },
        })
    })

    /** Holds the next revision read and commit until the returned function is called. */
    const holdRequests = () => {
        let release = () => undefined as void
        hold = new Promise<void>((resolve) => {
            release = () => {
                hold = null
                resolve()
            }
        })
        return release
    }

    it("While a column saves, the editor is read only and a row edit stays out of it", async () => {
        await mount()
        const release = holdRequests()
        let saving: Promise<unknown> = Promise.resolve()
        act(() => {
            saving = editor().renameColumn("answer", "reply")
        })
        await flush()

        expect(editor().isSaving).toBe(true)
        expect(editor().readOnly).toBe(true)
        expect(editor().columnEditBlocked).not.toBeNull()
        expect(run(() => editor().addRow())).toBeNull()
        run(() => editor().deleteRows(["case-1"]))
        expect(store.get(testcaseMolecule.newIds)).toEqual([])
        // A cell editor that writes to the store directly: its edit must not join the save.
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {answer: "14 days"}}))

        await act(async () => {
            release()
            await saving
        })

        expect(commitBodies()).toHaveLength(1)
        expect(commitBody()?.testset_revision.delta).toEqual({
            rows: undefined,
            columns: {replace: [["answer", "reply"]]},
        })
        expect(editor().readOnly).toBe(false)
    })

    it("A failed column save keeps a row edit made while it ran", async () => {
        failCommit = true
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        const release = holdRequests()
        let saving: Promise<unknown> = Promise.resolve()
        act(() => {
            saving = editor().deleteColumns(["answer"])
        })
        await flush()
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {answer: "14 days"}}))

        await act(async () => {
            release()
            await saving
        })

        expect(editor().changesSummary.updatedTestcases).toBe(1)
        expect(store.get(revisionMolecule.atoms.pendingColumnOps(REVISION))).toMatchObject({
            add: [],
            remove: [],
            rename: [],
        })
        errors.mockRestore()
    })

    it("A second click while a column saves sends nothing more", async () => {
        await mount()
        const release = holdRequests()
        let first: Promise<unknown> = Promise.resolve()
        let second: Promise<unknown> = Promise.resolve()
        act(() => {
            first = editor().addColumn("country")
            second = editor().addColumn("country")
        })
        let commitResult: string | null = "unset"
        await act(async () => {
            commitResult = await editor().commit("x")
        })

        await act(async () => {
            release()
            await first
        })

        expect(await second).toMatchObject({ok: false, reason: "saving"})
        expect(commitResult).toBeNull()
        expect(commitBodies()).toHaveLength(1)
        expect(commitBody()?.testset_revision.delta.columns).toEqual({add: ["country"]})
    })

    it("A nested name used only by a row past the first 20 is refused", async () => {
        rowsOnServer = manyRows().map((row, index) =>
            index === 22 ? {id: row.id, data: {question: "Q", parent: {child: "keep"}}} : row,
        )
        await mount()

        expect(await act(() => editor().addColumn("parent.child"))).toEqual({
            ok: false,
            reason: "duplicate",
        })
        expect(await act(() => editor().renameColumn("answer", "parent.child"))).toEqual({
            ok: false,
            reason: "duplicate",
        })
        expect(commitBodies()).toHaveLength(0)
    })

    it.each([
        ["with no rows", {testcase_ids: []}],
        ["saved with no data", null],
    ])("A column change on a revision %s is refused and sends nothing", async (_name, data) => {
        rowsOnServer = []
        fullRevisionData = data
        await mount()

        const refused = {
            ok: false,
            reason: "noRows",
            message: "Add a row first, then add columns",
        }
        expect(await act(() => editor().addColumn("country"))).toEqual(refused)
        expect(await act(() => editor().renameColumn("answer", "reply"))).toEqual(refused)
        expect(await act(() => editor().deleteColumns(["answer"]))).toEqual(refused)
        expect(commitBodies()).toHaveLength(0)
    })

    describe("on a new test set", () => {
        const createdRows = () => {
            const call = http.post.mock.calls.find(([url]) =>
                String(url).endsWith("/simple/testsets/"),
            )
            return (call?.[1] as {testset: {data: {testcases: unknown[]}}} | undefined)?.testset
                .data.testcases
        }

        it("Columns change before the first save, and the rows follow them", async () => {
            await mount("new")
            expect(editor().columnEditBlocked).toBeNull()
            expect(await act(() => editor().addColumn("question"))).toEqual({
                ok: true,
                revisionId: null,
            })
            await act(() => editor().addColumn("answer"))
            const rowId = run(() => editor().addRow())
            run(() =>
                store.set(testcaseMolecule.actions.update, rowId ?? "", {
                    data: {question: "Is gift wrap free?", answer: "No"},
                }),
            )
            expect(editor().columnEditBlocked).toBeNull()

            expect(await act(() => editor().renameColumn("answer", "reply"))).toEqual({
                ok: true,
                revisionId: null,
            })
            expect(await act(() => editor().addColumn("reply"))).toEqual({
                ok: false,
                reason: "duplicate",
            })
            expect(commitBodies()).toHaveLength(0)

            expect(await commit()).toBe("rev-created")
            expect(createdRows()).toEqual([{data: {question: "Is gift wrap free?", reply: "No"}}])
        })

        it("A deleted column takes its values with it, also when added again", async () => {
            await mount("new")
            await act(() => editor().addColumn("question"))
            await act(() => editor().addColumn("country"))
            const rowId = run(() => editor().addRow())
            run(() =>
                store.set(testcaseMolecule.actions.update, rowId ?? "", {
                    data: {question: "Is gift wrap free?", country: "France"},
                }),
            )

            await act(() => editor().deleteColumns(["country"]))
            await act(() => editor().addColumn("country"))

            await commit()
            expect(createdRows()).toEqual([{data: {question: "Is gift wrap free?", country: ""}}])
        })

        it("A column can take the name of a deleted column and keep its own values", async () => {
            await mount("new")
            await act(() => editor().addColumn("question"))
            await act(() => editor().addColumn("answer"))
            const rowId = run(() => editor().addRow())
            run(() =>
                store.set(testcaseMolecule.actions.update, rowId ?? "", {
                    data: {question: "Is gift wrap free?", answer: "No"},
                }),
            )

            await act(() => editor().deleteColumns(["question"]))
            expect(await act(() => editor().renameColumn("answer", "question"))).toEqual({
                ok: true,
                revisionId: null,
            })

            await commit()
            expect(createdRows()).toEqual([{data: {question: "No"}}])
        })

        it("A row-only column can be deleted and its name given to another column", async () => {
            await mount("new")
            const rowId = run(() => editor().addRow())
            // "a" lives only in the row, never in the column list.
            run(() => store.set(testcaseMolecule.actions.update, rowId ?? "", {data: {a: "old"}}))
            await act(() => editor().addColumn("b"))
            run(() => store.set(testcaseMolecule.actions.update, rowId ?? "", {data: {b: "keep"}}))

            await act(() => editor().deleteColumns(["a"]))
            expect(await act(() => editor().renameColumn("b", "a"))).toEqual({
                ok: true,
                revisionId: null,
            })

            await commit()
            expect(createdRows()).toEqual([{data: {a: "keep"}}])
        })

        it("A rename to a name held only by a row past row 20 is refused", async () => {
            await mount("new")
            await act(() => editor().addColumn("a"))
            const ids = Array.from({length: 21}, () => run(() => editor().addRow()) ?? "")
            ids.forEach((id, index) =>
                run(() =>
                    store.set(testcaseMolecule.actions.update, id, {
                        data: index === 20 ? {a: "replacement", b: "keep"} : {a: `row ${index}`},
                    }),
                ),
            )

            expect(await act(() => editor().renameColumn("a", "b"))).toEqual({
                ok: false,
                reason: "duplicate",
            })
            expect(await act(() => editor().addColumn("b"))).toEqual({
                ok: false,
                reason: "duplicate",
            })
        })
    })

    it("Discard drops the edit of a row that was then deleted", async () => {
        await mount()
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {answer: "14 days"}}))
        run(() => editor().deleteRows(["case-1"]))

        act(() => editor().discard())
        await flush()

        expect(store.get(testcaseMolecule.atoms.draft("case-1"))).toBeNull()
        expect(editor().hasUnsavedChanges).toBe(false)
    })

    it("Leaving the page drops the edit of a row that was then deleted", async () => {
        await mount()
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {answer: "14 days"}}))
        run(() => editor().deleteRows(["case-1"]))

        act(() => root.unmount())
        root = createRoot(host)

        expect(store.get(testcaseMolecule.atoms.draft("case-1"))).toBeNull()
    })

    it("A column save refreshes the loaded revisions list", async () => {
        revisionsInList = [{id: REVISION, version: "2"}]
        const seen: {revisions: ReturnType<typeof useRevisionsList> | null} = {revisions: null}
        function RevisionsProbe() {
            seen.revisions = useRevisionsList({projectId: PROJECT, testsetId: TESTSET})
            return createElement(Probe, {routeId: REVISION})
        }
        act(() =>
            root.render(
                createElement(
                    QueryClientProvider,
                    {client: queryClient},
                    createElement(RevisionsProbe),
                ),
            ),
        )
        await flush()
        act(() => seen.revisions?.load())
        await flush()
        expect(seen.revisions?.latestVersion).toBe(2)

        revisionsInList = [
            {id: NEW_REVISION, version: "3"},
            {id: REVISION, version: "2"},
        ]
        await act(() => editor().addColumn("country"))
        await flush()

        expect(seen.revisions?.latestVersion).toBe(3)
    })
})
