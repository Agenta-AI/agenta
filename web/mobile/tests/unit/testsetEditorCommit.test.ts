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
            const rows = serverRows()
            return {data: {count: rows.length, testcases: rows, windowing: {next: null}}}
        }
        if (url.endsWith("/testsets/revisions/commit")) {
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
            return {
                data: {
                    count: 1,
                    testset_revisions: [
                        {
                            id: REVISION,
                            testset_id: TESTSET,
                            testset_variant_id: VARIANT,
                            version: "2",
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

/** The body of the commit request, or null when none was sent. */
const commitBody = () => {
    const call = http.post.mock.calls.find(([url]) =>
        String(url).endsWith("/testsets/revisions/commit"),
    )
    return call
        ? (call[1] as {
              testset_revision: {
                  delta: {
                      rows?: {
                          replace?: {id: string; data: Record<string, unknown>}[]
                          add?: {data: Record<string, unknown>}[]
                          remove?: string[]
                      }
                      columns?: Record<string, unknown>
                  }
              }
          })
        : null
}

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

    it("A column renamed after a row edit sends the edited row under the new name", async () => {
        await mount()
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {answer: "14 days"}}))
        expect(run(() => editor().renameColumn("answer", "reply"))).toEqual({ok: true})

        await commit()

        const delta = commitBody()?.testset_revision.delta
        expect(delta?.columns).toEqual({replace: [["answer", "reply"]]})
        expect(delta?.rows?.replace).toEqual([
            {
                id: "case-1",
                data: {question: "What is the refund window?", reply: "14 days"},
                set_id: TESTSET,
            },
        ])
    })

    it("A column renamed after a new row is added sends the new row under the new name", async () => {
        await mount()
        const rowId = run(() => editor().addRow())
        run(() =>
            store.set(testcaseMolecule.actions.update, rowId ?? "", {
                data: {question: "Is gift wrap free?", answer: "No"},
            }),
        )
        run(() => editor().renameColumn("answer", "reply"))

        await commit()

        expect(commitBody()?.testset_revision.delta.rows?.add).toEqual([
            {data: {question: "Is gift wrap free?", reply: "No"}, set_id: TESTSET},
        ])
    })

    it("A rename to a name another pending rename took is refused", async () => {
        await mount()
        expect(run(() => editor().renameColumn("question", "prompt"))).toEqual({ok: true})
        expect(run(() => editor().renameColumn("answer", "prompt"))).toEqual({
            ok: false,
            reason: "duplicate",
        })
        expect(store.get(revisionMolecule.atoms.pendingColumnOps(REVISION)).rename).toEqual([
            {oldKey: "question", newKey: "prompt"},
        ])
    })

    it("A rename with edits before and after it sends every row under the new name", async () => {
        await mount()
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {answer: "14 days"}}))
        expect(run(() => editor().renameColumn("answer", "reply"))).toEqual({ok: true})
        run(() => store.set(testcaseMolecule.actions.update, "case-2", {data: {reply: "No"}}))
        const rowId = run(() => editor().addRow())
        run(() =>
            store.set(testcaseMolecule.actions.update, rowId ?? "", {
                data: {question: "Is gift wrap free?", reply: "Yes"},
            }),
        )

        await commit()

        const delta = commitBody()?.testset_revision.delta
        expect(delta?.columns).toEqual({replace: [["answer", "reply"]]})
        expect(delta?.rows?.replace).toEqual([
            {
                id: "case-1",
                data: {question: "What is the refund window?", reply: "14 days"},
                set_id: TESTSET,
            },
            {id: "case-2", data: {question: "Do you ship abroad?", reply: "No"}, set_id: TESTSET},
        ])
        expect(delta?.rows?.add).toEqual([
            {data: {question: "Is gift wrap free?", reply: "Yes"}, set_id: TESTSET},
        ])
    })

    it("The old name of a renamed column cannot name a new column before a save", async () => {
        await mount()
        run(() => editor().renameColumn("answer", "reply"))

        expect(run(() => editor().addColumn("answer"))).toEqual({
            ok: false,
            reason: "pendingRenameName",
            message:
                'The name "answer" is part of the unsaved rename of "answer" to "reply". Save first to use it.',
        })
        const rowId = run(() => editor().addRow())
        run(() =>
            store.set(testcaseMolecule.actions.update, rowId ?? "", {
                data: {question: "Is gift wrap free?", reply: "No"},
            }),
        )

        await commit()

        const delta = commitBody()?.testset_revision.delta
        expect(delta?.columns).toEqual({replace: [["answer", "reply"]]})
        expect(delta?.rows?.add).toEqual([
            {data: {question: "Is gift wrap free?", reply: "No"}, set_id: TESTSET},
        ])
    })

    it("The old name of a renamed column cannot be another column's new name", async () => {
        await mount()
        run(() => editor().renameColumn("answer", "reply"))

        expect(run(() => editor().renameColumn("question", "answer"))).toMatchObject({
            ok: false,
            reason: "pendingRenameName",
        })
        expect(store.get(revisionMolecule.atoms.pendingColumnOps(REVISION)).rename).toEqual([
            {oldKey: "answer", newKey: "reply"},
        ])
    })

    it("A renamed column cannot be renamed again before a save", async () => {
        await mount()
        run(() => editor().renameColumn("answer", "reply"))
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {reply: "14 days"}}))

        expect(editor().renameBlocked("reply")).toBe("Save first to rename this column again")
        expect(editor().renameBlocked("question")).toBeNull()
        expect(run(() => editor().renameColumn("reply", "response"))).toEqual({
            ok: false,
            reason: "renamed",
            message: "Save first to rename this column again",
        })

        await commit()

        const delta = commitBody()?.testset_revision.delta
        expect(delta?.columns).toEqual({replace: [["answer", "reply"]]})
        expect(delta?.rows?.replace).toEqual([
            {
                id: "case-1",
                data: {question: "What is the refund window?", reply: "14 days"},
                set_id: TESTSET,
            },
        ])
    })

    it("A column added in this session cannot be renamed before a save", async () => {
        await mount()
        run(() => editor().addColumn("country"))
        const rowId = run(() => editor().addRow())
        run(() =>
            store.set(testcaseMolecule.actions.update, rowId ?? "", {
                data: {question: "Is gift wrap free?", answer: "No", country: "France"},
            }),
        )

        const message =
            "Save first to rename a new column, or delete it and add it again with the new name"
        expect(editor().renameBlocked("country")).toBe(message)
        expect(run(() => editor().renameColumn("country", "region"))).toEqual({
            ok: false,
            reason: "added",
            message,
        })

        await commit()

        const delta = commitBody()?.testset_revision.delta
        expect(delta?.columns).toEqual({add: ["country"]})
        expect(delta?.rows?.add).toEqual([
            {
                data: {question: "Is gift wrap free?", answer: "No", country: "France"},
                set_id: TESTSET,
            },
        ])
    })

    it("Discard after a rename sends the next edit under the saved names", async () => {
        await mount()
        run(() => store.set(testcaseMolecule.actions.update, "case-1", {data: {answer: "14 days"}}))
        run(() => editor().renameColumn("answer", "reply"))
        run(() => editor().addColumn("country"))
        const rowId = run(() => editor().addRow())
        run(() => store.set(testcaseMolecule.actions.update, rowId ?? "", {data: {reply: "Yes"}}))

        act(() => editor().discard())
        await flush()

        expect(editor().hasUnsavedChanges).toBe(false)
        expect(store.get(revisionMolecule.atoms.pendingColumnOps(REVISION))).toMatchObject({
            add: [],
            remove: [],
            rename: [],
        })
        expect(store.get(testcaseMolecule.atoms.draft(rowId ?? ""))).toBeNull()
        expect(editor().renameBlocked("answer")).toBeNull()

        run(() => store.set(testcaseMolecule.actions.update, "case-2", {data: {answer: "No"}}))
        await commit()

        const delta = commitBody()?.testset_revision.delta
        expect(delta?.columns).toBeUndefined()
        expect(delta?.rows?.replace).toEqual([
            {id: "case-2", data: {question: "Do you ship abroad?", answer: "No"}, set_id: TESTSET},
        ])
        expect(delta?.rows?.add).toBeUndefined()
    })

    it("The column list follows a pending rename and a pending removal", async () => {
        await mount()
        // The same selector the table reads its headers from.
        const columnKeys = () =>
            store
                .get(testcaseDataController.selectors.columns(editor().tableConfig))
                .map((column) => column.key)
        expect(columnKeys()).toEqual(["question", "answer"])

        run(() => editor().renameColumn("question", "prompt"))
        run(() => editor().deleteColumn("answer"))

        expect(columnKeys()).toEqual(["prompt"])
        expect(run(() => editor().addColumn("answer"))).toEqual({ok: true})
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

    it("A commit refreshes the loaded revisions list", async () => {
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

        run(() => editor().addColumn("country"))
        revisionsInList = [
            {id: NEW_REVISION, version: "3"},
            {id: REVISION, version: "2"},
        ]
        await commit()
        await flush()

        expect(seen.revisions?.latestVersion).toBe(3)
    })
})
