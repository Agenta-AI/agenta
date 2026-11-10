// @vitest-environment jsdom
/**
 * "Create a new test set" (a file drop) in the load dialog of the playground, on the real controllers with only
 * HTTP mocked: the M3 create dialog uploads a file, the playground connects to the new revision,
 * and a cancel returns to the load dialog.
 */
import {act} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {playgroundController} from "@agenta/playground"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundRunPane} from "@/features/playground/PlaygroundRunPane"
import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

import {
    button,
    click,
    completionRevision,
    settle,
    stubResizeObserver,
} from "../support/playgroundHarness"

import {polyfillBlobText, stubFetchHttp, type RecordedFetch} from "./testsetHttp"

const {http, router, loads} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    loads: {create: 0},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        replace: vi.fn(),
        push: vi.fn(),
        events: {on: vi.fn(), off: vi.fn(), emit: vi.fn()},
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
// Counts how often the create dialog's module is loaded.
vi.mock("@/features/testsets/create/CreateTestsetDialog", async (original) => {
    loads.create += 1
    return original()
})
polyfillBlobText()

const TESTSET = "0b9f6c1e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"
const VARIANT = "1c0a7d2f-2d3e-4f40-9b0c-1d2e3f4a5b6c"
const NEW_REVISION = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
const FRANCE = "a1b2c3d4-0000-4000-8000-000000000001"
const ITALY = "a1b2c3d4-0000-4000-8000-000000000002"

const routeHttp = () => {
    http.get.mockImplementation(async (url: string) => {
        if (url.endsWith(`/testsets/revisions/${NEW_REVISION}`)) {
            return {
                data: {
                    testset_revision: {
                        id: NEW_REVISION,
                        testset_id: TESTSET,
                        testset_variant_id: VARIANT,
                        name: "Capitals",
                        version: "1",
                    },
                },
            }
        }
        if (url.endsWith(`/testsets/variants/${VARIANT}`)) {
            return {data: {testset_variant: {id: VARIANT, name: "Capitals"}}}
        }
        return {data: {}}
    })
    http.post.mockImplementation(async (url: string) => {
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
            return {
                data: {
                    count: 2,
                    testcases: [
                        {id: FRANCE, testset_id: TESTSET, data: {country: "France"}},
                        {id: ITALY, testset_id: TESTSET, data: {country: "Italy"}},
                    ],
                },
            }
        }
        if (url.endsWith("/testsets/revisions/query")) {
            return {
                data: {
                    count: 1,
                    testset_revisions: [
                        {
                            id: NEW_REVISION,
                            testset_id: TESTSET,
                            testset_variant_id: VARIANT,
                            version: "1",
                        },
                    ],
                },
            }
        }
        return {data: {}}
    })
}

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let projectId = "proj-700"
let uploads: RecordedFetch[]

const Screen = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" && primaryRevisionId ? (
        <PlaygroundRunPane revisionId={primaryRevisionId} />
    ) : null
}

const loadableId = () => store.get(playgroundController.selectors.loadableId()) as string
const openLoadDialog = async () => {
    const trigger = button(host, "Test set")
    expect(trigger, "the test set menu").toBeDefined()
    await act(async () => {
        trigger!.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
    await settle()
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (element) => element.textContent === "Connect test set",
    )
    await act(async () => item!.click())
    await settle()
}
const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
const topDialog = () => dialogs()[dialogs().length - 1]
/** Drops a CSV on the load dialog's "Create a new test set" area: the create dialog opens with it. */
const dropFile = async (fileName: string) => {
    const input = topDialog().querySelector<HTMLInputElement>('[data-testid="testset-file-input"]')!
    Object.defineProperty(input, "files", {
        value: [new File(["country\nFrance\nItaly"], fileName)],
        configurable: true,
    })
    await act(async () => {
        input.dispatchEvent(new Event("change", {bubbles: true}))
    })
    await settle()
}
const nameAndCreate = async (name: string) => {
    const field = document.querySelector<HTMLInputElement>("#upload-testset-name")!
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        setter.call(field, name)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
    await click(topDialog(), "Create test set")
    await settle()
}

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    stubResizeObserver()
    vi.clearAllMocks()
    routeHttp()
    uploads = stubFetchHttp(() => ({
        data: {testset: {id: TESTSET, revision_id: NEW_REVISION}},
    }))
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-1"}
    router.replace.mockResolvedValue(true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() =>
        root.render(
            <QueryClientProvider client={store.get(queryClientAtom)}>
                <Screen />
            </QueryClientProvider>,
        ),
    )
    await settle()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("Create a new test set from the load dialog", () => {
    // Keep this test first: the module loads once per file, and the count needs a fresh start.
    it("The create dialog's code loads only when it opens", async () => {
        await openLoadDialog()
        expect(loads.create).toBe(0)
        await dropFile("capitals.csv")
        expect(loads.create).toBe(1)
    })

    it("Create and load uploads the file and connects the playground to the new revision", async () => {
        await openLoadDialog()
        await dropFile("capitals.csv")
        await nameAndCreate("  Capitals  ")

        const [request] = uploads.filter((item) => item.url.includes("/simple/testsets/upload"))
        expect(new URL(request.url).searchParams.get("project_id")).toBe(projectId)
        expect(request.form?.file_type).toBe("csv")
        expect(request.form?.testset_name).toBe("Capitals")
        expect(Object.keys(request.form ?? {}).sort()).toEqual([
            "file",
            "file_type",
            "testset_name",
        ])

        const queries = http.post.mock.calls.filter(([url]) =>
            String(url).endsWith("/testcases/query"),
        )
        expect(queries.map(([, body]) => body)).toEqual([
            {testset_revision_ref: {id: NEW_REVISION}, windowing: {limit: 50}},
            {testcase_ids: [FRANCE, ITALY]},
        ])
        expect(store.get(loadableController.selectors.connectedSource(loadableId()))).toMatchObject(
            {id: NEW_REVISION},
        )
        expect(button(host, "Capitals")).toBeDefined()
        expect(dialogs()).toHaveLength(0)
        expect(router.push).not.toHaveBeenCalled()
    })

    it("Create and load keeps the draft rows as new rows", async () => {
        await act(async () =>
            store.set(loadableController.actions.addRow, loadableId(), {country: "Brazil"}),
        )
        await settle()
        await openLoadDialog()
        await dropFile("capitals.csv")
        await nameAndCreate("Capitals")
        expect(document.body.textContent).toContain("Keep your draft test cases?")
        await click(document.body, "Keep and load")
        await settle()

        const rows = store.get(loadableController.selectors.rows(loadableId())) as {
            id: string
            data: Record<string, unknown>
        }[]
        expect(rows.map((row) => row.data.country)).toEqual(
            expect.arrayContaining(["France", "Italy", "Brazil"]),
        )
        expect(store.get(loadableController.selectors.hasLocalChanges(loadableId()))).toBe(true)
    })

    it("Rows that fail to load connect nothing and tell the reader", async () => {
        const answer = http.post.getMockImplementation()!
        http.post.mockImplementation(async (url: string, body: unknown) => {
            if (url.endsWith("/testcases/query")) throw new Error("Request failed with status 500")
            return answer(url, body)
        })
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        await openLoadDialog()
        await dropFile("capitals.csv")
        await nameAndCreate("Capitals")

        expect(message.error).toHaveBeenCalledWith("The test set was created, but it did not load")
        expect(store.get(loadableController.selectors.connectedSource(loadableId()))).toMatchObject(
            {id: null},
        )
        expect(button(host, "Test set")).toBeDefined()
    })

    it("Cancel returns to the load dialog and connects nothing", async () => {
        await openLoadDialog()
        await dropFile("capitals.csv")
        expect(topDialog().textContent).toContain("Create new test set")
        await click(topDialog(), "Close")
        await settle()

        expect(dialogs()).toHaveLength(1)
        expect(topDialog().textContent).toContain("Load test set")
        expect(uploads.filter((item) => item.url.includes("/upload"))).toHaveLength(0)
        expect(button(host, "Test set")).toBeDefined()
    })

    it("The dropped file opens the create dialog with the file and its name, upload only", async () => {
        await openLoadDialog()
        expect(topDialog().textContent).toContain("Create a new test set")
        await dropFile("capitals.csv")

        expect(topDialog().textContent).toContain("capitals.csv")
        expect(document.querySelector<HTMLInputElement>("#upload-testset-name")?.value).toBe(
            "capitals",
        )
        expect(topDialog().textContent).not.toContain("New via UI")
        expect(topDialog().textContent).not.toContain("Create via API")
    })
})
