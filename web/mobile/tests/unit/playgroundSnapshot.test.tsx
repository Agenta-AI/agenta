// @vitest-environment jsdom
/**
 * The playground address keeps the work: the `#pgSnapshot` hash brings drafts and test cases back
 * after a reload or in a shared link, and an app opens on its last selection. Real playground
 * controller, real workflow queries, real snapshot codec; only HTTP is mocked.
 */
import {act} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {encodeSnapshot, type PlaygroundSnapshot} from "@agenta/playground/snapshot"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    usePlaygroundSelection,
    type PlaygroundSelection,
} from "@/features/playground/usePlaygroundSelection"

const {http, router, routeListeners} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    /** Router event listeners by event name, as `router.events` keeps them. */
    routeListeners: new Map<string, Set<(url: string, options: {shallow: boolean}) => void>>(),
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        asPath: "/",
        replace: vi.fn(),
        events: {
            on: (name: string, listener: (url: string, options: {shallow: boolean}) => void) => {
                if (!routeListeners.has(name)) routeListeners.set(name, new Set())
                routeListeners.get(name)?.add(listener)
            },
            off: (name: string, listener: (url: string, options: {shallow: boolean}) => void) =>
                routeListeners.get(name)?.delete(listener),
        },
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

// A new project per test: query keys carry the project, so no test reads another's cache.
let projectId = "proj-0"
const revision = (id: string, workflowId: string, version: number, flags = {}) => ({
    id,
    version,
    name: "default",
    workflow_id: workflowId,
    workflow_variant_id: `${workflowId}-variant`,
    flags,
    created_at: `2026-11-0${version}T00:00:00Z`,
    data: {uri: "agenta:builtin:completion:v0", parameters: {}},
})
const apps: Record<string, object> = {
    "app-1": {id: "app-1", name: "Greeter", flags: {}},
    "app-2": {id: "app-2", name: "Translator", flags: {}},
    "agent-app": {id: "agent-app", name: "Helper", flags: {}},
}
const revisions = [
    revision("rev-1", "app-1", 1),
    revision("rev-2", "app-1", 2),
    revision("rev-x", "app-2", 1),
    revision("rev-a", "agent-app", 1, {is_agent: true}),
    revision("rev-b", "agent-app", 2, {is_agent: true}),
]
/** Revisions one test adds to the fixtures above. */
let added: (Omit<ReturnType<typeof revision>, "data"> & {data: object | null})[] = []
let failRevisions = false
/** While set, the app request waits for it, so a test can answer the revisions first. */
let holdApp: Promise<void> | null = null

http.post.mockImplementation(async (url: string, body: Record<string, {id: string}[]>) => {
    if (url.endsWith("/workflows/query")) {
        await holdApp
        const ids = (body.workflow_refs ?? []).map((ref) => ref.id)
        return {data: {count: 1, workflows: ids.flatMap((id) => apps[id] ?? [])}}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        if (failRevisions) throw new Error("network down")
        const byId = (body.workflow_revision_refs ?? []).map((ref) => ref.id)
        const byApp = (body.workflow_refs ?? []).map((ref) => ref.id)
        // Newest first, as the server orders them.
        let found = [...revisions, ...added]
            .filter((item) => byId.includes(item.id) || byApp.includes(item.workflow_id))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
        const limit = (body as {windowing?: {limit?: number}}).windowing?.limit
        if (limit) found = found.slice(0, limit)
        return {data: {count: found.length, workflow_revisions: found}}
    }
    return {data: {}}
})
http.get.mockResolvedValue({data: {}})

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let selection: PlaygroundSelection

const Harness = ({appId}: {appId: string}) => {
    selection = usePlaygroundSelection({appId})
    return null
}

const settle = async () => {
    for (let i = 0; i < 30; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}

/** The address bar's hash, as the hook reads it on mount. */
const setHash = (hash: string) => {
    window.history.replaceState(null, "", hash ? `/playground#${hash}` : "/playground")
}

const mount = async (appId: string, revisionsParam?: string) => {
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: appId}
    if (revisionsParam) router.query.revisions = revisionsParam
    act(() => root.render(<Harness appId={appId} />))
    await settle()
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    failRevisions = false
    holdApp = null
    added = []
    router.replace.mockReset()
    router.replace.mockImplementation(
        async ({query, hash}: {query: Record<string, string>; hash?: string}) => {
            router.query = query
            setHash(hash ?? "")
            return true
        },
    )
    setHash("")
    window.localStorage.clear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    // Leaving keeps the edits of a saved revision; the next test starts without them.
    store.set(workflowMolecule.actions.discard, "rev-1")
    host.remove()
})

/** Emits a router event to the page's listeners. */
const emitRoute = (name: string, url: string, shallow: boolean) =>
    act(() => {
        for (const listener of routeListeners.get(name) ?? []) listener(url, {shallow})
    })

const snapshotHash = (snapshot: Omit<PlaygroundSnapshot, "v">) => {
    const encoded = encodeSnapshot({v: 2, ...snapshot} as PlaygroundSnapshot)
    if (!encoded.ok || !encoded.encoded) throw new Error("snapshot did not encode")
    return `pgSnapshot=${encoded.encoded}`
}

const parameters = (id: string) =>
    (store.get(workflowMolecule.selectors.data(id))?.data as {parameters?: object} | undefined)
        ?.parameters

const firstRowData = () => {
    const loadableId = store.get(playgroundController.selectors.loadableId())
    const rows = store.get(loadableController.selectors.rows(loadableId ?? "")) as {id: string}[]
    return rows.map((row) => store.get(testcaseMolecule.data(row.id))?.data)
}

describe("playground snapshot", () => {
    it("A reload brings the drafts and test cases back from the hash", async () => {
        await mount("app-1", "rev-1")
        const loadableId = store.get(playgroundController.selectors.loadableId())!
        const [row] = store.get(loadableController.selectors.rows(loadableId)) as {id: string}[]
        act(() => {
            workflowMolecule.set.update("rev-1", {
                data: {uri: "agenta:builtin:completion:v0", parameters: {temperature: 0.9}},
            })
            store.set(testcaseMolecule.actions.update, row.id, {data: {country: "Peru"}})
        })
        await settle()

        const written = window.location.hash
        expect(written.startsWith("#pgSnapshot=")).toBe(true)
        expect(router.query.revisions).toBe("rev-1")

        // A reload starts from an empty store: only the address keeps the drafts.
        act(() => root.render(null))
        act(() => store.set(workflowMolecule.actions.discard, "rev-1"))
        expect(store.get(workflowMolecule.selectors.isDirty("rev-1"))).toBe(false)

        setHash(written.slice(1))
        await mount("app-1", "rev-1")

        expect(selection.revisionIds).toEqual(["rev-1"])
        expect(selection.status).toBe("ready")
        expect(store.get(workflowMolecule.selectors.isDirty("rev-1"))).toBe(true)
        expect(parameters("rev-1")).toEqual({temperature: 0.9})
        expect(firstRowData()).toEqual([{country: "Peru"}])
    })

    it("A shared link with two copies of one revision opens both", async () => {
        setHash(
            snapshotHash({
                selection: [
                    {kind: "draft", draftKey: "dk-1", runnableType: "workflow"},
                    {kind: "draft", draftKey: "dk-2", runnableType: "workflow"},
                ],
                drafts: [
                    {
                        draftKey: "dk-1",
                        sourceRevisionId: "rev-1",
                        runnableType: "workflow",
                        patch: {parameters: {temperature: 0.5}},
                    },
                    {
                        draftKey: "dk-2",
                        sourceRevisionId: "rev-1",
                        runnableType: "workflow",
                        patch: {parameters: {temperature: 0.7}},
                    },
                ],
            }),
        )
        await mount("app-1", "rev-1,rev-1")

        const [first, second] = selection.revisionIds
        expect(selection.revisionIds).toHaveLength(2)
        expect(first).toBe("rev-1")
        expect(second.startsWith("local-")).toBe(true)
        expect(parameters("rev-1")).toEqual({temperature: 0.5})
        expect(parameters(second)).toEqual({temperature: 0.7})
    })

    it("A broken snapshot is ignored and the revisions in the address open", async () => {
        setHash("pgSnapshot=not-a-snapshot")
        await mount("app-1", "rev-1")

        expect(selection.revisionIds).toEqual(["rev-1"])
        expect(selection.status).toBe("ready")
        expect(store.get(workflowMolecule.selectors.isDirty("rev-1"))).toBe(false)
    })

    it("A snapshot of another app's revision is dropped for the latest revision", async () => {
        setHash(
            snapshotHash({
                selection: [{kind: "commit", id: "rev-x", runnableType: "workflow"}],
                drafts: [],
            }),
        )
        await mount("app-1")

        expect(selection.revisionIds).toEqual(["rev-2"])
        expect(selection.status).toBe("ready")
    })

    it("A snapshot of a revision that no longer exists is dropped for the latest revision", async () => {
        setHash(
            snapshotHash({
                selection: [{kind: "draft", draftKey: "dk-1", runnableType: "workflow"}],
                drafts: [
                    {
                        draftKey: "dk-1",
                        sourceRevisionId: "rev-gone",
                        runnableType: "workflow",
                        patch: {parameters: {temperature: 0.5}},
                    },
                ],
            }),
        )
        await mount("app-1")

        expect(selection.revisionIds).toEqual(["rev-2"])
        expect(selection.status).toBe("ready")
    })
})

describe("last selection per app", () => {
    it("An app opens on the revisions it showed last", async () => {
        await mount("app-1", "rev-1")
        act(() => root.render(null))
        // A plain link: no hash from the visit before.
        setHash("")

        await mount("app-1")

        expect(selection.revisionIds).toEqual(["rev-1"])
    })

    it("Each app keeps its own last selection", async () => {
        await mount("app-1", "rev-1")
        act(() => root.render(null))
        // A plain link: no hash from the visit before.
        setHash("")

        await mount("app-2")

        expect(selection.revisionIds).toEqual(["rev-x"])
    })

    it("Revisions in the address win over the last selection", async () => {
        await mount("app-1", "rev-1")
        act(() => root.render(null))
        // A plain link: no hash from the visit before.
        setHash("")

        await mount("app-1", "rev-2")

        expect(selection.revisionIds).toEqual(["rev-2"])
    })

    it("A last selection that no longer resolves opens the latest revision", async () => {
        window.localStorage.setItem(
            "agenta:playground:last-selection",
            JSON.stringify({"app-1": ["rev-gone"]}),
        )

        await mount("app-1")

        expect(selection.revisionIds).toEqual(["rev-2"])
    })

    it("Unreadable stored data is ignored", async () => {
        window.localStorage.setItem("agenta:playground:last-selection", "{not json")

        await mount("app-1")

        expect(selection.revisionIds).toEqual(["rev-2"])
    })
})

describe("a link into the open playground", () => {
    it("A new snapshot for the same app replaces what the page showed", async () => {
        await mount("app-1", "rev-1")

        setHash(
            snapshotHash({
                selection: [{kind: "commit", id: "rev-2", runnableType: "workflow"}],
                drafts: [],
                localTestset: {rows: [{data: {country: "Chile"}}], name: null},
            }),
        )
        router.query = {...router.query, revisions: "rev-2"}
        emitRoute("routeChangeComplete", "/m/new", false)
        await settle()

        expect(selection.revisionIds).toEqual(["rev-2"])
        expect(firstRowData()).toEqual([{country: "Chile"}])
    })

    it("A link that changes only the hash replaces what the page showed", async () => {
        await mount("app-1", "rev-1")

        setHash(
            snapshotHash({
                selection: [{kind: "commit", id: "rev-1", runnableType: "workflow"}],
                drafts: [],
                localTestset: {rows: [{data: {country: "Kenya"}}], name: null},
            }),
        )
        emitRoute("hashChangeComplete", "/m/hash", false)
        await settle()

        expect(firstRowData()).toEqual([{country: "Kenya"}])
    })

    it("The page's own address writes do not restart it", async () => {
        await mount("app-1", "rev-1")
        const nodeId = store.get(playgroundController.selectors.nodes())[0]?.id

        emitRoute("routeChangeComplete", "/m/same", true)
        await settle()

        expect(store.get(playgroundController.selectors.nodes())[0]?.id).toBe(nodeId)
    })

    it("A shallow change of the hash alone that drops it gets it back", async () => {
        await mount("app-1", "rev-1")
        expect(window.location.hash.startsWith("#pgSnapshot=")).toBe(true)

        // The trace drawer writes `?trace=` from the search alone.
        setHash("")
        emitRoute("hashChangeComplete", "/m/trace", true)
        await settle()

        expect(window.location.hash.startsWith("#pgSnapshot=")).toBe(true)
    })
})

describe("evaluators in a snapshot", () => {
    it("An evaluator after the app is connected again", async () => {
        setHash(
            snapshotHash({
                selection: [
                    {
                        kind: "commit",
                        id: "rev-1",
                        runnableType: "workflow",
                        depth: 0,
                        entityType: "workflow",
                    },
                    {
                        kind: "commit",
                        id: "ev-rev-1",
                        runnableType: "workflow",
                        depth: 1,
                        entityType: "workflow",
                        label: "Exact match",
                    },
                ],
                drafts: [],
            }),
        )
        await mount("app-1", "rev-1")

        const graph = store.get(playgroundController.selectors.nodes())
        expect(graph.map((node) => [node.entityId, node.depth])).toEqual([
            ["rev-1", 0],
            ["ev-rev-1", 1],
        ])
        expect(selection.revisionIds).toEqual(["rev-1"])
    })

    it("The address keeps an evaluator draft until its revision loads", async () => {
        const hash = snapshotHash({
            selection: [
                {
                    kind: "commit",
                    id: "rev-1",
                    runnableType: "workflow",
                    depth: 0,
                    entityType: "workflow",
                },
                {
                    kind: "draft",
                    draftKey: "dk-ev",
                    runnableType: "workflow",
                    depth: 1,
                    entityType: "workflow",
                },
            ],
            drafts: [
                {
                    draftKey: "dk-ev",
                    sourceRevisionId: "ev-slow",
                    runnableType: "workflow",
                    patch: {parameters: {threshold: 0.8}},
                },
            ],
        })
        setHash(hash)
        await mount("app-1", "rev-1")

        // `ev-slow` never answers here: the hash must stay the one that holds its draft.
        expect(window.location.hash).toBe(`#${hash}`)
    })
})
