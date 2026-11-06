// @vitest-environment jsdom
/**
 * Sending test cases from the test set editor to an annotation queue, over the real queue
 * state and the real picker. Only HTTP, the router, the lazy loader and the toast are replaced,
 * so the test checks the request that reaches the server.
 */
import {act} from "react"

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const http = vi.hoisted(() => ({get: vi.fn(), post: vi.fn(), put: vi.fn()}))
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
}))
vi.mock("next/router", () => ({
    useRouter: () => ({query: {workspace_id: "w-1", project_id: "p-1"}, push: vi.fn()}),
}))
// The page loads the picker lazily; here the only lazy module is the picker, loaded at once.
vi.mock("next/dynamic", async () => {
    const picker = await import("@/features/annotations/AddToQueuePicker")
    return {default: () => picker.default}
})
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
}

import {TestcaseQueueButton} from "@/features/testsets/detail/TestcaseQueuePicker"

const queue = (id: string, name: string, kind: string) => ({
    id,
    name,
    run_id: `run-${id}`,
    data: {kind},
    updated_at: "2026-11-01T10:00:00Z",
})

const store = getDefaultStore()

const flush = async () => {
    for (let round = 0; round < 10; round++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
}

describe("Send test cases to an annotation queue", () => {
    let root: Root
    let host: HTMLDivElement
    let queryClient: QueryClient

    beforeEach(() => {
        vi.clearAllMocks()
        http.post.mockImplementation(async (url: string) => {
            if (url.endsWith("/simple/queues/query")) {
                return {
                    data: {
                        count: 2,
                        queues: [
                            queue("q-1", "Support replies", "traces"),
                            queue("q-2", "Label capitals", "testcases"),
                        ],
                    },
                }
            }
            if (url.endsWith("/simple/queues/q-2/testcases/")) {
                return {data: {count: 1, queue_id: "q-2"}}
            }
            throw new Error(`Unexpected POST ${url}`)
        })
        queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        store.set(queryClientAtom, queryClient)
        store.set(projectIdAtom, "p-1")
        store.set(sessionAtom, true)
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        document.body.innerHTML = ""
    })

    const button = (name: string) =>
        Array.from(document.body.querySelectorAll("button")).find(
            (element) => element.textContent?.trim() === name,
        )

    it("Picking a test case queue sends the test case ids to it", async () => {
        act(() =>
            root.render(
                <QueryClientProvider client={queryClient}>
                    <TestcaseQueueButton
                        label="Add annotation queue"
                        itemIds={["case-1", "case-2"]}
                    />
                </QueryClientProvider>,
            ),
        )
        await act(async () => button("Add annotation queue")?.click())
        // The picker code loads on the first open.
        await flush()

        // Only test case queues are offered.
        expect(document.body.textContent).toContain("Label capitals")
        expect(document.body.textContent).not.toContain("Support replies")

        const pick = Array.from(document.body.querySelectorAll("li button")).find((row) =>
            row.textContent?.includes("Label capitals"),
        )
        await act(async () => (pick as HTMLButtonElement | undefined)?.click())
        await flush()

        const adds = http.post.mock.calls.filter(([url]) =>
            String(url).endsWith("/simple/queues/q-2/testcases/"),
        )
        expect(adds).toHaveLength(1)
        expect(adds[0][1]).toEqual({testcase_ids: ["case-1", "case-2"]})
        expect(adds[0][2]).toEqual({params: {project_id: "p-1"}})
    })

    it("With no saved test case the button is off and sends nothing", async () => {
        act(() => root.render(<TestcaseQueueButton label="Add to queue" itemIds={[]} />))
        expect(button("Add to queue")?.disabled).toBe(true)
        expect(http.post).not.toHaveBeenCalled()
    })
})
