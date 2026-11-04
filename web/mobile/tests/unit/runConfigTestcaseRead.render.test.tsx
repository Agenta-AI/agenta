// @vitest-environment jsdom
import {act, createElement} from "react"

import {sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Only the HTTP layer is fake: the test set queries, the column atoms and the rows are real.
const http = vi.hoisted(() => ({post: vi.fn(), get: vi.fn()}))
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<typeof import("@agenta/shared/api")>()),
    axios: http,
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {TestsetRows} from "@/features/evaluation-run/configuration/TestsetRows"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const REVISION_ID = "0b0c5a4e-3d57-4b8e-9d0e-7f1d6a2a9c11"

let host: HTMLDivElement
let root: Root

async function mount() {
    const store = createStore()
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    store.set(sessionAtom, true)
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(TestsetRows, {
                        projectId: "pr",
                        testset: {testsetId: "ts-1", revisionId: REVISION_ID},
                    }),
                ),
            ),
        )
    })
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)))
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    http.post.mockReset()
    http.get.mockReset()
    http.get.mockResolvedValue({data: {}})
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("test case read on the Configuration tab", () => {
    it("A failed read says the columns could not load, not that there is no metadata", async () => {
        http.post.mockRejectedValue(new Error("network"))
        await mount()
        expect(host.textContent).toContain("Could not load the columns.")
        expect(host.textContent).not.toContain("No column metadata.")
    })
})
