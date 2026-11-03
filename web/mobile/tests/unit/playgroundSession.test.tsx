// @vitest-environment jsdom
/**
 * The prompt playground's selection lifecycle (`usePlaygroundSession`), on the real playground
 * controller and the real workflow queries. Only HTTP is mocked: the workflow endpoints answer
 * from the fixtures below.
 */
import {act} from "react"

import {playgroundController} from "@agenta/playground"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    usePlaygroundSession,
    type PlaygroundSession,
} from "@/features/playground/usePlaygroundSession"

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
let revisions = [
    revision("rev-1", "app-1", 1),
    revision("rev-2", "app-1", 2),
    revision("rev-x", "app-2", 1),
    revision("rev-a", "agent-app", 1, {is_agent: true}),
]
let failRevisions = false

http.post.mockImplementation(async (url: string, body: Record<string, {id: string}[]>) => {
    if (url.endsWith("/workflows/query")) {
        const ids = (body.workflow_refs ?? []).map((ref) => ref.id)
        return {data: {count: 1, workflows: ids.flatMap((id) => apps[id] ?? [])}}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        if (failRevisions) throw new Error("network down")
        const byId = (body.workflow_revision_refs ?? []).map((ref) => ref.id)
        const byApp = (body.workflow_refs ?? []).map((ref) => ref.id)
        const found = revisions.filter(
            (item) => byId.includes(item.id) || byApp.includes(item.workflow_id),
        )
        return {data: {count: found.length, workflow_revisions: found}}
    }
    return {data: {}}
})
http.get.mockResolvedValue({data: {}})

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let session: PlaygroundSession

const Harness = ({appId}: {appId: string}) => {
    session = usePlaygroundSession({appId})
    return null
}

const settle = async () => {
    for (let i = 0; i < 10; i++) {
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
    host.remove()
})

describe("usePlaygroundSession", () => {
    it("Revisions in the URL are selected in order", async () => {
        await mount("app-1", "rev-2,rev-1")

        expect(session.entityIds).toEqual(["rev-2", "rev-1"])
        expect(session.primaryId).toBe("rev-2")
        expect(session.status).toBe("ready")
    })

    it("Without revisions the latest revision is selected", async () => {
        await mount("app-1")

        expect(session.entityIds).toEqual(["rev-2"])
        expect(session.status).toBe("ready")
    })

    it("The selection is written to the revisions query parameter", async () => {
        await mount("app-1")

        expect(router.replace).toHaveBeenCalledWith(
            {pathname: router.pathname, query: expect.objectContaining({revisions: "rev-2"})},
            undefined,
            {shallow: true},
        )
    })

    it("Local draft ids are not written to the URL", async () => {
        await mount("app-1", "rev-1")
        router.replace.mockClear()

        act(() => store.set(playgroundController.actions.setEntityIds, ["rev-1", "local-abc"]))
        await settle()

        expect(router.replace).not.toHaveBeenCalled()
        expect(router.query.revisions).toBe("rev-1")
    })

    it("An id that does not resolve is dropped and the latest revision is selected", async () => {
        await mount("app-1", "rev-missing")

        expect(session.entityIds).toEqual(["rev-2"])
        expect(router.query.revisions).toBe("rev-2")
    })

    it("A revision of another app is dropped", async () => {
        await mount("app-1", "rev-1,rev-x")

        expect(session.entityIds).toEqual(["rev-1"])
        expect(router.query.revisions).toBe("rev-1")
    })

    it("Unmount clears the playground nodes and runs", async () => {
        await mount("app-1", "rev-1")
        expect(nodes()).not.toHaveLength(0)

        act(() => root.render(null))

        expect(nodes()).toEqual([])
    })

    it("Changing the app clears the previous app's selection", async () => {
        await mount("app-1", "rev-1")

        router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-2"}
        act(() => root.render(<Harness appId="app-2" />))
        await settle()

        expect(session.entityIds).toEqual(["rev-x"])
        expect(nodes().map((node) => node.entityId)).toEqual(["rev-x"])
    })

    it("An agent app reports agent", async () => {
        await mount("agent-app")

        expect(session.status).toBe("agent")
    })

    it("An unknown app reports not-found", async () => {
        await mount("app-unknown")

        expect(session.status).toBe("not-found")
        expect(nodes()).toEqual([])
    })

    it("A failed revision load reports error and retry refetches", async () => {
        failRevisions = true
        await mount("app-1", "rev-1")
        expect(session.status).toBe("error")

        failRevisions = false
        act(() => session.retry())
        await settle()

        expect(session.status).toBe("ready")
        expect(session.entityIds).toEqual(["rev-1"])
    })
})
