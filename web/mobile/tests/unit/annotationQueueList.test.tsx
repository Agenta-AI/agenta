// @vitest-environment jsdom
// The data hooks behind the annotation queues list, run over the real queue store and the real
// pagination hook. Only the HTTP client is replaced.
import {act} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const http = vi.hoisted(() => ({
    post: vi.fn(),
    delete: vi.fn(),
    success: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        getAgentaApiUrl: () => "http://api.test",
        axios: {...actual.axios, post: http.post, delete: http.delete},
    }
})

vi.mock("@agenta/ui/app-message", () => ({
    message: {success: http.success, error: vi.fn()},
}))

const router = vi.hoisted(() => ({push: vi.fn(async () => true)}))
vi.mock("next/router", () => ({useRouter: () => router}))

import {QueueDeleteCard} from "@/features/annotations/QueueDeleteCard"
import {useQueueList} from "@/features/annotations/useQueueList"

const queue = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    run_id: `run-${id}`,
    flags: {is_default: true},
    data: {kind: "traces"},
    ...extra,
})

const queryBodies = () =>
    http.post.mock.calls
        .filter(([url]) => String(url).endsWith("/simple/queues/query"))
        .map(
            ([, body]) =>
                body as {queue?: Record<string, unknown>; windowing?: Record<string, unknown>},
        )

const ListProbe = ({expose}: {expose: (value: ReturnType<typeof useQueueList>) => void}) => {
    expose(useQueueList())
    return null
}

describe("annotation queue list data", () => {
    let root: Root
    let host: HTMLElement
    let latest: ReturnType<typeof useQueueList>

    const mountList = async () => {
        await act(async () => {
            root.render(<ListProbe expose={(value) => (latest = value)} />)
        })
        await settle()
    }
    const settle = async (ms = 50) => {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, ms))
        })
    }

    beforeEach(() => {
        http.post.mockReset()
        http.delete.mockReset()
        http.success.mockReset()
        const store = getDefaultStore()
        store.set(
            queryClientAtom,
            new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}}),
        )
        store.set(projectIdAtom, "project-1")
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
        const store = getDefaultStore()
        store.set(projectIdAtom, null)
    })

    it("The list asks for 50 queues, newest first", async () => {
        http.post.mockResolvedValue({
            data: {
                queues: [
                    queue("q-1", "Triage"),
                    queue("q-2", "Hidden copy", {flags: {is_default: false}}),
                    queue("q-3", "Evaluation queue", {data: {kind: "testsets"}}),
                    queue("q-4", "Golden set", {data: {kind: "testcases"}}),
                ],
                windowing: {next: null},
            },
        })
        await mountList()

        expect(queryBodies()[0]?.windowing).toMatchObject({limit: 50, order: "descending"})
        // Only default queues of kind traces or test cases stay in the list.
        expect(latest.rows.map((row) => row.name)).toEqual(["Triage", "Golden set"])
    })

    it("Typing a search term sends it as the name filter", async () => {
        http.post.mockResolvedValue({data: {queues: [], windowing: {next: null}}})
        await mountList()
        const before = queryBodies().length

        await act(async () => latest.setSearch("tri"))
        // The term waits for the 300 ms debounce: nothing is sent yet.
        await settle(100)
        expect(queryBodies().length).toBe(before)

        await settle(350)
        const last = queryBodies().at(-1)
        expect(last?.queue).toMatchObject({name: "tri"})
    })

    it("Choosing Traces sends the traces kind", async () => {
        http.post.mockResolvedValue({data: {queues: [], windowing: {next: null}}})
        await mountList()

        await act(async () => latest.setKind("traces"))
        await settle()

        expect(queryBodies().at(-1)?.queue).toMatchObject({kind: "traces"})
    })

    it("Reaching the end loads the next page with the cursor", async () => {
        http.post
            .mockResolvedValueOnce({
                data: {queues: [queue("q-1", "Triage")], windowing: {next: "cursor-1"}},
            })
            .mockResolvedValueOnce({
                data: {queues: [queue("q-2", "Refunds")], windowing: {next: null}},
            })
        await mountList()
        expect(latest.hasMore).toBe(true)

        await act(async () => latest.loadMore())
        await settle()

        expect(queryBodies()[1]?.windowing).toMatchObject({next: "cursor-1", limit: 50})
        expect(latest.rows.map((row) => row.name)).toEqual(["Triage", "Refunds"])
        expect(latest.hasMore).toBe(false)
    })

    it("A failed load reports an error and retries", async () => {
        http.post.mockRejectedValue(new Error("boom"))
        await mountList()
        expect(latest.isError).toBe(true)
        expect(latest.isLoading).toBe(false)

        http.post.mockReset()
        http.post.mockResolvedValue({
            data: {queues: [queue("q-1", "Triage")], windowing: {next: null}},
        })
        await act(async () => latest.refetch())
        await settle()

        expect(latest.isError).toBe(false)
        expect(latest.rows.map((row) => row.name)).toEqual(["Triage"])
    })
})

describe("annotation queue delete", () => {
    let root: Root
    let host: HTMLElement

    const buttonNamed = (name: string) =>
        [...document.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === name,
        )
    const mountCard = async (queueName: string | null) => {
        await act(async () =>
            root.render(<QueueDeleteCard queueId="q-1" queueName={queueName} listHref="/queues" />),
        )
        await act(async () => buttonNamed("Delete queue")?.click())
    }

    beforeEach(() => {
        http.delete.mockReset()
        http.post.mockReset()
        http.success.mockReset()
        router.push.mockClear()
        const store = getDefaultStore()
        store.set(
            queryClientAtom,
            new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}}),
        )
        store.set(projectIdAtom, "project-1")
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
        getDefaultStore().set(projectIdAtom, null)
    })

    it("Confirming delete calls the delete endpoint once, then returns to the list", async () => {
        let release: (value: unknown) => void = () => undefined
        http.delete.mockImplementation(() => new Promise((resolve) => (release = resolve)))
        await mountCard("Triage")
        expect(document.body.textContent).toContain(
            "Are you sure you want to delete the following?",
        )
        expect(document.body.textContent).toContain("Annotation queue")
        expect(document.body.textContent).toContain("Triage")

        // Two clicks while the request runs: one request.
        const confirm = buttonNamed("Delete")
        await act(async () => {
            confirm?.click()
            confirm?.click()
        })
        expect(http.delete).toHaveBeenCalledTimes(1)
        expect(String(http.delete.mock.calls[0][0])).toBe("http://api.test/simple/queues/q-1")

        await act(async () => release({data: {count: 1, queue_id: "q-1"}}))
        expect(http.success).toHaveBeenCalledWith("Deleted successfully")
        expect(router.push).toHaveBeenCalledWith("/queues")
        expect(document.querySelector("[role='alertdialog']")).toBeNull()
    })

    it("A failed delete shows Couldn't delete this queue without the API text", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        http.delete.mockRejectedValue(new Error("403 forbidden: secret detail"))
        await mountCard(null)
        expect(document.body.textContent).toContain("Untitled queue")

        await act(async () => buttonNamed("Delete")?.click())

        expect(document.body.textContent).toContain("Couldn't delete this queue")
        expect(document.body.textContent).not.toContain("secret detail")
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })
})
