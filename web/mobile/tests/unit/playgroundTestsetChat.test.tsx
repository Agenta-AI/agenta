// @vitest-environment jsdom
/**
 * The test set menu model in a chat playground, on the real controllers with only HTTP mocked.
 * A chat playground holds one test case, and its conversation comes from that test case.
 */
import {act} from "react"

import {fetchTestcasesPage} from "@agenta/entities/testcase"
import {executionItemController} from "@agenta/playground"
import {useTestsetMenuModel, type TestsetMenuModel} from "@agenta/playground-ui/hooks"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {settle} from "../support/playgroundHarness"

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
const REVISION = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
const LISBON = "a1b2c3d4-0000-4000-8000-000000000001"
const OSLO = "a1b2c3d4-0000-4000-8000-000000000002"
const rows = [
    {
        id: LISBON,
        testset_id: TESTSET,
        data: {name: "Alex", messages: [{role: "user", content: "A weekend in Lisbon?"}]},
    },
    {
        id: OSLO,
        testset_id: TESTSET,
        data: {name: "Sam", messages: [{role: "user", content: "A week in Oslo?"}]},
    },
]

const chatRevision = {
    id: "rev-chat-1",
    version: 2,
    name: "default",
    workflow_id: "app-1",
    workflow_variant_id: "app-1-variant",
    flags: {is_application: true, is_chat: true},
    created_at: "2026-11-01T00:00:00Z",
    data: {
        uri: "agenta:builtin:chat:v0",
        parameters: {
            prompt: {
                messages: [{role: "system", content: "You help {{name}} plan trips."}],
                llm_config: {model: "gpt-4o-mini"},
            },
        },
    },
}

http.get.mockResolvedValue({data: {}})
http.post.mockImplementation(async (url: string) => {
    if (url.endsWith("/workflows/query")) {
        return {data: {count: 1, workflows: [{id: "app-1", name: "Trips", flags: {}}]}}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        return {data: {count: 1, workflow_revisions: [chatRevision]}}
    }
    if (url.endsWith("/testcases/query")) {
        return {data: {count: rows.length, testcases: rows, windowing: {next: null}}}
    }
    return {data: {}}
})

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let projectId = "proj-800"
let model: TestsetMenuModel | null = null

const Probe = () => {
    model = useTestsetMenuModel()
    return null
}
const Harness = () => {
    const {status} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" ? <Probe /> : null
}
const userMessages = () => {
    const byId = store.get(executionItemController.selectors.messagesById) as Record<
        string,
        {role: string; content: unknown}
    >
    return (store.get(executionItemController.selectors.messageIds) as string[])
        .map((id) => byId[id])
        .filter((message) => message?.role === "user")
        .map((message) => message.content)
}

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
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

describe("The test set menu in a chat playground", () => {
    it("Managing the test cases loads the conversation of the newly picked one", async () => {
        await act(async () => {
            await fetchTestcasesPage({projectId, revisionId: REVISION})
        })
        expect(model!.isChat).toBe(true)
        await act(async () =>
            model!.confirmLoad({
                revisionId: REVISION,
                testcaseIds: [LISBON],
                testsetName: "Trips",
                testsetId: TESTSET,
                revisionVersion: 2,
            }),
        )
        await settle()
        expect(userMessages()).toEqual(["A weekend in Lisbon?"])

        act(() => model!.manage())
        await act(async () => model!.confirmEdit({revisionId: REVISION, testcaseIds: [OSLO]}))
        await settle()

        expect(userMessages()).toEqual(["A week in Oslo?"])
        expect(model!.connectedRevisionId).toBe(REVISION)
        expect(model!.label).toBe("Trips (v2)")
    })
})
