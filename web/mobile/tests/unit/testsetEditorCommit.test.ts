// @vitest-environment jsdom
/**
 * The Test set editor over the real package state: the real save atoms, the real testcase
 * table data controller and the real paginated store. Only the HTTP client is replaced, so each
 * test checks the commit body that would reach the server.
 */
import {act, createElement} from "react"

import {testcaseDataController, testcaseMolecule} from "@agenta/entities/testcase"
import {revisionMolecule} from "@agenta/entities/testset"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useRevisionsList} from "@/features/testsets/detail/useRevisionsList"
import {useTestsetEditor} from "@/features/testsets/detail/useTestsetEditor"

const http = vi.hoisted(() => ({get: vi.fn(), post: vi.fn(), put: vi.fn()}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
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

let rowsOnServer = serverRows()
let failFullRevision = false
let failCommit = false
let revisionsInList: {id: string; version: string}[] = []

/** Answers each request the package sends, by URL. */
const routeHttp = () => {
    http.get.mockImplementation(async (url: string) => {
        if (url.endsWith(`/testsets/revisions/${REVISION}`)) {
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
            const rows = rowsOnServer
            return {data: {count: rows.length, testcases: rows, windowing: {next: null}}}
        }
        if (url.endsWith("/simple/testsets/")) {
            return {
                data: {
                    testset: {id: TESTSET, name: "Refund questions", revision_id: "rev-created"},
                },
            }
        }
        if (url.endsWith("/testsets/revisions/commit")) {
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
                            data: {
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
        failFullRevision = false
        failCommit = false
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

        expect(await act(() => editor().deleteColumn("answer"))).toEqual({
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
        expect(await act(() => editor().deleteColumn("answer"))).toEqual(refusal)

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

            await act(() => editor().deleteColumn("country"))
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

            await act(() => editor().deleteColumn("question"))
            expect(await act(() => editor().renameColumn("answer", "question"))).toEqual({
                ok: true,
                revisionId: null,
            })

            await commit()
            expect(createdRows()).toEqual([{data: {question: "No"}}])
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
