// @vitest-environment jsdom
/**
 * The prompt playground's selection lifecycle (`usePlaygroundSelection`), on the real playground
 * controller and the real workflow queries. Only HTTP is mocked: the workflow endpoints answer
 * from the fixtures below.
 */
import {act} from "react"

import {createLocalDraftFromWorkflowRevision, workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
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

// Long enough for the address write, which waits for the edits to stop.
const settle = async () => {
    for (let i = 0; i < 30; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}

const mount = async (appId: string, revisionsParam?: string) => {
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: appId}
    if (revisionsParam) router.query.revisions = revisionsParam
    act(() => root.render(<Harness appId={appId} />))
    await settle()
}

const nodes = () => store.get(playgroundController.selectors.nodes())

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    failRevisions = false
    holdApp = null
    added = []
    // Each test opens with no remembered selection.
    window.localStorage.clear()
    router.replace.mockReset()
    router.replace.mockImplementation(async ({query}: {query: Record<string, string>}) => {
        router.query = query
        return true
    })
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

describe("usePlaygroundSelection", () => {
    it("Revisions in the URL are selected in order", async () => {
        await mount("app-1", "rev-2,rev-1")

        expect(selection.revisionIds).toEqual(["rev-2", "rev-1"])
        expect(selection.primaryRevisionId).toBe("rev-2")
        expect(selection.status).toBe("ready")
        expect(selection.appKind).toBe("prompt")
    })

    it("Without revisions the latest revision is selected", async () => {
        await mount("app-1")

        expect(selection.revisionIds).toEqual(["rev-2"])
        expect(selection.status).toBe("ready")
    })

    it("Without revisions the latest revision opens when it answers before the app", async () => {
        let releaseApp = () => undefined as void
        holdApp = new Promise((resolve) => {
            releaseApp = resolve
        })
        await mount("app-1")
        expect(selection.status).toBe("loading")

        releaseApp()
        await settle()

        expect(selection.revisionIds).toEqual(["rev-2"])
        expect(selection.status).toBe("ready")
    })

    it("Without revisions a newer variant's empty seed is skipped for the latest revision", async () => {
        added = [
            {...revision("rev-seed", "app-1", 0), created_at: "2026-11-05T00:00:00Z", data: null},
        ]

        await mount("app-1")

        expect(selection.revisionIds).toEqual(["rev-2"])
        expect(selection.status).toBe("ready")
    })

    it("A new variant with an empty seed and a later revision opens the later revision", async () => {
        added = [
            {
                ...revision("rev-seed", "app-1", 0),
                workflow_variant_id: "app-1-variant-2",
                created_at: "2026-11-05T00:00:00Z",
                data: null,
            },
            {
                ...revision("rev-new", "app-1", 1),
                workflow_variant_id: "app-1-variant-2",
                created_at: "2026-11-06T00:00:00Z",
            },
        ]

        await mount("app-1")

        expect(selection.revisionIds).toEqual(["rev-new"])
        expect(selection.status).toBe("ready")
    })

    it("A version 0 that holds a config opens as the latest revision", async () => {
        apps["app-v0"] = {id: "app-v0", name: "Seeded", flags: {}}
        added = [
            {
                ...revision("rev-v0", "app-v0", 0),
                created_at: "2026-11-05T00:00:00Z",
                data: {
                    uri: "agenta:builtin:completion:v0",
                    parameters: {prompt: {messages: [{role: "user", content: "Hi"}]}},
                },
            },
        ]

        await mount("app-v0")

        expect(selection.revisionIds).toEqual(["rev-v0"])
        expect(selection.status).toBe("ready")
    })

    it("The selection is written to the revisions query parameter", async () => {
        await mount("app-1")

        expect(router.replace).toHaveBeenCalledWith(
            expect.objectContaining({
                pathname: router.pathname,
                query: expect.objectContaining({revisions: "rev-2"}),
            }),
            undefined,
            {shallow: true, scroll: false},
        )
    })

    it("A local draft is named by its revision in the URL and kept in the hash", async () => {
        await mount("app-1", "rev-1")
        const localId = createLocalDraftFromWorkflowRevision("rev-1")!
        router.replace.mockClear()

        act(() => store.set(playgroundController.actions.setEntityIds, ["rev-1", localId]))
        await settle()

        expect(selection.revisionIds).toEqual(["rev-1", localId])
        expect(router.query.revisions).toBe("rev-1")
        expect(router.replace).toHaveBeenLastCalledWith(
            expect.objectContaining({hash: expect.stringMatching(/^pgSnapshot=/)}),
            undefined,
            {shallow: true, scroll: false},
        )
    })

    it("A local draft id with no draft behind it is dropped", async () => {
        await mount("app-1", "local-missing")

        expect(selection.revisionIds).toEqual(["rev-2"])
        expect(selection.status).toBe("ready")
    })

    it("A foreign agent revision does not send a prompt app to the agent page", async () => {
        const kinds: (string | null)[] = []
        const Recorder = () => {
            selection = usePlaygroundSelection({appId: "app-1"})
            kinds.push(selection.appKind)
            return null
        }
        router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-1"}
        router.query.revisions = "rev-b"
        act(() => root.render(<Recorder />))
        await settle()

        expect(kinds).not.toContain("agent")
        expect(selection.revisionIds).toEqual(["rev-2"])
    })

    it("An id that does not resolve is dropped and the latest revision is selected", async () => {
        await mount("app-1", "rev-missing")

        expect(selection.revisionIds).toEqual(["rev-2"])
        expect(router.query.revisions).toBe("rev-2")
    })

    it("A revision of another app is dropped", async () => {
        await mount("app-1", "rev-1,rev-x")

        expect(selection.revisionIds).toEqual(["rev-1"])
        expect(router.query.revisions).toBe("rev-1")
    })

    it("Unmount clears the playground nodes and runs", async () => {
        await mount("app-1", "rev-1")
        expect(nodes()).not.toHaveLength(0)

        act(() => root.render(null))

        expect(nodes()).toEqual([])
    })

    it("Leaving keeps the edits of a saved revision and drops a local copy", async () => {
        await mount("app-1", "rev-1")
        const localId = createLocalDraftFromWorkflowRevision("rev-1")!
        act(() => {
            store.set(playgroundController.actions.setEntityIds, ["rev-1", localId])
            workflowMolecule.set.update("rev-1", {
                data: {uri: "agenta:builtin:completion:v0", parameters: {temperature: 0.9}},
            })
        })
        await settle()
        expect(store.get(workflowMolecule.selectors.isDirty("rev-1"))).toBe(true)

        act(() => root.render(null))

        expect(store.get(workflowMolecule.selectors.isDirty("rev-1"))).toBe(true)
        expect(store.get(workflowMolecule.selectors.data(localId))).toBeNull()
    })

    it("Coming back shows the kept edit as a draft of the same revision", async () => {
        await mount("app-1", "rev-1")
        act(() => {
            workflowMolecule.set.update("rev-1", {
                data: {uri: "agenta:builtin:completion:v0", parameters: {temperature: 0.9}},
            })
        })
        await settle()
        act(() => root.render(null))

        await mount("app-1", "rev-1")

        expect(selection.revisionIds).toEqual(["rev-1"])
        expect(store.get(workflowMolecule.selectors.isDirty("rev-1"))).toBe(true)
        const parameters = store.get(workflowMolecule.selectors.data("rev-1"))?.data?.parameters
        expect(parameters).toMatchObject({temperature: 0.9})
    })

    it("Changing the app clears the previous app's selection", async () => {
        await mount("app-1", "rev-1")

        router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-2"}
        act(() => root.render(<Harness appId="app-2" />))
        await settle()

        expect(selection.revisionIds).toEqual(["rev-x"])
        expect(nodes().map((node) => node.entityId)).toEqual(["rev-x"])
    })

    it("An agent app reports the agent kind", async () => {
        await mount("agent-app")

        expect(selection.appKind).toBe("agent")
    })

    it("An unknown app reports not-found", async () => {
        await mount("app-unknown")

        expect(selection.status).toBe("not-found")
        expect(nodes()).toEqual([])
    })

    it("A failed revision load reports error and retry refetches", async () => {
        failRevisions = true
        await mount("app-1", "rev-1")
        expect(selection.status).toBe("error")

        failRevisions = false
        act(() => selection.retry())
        await settle()

        expect(selection.status).toBe("ready")
        expect(selection.revisionIds).toEqual(["rev-1"])
    })
})
