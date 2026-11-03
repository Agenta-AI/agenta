// @vitest-environment jsdom
/**
 * The test set menu model of the playground on the real playground controller, loadable
 * controller and test case store. Only HTTP is mocked, so each save test checks the exact body
 * that would reach the server.
 */
import {act} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {fetchTestcasesPage, testcaseMolecule} from "@agenta/entities/testcase"
import {executionItemController, playgroundController} from "@agenta/playground"
import {useTestsetMenuModel, type TestsetMenuModel} from "@agenta/playground-ui/hooks"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {completionRevision, settle} from "../support/playgroundHarness"

import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
}))
vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))

const TESTSET = "0b9f6c1e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"
const VARIANT = "1c0a7d2f-2d3e-4f40-9b0c-1d2e3f4a5b6c"
const REVISION = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
const OTHER_REVISION = "8b3e4f50-6c7d-4e8f-a091-2c3d4e5f6071"
const COMMITTED_REVISION = "7a2d3e4f-5b6c-4d7e-9f80-1b2c3d4e5f60"
const CREATED_TESTSET = "2d1b8e3f-3e4f-4051-8c1d-2e3f4a5b6c7d"
const CREATED_REVISION = "9c4f5061-7d8e-4f90-b1a2-3d4e5f607182"

const PERU = "a1b2c3d4-0000-4000-8000-000000000003"
/** A third saved row, for the tests that need one. */
let withPeru = false
const savedRows = () => [
    {id: "a1b2c3d4-0000-4000-8000-000000000001", testset_id: TESTSET, data: {country: "France"}},
    {id: "a1b2c3d4-0000-4000-8000-000000000002", testset_id: TESTSET, data: {country: "Italy"}},
    ...(withPeru ? [{id: PERU, testset_id: TESTSET, data: {country: "Peru"}}] : []),
]
const otherRows = () => [
    {id: "b1b2c3d4-0000-4000-8000-000000000003", testset_id: TESTSET, data: {country: "Peru"}},
]
const createdRows = () => [
    {
        id: "c1b2c3d4-0000-4000-8000-000000000004",
        testset_id: CREATED_TESTSET,
        data: {country: "Spain"},
    },
    {
        id: "c1b2c3d4-0000-4000-8000-000000000005",
        testset_id: CREATED_TESTSET,
        data: {country: "Italy"},
    },
]
const [FRANCE, ITALY] = savedRows().map((row) => row.id)

interface CommitBody {
    testset_revision: {
        delta: {
            rows?: {
                replace?: {id: string; data: Record<string, unknown>}[]
                add?: {data: Record<string, unknown>}[]
                remove?: string[]
            }
        }
    }
}

let failCommit = false
let failCreate = false
let failCreatedRows = false

const routeHttp = () => {
    http.get.mockImplementation(async (url: string) => {
        if (url.endsWith(`/testsets/revisions/${REVISION}`)) {
            return {
                data: {
                    testset_revision: {
                        id: REVISION,
                        testset_id: TESTSET,
                        testset_variant_id: VARIANT,
                        name: "Capitals",
                        version: "2",
                    },
                },
            }
        }
        if (url.endsWith(`/testsets/variants/${VARIANT}`)) {
            return {data: {testset_variant: {id: VARIANT, name: "Capitals"}}}
        }
        return {data: {}}
    })
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        if (url.endsWith("/workflows/query")) {
            return {data: {count: 1, workflows: [{id: "app-1", name: "Capitals", flags: {}}]}}
        }
        if (url.endsWith("/workflows/revisions/query")) {
            return {
                data: {
                    count: 1,
                    workflow_revisions: [completionRevision("Capital of {{country}}?")],
                },
            }
        }
        if (url.endsWith("/testcases/query")) {
            const ref = (body.testset_revision_ref as {id: string}).id
            if (ref === CREATED_REVISION && failCreatedRows) {
                throw new Error("Request failed with status code 502")
            }
            const rows =
                ref === REVISION ? savedRows() : ref === CREATED_REVISION ? createdRows() : []
            const testcases = ref === OTHER_REVISION ? otherRows() : rows
            return {data: {count: testcases.length, testcases, windowing: {next: null}}}
        }
        if (url.endsWith("/testsets/revisions/query") && body.testset_revision_refs) {
            const refs = body.testset_revision_refs as {id: string}[]
            return {
                data: {
                    count: refs.length,
                    testset_revisions: refs.map(({id}) => ({
                        id,
                        testset_id: id === CREATED_REVISION ? CREATED_TESTSET : TESTSET,
                        testset_variant_id: VARIANT,
                        version: id === COMMITTED_REVISION ? "3" : "2",
                    })),
                },
            }
        }
        if (url.endsWith("/testsets/revisions/commit")) {
            if (failCommit) throw new Error("Request failed with status code 500")
            // The server applies the delta to the saved rows. A test case never changes: an edited
            // row comes back with a new id.
            const rows = (body as unknown as CommitBody).testset_revision.delta.rows ?? {}
            const replaced = new Map((rows.replace ?? []).map((row) => [row.id, row.data]))
            const testcases = [
                ...savedRows()
                    .filter((row) => !(rows.remove ?? []).includes(row.id))
                    .map((row, index) => {
                        const data = replaced.get(row.id)
                        const edited = data && JSON.stringify(data) !== JSON.stringify(row.data)
                        return edited
                            ? {
                                  id: `e1b2c3d4-0000-4000-8000-00000000020${index}`,
                                  testset_id: TESTSET,
                                  data,
                              }
                            : row
                    }),
                ...(rows.add ?? []).map((row, index) => ({
                    id: `d1b2c3d4-0000-4000-8000-00000000010${index}`,
                    testset_id: TESTSET,
                    data: row.data,
                })),
            ]
            return {
                data: {
                    testset_revision: {id: COMMITTED_REVISION, version: "3", data: {testcases}},
                },
            }
        }
        if (url.endsWith("/simple/testsets/")) {
            if (failCreate) throw new Error("Request failed with status code 500")
            return {
                data: {
                    testset: {
                        id: CREATED_TESTSET,
                        name: "Capitals copy",
                        slug: "capitals-copy",
                        revision_id: CREATED_REVISION,
                    },
                },
            }
        }
        return {data: {}}
    })
}

/** What the dialog hands over in manage mode. */
const picked = (revisionId: string, testcaseIds: string[]) => ({
    revisionId,
    testcaseIds,
    testsetName: null,
    testsetId: null,
    revisionVersion: null,
})

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let projectId = "proj-500"
let model: TestsetMenuModel | null = null

const Probe = () => {
    model = useTestsetMenuModel()
    return null
}
const Harness = () => {
    const {status} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" ? <Probe /> : null
}

const menu = (): TestsetMenuModel => {
    if (!model) throw new Error("The probe did not render")
    return model
}
const loadableId = () => store.get(playgroundController.selectors.loadableId()) as string
const rowIds = () => store.get(executionItemController.selectors.generationRowIds) as string[]
const rowData = (id: string) =>
    (store.get(testcaseMolecule.data(id)) as {data: Record<string, unknown>} | null)?.data
const rowValues = () => rowIds().map((id) => rowData(id)?.country)
const postsTo = (path: string) => http.post.mock.calls.filter(([url]) => String(url).endsWith(path))

/** The dialog's table loads the picked revision's rows; this does the same. */
const loadRows = async (revisionId: string) => {
    await act(async () => {
        await fetchTestcasesPage({projectId, revisionId})
    })
}
const pickLoad = async (revisionId = REVISION, ids = [FRANCE, ITALY]) => {
    await loadRows(revisionId)
    await act(async () =>
        menu().confirmLoad({
            revisionId,
            testcaseIds: ids,
            testsetName: "Capitals",
            testsetId: TESTSET,
            revisionVersion: 2,
        }),
    )
    await settle()
}
const editCell = async (row: string, value: string) => {
    await act(async () =>
        store.set(executionItemController.actions.setTestcaseCellValue, {
            testcaseId: row,
            column: "country",
            value,
        }),
    )
    await settle()
}
const typeDraft = (value: string) => editCell(rowIds()[0], value)

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    vi.clearAllMocks()
    failCommit = false
    failCreate = false
    failCreatedRows = false
    withPeru = false
    routeHttp()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-1"}
    router.replace.mockResolvedValue(true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => root.render(<Harness />))
    await settle()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    model = null
})

describe("Connecting a test set", () => {
    it("Connecting loads the picked rows and names the test set with its version", async () => {
        expect(menu().visible).toBe(true)
        expect(menu().label).toBe("Test set")
        act(() => menu().connect())
        expect(menu().dialog).toEqual({kind: "load"})

        await pickLoad()

        expect(menu().dialog).toBeNull()
        expect(menu().isConnected).toBe(true)
        expect(menu().label).toBe("Capitals (v2)")
        expect(rowValues()).toEqual(["France", "Italy"])
        // State only: the rows were already loaded by the dialog.
        expect(postsTo("/testsets/revisions/commit")).toHaveLength(0)
    })

    it("Connecting with draft rows asks first, and Keep and load keeps them as new rows", async () => {
        await typeDraft("Japan")

        await pickLoad()

        expect(menu().dialog).toMatchObject({
            kind: "keep-drafts",
            draftCount: 1,
            testsetName: "Capitals",
            chat: false,
        })
        expect(menu().isConnected).toBe(false)

        await act(async () => menu().confirmKeepDrafts(true))
        await settle()

        expect(menu().dialog).toBeNull()
        expect(menu().isConnected).toBe(true)
        expect(rowValues()).toEqual(["France", "Italy", "Japan"])
        expect(rowIds()[2]).toMatch(/^(new|local)-/)
        expect(menu().hasLocalChanges).toBe(true)
    })

    it("Discard drafts connects with the picked rows only", async () => {
        await typeDraft("Japan")
        await pickLoad()

        await act(async () => menu().confirmKeepDrafts(false))
        await settle()

        expect(rowValues()).toEqual(["France", "Italy"])
        expect(menu().hasLocalChanges).toBe(false)
    })
})

describe("Syncing changes", () => {
    it("Sync commit sends the edited and added rows with the message, and keeps a removed row", async () => {
        await pickLoad()
        await editCell(FRANCE, "Spain")
        await act(async () => store.set(loadableController.actions.addRow, loadableId(), {}))
        await settle()
        const added = rowIds()[2]
        await editCell(added, "Japan")
        await act(async () => store.set(loadableController.actions.removeRow, loadableId(), ITALY))
        await settle()
        expect(menu().hasLocalChanges).toBe(true)

        let result: Awaited<ReturnType<TestsetMenuModel["syncSubmit"]>> | undefined
        await act(async () => {
            result = await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: "Fix the capitals",
                mode: "commit",
            })
        })
        await settle()

        expect(result).toEqual({success: true})
        const commits = postsTo("/testsets/revisions/commit")
        expect(commits).toHaveLength(1)
        expect(commits[0][1]).toEqual({
            testset_revision: {
                testset_id: TESTSET,
                revision_id: REVISION,
                message: "Fix the capitals",
                name: undefined,
                description: undefined,
                delta: {
                    columns: undefined,
                    rows: {
                        replace: [{id: FRANCE, data: {country: "Spain"}, set_id: TESTSET}],
                        add: [{data: {country: "Japan"}, set_id: TESTSET}],
                    },
                },
            },
        })
    })

    it("Manage test cases keeps a row added in the playground as one new row", async () => {
        await pickLoad()
        await act(async () => store.set(loadableController.actions.addRow, loadableId(), {}))
        await settle()
        const added = rowIds()[2]
        await editCell(added, "Japan")
        act(() => menu().manage())

        await act(async () => menu().confirmEdit(picked(REVISION, [FRANCE, ITALY, added])))
        await settle()
        expect(rowValues()).toEqual(["France", "Italy", "Japan"])

        await act(async () => {
            await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: null,
                mode: "commit",
            })
        })

        const rows = (
            postsTo("/testsets/revisions/commit")[0][1] as {
                testset_revision: {delta: {rows: {replace?: {id: string}[]; add?: unknown[]}}}
            }
        ).testset_revision.delta.rows
        expect(rows.add).toEqual([{data: {country: "Japan"}, set_id: TESTSET}])
        expect((rows.replace ?? []).map((row) => row.id)).not.toContain(added)
    })

    it("A row added in the playground and then deselected is not committed", async () => {
        await pickLoad()
        await act(async () => store.set(loadableController.actions.addRow, loadableId(), {}))
        await settle()
        await editCell(rowIds()[2], "Japan")
        await editCell(FRANCE, "Spain")
        act(() => menu().manage())
        await act(async () => menu().confirmEdit(picked(REVISION, [FRANCE, ITALY])))
        await settle()
        expect(rowValues()).toEqual(["Spain", "Italy"])

        await act(async () => {
            await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: null,
                mode: "commit",
            })
        })

        const rows = (
            postsTo("/testsets/revisions/commit")[0][1] as {
                testset_revision: {delta: {rows: {add?: unknown[]}}}
            }
        ).testset_revision.delta.rows
        expect(rows.add).toBeUndefined()
    })

    it("A row deselected in an earlier Manage stays out after a second Manage", async () => {
        withPeru = true
        await pickLoad(REVISION, [FRANCE, ITALY, PERU])
        act(() => menu().manage())
        await act(async () => menu().confirmEdit(picked(REVISION, [FRANCE, ITALY])))
        await settle()
        act(() => menu().manage())
        await act(async () => menu().confirmEdit(picked(REVISION, [FRANCE])))
        await settle()
        expect(rowValues()).toEqual(["France"])

        await act(async () => {
            await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: null,
                mode: "commit",
            })
        })

        const rows = (
            postsTo("/testsets/revisions/commit")[0][1] as {
                testset_revision: {delta: {rows: {remove?: string[]}}}
            }
        ).testset_revision.delta.rows
        // Deselected rows stay in the test set.
        expect(rows.remove).toBeUndefined()
        expect(menu().isConnected).toBe(true)
    })

    it("A deselected saved row is not deleted and keeps its saved value", async () => {
        await pickLoad()
        await editCell(ITALY, "Rome")
        act(() => menu().manage())
        await act(async () => menu().confirmEdit(picked(REVISION, [FRANCE])))
        await settle()
        // Deselecting alone is nothing to sync.
        expect(menu().hasLocalChanges).toBe(false)
        await editCell(FRANCE, "Spain")

        await act(async () => {
            await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: null,
                mode: "commit",
            })
        })

        expect(postsTo("/testsets/revisions/commit")[0][1]).toMatchObject({
            testset_revision: {
                delta: {rows: {replace: [{id: FRANCE, data: {country: "Spain"}, set_id: TESTSET}]}},
            },
        })
        const rows = (
            postsTo("/testsets/revisions/commit")[0][1] as {
                testset_revision: {delta: {rows: {remove?: string[]; replace?: {id: string}[]}}}
            }
        ).testset_revision.delta.rows
        expect(rows.remove).toBeUndefined()
        expect((rows.replace ?? []).map((row) => row.id)).toEqual([FRANCE])
    })

    it("After a commit the menu names the new version", async () => {
        await pickLoad()
        await editCell(FRANCE, "Spain")

        await act(async () => {
            await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: null,
                mode: "commit",
            })
        })
        await settle()

        expect(menu().label).toBe("Capitals (v3)")
        expect(menu().connectedRevisionId).toBe(COMMITTED_REVISION)
        expect(menu().hasLocalChanges).toBe(false)
    })

    it("A failed commit shows a plain message and keeps the edits", async () => {
        failCommit = true
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await pickLoad()
        await editCell(FRANCE, "Spain")

        let result: Awaited<ReturnType<TestsetMenuModel["syncSubmit"]>> | undefined
        await act(async () => {
            result = await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: null,
                mode: "commit",
            })
        })
        await settle()

        expect(result).toEqual({success: false, error: "Couldn't save the test set"})
        expect(menu().hasLocalChanges).toBe(true)
        expect(rowData(FRANCE)?.country).toBe("Spain")
        expect(menu().connectedRevisionId).toBe(REVISION)
        consoleError.mockRestore()
    })

    it("Save as new sends every visible row and the name", async () => {
        await pickLoad()
        await editCell(FRANCE, "Spain")

        expect(menu().canSyncSubmit({mode: "save-new", entityName: "  "})).toBe(false)
        expect(menu().canSyncSubmit({mode: "save-new", entityName: "Capitals copy"})).toBe(true)

        let result: Awaited<ReturnType<TestsetMenuModel["syncSubmit"]>> | undefined
        await act(async () => {
            result = await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: "Copy",
                mode: "save-new",
                entityName: " Capitals copy ",
                entitySlug: "capitals-copy",
            })
        })
        await settle()

        expect(result).toEqual({success: true})
        const creates = postsTo("/simple/testsets/")
        expect(creates).toHaveLength(1)
        expect(creates[0][1]).toEqual({
            testset: {
                slug: "capitals-copy",
                name: "Capitals copy",
                data: {testcases: [{data: {country: "Spain"}}, {data: {country: "Italy"}}]},
            },
            message: "Copy",
        })
        expect(postsTo("/testsets/revisions/commit")).toHaveLength(0)
    })

    it("Save as new connects the playground to the new test set", async () => {
        await pickLoad()
        await editCell(FRANCE, "Spain")

        await act(async () => {
            await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: null,
                mode: "save-new",
                entityName: "Capitals copy",
                entitySlug: "capitals-copy",
            })
        })
        await settle()

        expect(menu().connectedRevisionId).toBe(CREATED_REVISION)
        expect(menu().label).toBe("Capitals copy")
        expect(rowValues()).toEqual(["Spain", "Italy"])
        expect(menu().hasLocalChanges).toBe(false)
    })

    it("When the new test set's rows do not load, the rows stay as local rows", async () => {
        failCreatedRows = true
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await pickLoad()
        await editCell(FRANCE, "Spain")

        let result: Awaited<ReturnType<TestsetMenuModel["syncSubmit"]>> | undefined
        await act(async () => {
            result = await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: null,
                mode: "save-new",
                entityName: "Capitals copy",
                entitySlug: "capitals-copy",
            })
        })
        await settle()

        // Saved: the dialog closes and nothing is created twice.
        expect(result).toEqual({success: true})
        expect(postsTo("/simple/testsets/")).toHaveLength(1)
        expect(menu().isConnected).toBe(false)
        expect(rowValues()).toEqual(["Spain", "Italy"])
        consoleError.mockRestore()
    })

    it("A failed save as new keeps the edits and the old connection", async () => {
        failCreate = true
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await pickLoad()
        await editCell(FRANCE, "Spain")

        let result: Awaited<ReturnType<TestsetMenuModel["syncSubmit"]>> | undefined
        await act(async () => {
            result = await menu().syncSubmit({
                entity: {type: "revision", id: REVISION},
                message: null,
                mode: "save-new",
                entityName: "Capitals copy",
            })
        })
        await settle()

        expect(result).toMatchObject({success: false, error: "Couldn't save the test set"})
        expect(menu().connectedRevisionId).toBe(REVISION)
        expect(rowData(FRANCE)?.country).toBe("Spain")
        consoleError.mockRestore()
    })
})

describe("Disconnecting and changing the test set", () => {
    it("Disconnect without edits returns to one empty local row at once", async () => {
        await pickLoad()

        act(() => menu().disconnect())
        await settle()

        expect(menu().dialog).toBeNull()
        expect(menu().isConnected).toBe(false)
        expect(rowIds()).toHaveLength(1)
    })

    it("Save and disconnect commits, then keeps the rows as local rows", async () => {
        await pickLoad()
        await editCell(FRANCE, "Spain")

        act(() => menu().disconnect())
        expect(menu().dialog).toEqual({kind: "unsaved", intent: "disconnect"})

        await act(async () => {
            await menu().resolveUnsaved("save")
        })
        await settle()

        const commits = postsTo("/testsets/revisions/commit")
        expect(commits).toHaveLength(1)
        // Every connected row goes as a replace (the store keeps a copy of each); only the edit
        // changes a value.
        expect(commits[0][1]).toMatchObject({
            testset_revision: {
                revision_id: REVISION,
                message: null,
                delta: {
                    rows: {
                        replace: [
                            {id: FRANCE, data: {country: "Spain"}, set_id: TESTSET},
                            {id: ITALY, data: {country: "Italy"}, set_id: TESTSET},
                        ],
                    },
                },
            },
        })
        expect(menu().dialog).toBeNull()
        expect(menu().isConnected).toBe(false)
        expect(rowValues()).toEqual(["Spain", "Italy"])
        expect(vi.mocked(message.success)).toHaveBeenCalledWith("Test set updated")
    })

    it("A failed save keeps the dialog open and the connection", async () => {
        failCommit = true
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await pickLoad()
        await editCell(FRANCE, "Spain")
        expect(menu().hasLocalChanges).toBe(true)
        act(() => menu().disconnect())

        await act(async () => {
            await menu().resolveUnsaved("save")
        })
        await settle()

        expect(vi.mocked(message.error)).toHaveBeenCalledWith("Couldn't save the test set")
        expect(menu().dialog).toEqual({kind: "unsaved", intent: "disconnect"})
        expect(menu().saving).toBe(false)
        expect(menu().isConnected).toBe(true)
        expect(rowData(FRANCE)?.country).toBe("Spain")
        consoleError.mockRestore()
    })

    it("Discard and disconnect resets to one empty local row without a request", async () => {
        await pickLoad()
        await editCell(FRANCE, "Spain")
        act(() => menu().disconnect())

        await act(async () => {
            await menu().resolveUnsaved("discard")
        })
        await settle()

        expect(postsTo("/testsets/revisions/commit")).toHaveLength(0)
        expect(postsTo("/simple/testsets/")).toHaveLength(0)
        expect(menu().isConnected).toBe(false)
        expect(rowIds()).toHaveLength(1)
        expect(rowData(rowIds()[0])?.country ?? "").toBe("")
    })

    it("Cancelling the load after Discard and Load keeps the connected test set", async () => {
        await pickLoad()
        await editCell(FRANCE, "Spain")

        act(() => menu().change())
        expect(menu().dialog).toEqual({kind: "unsaved", intent: "change"})
        await act(async () => {
            await menu().resolveUnsaved("discard")
        })
        expect(menu().dialog).toMatchObject({kind: "load"})

        act(() => menu().close())
        await settle()

        expect(menu().isConnected).toBe(true)
        expect(menu().connectedRevisionId).toBe(REVISION)
        expect(rowValues()).toEqual(["Spain", "Italy"])
        expect(menu().hasLocalChanges).toBe(true)
    })

    it("Discard and Load replaces the edited rows once a new test set is confirmed", async () => {
        await pickLoad()
        await editCell(FRANCE, "Spain")
        act(() => menu().change())
        await act(async () => {
            await menu().resolveUnsaved("discard")
        })

        await pickLoad(
            OTHER_REVISION,
            otherRows().map((row) => row.id),
        )

        expect(menu().connectedRevisionId).toBe(OTHER_REVISION)
        expect(rowValues()).toEqual(["Peru"])
        expect(menu().hasLocalChanges).toBe(false)
        expect(rowData(FRANCE)?.country).toBe("France")
    })

    it("Change test set without edits opens the load dialog at once", async () => {
        await pickLoad()

        act(() => menu().change())

        expect(menu().dialog).toEqual({kind: "load"})
    })
})

describe("Managing the test cases", () => {
    it("Manage test cases with the same revision updates the selection only", async () => {
        await pickLoad()

        act(() => menu().manage())
        expect(menu().dialog).toEqual({kind: "edit"})

        await act(async () => menu().confirmEdit(picked(REVISION, [ITALY])))
        await settle()

        expect(menu().dialog).toBeNull()
        expect(menu().connectedRevisionId).toBe(REVISION)
        expect(rowValues()).toEqual(["Italy"])
    })

    it("Picking another revision in manage imports rows without connecting", async () => {
        await pickLoad()
        act(() => menu().manage())
        await loadRows(OTHER_REVISION)

        await act(async () =>
            menu().confirmEdit(
                picked(
                    OTHER_REVISION,
                    otherRows().map((row) => row.id),
                ),
            ),
        )
        await settle()

        expect(menu().connectedRevisionId).toBe(REVISION)
        expect(rowValues()).toEqual(["France", "Italy", "Peru"])
        expect(rowIds()[2]).toMatch(/^(new|local)-/)
    })
})
