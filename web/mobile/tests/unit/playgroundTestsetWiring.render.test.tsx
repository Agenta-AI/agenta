// @vitest-environment jsdom
/**
 * The test set menu inside the playground run pane, on the real controllers with only HTTP
 * mocked: the sync dialog sends the typed message, the dialogs load on demand, and leaving the
 * page asks first and then clears the connected test set.
 */
import {act} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {executionItemController, playgroundController} from "@agenta/playground"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    button,
    click,
    completionRevision,
    settle,
    stubResizeObserver,
    typeInto,
} from "../support/playgroundHarness"

import {PlaygroundRunPane} from "@/features/playground/PlaygroundRunPane"
import {usePlaygroundLeaveGuard} from "@/features/playground/usePlaygroundLeaveGuard"
import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

const {http, router, loads} = vi.hoisted(() => {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
    return {
        http: {post: vi.fn(), get: vi.fn()},
        loads: {testsets: 0},
        router: {
            isReady: true,
            pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
            query: {} as Record<string, string>,
            replace: vi.fn(),
            push: vi.fn(),
            events: {
                on: (name: string, handler: (...args: unknown[]) => void) => {
                    if (!handlers.has(name)) handlers.set(name, new Set())
                    handlers.get(name)!.add(handler)
                },
                off: (name: string, handler: (...args: unknown[]) => void) =>
                    handlers.get(name)?.delete(handler),
                emit: (name: string, ...args: unknown[]) =>
                    handlers.get(name)?.forEach((handler) => handler(...args)),
            },
        },
    }
})
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
// Counts how often the dialogs' module is loaded.
vi.mock("@agenta/playground-ui/panels/testsets", async (original) => {
    loads.testsets += 1
    return original()
})

const TESTSET = "0b9f6c1e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"
const VARIANT = "1c0a7d2f-2d3e-4f40-9b0c-1d2e3f4a5b6c"
const REVISION = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
const COMMITTED_REVISION = "7a2d3e4f-5b6c-4d7e-9f80-1b2c3d4e5f60"
const FRANCE = "a1b2c3d4-0000-4000-8000-000000000001"
const ITALY = "a1b2c3d4-0000-4000-8000-000000000002"
const savedRows = () => [
    {id: FRANCE, testset_id: TESTSET, data: {country: "France"}},
    {id: ITALY, testset_id: TESTSET, data: {country: "Italy"}},
]

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
        if (url.endsWith("/testsets/revisions/query") && body.testset_revision_refs) {
            const refs = body.testset_revision_refs as {id: string}[]
            return {
                data: {
                    count: refs.length,
                    testset_revisions: refs.map(({id}) => ({
                        id,
                        testset_id: TESTSET,
                        testset_variant_id: VARIANT,
                        version: id === COMMITTED_REVISION ? "3" : "2",
                    })),
                },
            }
        }
        if (url.endsWith("/testsets/revisions/commit")) {
            return {
                data: {
                    testset_revision: {
                        id: COMMITTED_REVISION,
                        version: "3",
                        data: {
                            testcases: [
                                {
                                    id: "e1b2c3d4-0000-4000-8000-000000000201",
                                    testset_id: TESTSET,
                                    data: {country: "Spain"},
                                },
                                savedRows()[1],
                            ],
                        },
                    },
                },
            }
        }
        return {data: {}}
    })
}

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let projectId = "proj-900"
let leaveDialog: React.ReactNode = null

const Screen = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-1"})
    leaveDialog = usePlaygroundLeaveGuard()
    return (
        <>
            {status === "ready" && primaryRevisionId ? (
                <PlaygroundRunPane revisionId={primaryRevisionId} />
            ) : null}
            {leaveDialog}
        </>
    )
}
const mount = async () => {
    act(() =>
        root.render(
            <QueryClientProvider client={store.get(queryClientAtom)}>
                <Screen />
            </QueryClientProvider>,
        ),
    )
    await settle()
}

const loadableId = () => store.get(playgroundController.selectors.loadableId()) as string
const rowIds = () => store.get(executionItemController.selectors.generationRowIds) as string[]
const connect = async () => {
    await act(async () =>
        store.set(playgroundController.actions.connectToTestset, {
            loadableId: loadableId(),
            revisionId: REVISION,
            testcases: savedRows(),
            testsetName: "Capitals",
            testsetId: TESTSET,
            revisionVersion: 2,
        }),
    )
    await settle()
}
const editFrance = async () => {
    await act(async () =>
        store.set(executionItemController.actions.setTestcaseCellValue, {
            testcaseId: FRANCE,
            column: "country",
            value: "Spain",
        }),
    )
    await settle()
}
const openMenu = async () => {
    const trigger = button(host, "Capitals (v2)") ?? button(host, "Test set")
    expect(trigger, "the test set menu").toBeDefined()
    await act(async () => {
        trigger!.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
    await settle()
}
const menuItem = async (label: string) => {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (element) => element.textContent === label,
    )
    expect(item, `a menu item named ${label}`).toBeDefined()
    await act(async () => item!.click())
    await settle()
}
const leave = () => {
    try {
        router.events.emit("routeChangeStart", "/w/ws-1/p/proj/apps", {shallow: false})
        return "left"
    } catch {
        return "stopped"
    }
}

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    stubResizeObserver()
    vi.clearAllMocks()
    loads.testsets = 0
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
    await mount()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("The test set menu in the run pane", () => {
    it("The dialogs' code loads only when one opens", async () => {
        await connect()
        await editFrance()
        expect(button(host, "Capitals (v2)")).toBeDefined()
        expect(loads.testsets).toBe(0)

        await openMenu()
        await menuItem("Disconnect")

        expect(loads.testsets).toBe(1)
        expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
            "Save changes?",
        )
    })

    it("Sync changes commits through the dialog with the typed message", async () => {
        await connect()
        await editFrance()

        await openMenu()
        await menuItem("Sync changes")
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
        expect(dialog).not.toBeNull()
        const messageField = dialog.querySelector<HTMLTextAreaElement>(
            'textarea[placeholder="Describe your changes..."]',
        )!
        await typeInto(messageField, "Fix France")
        await settle()
        await click(dialog, "Commit")

        const commits = http.post.mock.calls.filter(([url]) =>
            String(url).endsWith("/testsets/revisions/commit"),
        )
        expect(commits).toHaveLength(1)
        expect(commits[0][1]).toEqual({
            testset_revision: {
                testset_id: TESTSET,
                revision_id: REVISION,
                message: "Fix France",
                name: undefined,
                description: undefined,
                delta: {
                    columns: undefined,
                    rows: {
                        replace: [
                            {id: FRANCE, data: {country: "Spain"}, set_id: TESTSET},
                            {id: ITALY, data: {country: "Italy"}, set_id: TESTSET},
                        ],
                    },
                },
            },
        })
        expect(button(host, "Capitals (v3)")).toBeDefined()
    })

    it("The sync dialog counts a saved row unchecked in Manage as deleted, and the commit deletes it", async () => {
        await connect()
        await act(async () =>
            store.set(loadableController.actions.updateTestcaseSelection, loadableId(), [FRANCE]),
        )
        await settle()

        await openMenu()
        await menuItem("Sync changes")
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
        expect(dialog.textContent).toContain("1 testcase deleted")
        await click(dialog, "Commit")

        const commits = http.post.mock.calls.filter(([url]) =>
            String(url).endsWith("/testsets/revisions/commit"),
        )
        expect(commits).toHaveLength(1)
        expect(
            (commits[0][1] as {testset_revision: {delta: {rows: {remove?: string[]}}}})
                .testset_revision.delta.rows.remove,
        ).toEqual([ITALY])
    })

    it("Leaving with unsaved test set edits asks first", async () => {
        await connect()
        expect(leave()).toBe("left")

        await editFrance()
        let outcome = ""
        await act(async () => {
            outcome = leave()
        })
        await settle()

        expect(outcome).toBe("stopped")
        expect(document.body.textContent).toContain("Discard unsaved changes?")
    })

    it("Leaving drops the edits of a row deselected in Manage", async () => {
        await connect()
        await editFrance()
        await act(async () =>
            store.set(loadableController.actions.updateTestcaseSelection, loadableId(), [ITALY]),
        )
        await settle()

        act(() => root.unmount())
        root = createRoot(host)

        expect(store.get(testcaseMolecule.atoms.draft(FRANCE))).toBeNull()
    })

    it("Leaving clears the connected test set", async () => {
        await connect()
        await editFrance()
        const id = loadableId()

        act(() => root.unmount())
        root = createRoot(host)

        expect(store.get(loadableController.selectors.mode(id))).toBe("local")
        expect(store.get(testcaseMolecule.atoms.ids)).toEqual([])
        expect(store.get(testcaseMolecule.atoms.newIds)).toEqual([])
        expect(store.get(testcaseMolecule.atoms.isDirty(FRANCE))).toBe(false)

        // Coming back starts with one empty local row.
        await mount()
        expect(button(host, "Test set")).toBeDefined()
        expect(rowIds()).toHaveLength(1)
    })
})
