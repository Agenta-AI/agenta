// @vitest-environment jsdom
import {act, createElement} from "react"

import {queryTestsetsPage, type Testset} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useTestsetsList} from "@/features/testsets/list/useTestsetsList"

vi.mock("@agenta/ui/app-message", () => ({message: {error: vi.fn()}}))
vi.mock("@agenta/entities/testset", () => ({
    queryTestsetsPage: vi.fn(),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const alpha = {id: "t-alpha", name: "Alpha set"} as Testset
const beta = {id: "t-beta", name: "Beta set"} as Testset

type ListResult = ReturnType<typeof useTestsetsList>

let latest: ListResult | null = null

const result = (): ListResult => {
    if (!latest) throw new Error("The probe did not render")
    return latest
}

function Probe(props: {projectId: string; search: string}) {
    latest = useTestsetsList(props)
    return null
}

describe("Testsets list", () => {
    let root: Root
    let host: HTMLDivElement
    let client: QueryClient

    const renderProbe = (search: string) =>
        act(async () => {
            root.render(
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(Probe, {projectId: "p1", search}),
                ),
            )
        })

    const settle = (check: () => void) => act(() => vi.waitFor(check))

    beforeEach(() => {
        vi.mocked(queryTestsetsPage).mockReset()
        latest = null
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        client.clear()
    })

    it("sends the search term as the name filter", async () => {
        vi.mocked(queryTestsetsPage).mockResolvedValue({testsets: [alpha], nextCursor: null})

        await renderProbe("  alpha ")
        await settle(() => expect(result().isPending).toBe(false))
        expect(queryTestsetsPage).toHaveBeenLastCalledWith(
            expect.objectContaining({projectId: "p1", limit: 50, name: "alpha"}),
        )

        await renderProbe("")
        await settle(() => expect(result().isPending).toBe(false))
        expect(queryTestsetsPage).toHaveBeenLastCalledWith(
            expect.objectContaining({projectId: "p1", name: undefined}),
        )
    })

    it("loads the next page with the cursor", async () => {
        vi.mocked(queryTestsetsPage)
            .mockResolvedValueOnce({testsets: [alpha], nextCursor: "c1"})
            .mockResolvedValueOnce({testsets: [beta], nextCursor: null})

        await renderProbe("")
        await settle(() => expect(result().testsets).toHaveLength(1))

        await act(async () => {
            result().loadMore()
        })
        await settle(() => expect(result().testsets).toHaveLength(2))

        expect(queryTestsetsPage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({cursor: "c1"}),
        )
        expect(result().testsets).toEqual([alpha, beta])
    })

    it("has no more pages when the cursor is empty", async () => {
        vi.mocked(queryTestsetsPage).mockResolvedValue({testsets: [alpha], nextCursor: null})

        await renderProbe("")
        await settle(() => expect(result().isPending).toBe(false))

        expect(result().hasMore).toBe(false)
    })

    it("A failed testsets list request reports an error, not an empty list", async () => {
        vi.mocked(queryTestsetsPage).mockRejectedValue(new Error("boom"))

        await renderProbe("")
        await settle(() => expect(result().isError).toBe(true))

        expect(result().isPending).toBe(false)
        expect(result().testsets).toEqual([])
    })

    it("A failed Load more says so and keeps the loaded testsets", async () => {
        vi.mocked(queryTestsetsPage)
            .mockResolvedValueOnce({testsets: [alpha], nextCursor: "c1"})
            .mockRejectedValueOnce(new Error("boom"))

        await renderProbe("")
        await settle(() => expect(result().testsets).toHaveLength(1))
        await act(async () => {
            result().loadMore()
        })
        await settle(() =>
            expect(message.error).toHaveBeenCalledWith("Couldn't load more test sets"),
        )

        expect(result().testsets).toEqual([alpha])
    })
})
