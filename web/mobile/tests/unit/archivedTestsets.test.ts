// @vitest-environment jsdom
import {act, createElement} from "react"

import {queryTestsetsPage, type Testset} from "@agenta/entities/testset"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    ARCHIVED_TESTSETS_PAGE_SIZE,
    useArchivedTestsets,
} from "@/features/testsets/archived/useArchivedTestsets"

vi.mock("@agenta/entities/testset", () => ({
    queryTestsetsPage: vi.fn(),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const testset = (id: string, deletedAt: string | null) =>
    ({id, name: id, deleted_at: deletedAt}) as unknown as Testset

type ListResult = ReturnType<typeof useArchivedTestsets>

let latest: ListResult | null = null

const result = (): ListResult => {
    if (!latest) throw new Error("The probe did not render")
    return latest
}

function Probe(props: {projectId: string; search: string}) {
    latest = useArchivedTestsets(props)
    return null
}

describe("Archived testsets", () => {
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

    it("Archived testsets keep rows with an archive date only", async () => {
        vi.mocked(queryTestsetsPage).mockResolvedValue({
            testsets: [testset("Alpha set", "2026-10-01T00:00:00Z"), testset("Beta set", null)],
            nextCursor: null,
        })

        await renderProbe("")
        await settle(() => expect(result().isPending).toBe(false))
        expect(result().testsets.map((row) => row.id)).toEqual(["Alpha set"])
    })

    it("Archived testsets follow every page cursor", async () => {
        vi.mocked(queryTestsetsPage)
            .mockResolvedValueOnce({
                testsets: [testset("Alpha set", "2026-10-01T00:00:00Z"), testset("Beta set", null)],
                nextCursor: "c1",
            })
            .mockResolvedValueOnce({
                testsets: [testset("Gamma set", "2026-10-03T00:00:00Z")],
                nextCursor: null,
            })

        await renderProbe("")
        await settle(() => expect(result().isPending).toBe(false))
        expect(queryTestsetsPage).toHaveBeenCalledTimes(2)
        expect(queryTestsetsPage).toHaveBeenLastCalledWith(expect.objectContaining({cursor: "c1"}))
        expect(
            result()
                .testsets.map((row) => row.id)
                .sort(),
        ).toEqual(["Alpha set", "Gamma set"])
    })

    it("Archived testsets are sorted by archive date, newest first", async () => {
        vi.mocked(queryTestsetsPage).mockResolvedValue({
            testsets: [
                testset("Old set", "2026-09-01T00:00:00Z"),
                testset("New set", "2026-10-05T00:00:00Z"),
                testset("Mid set", "2026-09-20T00:00:00Z"),
            ],
            nextCursor: null,
        })

        await renderProbe("")
        await settle(() => expect(result().isPending).toBe(false))
        expect(result().testsets.map((row) => row.id)).toEqual(["New set", "Mid set", "Old set"])
    })

    it("Archived testsets send the search term as the name filter", async () => {
        vi.mocked(queryTestsetsPage).mockResolvedValue({testsets: [], nextCursor: null})

        await renderProbe("alpha")
        await settle(() => expect(result().isPending).toBe(false))
        expect(queryTestsetsPage).toHaveBeenLastCalledWith({
            projectId: "p1",
            limit: ARCHIVED_TESTSETS_PAGE_SIZE,
            cursor: null,
            name: "alpha",
            includeArchived: true,
        })
    })

    it("A failed archived testsets request reports an error, not an empty list", async () => {
        vi.mocked(queryTestsetsPage).mockRejectedValue(new Error("boom"))

        await renderProbe("")
        await settle(() => expect(result().isError).toBe(true))
        expect(result().testsets).toEqual([])
    })
})
